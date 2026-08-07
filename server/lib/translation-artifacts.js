'use strict';
/**
 * Stray markup and labels a translation model wraps around its own answer.
 *
 * Two shapes, both reported on the same source article.
 *
 * The first, on a Hindi article: the model returned the whole translated body
 * inside a tag of its own invention —
 *
 *     <budget:token_budget>
 *     सीनेट होमलैंड सिक्योरिटी और गवर्नमेंटल अफेयर्स कमेटी…
 *     </budget:token_budget>
 *
 * The endpoint's parser only lifts off the `TITLE:` / `SOURCE:` / `CATEGORY:`
 * header lines and takes the remainder as content, so the wrapper travelled
 * straight through into both translation caches. That is what made it worth
 * fixing rather than ignoring: the reader who triggered it saw it once, but
 * every later reader was served the cached copy, so it never went away on its
 * own and re-translating could not clear it.
 *
 * It was also visible rather than inert. `<budget:token_budget>` is a valid
 * CommonMark autolink (`<scheme:path>`), so react-markdown rendered it as a
 * link sitting in front of the article's first sentence.
 *
 * The second, on the Arabic translation of that article: the body opened on the
 * word `CONTENT:`. The endpoint frames the article it sends with the same labels
 * it asks for back — `TITLE:`, `SOURCE:`, `CATEGORY:`, then `CONTENT:` ahead of
 * the body — and the parser lifts the first three off the response but has no
 * reason to expect the fourth, which belongs to the input alone. A model that
 * has just been shown the label answers with it, so it survived into the body
 * and into the caches, and cached is where it stayed.
 *
 * Pulled out of server.js so the rules below can be tested against real model
 * output without a database or an API key.
 */

/**
 * HTML elements an article body may legitimately be wrapped in. A translation
 * of a stored HTML article can arrive enclosed in one of these, and unwrapping
 * it would change the document rather than clean it.
 */
const HTML_ELEMENTS = new Set([
    'a', 'abbr', 'address', 'article', 'aside', 'b', 'blockquote', 'body', 'br',
    'caption', 'cite', 'code', 'col', 'colgroup', 'dd', 'del', 'details', 'div',
    'dl', 'dt', 'em', 'figcaption', 'figure', 'footer', 'h1', 'h2', 'h3', 'h4',
    'h5', 'h6', 'head', 'header', 'hgroup', 'hr', 'html', 'i', 'iframe', 'img',
    'ins', 'kbd', 'li', 'main', 'mark', 'nav', 'ol', 'p', 'picture', 'pre', 'q',
    's', 'samp', 'section', 'small', 'span', 'strong', 'sub', 'summary', 'sup',
    'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'time', 'tr', 'u', 'ul',
    'var', 'video', 'wbr',
]);

/**
 * URI schemes that make `<scheme:rest>` a link the author meant to write.
 * Markdown autolinks share their shape with the artifact, so the two are told
 * apart here rather than by guessing.
 */
const REAL_URI_SCHEMES = new Set([
    'bitcoin', 'data', 'file', 'ftp', 'ftps', 'geo', 'http', 'https', 'irc',
    'magnet', 'mailto', 'news', 'nntp', 'sms', 'tel', 'urn', 'webcal', 'ws',
    'wss', 'xmpp',
]);

/** `<p>` and `<h2>` are markup; `<budget:token_budget>` is not. */
const isHtmlElement = (name) => HTML_ELEMENTS.has(name.toLowerCase());

/**
 * True when `<name>` is a link the author wrote, not a tag the model invented.
 * Anything with a real scheme is one, as is anything carrying the furniture of
 * an address — a slash, an `@`, or a dot — whatever its scheme.
 */
function isAutolink(name) {
    const colon = name.indexOf(':');
    if (colon === -1) return false;
    if (REAL_URI_SCHEMES.has(name.slice(0, colon).toLowerCase())) return true;
    return /[/@.]/.test(name.slice(colon + 1));
}

/** A tag name that is neither real markup nor a link: the artifact shape. */
const isArtifactTag = (name) => !isHtmlElement(name) && !isAutolink(name);

/** Tag names, as they appear inside the brackets. Deliberately permissive. */
const TAG_NAME = '[A-Za-z][A-Za-z0-9._:+-]*';

/**
 * The `CONTENT:` label, at the very start of a body and nowhere else.
 *
 * Anchored deliberately. An article may quote the word mid-sentence — a piece
 * about publishing could reasonably print "CONTENT: a note on the format" — and
 * only the copy sitting where the first sentence belongs is the echoed label.
 *
 * Tolerates what a model puts around it: the bold a markdown-minded translator
 * adds (`**CONTENT:**`), a space before the colon, and either shape it arrives
 * in — alone on its line, or run straight into the first sentence.
 */
const CONTENT_LABEL = /^\**[ \t]*CONTENT[ \t]*:\**[ \t]*\r?\n?/i;

/** Drop a leading `CONTENT:` label. Returns the body unchanged when absent. */
const stripContentLabel = (text) => text.replace(CONTENT_LABEL, '');

/**
 * Strip wrapper tags a model put around a translation.
 *
 * Three passes, narrowest first, with the `CONTENT:` label taken off either
 * side of the first — the label can sit outside a wrapper the model invented or
 * inside it, and which one costs nothing to allow for:
 *
 *   1. A matched pair enclosing the entire body is unwrapped, provided the tag
 *      is not a real HTML element. Repeated, because a model that invents one
 *      wrapper can invent two.
 *   2. Orphan closing tags go. A `</x>` cannot be an autolink, so a non-HTML
 *      one is always debris.
 *   3. Orphan opening tags go only when they are neither HTML nor a plausible
 *      link — `<mailto:someone@example.org>` and `<https://example.org>` stay.
 *
 * Content that carries none of this is returned unchanged apart from trimming.
 */
function stripTranslationArtifacts(content) {
    if (typeof content !== 'string' || content.length === 0) return content;
    let out = stripContentLabel(content.trim()).trim();

    // 1. Unwrap. Bounded rather than `while (true)`: a pathological input must
    // not spin here, and nothing legitimate nests model wrappers deeply.
    for (let i = 0; i < 4; i++) {
        const wrapped = out.match(new RegExp(`^<(${TAG_NAME})>([\\s\\S]*)<\\/\\1>$`));
        if (!wrapped || isHtmlElement(wrapped[1])) break;
        out = wrapped[2].trim();
    }

    // The label again, now that any wrapper enclosing it is off.
    out = stripContentLabel(out).trim();

    // 2. Orphan closing tags.
    out = out.replace(new RegExp(`<\\/(${TAG_NAME})>`, 'g'), (tag, name) =>
        isHtmlElement(name) ? tag : '',
    );

    // 3. Orphan opening tags, excluding autolinks.
    out = out.replace(new RegExp(`<(${TAG_NAME})>`, 'g'), (tag, name) =>
        isArtifactTag(name) ? '' : tag,
    );

    // Removing a tag that sat on its own line leaves the blank line behind.
    return out.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Below this share of the original's length, a "translation" is a failed
 * response. Every language this site offers renders an article within a factor
 * of a few of its English length — Hindi came back slightly longer than its
 * source — so a tenth is far under anything a real translation reaches.
 */
const IMPLAUSIBLE_RATIO = 0.1;

/**
 * True when a result is too short to be a translation of `source`.
 *
 * Emptiness alone is not enough to spot debris. One cached row held nothing but
 * `<budget:token_budget>200000</budget:token_budget>` — the model reported a
 * token budget and translated none of the article — and `200000` survives the
 * strip. Against the length of the article it was supposed to be, it does not.
 */
function isImplausiblyShort(translated, source) {
    const out = typeof translated === 'string' ? translated.trim().length : 0;
    const src = typeof source === 'string' ? source.trim().length : 0;
    if (src === 0) return out === 0;
    return out < src * IMPLAUSIBLE_RATIO;
}

module.exports = {
    stripTranslationArtifacts,
    stripContentLabel,
    isArtifactTag,
    isImplausiblyShort,
};
