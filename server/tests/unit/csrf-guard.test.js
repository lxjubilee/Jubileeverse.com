'use strict';
/**
 * The CSRF guard, and the mount-path fault that made the language picker fail
 * on production only.
 *
 * The middleware is registered with `app.use('/api/', requireCsrf)`. Express
 * hands a mounted handler a `req.path` relative to its mount, so `/api/tts`
 * arrives as `/tts` — and the exempt list, written as full paths, matched
 * nothing. Every endpoint that had been deliberately exempted was guarded.
 *
 * That combination is why it survived: the guard engages only when a session
 * COOKIE is present, and only the deployed site's OIDC sign-in sets one. On
 * localhost a developer is signed out, or signed in on the bearer path, so the
 * branch never ran. The tests below therefore drive the RELATIVE path Express
 * actually supplies, not the tidy one it is tempting to assume.
 */

const {
    CSRF_EXEMPT_PATHS,
    fullRequestPath,
    isCsrfExempt,
    csrfDecision,
} = require('../../lib/csrf-guard');

const SESSION = '__Host-jv-session';

/** A signed-in reader on the live site, as Express presents them to the guard. */
function signedIn(path, extra = {}) {
    return {
        method: 'POST',
        baseUrl: '/api',
        path,                              // relative to the mount, as Express gives it
        cookies: { [SESSION]: 'sess-abc' },
        sessionCookieName: SESSION,
        ...extra,
    };
}

describe('the mount-path fault itself', () => {
    test('the full path is rebuilt from the mount and the relative path', () => {
        expect(fullRequestPath('/api', '/tts')).toBe('/api/tts');
    });

    test("a mount reported with its trailing slash does not yield '/api//tts'", () => {
        // app.use('/api/', …) — Express normally reports baseUrl as '/api', but a
        // doubled slash here would miss the exempt list exactly as before.
        expect(fullRequestPath('/api/', '/tts')).toBe('/api/tts');
    });

    test('the relative path alone is NOT exempt — this was the bug', () => {
        // What the old code compared. Pinned so the mistake cannot come back.
        expect(isCsrfExempt('/tts')).toBe(false);
        expect(isCsrfExempt('/api/tts')).toBe(true);
    });
});

describe('the endpoints that must stay reachable while signed in', () => {
    test.each([
        ['/tts', 'Read Aloud'],
        ['/track/view', 'view telemetry'],
        ['/verse', 'the daily verse'],
    ])('%s is allowed without a token (%s)', (path) => {
        expect(csrfDecision(signedIn(path))).toEqual({ allow: true });
    });

    test('/api/translate-batch stays GUARDED — the client sends the token instead', () => {
        // Not exempt by design: src/lib/csrf.ts echoes the jv-csrf cookie back,
        // and article-translation.test.js pins that. Listed here so exempting it
        // is a deliberate act rather than an accident.
        const decision = csrfDecision(signedIn('/translate-batch'));
        expect(decision.allow).toBe(false);
        expect(csrfDecision(signedIn('/translate-batch', {
            cookies: { [SESSION]: 'sess-abc', 'jv-csrf': 'tok-1' },
            csrfHeader: 'tok-1',
        }))).toEqual({ allow: true });
    });
});

describe('the guard still guards everything else', () => {
    test('a state-changing endpoint with no token is refused', () => {
        expect(csrfDecision(signedIn('/reactions/slug'))).toEqual({
            allow: false, status: 403, error: 'CSRF token mismatch',
        });
    });

    test('a matching token lets it through', () => {
        const decision = csrfDecision(signedIn('/reactions/slug', {
            cookies: { [SESSION]: 'sess-abc', 'jv-csrf': 'tok-1' },
            csrfHeader: 'tok-1',
        }));
        expect(decision).toEqual({ allow: true });
    });

    test('a token that does not match the cookie is refused', () => {
        const decision = csrfDecision(signedIn('/reactions/slug', {
            cookies: { [SESSION]: 'sess-abc', 'jv-csrf': 'tok-1' },
            csrfHeader: 'tok-2',
        }));
        expect(decision.allow).toBe(false);
    });

    test('a header with no cookie behind it is refused', () => {
        const decision = csrfDecision(signedIn('/reactions/slug', { csrfHeader: 'tok-1' }));
        expect(decision.allow).toBe(false);
    });

    test('an exempt path is exempt by its path, not by having a token', () => {
        // Guards against "fixing" this by quietly exempting everything.
        expect(csrfDecision(signedIn('/reactions/slug')).allow).toBe(false);
        expect(csrfDecision(signedIn('/tts')).allow).toBe(true);
    });
});

describe('callers the guard never applied to', () => {
    test('no session cookie means the bearer path, which needs no token', () => {
        expect(csrfDecision({
            method: 'POST', baseUrl: '/api', path: '/reactions/slug',
            cookies: {}, sessionCookieName: SESSION,
        })).toEqual({ allow: true });
    });

    test.each(['GET', 'HEAD', 'OPTIONS'])('%s cannot change state, so is allowed', (method) => {
        expect(csrfDecision(signedIn('/reactions/slug', { method }))).toEqual({ allow: true });
    });

    test('the method check is case-insensitive', () => {
        expect(csrfDecision(signedIn('/reactions/slug', { method: 'get' }))).toEqual({ allow: true });
    });
});

describe('against real Express routing', () => {
    // The bug was a belief about what Express supplies to a MOUNTED handler, so
    // asserting it against the real router is the only thing that settles it.
    // A pure-function test would happily agree with a wrong assumption.
    const express = require('express');
    const request = require('supertest');

    function app() {
        const a = express();
        a.use(express.json());
        a.use('/api/', (req, res, next) => {
            const decision = csrfDecision({
                method: req.method,
                baseUrl: req.baseUrl,
                path: req.path,
                cookies: Object.fromEntries(
                    (req.headers.cookie || '').split(';').map((c) => {
                        const i = c.indexOf('=');
                        return [c.slice(0, i).trim(), c.slice(i + 1).trim()];
                    }).filter(([k]) => k),
                ),
                csrfHeader: req.headers['x-csrf-token'],
                sessionCookieName: 'jv-session',
            });
            if (decision.allow) return next();
            return res.status(decision.status).json({ error: decision.error });
        });
        a.post('/api/tts', (_q, s) => s.json({ ok: true }));
        a.post('/api/reactions/slug', (_q, s) => s.json({ ok: true }));
        return a;
    }

    test('an exempt path passes with a session cookie and no token', async () => {
        // Fails if baseUrl+path do not actually recombine to '/api/tts'.
        await request(app()).post('/api/tts')
            .set('Cookie', 'jv-session=abc').send({}).expect(200);
    });

    test('a guarded path still refuses under identical conditions', async () => {
        await request(app()).post('/api/reactions/slug')
            .set('Cookie', 'jv-session=abc').send({}).expect(403);
    });
});

describe('the exempt list', () => {
    test('every entry is a full path, since that is what it is matched against', () => {
        for (const p of CSRF_EXEMPT_PATHS) expect(p.startsWith('/api/')).toBe(true);
    });

    test('the three public endpoints are on it, and nothing else', () => {
        expect([...CSRF_EXEMPT_PATHS].sort()).toEqual([
            '/api/track/view', '/api/tts', '/api/verse',
        ].sort());
    });
});
