'use strict';
/**
 * Transactional email templates.
 *
 * Email is not the web. Every constraint below is deliberate:
 *
 *   - Tables, not flexbox/grid. Outlook renders through Word's HTML engine, which
 *     has no support for either.
 *   - Styles inlined on the elements. Gmail strips <head> in forwarded and clipped
 *     messages, so a <style> block is a progressive enhancement at best; the
 *     @media rules below are exactly that and nothing load-bearing lives there.
 *   - No external CSS, JS, or webfonts — they are stripped or blocked outright.
 *   - No image is required to read the message. Most clients block remote images
 *     by default, so the wordmark is live text rather than a logo file.
 *   - Every message ships a plain-text alternative. HTML-only mail scores badly
 *     with spam filters and is unreadable in text-only clients.
 *
 * Light-first. A dark shell would collide with the aggressive auto-inversion
 * Outlook and Gmail apply, which is how "designed dark" becomes "unreadable grey
 * on grey". The dark-mode block is opt-in for clients that honour prefers-color-scheme.
 */

const GOLD = '#e6ac00';
const INK = '#1b1b1b';
const BODY_TEXT = '#3f3f46';
const MUTED = '#71717a';
const PAGE_BG = '#f4f4f5';
const CARD_BG = '#ffffff';
const HAIRLINE = '#e4e4e7';

const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";

/** Escape text destined for an HTML context. */
function esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Chrome shared by every transactional message: preheader, centred card, wordmark,
 * footer. `contentHtml` is dropped into the card body.
 *
 * The preheader is the text a client previews next to the subject line. Left
 * unset it scrapes whatever comes first — usually "View in browser" or the raw
 * URL — so it is set explicitly and then hidden twice over: zero-height/opacity
 * for rendering clients, plus the &#847;&zwnj; padding run that stops Gmail
 * pulling body copy in after it.
 */
function shell({ preheader, contentHtml, footerNote }) {
    const pad = '&#847;&zwnj;&nbsp;'.repeat(60);
    return `<!DOCTYPE html>
<html lang="en" dir="ltr" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>JubileeVerse</title>
<!--[if mso]>
<noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
<![endif]-->
<style>
  /* Enhancement only — never rely on this block surviving. */
  @media only screen and (max-width:600px){
    .jv-card{width:100% !important;}
    .jv-pad{padding-left:24px !important;padding-right:24px !important;}
    .jv-h1{font-size:24px !important;line-height:32px !important;}
    .jv-btn a{display:block !important;}
  }
  @media (prefers-color-scheme:dark){
    .jv-page{background:#161616 !important;}
    .jv-card{background:#242424 !important;}
    .jv-h1,.jv-strong{color:#ffffff !important;}
    .jv-text{color:#c4c4c4 !important;}
    .jv-muted{color:#8a8a8a !important;}
    .jv-hair{border-color:rgba(255,255,255,0.12) !important;}
    .jv-urlbox{background:#1b1b1b !important;border-color:rgba(255,255,255,0.12) !important;}
  }
  a{color:#8a6a00;}
</style>
</head>
<body class="jv-page" style="margin:0;padding:0;width:100%;background:${PAGE_BG};">
<div style="display:none;font-size:1px;color:${PAGE_BG};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${esc(preheader)}${pad}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${PAGE_BG};">
<tr><td align="center" style="padding:32px 12px;">

<table role="presentation" class="jv-card" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:600px;background:${CARD_BG};border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">

  <tr><td style="height:4px;background:${GOLD};font-size:0;line-height:0;">&nbsp;</td></tr>

  <tr><td class="jv-pad" align="center" style="padding:32px 40px 8px;">
    <span class="jv-strong" style="font-family:${FONT};font-size:21px;font-weight:700;letter-spacing:-0.3px;color:${INK};">Jubilee<span style="color:${GOLD};">Verse</span>.com</span>
  </td></tr>

  ${contentHtml}

  <tr><td class="jv-pad" style="padding:0 40px;">
    <div class="jv-hair" style="border-top:1px solid ${HAIRLINE};font-size:0;line-height:0;">&nbsp;</div>
  </td></tr>

  <tr><td class="jv-pad" style="padding:20px 40px 32px;">
    <p class="jv-muted" style="margin:0 0 6px;font-family:${FONT};font-size:12px;line-height:18px;color:${MUTED};">${esc(footerNote)}</p>
    <p class="jv-muted" style="margin:0;font-family:${FONT};font-size:12px;line-height:18px;color:${MUTED};">&copy; ${new Date().getFullYear()} JubileeVerse.com</p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

/**
 * Password reset.
 *
 * The reset URL appears twice on purpose: once as the button, once as selectable
 * text. Buttons lose their href to overzealous sanitisers and are unusable when a
 * client refuses to render the VML fallback, and a reset mail whose only link is
 * dead strands the one user who cannot get in by any other route.
 *
 * The copy deliberately never asserts that the recipient asked for this — an
 * attacker who knows an address can trigger it. It states what happens if they
 * ignore it, which is the actionable part.
 *
 * @param {object}  opts
 * @param {string}  opts.resetUrl           Tokenised link. Must be absolute.
 * @param {number} [opts.expiresInMinutes]  Kept in step with the token TTL.
 * @returns {{subject:string, html:string, text:string}}
 */
function passwordResetEmail({ resetUrl, expiresInMinutes = 60 }) {
    if (!resetUrl) throw new Error('passwordResetEmail: resetUrl is required');

    const window_ = expiresInMinutes % 60 === 0
        ? `${expiresInMinutes / 60} hour${expiresInMinutes === 60 ? '' : 's'}`
        : `${expiresInMinutes} minutes`;

    const safeUrl = esc(resetUrl);

    const content = `
  <tr><td class="jv-pad" style="padding:16px 40px 0;">
    <h1 class="jv-h1" style="margin:0 0 16px;font-family:${FONT};font-size:27px;line-height:34px;font-weight:700;letter-spacing:-0.4px;color:${INK};">Reset your password</h1>
    <p class="jv-text" style="margin:0 0 24px;font-family:${FONT};font-size:16px;line-height:26px;color:${BODY_TEXT};">
      We received a request to reset the password for your JubileeVerse account. Choose a new one using the button below.
    </p>
  </td></tr>

  <tr><td class="jv-pad" align="left" style="padding:0 40px 24px;">
    <table role="presentation" class="jv-btn" cellpadding="0" cellspacing="0" border="0">
      <tr><td align="center" bgcolor="${GOLD}" style="border-radius:8px;">
        <!--[if mso]>
        <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${safeUrl}" style="height:48px;v-text-anchor:middle;width:260px;" arcsize="17%" stroke="f" fillcolor="${GOLD}">
        <w:anchorlock/><center style="color:${INK};font-family:${FONT};font-size:16px;font-weight:700;">Choose a new password</center>
        </v:roundrect>
        <![endif]-->
        <!--[if !mso]><!-- -->
        <a href="${safeUrl}" style="display:inline-block;padding:14px 32px;font-family:${FONT};font-size:16px;font-weight:700;line-height:20px;color:${INK};text-decoration:none;border-radius:8px;background:${GOLD};">Choose a new password</a>
        <!--<![endif]-->
      </td></tr>
    </table>
  </td></tr>

  <tr><td class="jv-pad" style="padding:0 40px 24px;">
    <p class="jv-muted" style="margin:0 0 8px;font-family:${FONT};font-size:13px;line-height:20px;color:${MUTED};">
      If the button does not work, copy this link into your browser:
    </p>
    <div class="jv-urlbox" style="padding:12px 14px;background:${PAGE_BG};border:1px solid ${HAIRLINE};border-radius:8px;">
      <a href="${safeUrl}" style="font-family:${FONT};font-size:13px;line-height:20px;color:#8a6a00;text-decoration:underline;word-break:break-all;">${safeUrl}</a>
    </div>
  </td></tr>

  <tr><td class="jv-pad" style="padding:0 40px 28px;">
    <p class="jv-text" style="margin:0;font-family:${FONT};font-size:14px;line-height:22px;color:${BODY_TEXT};">
      This link works once and expires in <strong class="jv-strong" style="color:${INK};">${window_}</strong>.
      If you did not ask to reset your password you can ignore this message — your password stays exactly as it is.
    </p>
  </td></tr>`;

    const text = [
        'Reset your password',
        '',
        'We received a request to reset the password for your JubileeVerse account.',
        'Open this link to choose a new one:',
        '',
        resetUrl,
        '',
        `This link works once and expires in ${window_}.`,
        'If you did not ask to reset your password you can ignore this message —',
        'your password stays exactly as it is.',
        '',
        '---',
        'This is an automated message, so replies do not reach us.',
        `(c) ${new Date().getFullYear()} JubileeVerse.com`,
        '',
    ].join('\n');

    return {
        subject: 'Reset your JubileeVerse password',
        html: shell({
            preheader: `Choose a new password — this link expires in ${window_}.`,
            contentHtml: content,
            footerNote: 'This is an automated message, so replies do not reach us.',
        }),
        text,
    };
}

module.exports = { passwordResetEmail, _internals: { shell, esc } };
