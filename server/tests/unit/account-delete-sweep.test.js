'use strict';
/**
 * The account-deletion sweep plan, and the order purgeUserAccount executes it in.
 *
 * Only two tables carry a foreign key to jv_users, so referential integrity does
 * almost nothing here — the declared sweep IS the integrity. Three properties
 * have to hold, and each one has a concrete failure behind it:
 *
 *   1. ORDER. jv_users must be deleted LAST, after every denormalized reference
 *      to it has been swept. Delete the row first and a mid-transaction abort
 *      leaves the account gone while ~40 columns across ~35 tables still name
 *      its owner — the leak this whole file exists to prevent.
 *      (The sweep used to open by WRITING a tombstone row. Deletion now keeps no
 *      record at all, so the first statement is the DELETE that removes any
 *      tombstone left over from that behaviour.)
 *   2. MODE. Three tables carry a UNIQUE constraint on the email column. Update
 *      them to one shared sentinel and the SECOND account deletion fails on
 *      23505 — a bug that cannot be reproduced with a single test user, which is
 *      exactly the kind that reaches production.
 *   3. TOLERANCE. This schema renames tables in conditional DO $$ blocks and
 *      carries 13 dead Phase-1 tables. A purge that threw on the first absent
 *      table would make deletion impossible; absence must be skipped AND
 *      reported, never silently swallowed.
 *
 * A mock client is used rather than a database: these are properties of the plan
 * and its execution order, not of PostgreSQL.
 */

const {
    ACCOUNT_DELETE_SWEEP,
    DELETED_ACTOR,
    SHARED_DB_UNVERIFIED,
    hashIdentity,
    assertSafeIdentifier,
    purgeUserAccount,
} = require('../../lib/account-deletion');

/** Columns with a UNIQUE that includes the user key — a shared sentinel would collide. */
const UNIQUE_ON_USER_KEY = [
    ['user_oauth_tokens', 'user_email'],
    ['jv_user_taxonomy_permissions', 'user_email'],
    ['jv_author_chat_sessions', 'user_email'],
    ['article_reactions', 'user_id'],
];

function mockClient({ missing = new Set(), extraColumns = [] } = {}) {
    const statements = [];
    const columns = ACCOUNT_DELETE_SWEEP
        .map((r) => ({ table_name: r.table, column_name: r.column }))
        .concat(extraColumns);
    return {
        statements,
        async query(sql, params) {
            if (/information_schema/.test(sql)) {
                return {
                    rows: columns.filter(
                        (c) => !missing.has(`${c.table_name}.${c.column_name}`)
                    ),
                };
            }
            statements.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
            return { rowCount: /DELETE FROM jv_users/.test(sql) ? 1 : 1, rows: [] };
        },
    };
}

const USER = {
    id: 42,
    email: 'lauren@example.com',
    role: 'user',
    sso_subject_id: 'sso|lauren@example.com',
};

describe('the sweep plan', () => {
    test('every entry declares a known mode', () => {
        const known = new Set(['cascade', 'delete', 'null', 'sentinel', 'deactivate', 'pseudonymize']);
        for (const rule of ACCOUNT_DELETE_SWEEP) {
            expect(known.has(rule.mode)).toBe(true);
        }
    });

    test('every table and column name is a safe SQL identifier', () => {
        // They are interpolated into SQL rather than bound, since a table name
        // cannot be a parameter. None is user input, but the assertion is cheap.
        for (const rule of ACCOUNT_DELETE_SWEEP) {
            expect(() => assertSafeIdentifier(rule.table)).not.toThrow();
            expect(() => assertSafeIdentifier(rule.column)).not.toThrow();
        }
    });

    test('columns with a UNIQUE on the user key are DELETEd, never anonymized', () => {
        for (const [table, column] of UNIQUE_ON_USER_KEY) {
            const rule = ACCOUNT_DELETE_SWEEP.find((r) => r.table === table && r.column === column);
            expect(rule).toBeDefined();
            expect(rule.mode).toBe('delete');
        }
    });

    test('credential-bearing tables are deleted, not merely unlinked', () => {
        // Anonymizing jv_api_keys would leave a working bearer credential with no
        // owner; user_oauth_tokens holds encrypted third-party secrets.
        for (const table of ['user_oauth_tokens', 'jv_api_keys']) {
            const rule = ACCOUNT_DELETE_SWEEP.find((r) => r.table === table);
            expect(rule.mode).toBe('delete');
        }
    });

    test('the audit trail is pseudonymized rather than deleted', () => {
        // Deleting it would let an admin erase their own trail by deleting an
        // account; keeping actor_id intact would make the privacy claim false.
        const rule = ACCOUNT_DELETE_SWEEP.find((r) => r.table === 'jv_audit_log');
        expect(rule.mode).toBe('pseudonymize');
    });

    test('the newsletter is suppressed rather than deleted', () => {
        const rule = ACCOUNT_DELETE_SWEEP.find((r) => r.table === 'jv_newsletter_subscribers');
        expect(rule.mode).toBe('deactivate');
    });

    test('the two cascading tables are still declared', () => {
        // Listed so a dropped FK constraint surfaces here rather than as a silent leak.
        const cascade = ACCOUNT_DELETE_SWEEP.filter((r) => r.mode === 'cascade').map((r) => r.table);
        expect(cascade.sort()).toEqual(['jv_cms_sessions', 'jv_refresh_tokens']);
    });

    test('the unverified shared tables are flagged for pre-production confirmation', () => {
        // server/CLAUDE.md warns this database is shared across a dozen sites and
        // calls a missing site filter the #1 recurring mistake. These three are
        // unprefixed, so their ownership must be confirmed before a DELETE ships.
        expect(SHARED_DB_UNVERIFIED).toEqual(
            expect.arrayContaining(['article_reactions', 'article_views', 'password_reset_tokens'])
        );
        for (const table of SHARED_DB_UNVERIFIED) {
            expect(ACCOUNT_DELETE_SWEEP.some((r) => r.table === table)).toBe(true);
        }
    });

    test('the sentinel is not email-shaped and not per-user', () => {
        // A per-user token would be re-identifiable via jv_deleted_accounts, and an
        // email-shaped one could be mistaken for a deliverable address.
        expect(DELETED_ACTOR).not.toMatch(/@/);
        expect(DELETED_ACTOR).toBe('deleted-user');
    });
});

describe('purgeUserAccount execution order', () => {
    test('no record of the account is written — any surviving tombstone is removed', async () => {
        // The product contract is that a deleted account is ABSENT from this
        // database, so nothing may INSERT a row describing it. Asserted as "no
        // INSERT anywhere in the sweep" rather than by inspecting one statement,
        // because the failure this guards against is a future re-addition of the
        // receipt row, wherever in the plan it lands.
        // The tombstone table is not part of the sweep plan, so the mock has to be
        // told it exists — which is the point of the guard in purgeUserAccount:
        // the table may legitimately have been dropped by hand, and a purge that
        // threw on its absence would make deletion impossible.
        const client = mockClient({ extraColumns: [{ table_name: 'jv_deleted_accounts', column_name: 'email_sha256' }] });
        await purgeUserAccount(client, USER, { actor: 'self' });
        expect(client.statements.some((s) => /^INSERT INTO jv_deleted_accounts/.test(s.sql))).toBe(false);
        expect(client.statements[0].sql).toMatch(/^DELETE FROM jv_deleted_accounts/);
    });

    test('a dropped tombstone table is skipped, not thrown', async () => {
        const client = mockClient();   // no jv_deleted_accounts column declared
        await purgeUserAccount(client, USER, { actor: 'self' });
        expect(client.statements.some((s) => /jv_deleted_accounts/.test(s.sql))).toBe(false);
    });

    test('the user row is deleted last', async () => {
        const client = mockClient();
        await purgeUserAccount(client, USER, { actor: 'self' });
        const last = client.statements[client.statements.length - 1].sql;
        expect(last).toMatch(/^DELETE FROM jv_users WHERE id = \$1$/);
    });

    test('nothing touches jv_users rows after the account row is gone', async () => {
        const client = mockClient();
        await purgeUserAccount(client, USER, { actor: 'self' });
        const deleteAt = client.statements.findIndex((s) => /DELETE FROM jv_users/.test(s.sql));
        const after = client.statements.slice(deleteAt + 1);
        expect(after).toHaveLength(0);
    });

    test('a missing table is skipped and reported, not thrown', async () => {
        const client = mockClient({ missing: new Set(['jv_persona_chat_sessions.user_email']) });
        const result = await purgeUserAccount(client, USER, { actor: 'self' });
        expect(result.skipped).toContain('jv_persona_chat_sessions.user_email');
        expect(client.statements.some((s) => /jv_persona_chat_sessions/.test(s.sql))).toBe(false);
    });

    test('the email is normalized before hashing so case and spacing cannot fork a tombstone', async () => {
        const client = mockClient();
        const result = await purgeUserAccount(
            client, { ...USER, email: '  Lauren@Example.COM  ' }, { actor: 'self' }
        );
        expect(result.emailHash).toBe(hashIdentity('lauren@example.com'));
    });

    test('the SSO subject is hashed, never sent in the clear', async () => {
        // upsertUserFromSso builds the subject as `sso|${id ?? email}`, so it very
        // often embeds the address verbatim. Nothing is stored any more, but the
        // tombstone sweep still MATCHES on these values, and a raw one in the
        // WHERE clause would leave the address in the query log.
        const client = mockClient({ extraColumns: [{ table_name: 'jv_deleted_accounts', column_name: 'email_sha256' }] });
        await purgeUserAccount(client, USER, { actor: 'self' });
        const sweep = client.statements[0];
        expect(sweep.sql).toMatch(/^DELETE FROM jv_deleted_accounts/);
        for (const param of sweep.params) {
            expect(String(param)).not.toContain('lauren@example.com');
        }
    });

    test('a reserved-word column is quoted', async () => {
        const client = mockClient();
        await purgeUserAccount(client, USER, { actor: 'self' });
        const pulse = client.statements.find((s) => /jv_pulse_tasks/.test(s.sql));
        expect(pulse.sql).toContain('"user"');
    });

    test('a purge with no actor supplied still completes', async () => {
        // Used to assert the NOT NULL deleted_by column fell back to 'unknown'.
        // That column went with the tombstone; what still matters is that an
        // administrative purge with no actor in context does not throw.
        const client = mockClient();
        const result = await purgeUserAccount(client, USER, {});   // no actor supplied
        expect(result.emailHash).toBe(hashIdentity(USER.email));
    });

    test('a user row that vanished under the lock aborts the whole purge', async () => {
        const client = mockClient();
        const original = client.query.bind(client);
        client.query = async (sql, params) => {
            if (/DELETE FROM jv_users/.test(sql)) return { rowCount: 0, rows: [] };
            return original(sql, params);
        };
        await expect(purgeUserAccount(client, USER, { actor: 'self' })).rejects.toThrow(/expected to delete 1 user row/);
    });

    test('a missing email is rejected before any statement runs', async () => {
        const client = mockClient();
        await expect(purgeUserAccount(client, { id: 1, email: '' }, { actor: 'self' }))
            .rejects.toThrow(/email is required/);
        expect(client.statements).toHaveLength(0);
    });
});
