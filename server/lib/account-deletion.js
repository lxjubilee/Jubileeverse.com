'use strict';
/**
 * lib/account-deletion.js — the account-deletion sweep plan.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Only two tables carry a foreign key to jv_users — jv_refresh_tokens and
 * jv_cms_sessions (server.js:16344, 16355). Every other reference to a user is
 * a denormalized string with no constraint, and most of them are the EMAIL, not
 * the id. So `DELETE FROM jv_users` raises no error and silently orphans ~40
 * columns across ~35 tables, including encrypted third-party credentials
 * (user_oauth_tokens) and live API keys (jv_api_keys).
 *
 * Referential integrity cannot help us here. The sweep below IS the integrity,
 * so it is declared as data rather than buried in a function: a test walks
 * information_schema and fails when a new user-referencing column appears that
 * nobody classified (see tests/integration/assertUserPurged.js). A hand-written
 * checklist rots the first time someone adds a table; this one shouts.
 *
 * MODES
 *   cascade      the FK already handles it. Listed so the test asserts the
 *                constraint still exists — a dropped FK is a silent leak.
 *   delete       the row is the user's own data or a credential, or the column
 *                carries a UNIQUE that a shared sentinel would collide on.
 *   null         nullable and non-identifying once cleared.
 *   sentinel     NOT NULL, so it cannot be nulled — gets DELETED_ACTOR.
 *   deactivate   row survives with a flag flipped (newsletter suppression).
 *   pseudonymize row survives, actor identity scrubbed (audit trail).
 */

const crypto = require('crypto');

/**
 * Replacement for NOT NULL actor columns.
 *
 * Deliberately flat, and deliberately NOT email-shaped. A per-user token like
 * `deleted-user+1234@invalid` would re-identify the person by joining against
 * jv_deleted_accounts.former_user_id — a privacy regression that would undo the
 * point of the feature. A non-email token also can never be mistaken for a
 * deliverable address by some future mailer.
 */
const DELETED_ACTOR = 'deleted-user';

/**
 * Tables whose ownership inside the shared multi-tenant database is UNVERIFIED.
 *
 * server/CLAUDE.md:3-24 warns that this PostgreSQL instance is a shared Content
 * Operating System used by roughly a dozen sites, and calls a missing site
 * filter "the #1 recurring mistake". These three tables are unprefixed, so we
 * cannot tell from the name alone whether another property writes rows into
 * them keyed by ITS OWN user-id space. If it does, `DELETE ... WHERE user_id=$1`
 * deletes a stranger's rows.
 *
 * Every runtime write we can find binds this app's own jv_users id
 * (server.js:11407 article_reactions, :11509 article_views, :11322
 * password_reset_tokens), which is why they are swept — but that is evidence,
 * not proof. MUST be confirmed against the live database before the feature is
 * enabled in production; see the UAT step in the rollout plan.
 */
const SHARED_DB_UNVERIFIED = Object.freeze([
    'article_reactions',
    'article_views',
    'password_reset_tokens',
]);

/**
 * The 13 Phase-1 canonical content tables. Each carries a nullable
 * `created_by TEXT` holding an email (server.js:15154 documents the convention:
 * "user email reference (not enforced FK)"). They are dead code at runtime —
 * nothing reads or writes them outside the DDL — but they still hold addresses,
 * so they are still swept.
 */
const PHASE1_CREATED_BY_TABLES = Object.freeze([
    'jv_articles', 'jv_prayers', 'jv_music', 'jv_radio_episodes', 'jv_podcasts',
    'jv_images', 'jv_videos', 'jv_taxonomy', 'jv_personas', 'jv_sites',
    'jv_page_templates', 'jv_assets', 'jv_prompt_recipes',
]);

/** @type {ReadonlyArray<{table:string,column:string,key:'id'|'email',mode:string,note?:string}>} */
const ACCOUNT_DELETE_SWEEP = Object.freeze([
    // ── cascade ──────────────────────────────────────────────────────────────
    { table: 'jv_refresh_tokens', column: 'user_id', key: 'id', mode: 'cascade',
      note: 'FK ON DELETE CASCADE (server.js:16344)' },
    { table: 'jv_cms_sessions', column: 'user_id', key: 'id', mode: 'cascade',
      note: 'FK ON DELETE CASCADE (server.js:16355)' },

    // ── delete: credentials and personal data ────────────────────────────────
    { table: 'user_oauth_tokens', column: 'user_email', key: 'email', mode: 'delete',
      note: 'AES-256-GCM encrypted third-party tokens; UNIQUE(user_email,provider) WHERE is_active' },
    { table: 'jv_api_keys', column: 'owner_id', key: 'email', mode: 'delete',
      note: 'live bearer credentials — anonymizing would leave a working key with no owner' },
    { table: 'jv_user_taxonomy_permissions', column: 'user_email', key: 'email', mode: 'delete',
      note: 'UNIQUE(user_email,taxonomy_node_id,permission) — a shared sentinel would 23505' },
    { table: 'jv_author_chat_sessions', column: 'user_email', key: 'email', mode: 'delete',
      note: 'full AI transcripts in messages JSONB; UNIQUE(user_email,persona_id,taxonomy_node_id)' },
    { table: 'jv_persona_chat_sessions', column: 'user_email', key: 'email', mode: 'delete',
      note: 'pre-rename name. The DDL re-creates it empty on every boot because CREATE runs '
          + 'before the rename block (server.js:15638 vs :15872), so it may exist alongside '
          + 'jv_author_chat_sessions. Swept defensively; skipped when absent.' },
    { table: 'jv_notifications', column: 'recipient_id', key: 'email', mode: 'delete',
      note: "the user's own inbox" },
    { table: 'jv_user_sessions', column: 'user_email', key: 'email', mode: 'delete',
      note: 'login history: ip_address, user_agent, device_parsed' },
    { table: 'password_reset_tokens', column: 'user_id', key: 'id', mode: 'delete' },
    { table: 'jv_radio_favorites', column: 'user_id', key: 'id', mode: 'delete' },
    { table: 'jv_radio_follows', column: 'user_id', key: 'id', mode: 'delete' },
    { table: 'article_reactions', column: 'user_id', key: 'id', mode: 'delete',
      note: 'user_id NOT NULL + UNIQUE(user_id,article_id,article_type) — cannot null or share' },
    { table: 'jv_article_slug_reactions', column: 'user_id', key: 'id', mode: 'delete',
      note: 'the slug-keyed successor to article_reactions; user_id NOT NULL + '
          + 'UNIQUE(user_id,article_slug) — cannot null or share. jv_-prefixed, so unlike '
          + 'article_reactions it is unambiguously this app\'s table.' },

    // ── null: nullable, non-identifying once cleared ─────────────────────────
    { table: 'article_views', column: 'user_id', key: 'id', mode: 'null',
      note: 'nullable; the view itself is legitimate anonymous telemetry' },
    { table: 'jv_users', column: 'locked_by', key: 'email', mode: 'null',
      note: "stamped on OTHER users' rows by an admin who is now leaving" },
    { table: 'jv_users', column: 'updated_by', key: 'email', mode: 'null',
      note: "stamped on OTHER users' rows" },
    { table: 'jv_user_sessions', column: 'revoked_by', key: 'email', mode: 'null',
      note: "OTHER users' sessions this user revoked" },
    { table: 'jv_content_objects', column: 'created_by', key: 'email', mode: 'null',
      note: 'TEXT, not UUID (server.js:15466). Leaked publicly today by SELECT co.* at :6388' },
    { table: 'jv_content_objects', column: 'updated_by', key: 'email', mode: 'null' },
    { table: 'jv_content_revisions', column: 'changed_by', key: 'email', mode: 'null' },
    { table: 'jv_content_taxonomy_map', column: 'assigned_by', key: 'email', mode: 'null' },
    { table: 'jv_content_author_map', column: 'attributed_by', key: 'email', mode: 'null' },
    { table: 'jv_author_bios', column: 'updated_by', key: 'email', mode: 'null' },
    { table: 'jv_author_bio_revisions', column: 'changed_by', key: 'email', mode: 'null' },
    { table: 'jv_reviewer_activity', column: 'reviewer_email', key: 'email', mode: 'null',
      note: 'keeps before_content/after_content as an editorial record, unattributed' },
    { table: 'jv_pulse_tasks', column: 'user', key: 'email', mode: 'null',
      note: 'reserved word — must stay double-quoted in SQL' },
    { table: 'image_queue', column: 'requested_by', key: 'email', mode: 'null' },
    { table: 'jv_automation_jobs', column: 'identity_id', key: 'email', mode: 'null',
      note: 'nullable, unlike requested_by on the same table' },
    ...PHASE1_CREATED_BY_TABLES.map((table) => ({
        table, column: 'created_by', key: 'email', mode: 'null',
        note: 'Phase-1 canonical table, dead at runtime but still holds addresses',
    })),

    // ── sentinel: NOT NULL, cannot be nulled ─────────────────────────────────
    { table: 'jv_comments', column: 'author_id', key: 'email', mode: 'sentinel',
      note: 'NOT NULL. Body may also contain @mentions of the address — not swept, see docs' },
    { table: 'jv_content_tasks', column: 'assignee_id', key: 'email', mode: 'sentinel' },
    { table: 'jv_content_tasks', column: 'created_by', key: 'email', mode: 'sentinel' },
    { table: 'jv_ai_generation_logs', column: 'actor_id', key: 'email', mode: 'sentinel' },
    { table: 'jv_automation_jobs', column: 'requested_by', key: 'email', mode: 'sentinel' },
    { table: 'jv_automation_job_templates', column: 'created_by', key: 'email', mode: 'sentinel' },
    { table: 'jv_automation_job_templates', column: 'updated_by', key: 'email', mode: 'sentinel' },

    // ── special ──────────────────────────────────────────────────────────────
    { table: 'jv_newsletter_subscribers', column: 'email', key: 'email', mode: 'deactivate',
      note: 'active=0 rather than DELETE. The list is decoupled from accounts, but the '
          + 'practical meaning of "delete my account" is "stop emailing me", and a '
          + 'suppression row survives a future bulk re-import where a deleted row would not.' },
    { table: 'jv_audit_log', column: 'actor_id', key: 'email', mode: 'pseudonymize',
      note: 'actor_id -> DELETED_ACTOR, ip_address and user_agent nulled. Rows are KEPT: '
          + 'deleting them would let a malicious admin erase their own trail by deleting '
          + 'an account. See jv_audit_log.target_id, handled separately in purgeUserAccount.' },
]);

/**
 * Columns that look user-referencing to the drift guard but deliberately are not,
 * so a new one shows up as a real finding instead of drowning in known noise.
 */
const INTENTIONALLY_UNCOVERED = Object.freeze([
    // Agent-to-agent messaging: these hold AI agent names ('jubilee', 'melody'), not people.
    { table: 'jv_qdrant_shared_knowledge', column: 'author' },
    { table: 'jv_qdrant_snapshots', column: 'created_by' },
    { table: 'jv_qdrant_messages', column: 'from_agent' },
    { table: 'jv_qdrant_messages', column: 'to_agent' },
    // Role-keyed, not user-keyed.
    { table: 'jv_role_permissions', column: 'role' },
    // UUID actor columns that are never populated: requireSession/requirePrivileged return
    // { userId, email, role, name } with no `.id`, so every `actor.id` binding writes NULL
    // (server.js:7201, 20036, 20056, 20083). Nothing to sweep.
    { table: 'jv_content_objects', column: 'approved_by' },
    { table: 'jv_content_objects', column: 'rejected_by' },
    { table: 'jv_content_objects', column: 'submitted_by' },
    { table: 'portal_pages', column: 'generated_by' },
    { table: 'portal_selection_rules', column: 'created_by' },
    { table: 'website_taxonomy_map', column: 'assigned_by' },
    { table: 'website_packages', column: 'built_by' },
    { table: 'satellite_updates', column: 'created_by' },
    { table: 'audit_rubrics', column: 'created_by' },
    { table: 'self_test_results', column: 'triggered_by_user' },
    { table: 'server_nodes', column: 'registered_by' },
    { table: 'prompt_nav_node_prompts', column: 'assigned_by' },
    { table: 'image_generation_jobs', column: 'requested_by' },
    { table: 'image_generation_jobs', column: 'reviewer_id' },
    { table: 'image_generation_jobs', column: 'approved_by' },
    { table: 'image_generation_jobs', column: 'rejected_by' },
    // jv_users' own identity columns — removed with the row itself.
    { table: 'jv_users', column: 'email' },
    { table: 'jv_deleted_accounts', column: 'deleted_by' },
    { table: 'jv_deleted_accounts', column: 'reinstated_by' },
]);

/**
 * SHA-256 of a normalized identity value, for jv_deleted_accounts.
 *
 * No pepper, deliberately. A pepper looks stronger, but a rotated or lost pepper
 * makes every existing tombstone unmatchable — which is precisely the silent
 * resurrection the tombstone exists to prevent. It would also buy little: an
 * attacker with read access to this database already has every live address in
 * jv_users.
 */
function hashIdentity(value) {
    return crypto.createHash('sha256')
        .update(String(value).trim().toLowerCase())
        .digest('hex');
}

/** Guard against SQL injection via a table name, which is never user input but is interpolated. */
function assertSafeIdentifier(name) {
    if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`unsafe SQL identifier: ${name}`);
    return name;
}

/**
 * Which (table, column) pairs actually exist right now.
 *
 * One query instead of 50 existence probes, and it catches a missing COLUMN as
 * well as a missing table. This is not defensive padding — this schema really
 * does drift: jv_persona_chat_sessions is renamed by a conditional DO $$ block
 * that can leave either name present, and 13 Phase-1 tables are dead weight
 * nothing has touched in months. A purge that threw on the first absent table
 * would make deletion impossible, so absence is tolerated — but recorded, so a
 * surprising skip surfaces in the audit trail instead of passing silently.
 */
async function loadExistingColumns(client) {
    const { rows } = await client.query(
        `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`
    );
    return new Set(rows.map((r) => `${r.table_name}.${r.column_name}`));
}

/**
 * Erase one account. The caller owns the transaction — see the BEGIN/COMMIT idiom
 * at server.js:5327 (NOT the one at 8817, which calls BEGIN on the pool itself so
 * each statement may land on a different connection).
 *
 * Ordering is load-bearing:
 *   1. The caller must already have run `SELECT ... FOR UPDATE` and captured
 *      `user.email` — roughly 40 of the columns below are keyed by the address,
 *      which is unrecoverable once the row is gone.
 *   2. The tombstone is written FIRST, so the single most consequential failure
 *      aborts before anything has been touched.
 *   3. jv_users is deleted LAST. Every abort point in between therefore leaves a
 *      complete, working account and no tombstone — there is no partial state
 *      that locks a user out.
 *
 * Deliberately does NOT log to the audit trail: logAuditEvent takes the pool, not
 * this client, so it would run on a different connection and survive a rollback.
 * The caller logs after COMMIT.
 *
 * @param {import('pg').PoolClient} client  already inside BEGIN
 * @param {{id:number|string, email:string, role?:string, sso_subject_id?:string|null, idp_subject_id?:string|null}} user
 * @param {{actor:string, reason?:string|null}} ctx
 * @returns {Promise<{counts:Record<string,number>, skipped:string[]}>}
 */
async function purgeUserAccount(client, user, ctx) {
    const email = String(user.email || '').trim().toLowerCase();
    if (!email) throw new Error('purgeUserAccount: user.email is required');
    if (user.id === undefined || user.id === null) throw new Error('purgeUserAccount: user.id is required');

    const emailHash = hashIdentity(email);
    const subject = user.sso_subject_id || user.idp_subject_id || null;
    const counts = {};
    const skipped = [];
    const present = await loadExistingColumns(client);
    const bump = (key, n) => { if (n) counts[key] = (counts[key] || 0) + n; };

    // ── 1. Tombstone, before anything is destroyed ───────────────────────────
    // ON CONFLICT so that delete -> reinstate -> delete is idempotent rather than
    // colliding on the unique email hash.
    await client.query(
        `INSERT INTO jv_deleted_accounts
           (email_sha256, sso_subject_sha256, email_domain, former_user_id,
            former_role, deleted_by, deletion_reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (email_sha256) DO UPDATE SET
           sso_subject_sha256 = EXCLUDED.sso_subject_sha256,
           email_domain       = EXCLUDED.email_domain,
           former_user_id     = EXCLUDED.former_user_id,
           former_role        = EXCLUDED.former_role,
           deleted_at         = NOW(),
           deleted_by         = EXCLUDED.deleted_by,
           deletion_reason    = EXCLUDED.deletion_reason,
           reinstated_at      = NULL,
           reinstated_by      = NULL`,
        [
            emailHash,
            subject ? hashIdentity(subject) : null,
            email.slice(email.lastIndexOf('@') + 1) || null,
            user.id,
            user.role || null,
            ctx.actor || 'unknown',   // column is NOT NULL
            ctx.reason || null,
        ]
    );

    // ── 2-4. The declared sweep ──────────────────────────────────────────────
    for (const rule of ACCOUNT_DELETE_SWEEP) {
        if (rule.mode === 'cascade') continue;          // the FK does it
        if (rule.mode === 'deactivate') continue;       // handled below
        if (rule.mode === 'pseudonymize') continue;     // handled below

        const table = assertSafeIdentifier(rule.table);
        const column = assertSafeIdentifier(rule.column);
        if (!present.has(`${table}.${column}`)) { skipped.push(`${table}.${column}`); continue; }

        const value = rule.key === 'id' ? user.id : email;
        // Identifiers are quoted because jv_pulse_tasks."user" is a reserved word.
        // They are never user input, and assertSafeIdentifier is the belt to that brace.
        let sql;
        if (rule.mode === 'delete') {
            sql = `DELETE FROM "${table}" WHERE "${column}" = $1`;
        } else if (rule.mode === 'null') {
            sql = `UPDATE "${table}" SET "${column}" = NULL WHERE "${column}" = $1`;
        } else if (rule.mode === 'sentinel') {
            sql = `UPDATE "${table}" SET "${column}" = '${DELETED_ACTOR}' WHERE "${column}" = $1`;
        } else {
            throw new Error(`purgeUserAccount: unknown sweep mode "${rule.mode}"`);
        }
        const { rowCount } = await client.query(sql, [value]);
        bump(`${table}.${column}`, rowCount);
    }

    // ── Newsletter: suppress rather than delete ──────────────────────────────
    // Deleting the row would let a future bulk import silently re-subscribe
    // someone who asked to be forgotten; active = 0 is a durable suppression
    // record. The address necessarily stays in plaintext — a suppression list
    // that cannot match an address does nothing.
    let newsletterUnsubscribed = false;
    if (present.has('jv_newsletter_subscribers.email')) {
        const { rowCount } = await client.query(
            `UPDATE jv_newsletter_subscribers SET active = 0 WHERE email = $1 AND active <> 0`,
            [email]
        );
        newsletterUnsubscribed = rowCount > 0;
        bump('jv_newsletter_subscribers.email', rowCount);
    }

    // ── Audit trail: pseudonymize the actor, keep the sequence ───────────────
    // Deleting these rows was rejected: it would let a malicious admin erase
    // their own trail by deleting an account. Keeping them untouched was also
    // rejected: actor_id holds the raw address and the row carries IP and
    // user-agent, so "we deleted your data" would be false.
    if (present.has('jv_audit_log.actor_id')) {
        const { rowCount } = await client.query(
            `UPDATE jv_audit_log
                SET actor_id = $2, ip_address = NULL, user_agent = NULL
              WHERE actor_id = $1`,
            [email, DELETED_ACTOR]
        );
        bump('jv_audit_log.actor_id', rowCount);
        // user_account.* events address their target BY EMAIL (server.js:19058),
        // so the address survives in target_id unless it is hashed here.
        const { rowCount: tgt } = await client.query(
            `UPDATE jv_audit_log SET target_id = $2
              WHERE target_type IN ('user_account', 'users', 'jv_users') AND target_id = $1`,
            [email, emailHash]
        );
        bump('jv_audit_log.target_id', tgt);
    }

    // ── Revision snapshots: the two keys we can name safely ──────────────────
    // snapshot is a polymorphic dump of whatever row was revised, so a recursive
    // walk would rewrite arbitrary content and break the rollback guarantee this
    // table exists to provide. Two targeted keys, and the residue is documented
    // rather than pretended away: an address may still sit in free text here.
    if (present.has('jv_content_revisions.snapshot')) {
        for (const key of ['created_by', 'updated_by']) {
            const { rowCount } = await client.query(
                `UPDATE jv_content_revisions
                    SET snapshot = jsonb_set(snapshot, $2::text[], 'null'::jsonb)
                  WHERE snapshot->>$3 = $1`,
                [email, `{${key}}`, key]
            );
            bump(`jv_content_revisions.snapshot.${key}`, rowCount);
        }
    }

    // ── 5. The user row, last. Cascades jv_refresh_tokens + jv_cms_sessions ──
    const { rowCount: userRows } = await client.query(`DELETE FROM jv_users WHERE id = $1`, [user.id]);
    if (userRows !== 1) {
        // The caller held FOR UPDATE, so this cannot happen benignly — it means the
        // row moved under us. Abort rather than leave a tombstone for a live account.
        throw new Error(`purgeUserAccount: expected to delete 1 user row, deleted ${userRows}`);
    }
    bump('jv_users', userRows);

    return { counts, skipped, newsletterUnsubscribed, emailHash };
}

module.exports = {
    DELETED_ACTOR,
    ACCOUNT_DELETE_SWEEP,
    INTENTIONALLY_UNCOVERED,
    SHARED_DB_UNVERIFIED,
    PHASE1_CREATED_BY_TABLES,
    hashIdentity,
    assertSafeIdentifier,
    loadExistingColumns,
    purgeUserAccount,
};
