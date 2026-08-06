'use strict';

/**
 * mail-transport.js — decides which SMTP credentials the server sends with, and
 * says so out loud.
 *
 * Transactional mail was optional and silent: `emailTransporter` was built only
 * when SMTP_HOST was set, and with it unset `sendEmail` returned false before
 * logging anything. A deployment provisioned from .env.example — which
 * documented no mail variables at all — therefore accepted every password reset
 * request, answered "if an account exists, a link has been sent", wrote the
 * token, and never sent the mail. Nothing in the log said why, because the only
 * line that would have was inside the branch that never ran.
 *
 * Two credential sets exist in practice. SMTP_* is the primary. SES_SMTP_* was
 * configured for Amazon SES but no code ever read it, so an operator who had
 * filled it in was still sending nothing. It is used as a fallback rather than
 * left dead: where it is present and SMTP_* is not, the alternative is no mail
 * at all.
 */

/** Ports that carry implicit TLS from the first byte, rather than STARTTLS. */
const IMPLICIT_TLS_PORT = 465;

/**
 * Resolve SMTP settings from the environment.
 *
 * Returns `{ options, source, reason }`. `options` is null when nothing is
 * configured, and `reason` always explains the outcome in terms a log reader
 * can act on. Pure: takes the environment rather than reading it, so the
 * decision can be tested without a live process.
 */
function resolveMailConfig(env = process.env) {
    const candidates = [
        {
            source: 'SMTP_*',
            host: env.SMTP_HOST,
            port: env.SMTP_PORT,
            user: env.SMTP_USER,
            pass: env.SMTP_PASS,
        },
        {
            source: 'SES_SMTP_*',
            host: env.SES_SMTP_ENDPOINT,
            port: env.SES_SMTP_PORT,
            user: env.SES_SMTP_USERNAME,
            pass: env.SES_SMTP_PASSWORD,
        },
    ];

    for (const c of candidates) {
        if (!c.host) continue;
        const port = parseInt(c.port || '587', 10);
        // A host with no credentials authenticates as nobody and every send is
        // rejected. Better to name the missing half than to build a transport
        // that cannot work.
        if (!c.user || !c.pass) {
            return {
                options: null,
                source: c.source,
                reason: `${c.source} host is set but ${!c.user ? 'user' : 'password'} is missing`,
            };
        }
        return {
            options: {
                host: c.host,
                port,
                secure: port === IMPLICIT_TLS_PORT,
                auth: { user: c.user, pass: c.pass },
            },
            source: c.source,
            reason: `using ${c.source} (${c.host}:${port})`,
        };
    }

    return {
        options: null,
        source: null,
        reason:
            'no SMTP configured — set SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS ' +
            '(or SES_SMTP_ENDPOINT/SES_SMTP_PORT/SES_SMTP_USERNAME/SES_SMTP_PASSWORD). ' +
            'Password reset and every other transactional mail is disabled until then',
    };
}

/**
 * The address mail is sent from, and whether it was chosen or defaulted.
 * A default that does not belong to the sending domain is a common reason for
 * a provider to accept the credentials and then reject the message.
 */
function resolveFromAddress(env = process.env) {
    const configured = env.SMTP_FROM || env.SES_SMTP_FROM;
    return {
        from: configured || 'noreply@jubileeverse.com',
        defaulted: !configured,
    };
}

/** The detail an SMTP failure actually carries, flattened for one log line. */
function describeMailError(e) {
    if (!e) return 'unknown error';
    const parts = [e.message];
    if (e.code) parts.push(`code=${e.code}`);
    if (e.responseCode) parts.push(`responseCode=${e.responseCode}`);
    // The server's own words — "Domain not allowed to send", "Authentication
    // credentials invalid" — are usually the whole diagnosis.
    if (e.response) parts.push(`response=${String(e.response).replace(/\s+/g, ' ').slice(0, 300)}`);
    return parts.join(' | ');
}

module.exports = { resolveMailConfig, resolveFromAddress, describeMailError, IMPLICIT_TLS_PORT };
