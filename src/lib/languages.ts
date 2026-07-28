/**
 * Language catalog for the site language picker. Codes + display names mirror
 * the original site-translate.js subset (the set the backend /api/translate-batch
 * supports). Flag images come from flagcdn using the locale's region subtag.
 */
export interface Language {
  code: string;
  name: string;
  /** flagcdn country code (region subtag, lowercased). */
  flag: string;
}

const RAW: Record<string, string> = {
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
};

export const LANGUAGES: Language[] = Object.entries(RAW).map(([code, name]) => ({
  code,
  name,
  flag: (code.split('-')[1] || code).toLowerCase(),
}));

export const DEFAULT_LANG = 'en-US';

export function getLangName(code: string): string {
  if (RAW[code]) return RAW[code];
  const base = code.split('-')[0];
  const match = Object.keys(RAW).find((k) => k.startsWith(base + '-'));
  return match ? RAW[match] : code;
}

export function getLangFlag(code: string): string {
  const lang = LANGUAGES.find((l) => l.code === code);
  return lang?.flag || (code.split('-')[1] || 'us').toLowerCase();
}
