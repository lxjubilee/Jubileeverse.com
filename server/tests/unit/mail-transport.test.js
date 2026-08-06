'use strict';
/**
 * Mail transport selection — why the password reset email never arrived.
 *
 * `emailTransporter` was built only when SMTP_HOST was set, and `sendEmail`
 * returned false before logging anything when it was not. .env.example
 * documented no mail variables at all, so a deployment provisioned from it
 * accepted the reset request, wrote the token, answered "if an account exists,
 * a link has been sent", and sent nothing — with no line in the log to say so.
 *
 * These cover the decision itself: what is chosen, what is refused, and whether
 * the reason given is one an operator can act on.
 */

const {
    resolveMailConfig,
    resolveFromAddress,
    describeMailError,
    IMPLICIT_TLS_PORT,
} = require('../../lib/mail-transport');

describe('an unconfigured server says so', () => {
    test('no mail variables at all yields no transport and an actionable reason', () => {
        const r = resolveMailConfig({});
        expect(r.options).toBeNull();
        expect(r.source).toBeNull();
        // The reason has to name the variables to set — this is the only thing
        // an operator sees when a reset never arrives.
        expect(r.reason).toMatch(/SMTP_HOST/);
        expect(r.reason).toMatch(/SES_SMTP_ENDPOINT/);
        expect(r.reason).toMatch(/disabled/i);
    });

    test('a host with no credentials is refused rather than half-built', () => {
        const noPass = resolveMailConfig({ SMTP_HOST: 'smtp.example.com', SMTP_USER: 'u' });
        expect(noPass.options).toBeNull();
        expect(noPass.reason).toMatch(/password is missing/);

        const noUser = resolveMailConfig({ SMTP_HOST: 'smtp.example.com', SMTP_PASS: 'p' });
        expect(noUser.options).toBeNull();
        expect(noUser.reason).toMatch(/user is missing/);
    });

    test('the reason names which credential set was at fault', () => {
        const r = resolveMailConfig({ SES_SMTP_ENDPOINT: 'email-smtp.us-east-1.amazonaws.com' });
        expect(r.options).toBeNull();
        expect(r.reason).toMatch(/SES_SMTP_\*/);
    });
});

describe('choosing between the two credential sets', () => {
    const SMTP = { SMTP_HOST: 'smtp.mailgun.org', SMTP_USER: 'u', SMTP_PASS: 'p' };
    const SES = {
        SES_SMTP_ENDPOINT: 'email-smtp.us-east-1.amazonaws.com',
        SES_SMTP_USERNAME: 'akia',
        SES_SMTP_PASSWORD: 'secret',
    };

    test('SMTP_* is used when present', () => {
        const r = resolveMailConfig(SMTP);
        expect(r.source).toBe('SMTP_*');
        expect(r.options).toMatchObject({
            host: 'smtp.mailgun.org',
            port: 587,
            auth: { user: 'u', pass: 'p' },
        });
    });

    test('SES_SMTP_* is used when SMTP_* is absent — it was configured but dead', () => {
        const r = resolveMailConfig(SES);
        expect(r.source).toBe('SES_SMTP_*');
        expect(r.options.host).toBe('email-smtp.us-east-1.amazonaws.com');
        expect(r.options.auth).toEqual({ user: 'akia', pass: 'secret' });
    });

    test('with both configured the primary wins', () => {
        expect(resolveMailConfig({ ...SMTP, ...SES }).source).toBe('SMTP_*');
    });

    test('the reason states the host and port actually dialled', () => {
        expect(resolveMailConfig(SMTP).reason).toBe('using SMTP_* (smtp.mailgun.org:587)');
    });
});

describe('port handling', () => {
    const base = { SMTP_HOST: 'smtp.example.com', SMTP_USER: 'u', SMTP_PASS: 'p' };

    test('465 is implicit TLS, everything else is STARTTLS', () => {
        expect(resolveMailConfig({ ...base, SMTP_PORT: String(IMPLICIT_TLS_PORT) }).options.secure).toBe(true);
        expect(resolveMailConfig({ ...base, SMTP_PORT: '587' }).options.secure).toBe(false);
        expect(resolveMailConfig({ ...base, SMTP_PORT: '25' }).options.secure).toBe(false);
    });

    test('an unset port defaults to 587 as a number, not a string', () => {
        const opts = resolveMailConfig(base).options;
        expect(opts.port).toBe(587);
        expect(typeof opts.port).toBe('number');
    });
});

describe('the From address', () => {
    test('an unset SMTP_FROM is flagged, because a mismatch gets mail rejected', () => {
        const r = resolveFromAddress({});
        expect(r.from).toBe('noreply@jubileeverse.com');
        expect(r.defaulted).toBe(true);
    });

    test('a configured address is used and not flagged', () => {
        expect(resolveFromAddress({ SMTP_FROM: 'hello@jubileeverse.com' }))
            .toEqual({ from: 'hello@jubileeverse.com', defaulted: false });
    });
});

describe('failure detail reaches the log', () => {
    test('code, responseCode and the server response are all kept', () => {
        const e = Object.assign(new Error('Invalid login'), {
            code: 'EAUTH',
            responseCode: 535,
            response: '535 Authentication credentials invalid',
        });
        const s = describeMailError(e);
        expect(s).toContain('Invalid login');
        expect(s).toContain('EAUTH');
        expect(s).toContain('535');
        // The provider's own words are usually the whole diagnosis — a rejected
        // sending domain reads very differently from a bad password.
        expect(s).toContain('Authentication credentials invalid');
    });

    test('a bare error still yields something printable', () => {
        expect(describeMailError(new Error('socket hang up'))).toBe('socket hang up');
        expect(describeMailError(null)).toBe('unknown error');
    });

    test('a long provider response is truncated rather than flooding the log', () => {
        const e = Object.assign(new Error('rejected'), { response: 'x'.repeat(1000) });
        expect(describeMailError(e).length).toBeLessThan(400);
    });
});
