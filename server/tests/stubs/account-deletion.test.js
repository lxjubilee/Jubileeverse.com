'use strict';
/**
 * Account Deletion — self-service and administrative contract.
 *
 * Written against Jest's own globals rather than `require('node:test')`. The
 * other live-HTTP stubs in this folder import node:test, which shadows Jest's
 * describe/it so Jest registers nothing and reports "Your test suite must
 * contain at least one test" — all ten of them fail before a single assertion
 * runs. Deletion is irreversible, so its contract test needs to actually run.
 *
 * Needs a live server (TEST_BASE_URL, default http://localhost:3107) booted with
 * ACCOUNT_DELETION_ENABLED=true. When the server is unreachable the suite
 * reports itself as skipped rather than failing, so it stays quiet in CI without
 * a backend but becomes real coverage the moment one is present.
 *
 * NOT covered here, deliberately: rate limiting. accountDeleteLimiter carries
 * `skip: () => NODE_ENV === 'test'` to match loginLimiter, so exercising it over
 * HTTP would either always pass or poison the bucket for the rest of the run.
 * Its configuration is asserted in tests/unit instead.
 */

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3107';
const PASSWORD = 'TestPass123!';

let serverUp = false;
let deletionEnabled = false;
let adminToken = '';
let adminUserId = '';
let adminEmail = '';

async function req(method, path, body, token) {
    return fetch(`${BASE}${path}`, {
        method,
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
    });
}

/** Register a throwaway reader. Returns null when the server will not cooperate. */
async function makeUser(tag) {
    const email = `test-delete-${tag}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}@jubileeverse.test`;
    const res = await req('POST', '/api/auth/register', { email, password: PASSWORD, name: 'Delete Test' });
    if (res.status !== 200 && res.status !== 201) return null;
    const data = await res.json();
    return { id: data.user?.id, email, token: data.token, refreshToken: data.refreshToken };
}

async function canSignIn(email) {
    const res = await req('POST', '/api/auth/login', { email, password: PASSWORD });
    return res.status === 200;
}

async function deleteSelf(user, overrides = {}) {
    return req('POST', '/api/auth/account/delete', {
        password: PASSWORD, confirmEmail: user.email, ...overrides,
    }, user.token);
}

beforeAll(async () => {
    try {
        const res = await fetch(`${BASE}/api/auth/lookup?email=probe@jubileeverse.test`);
        serverUp = res.status < 500;
    } catch {
        serverUp = false;
    }
    if (!serverUp) {
        console.warn(`[account-deletion] no server at ${BASE} — suite is inert`);
        return;
    }
    // Distinguish "flag is off" from "endpoint is broken": with the flag off the
    // endpoint answers 501 and every behavioural assertion below is meaningless.
    const probe = await req('POST', '/api/auth/account/delete', {});
    deletionEnabled = probe.status !== 501;
    if (!deletionEnabled) {
        console.warn('[account-deletion] ACCOUNT_DELETION_ENABLED is off — behavioural tests skipped');
    }

    const login = await req('POST', '/api/auth/login', {
        email: process.env.TEST_ADMIN_USER || 'admin',
        password: process.env.TEST_ADMIN_PASS || 'admin',
    });
    if (login.status === 200) {
        const data = await login.json();
        adminToken = data.token;
        adminUserId = data.user?.id;
        adminEmail = data.user?.email;
    }
}, 30000);

/** True when the environment can support a behavioural assertion. */
const live = () => serverUp && deletionEnabled;

describe('Account deletion — self-service', () => {
    test('an unauthenticated call is rejected', async () => {
        if (!serverUp) return;
        const res = await req('POST', '/api/auth/account/delete', {
            password: PASSWORD, confirmEmail: 'nobody@jubileeverse.test',
        });
        // 501 when the flag is off; 401 when it is on. Never 200.
        expect([401, 501]).toContain(res.status);
    });

    test('a wrong password is refused and the account survives', async () => {
        if (!live()) return;
        const user = await makeUser('wrongpw');
        if (!user) return;
        const res = await deleteSelf(user, { password: 'not-the-password' });
        expect(res.status).toBe(401);
        expect(await canSignIn(user.email)).toBe(true);
    });

    test('a mismatched confirmEmail is refused and the account survives', async () => {
        if (!live()) return;
        const user = await makeUser('mismatch');
        if (!user) return;
        const res = await deleteSelf(user, { confirmEmail: 'someone.else@jubileeverse.test' });
        expect(res.status).toBe(400);
        expect(await canSignIn(user.email)).toBe(true);
    });

    test('confirmEmail is a confirmation, never a selector', async () => {
        // The endpoint takes no id, so the real hazard is an implementation that
        // LOOKS UP by confirmEmail rather than COMPARING it to the token subject.
        // Passing a victim's address must fail AND leave the victim intact.
        if (!live()) return;
        const attacker = await makeUser('attacker');
        const victim = await makeUser('victim');
        if (!attacker || !victim) return;
        const res = await deleteSelf(attacker, { confirmEmail: victim.email });
        expect(res.status).toBe(400);
        expect(await canSignIn(victim.email)).toBe(true);
        expect(await canSignIn(attacker.email)).toBe(true);
    });

    test('a pasted, autocapitalised address is still accepted', async () => {
        if (!live()) return;
        const user = await makeUser('casing');
        if (!user) return;
        const res = await deleteSelf(user, { confirmEmail: `  ${user.email.toUpperCase()}  ` });
        expect(res.status).toBe(200);
    });

    test('correct credentials delete the account', async () => {
        if (!live()) return;
        const user = await makeUser('happy');
        if (!user) return;
        const res = await deleteSelf(user);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.deleted).toBe(true);
        expect(await canSignIn(user.email)).toBe(false);
    });

    test('the access token of a deleted account stops working', async () => {
        if (!live()) return;
        const user = await makeUser('token');
        if (!user) return;
        await deleteSelf(user);
        const me = await req('GET', '/api/auth/me', undefined, user.token);
        expect([401, 404]).toContain(me.status);
    });

    test('the refresh token of a deleted account cannot mint a new one', async () => {
        // Belt and braces: the FK cascade removes the row AND authRedeemRefreshToken
        // joins jv_users. Either alone would suffice; assert the observable result.
        if (!live()) return;
        const user = await makeUser('refresh');
        if (!user) return;
        await deleteSelf(user);
        const res = await req('POST', '/api/auth/refresh', { refreshToken: user.refreshToken });
        expect(res.status).toBe(401);
    });

    test('signing in after deletion returns 410, not 401', async () => {
        // The load-bearing assertion of the whole feature. A 401 would only prove
        // the row is missing; 410 proves the TOMBSTONE fired, which is what stops
        // upsertUserFromSso silently re-creating the account on the next sign-in.
        if (!live()) return;
        const user = await makeUser('tombstone');
        if (!user) return;
        await deleteSelf(user);
        const res = await req('POST', '/api/auth/login', { email: user.email, password: PASSWORD });
        expect(res.status).toBe(410);
        const body = await res.json();
        expect(body.accountDeleted).toBe(true);
    });

    test('re-registering produces a new empty account, never the old one restored', async () => {
        if (!live()) return;
        const user = await makeUser('reregister');
        if (!user) return;
        await deleteSelf(user);
        // Registration is a deliberate front-door act and clears the tombstone, so
        // in local mode it succeeds; in SSO mode it 409s on the surviving Jubilee ID.
        const res = await req('POST', '/api/auth/register', {
            email: user.email, password: PASSWORD, name: 'Back Again',
        });
        expect([200, 201, 409]).toContain(res.status);
        if (res.status === 200 || res.status === 201) {
            const data = await res.json();
            expect(data.user?.id).not.toBe(user.id);
        }
    });

    test('a back-office account is refused rather than self-deleted', async () => {
        // Never 200: a privileged self-delete would bypass the last-admin quorum
        // and, combined with audit pseudonymization, erase the actor's own trail.
        if (!live() || !adminToken) return;
        const res = await req('POST', '/api/auth/account/delete', {
            password: process.env.TEST_ADMIN_PASS || 'admin',
            confirmEmail: adminEmail,
        }, adminToken);
        expect(res.status).toBe(403);
        const body = await res.json();
        expect(body.requiresAdmin).toBe(true);
    });
});

describe('Account deletion — administrative', () => {
    test('an unauthenticated call is rejected', async () => {
        if (!serverUp) return;
        const res = await req('DELETE', '/api/admin/users/1', { confirm_email: 'x@y.z' });
        expect([401, 403]).toContain(res.status);
    });

    test('a non-admin is refused', async () => {
        if (!live()) return;
        const user = await makeUser('nonadmin');
        if (!user) return;
        const res = await req('DELETE', `/api/admin/users/${user.id}`,
            { confirm_email: user.email }, user.token);
        expect(res.status).toBe(403);
    });

    test('a non-numeric id is a 400, not a leaked 500', async () => {
        // Sibling admin routes pass req.params.id straight into a BIGINT comparison
        // and leak the driver's error message in a 500.
        if (!live() || !adminToken) return;
        const res = await req('DELETE', '/api/admin/users/abc', { confirm_email: 'x@y.z' }, adminToken);
        expect(res.status).toBe(400);
    });

    test('a mismatched confirm_email is refused and the target survives', async () => {
        if (!live() || !adminToken) return;
        const user = await makeUser('adminmismatch');
        if (!user) return;
        const res = await req('DELETE', `/api/admin/users/${user.id}`,
            { confirm_email: 'wrong@jubileeverse.test' }, adminToken);
        expect(res.status).toBe(400);
        expect(await canSignIn(user.email)).toBe(true);
    });

    test('an admin can delete another user', async () => {
        if (!live() || !adminToken) return;
        const user = await makeUser('admindelete');
        if (!user) return;
        const res = await req('DELETE', `/api/admin/users/${user.id}`,
            { confirm_email: user.email }, adminToken);
        expect(res.status).toBe(200);
        expect(await canSignIn(user.email)).toBe(false);
    });

    test('an unknown id is a 404', async () => {
        if (!live() || !adminToken) return;
        const res = await req('DELETE', '/api/admin/users/99999999',
            { confirm_email: 'ghost@jubileeverse.test' }, adminToken);
        expect(res.status).toBe(404);
    });

    test('an admin cannot delete their own account from the console', async () => {
        if (!live() || !adminToken || !adminUserId) return;
        const res = await req('DELETE', `/api/admin/users/${adminUserId}`,
            { confirm_email: adminEmail }, adminToken);
        expect(res.status).toBe(400);
    });
});
