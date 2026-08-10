'use strict';
/**
 * lib/languages.js — the languages a reader may ask an article to be translated
 * into, as CommonJS.
 *
 * The catalogue already exists, in `src/lib/languages.ts`. That file is
 * TypeScript ESM and the Express process runs unbuilt CommonJS, so it cannot be
 * required from here; the repo's established answer to that boundary is a parity
 * test that reads the TypeScript source and fails when the two drift — see
 * tests/unit/tts-voice-coverage.test.js, which does exactly this for the neural
 * voice table. tests/unit/translation-languages-sync.test.js does it for the list
 * below. Keep both in step by hand; the test is what makes that safe.
 *
 * Why a server-side copy is needed at all: a translated article is stored on the
 * CDN under a key that carries the language code as a folder segment
 * (`news/2026/08/09/hi-IN/<slug>/article.md`), so `language_code` — which arrives
 * from the request body and was previously checked only for presence — now
 * decides where bytes land in a bucket. Two layers guard that, and both are
 * load-bearing:
 *
 *   - LANG_CODE_RE is the *shape* guarantee. It holds whatever the list contains,
 *     and it is what makes the no-collision-with-article-slugs property below
 *     true.
 *   - The allowlist is the *authority*. Without it a caller can mint folders
 *     under every article on the site, or store a "translation" under a code of
 *     their choosing that a later reader is then served.
 *
 * The collision property, stated once here because several call sites depend on
 * it: an article slug can never equal a language folder. newsSlugify() in
 * r2-news.js lowercases before slugifying, so a slug is always `[a-z0-9-]+`,
 * while every code below carries an uppercase region subtag. canonicalLang()
 * returning the list's own spelling rather than the caller's is what turns that
 * from an observation into a guarantee — R2 keys are case-sensitive, so an
 * un-canonicalised `hi-in` would be both a second object for one language and a
 * legal slug shape.
 */

/**
 * Code -> display name, mirroring RAW in src/lib/languages.ts exactly.
 *
 * The name matters as well as the code: it is interpolated into the translation
 * system prompt, and taking it from the request meant an unbounded caller string
 * reached the model. Preferring this table for a known code closes that.
 */
const LANGUAGE_NAMES = Object.freeze({
    'en-US': 'English (US)',
    'en-GB': 'English (UK)',
    'af-ZA': 'Afrikaans',
    'sq-AL': 'Albanian',
    'am-ET': 'Amharic',
    'ar-EG': 'Arabic (Egypt)',
    'ar-SA': 'Arabic (Saudi Arabia)',
    'ar-AE': 'Arabic (UAE)',
    'hy-AM': 'Armenian',
    'az-AZ': 'Azerbaijani',
    'bn-BD': 'Bengali',
    'bs-BA': 'Bosnian',
    'bg-BG': 'Bulgarian',
    'my-MM': 'Burmese',
    'zh-CN': 'Chinese (Simplified)',
    'zh-TW': 'Chinese (Traditional)',
    'hr-HR': 'Croatian',
    'cs-CZ': 'Czech',
    'da-DK': 'Danish',
    'nl-NL': 'Dutch',
    'et-EE': 'Estonian',
    'fil-PH': 'Filipino',
    'fi-FI': 'Finnish',
    'fr-FR': 'French (France)',
    'fr-CA': 'French (Canada)',
    'ka-GE': 'Georgian',
    'de-DE': 'German',
    'el-GR': 'Greek',
    'gu-IN': 'Gujarati',
    'he-IL': 'Hebrew',
    'hi-IN': 'Hindi',
    'hu-HU': 'Hungarian',
    'is-IS': 'Icelandic',
    'id-ID': 'Indonesian',
    'it-IT': 'Italian',
    'ja-JP': 'Japanese',
    'kn-IN': 'Kannada',
    'kk-KZ': 'Kazakh',
    'km-KH': 'Khmer',
    'ko-KR': 'Korean',
    'lo-LA': 'Lao',
    'lv-LV': 'Latvian',
    'lt-LT': 'Lithuanian',
    'mk-MK': 'Macedonian',
    'ms-MY': 'Malay',
    'ml-IN': 'Malayalam',
    'mr-IN': 'Marathi',
    'mn-MN': 'Mongolian',
    'ne-NP': 'Nepali',
    'nb-NO': 'Norwegian',
    'fa-IR': 'Persian (Farsi)',
    'pl-PL': 'Polish',
    'pt-BR': 'Portuguese (Brazil)',
    'pt-PT': 'Portuguese (Portugal)',
    'pa-IN': 'Punjabi',
    'ro-RO': 'Romanian',
    'ru-RU': 'Russian',
    'sr-RS': 'Serbian',
    'si-LK': 'Sinhala',
    'sk-SK': 'Slovak',
    'sl-SI': 'Slovenian',
    'so-SO': 'Somali',
    'es-MX': 'Spanish (Mexico)',
    'es-ES': 'Spanish (Spain)',
    'es-US': 'Spanish (United States)',
    'es-CO': 'Spanish (Colombia)',
    'es-AR': 'Spanish (Argentina)',
    'sw-KE': 'Swahili',
    'sv-SE': 'Swedish',
    'ta-IN': 'Tamil',
    'te-IN': 'Telugu',
    'th-TH': 'Thai',
    'tr-TR': 'Turkish',
    'uk-UA': 'Ukrainian',
    'ur-PK': 'Urdu (Pakistan)',
    'ur-IN': 'Urdu (India)',
    'uz-UZ': 'Uzbek',
    'vi-VN': 'Vietnamese',
    'cy-GB': 'Welsh',
    'zu-ZA': 'Zulu',
});

const LANGUAGE_CODES = Object.freeze(Object.keys(LANGUAGE_NAMES));

/**
 * The shape every code in the catalogue has: a two- or three-letter primary tag,
 * a hyphen, and an uppercase two-letter region. `fil-PH` is the only three-letter
 * primary tag in the list.
 */
const LANG_CODE_RE = /^[a-z]{2,3}-[A-Z]{2}$/;

/** Lower-cased code -> the catalogue's own spelling. */
const BY_LOWER = new Map(LANGUAGE_CODES.map((code) => [code.toLowerCase(), code]));

/**
 * The catalogue's spelling of `code`, or '' when it is not a language we offer.
 *
 * Case-insensitive on the way in and canonical on the way out, so `hi-in`,
 * `HI-IN` and `hi-IN` all resolve to the single object `hi-IN`.
 */
function canonicalLang(code) {
    if (typeof code !== 'string') return '';
    return BY_LOWER.get(code.trim().toLowerCase()) || '';
}

/**
 * True when `code` names a language an article may be translated *into*.
 *
 * English is excluded deliberately: it is the language articles are stored in,
 * so a translation into it would be a second copy of the same bytes under a
 * different key, free to drift from the original.
 */
function isTranslatable(code) {
    const canonical = canonicalLang(code);
    return Boolean(canonical) && !canonical.startsWith('en-');
}

/** The display name for a known code, or '' — never the caller's own string. */
function languageName(code) {
    return LANGUAGE_NAMES[canonicalLang(code)] || '';
}

/**
 * Scripts written right to left.
 *
 * Base subtags only, matched against the code's own base subtag. The previous
 * version of this list carried region-qualified entries (`he-IL`, `fa-IR`,
 * `ur-PK`) and compared them against `code.toLowerCase()` — which no
 * region-qualified entry can ever equal — while the picker only ever sends
 * region-qualified codes. So every RTL language the site offers was reported as
 * left-to-right. Fixed here rather than left alone because the flag is now
 * written into stored translations, where a wrong value outlives the request.
 */
const RTL_BASE_SUBTAGS = new Set([
    'ar',   // Arabic
    'he',   // Hebrew
    'fa',   // Persian/Farsi
    'ur',   // Urdu
    'yi',   // Yiddish
    'arc',  // Aramaic
    'dv',   // Dhivehi/Maldivian
    'ku',   // Kurdish (Sorani)
    'ps',   // Pashto
]);

function isRTLLanguage(languageCode) {
    if (typeof languageCode !== 'string') return false;
    return RTL_BASE_SUBTAGS.has(languageCode.trim().toLowerCase().split('-')[0]);
}

module.exports = {
    LANGUAGE_NAMES,
    LANGUAGE_CODES,
    LANG_CODE_RE,
    canonicalLang,
    isTranslatable,
    languageName,
    isRTLLanguage,
};
