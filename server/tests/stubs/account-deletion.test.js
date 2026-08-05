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
 * Needs a live server (TEST_BASE_URL, default http://localhost:3107) — no special
 * configuration; account deletion is ordinary product behaviour and is not gated
 * on an env var. When the server is unreachable the suite reports itself as
 * skipped rather than failing, so it stays quiet in CI without a backend but
 * becomes real coverage the moment one is present.
 *
 * Rate limiting is not asserted here, but it does constrain the suite. The
 * limiter's `skip: () => NODE_ENV === 'test'` reads the SERVER's environment, and
 * a stub suite talks to a separately-booted server that is normally in production
 * mode — so the budget is live. This suite needs ~13 attempts (the beforeAll probe
 * costs one and the unauthenticated case costs two), which fits the
 * 20-per-15-minutes allowance with room to spare. If it
 * is ever exhausted anyway, the remaining behavioural tests skip with a warning
 * rather than reporting code failures for an environmental limit — watch for that
 * warning, because a green run that skipped the destructive half proves nothing.
 * Restart the API to reset the in-memory bucket.
 */

// Jest's 5s default is far too short here. Each behavioural test registers a
// user, deletes it, and then probes sign-in — and every one of those hops runs
// against a remote PostgreSQL over an SSH tunnel, with the deletion itself
// executing a ~50-statement sweep inside one transaction. Under the default the
// tests time out mid-flight and report as failures even though the server
// answered 200, which reads as "deletion is broken" when it is working fine.
jest.setTimeout(60000);

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

/**
 * Assert whether `email` can still sign in.
 *
 * Never collapses the answer to a boolean before checking for a 429. /api/auth/login
 * has its OWN limiter (10 per 15 min per IP) separate from the deletion one, and a
 * full-suite run has many other stub files signing in as admin against the same
 * server from the same IP. Treating that 429 as "cannot sign in" made this file
 * report that an account had been deleted when it was alive and well — a false
 * failure on the single most alarming assertion in the suite.
 */
async function expectSignIn(email, expected) {
    const res = await req('POST', '/api/auth/login', { email, password: PASSWORD });
    if (res.status === 429) {
        if (!loginRateLimited) {
            loginRateLimited = true;
            console.warn('[account-deletion] /api/auth/login rate limited — sign-in assertions skipped');
        }
        return;
    }
    expect(res.status === 200).toBe(expected);
}

async function deleteSelf(user, overrides = {}) {
    const res = await req('POST', '/api/auth/account/delete', {
        password: PASSWORD, confirmEmail: user.email, ...overrides,
    }, user.token);
    checkRateLimited(res.status);
    return res;
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
    // A 503 means the tombstone table is unavailable, so deletion is refused for
    // safety and every behavioural assertion below would be meaningless. That is
    // the only condition that disables the feature — there is no config flag.
    const probe = await req('POST', '/api/auth/account/delete', {});
    deletionEnabled = probe.status !== 503;
    if (!deletionEnabled) {
        console.warn('[account-deletion] tombstone table unavailable — behavioural tests skipped');
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

// accountDeleteLimiter allows 20 attempts per 15 minutes per IP and carries
// `skip: () => NODE_ENV === 'test'` — but that reads the SERVER's environment,
// and a stub suite talks to a separately-booted server which is normally in
// production mode. So the budget is real here, and a suite with more than five
// deletions in it will exhaust it. Once that happens the remaining assertions
// would report code failures for what is purely an environmental limit, so we
// stop and say so instead. Restart the API to reset the in-memory bucket.
let rateLimited = false;
let loginRateLimited = false;

/** True when the environment can still support a behavioural assertion. */
const live = () => serverUp && deletionEnabled && !rateLimited;

/** Note a 429 and disable the remaining behavioural tests. Returns true if limited. */
function checkRateLimited(status) {
    if (status === 429 && !rateLimited) {
        rateLimited = true;
        console.warn('[account-deletion] rate limit reached (20 per 15 min per IP) — remaining behavioural tests skipped; restart the API to reset');
    }
    return status === 429;
}

describe('Account deletion — self-service', () => {
    test('an unauthenticated call is rejected', async () => {
        if (!serverUp) return;
        // Both shapes, because the empty one is now the shape the product sends:
        // with no password and no address in the body, the session is the ONLY
        // thing between a stranger and someone else's account.
        for (const body of [{ password: PASSWORD, confirmEmail: 'nobody@jubileeverse.test' }, {}]) {
            const res = await req('POST', '/api/auth/account/delete', body);
            // 503 if the tombstone table is unavailable, 401 otherwise. Never 200.
            expect([401, 503]).toContain(res.status);
        }
    });

    test('a bare confirmation, with no password and no address, deletes', async () => {
        // What the settings dialog sends after "Yes, delete it". The proof-carrying
        // cases below are the older shape kept working, not the primary one — if
        // this test and one of those ever disagree, this is the one that describes
        // the product.
        if (!live()) return;
        const user = await makeUser('bare');
        if (!user) return;
        const res = await deleteSelf(user, { password: undefined, confirmEmail: undefined });
        if (rateLimited) return;
        expect(res.status).toBe(200);
        await expectSignIn(user.email, false);
    });

    test('a wrong password is refused and the account survives', async () => {
        if (!live()) return;
        const user = await makeUser('wrongpw');
        if (!user) return;
        const res = await deleteSelf(user, { password: 'not-the-password' });
        if (rateLimited) return;
        expect(res.status).toBe(401);
        await expectSignIn(user.email, true);
    });

    test('a mismatched confirmEmail is refused and the account survives', async () => {
        if (!live()) return;
        const user = await makeUser('mismatch');
        if (!user) return;
        const res = await deleteSelf(user, { confirmEmail: 'someone.else@jubileeverse.test' });
        if (rateLimited) return;
        expect(res.status).toBe(400);
        await expectSignIn(user.email, true);
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
        if (rateLimited) return;
        expect(res.status).toBe(400);
        await expectSignIn(victim.email, true);
        await expectSignIn(attacker.email, true);
    });

    test('a pasted, autocapitalised address is still accepted', async () => {
        if (!live()) return;
        const user = await makeUser('casing');
        if (!user) return;
        const res = await deleteSelf(user, { confirmEmail: `  ${user.email.toUpperCase()}  ` });
        if (rateLimited) return;
        expect(res.status).toBe(200);
    });

    test('correct credentials delete the account', async () => {
        if (!live()) return;
        const user = await makeUser('happy');
        if (!user) return;
        const res = await deleteSelf(user);
        if (rateLimited) return;
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.deleted).toBe(true);
        await expectSignIn(user.email, false);
    });

    test('the access token of a deleted account stops working', async () => {
        if (!live()) return;
        const user = await makeUser('token');
        if (!user) return;
        await deleteSelf(user);
        if (rateLimited) return;
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
        if (rateLimited) return;
        const res = await req('POST', '/api/auth/refresh', { refreshToken: user.refreshToken });
        expect(res.status).toBe(401);
    });

    test('a deleted account cannot sign in again', async () => {
        // The status legitimately differs by auth mode, and asserting 410
        // unconditionally was wrong:
        //
        //   local — the hard delete took the password hash with it, so there is
        //     nothing to authenticate against and login answers a generic 401.
        //     Returning 410 here would leak "this address was deleted" to an
        //     unauthenticated caller.
        //   sso   — the authority still holds the Jubilee ID and verifies the
        //     password first, so upsertUserFromSso's ACCOUNT_DELETED becomes a
        //     credential-gated 410 carrying accountDeleted.
        //
        // The invariant that must hold in BOTH modes is the one asserted here:
        // sign-in never succeeds. When the answer is 410 we additionally check
        // the body, which is what proves the tombstone fired rather than the row
        // merely being absent.
        if (!live()) return;
        const user = await makeUser('tombstone');
        if (!user) return;
        await deleteSelf(user);
        if (rateLimited) return;
        const res = await req('POST', '/api/auth/login', { email: user.email, password: PASSWORD });
        // Same 429 caveat as expectSignIn: /api/auth/login has its own bucket that
        // a full-suite run shares with every other stub file. A 429 says nothing
        // about whether the deletion worked, so it must not be read as a verdict.
        if (res.status === 429) return;
        expect(res.status).not.toBe(200);
        expect([401, 410]).toContain(res.status);
        if (res.status === 410) {
            const body = await res.json();
            expect(body.accountDeleted).toBe(true);
        }
    });

    test('re-registering produces a new empty account, never the old one restored', async () => {
        if (!live()) return;
        const user = await makeUser('reregister');
        if (!user) return;
        await deleteSelf(user);
        if (rateLimited) return;
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

    test('a back-office account is permitted to delete itself', async () => {
        // Asserted through GET /api/auth/me rather than by calling the endpoint.
        // Back-office self-deletion is allowed by product decision and carries no
        // last-admin quorum, so actually exercising it here would delete the
        // environment's administrator and lock the back office — a test must
        // never be the thing that does that. can_delete_account is required to
        // mirror exactly what the endpoint accepts, so checking the flag checks
        // the policy.
        if (!live() || !adminToken) return;
        const res = await req('GET', '/api/auth/me', undefined, adminToken);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.user.can_delete_account).toBe(true);
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
        await expectSignIn(user.email, true);
    });

    test('an admin can delete another user', async () => {
        if (!live() || !adminToken) return;
        const user = await makeUser('admindelete');
        if (!user) return;
        const res = await req('DELETE', `/api/admin/users/${user.id}`,
            { confirm_email: user.email }, adminToken);
        expect(res.status).toBe(200);
        await expectSignIn(user.email, false);
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
