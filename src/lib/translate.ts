/**
 * Client-side site translation. Faithful port of public/js/site-translate.js:
 * reads the chosen `siteLang`, scans common UI selectors, batches them to the
 * backend /api/translate-batch endpoint, applies + caches the results.
 *
 * Kept as a DOM-scanning routine (rather than i18n message catalogs) to match
 * the original behavior and the backend contract exactly.
 */
import { csrfHeaders } from './csrf';
import { getLangName } from './languages';

const CACHE_PREFIX = 'jv_pg_';
export const SITE_LANG_KEY = 'siteLang';

interface SelectorSpec {
  sel: string;
  prop: 'textContent' | 'placeholder' | 'innerHTML';
}

const SELECTORS: SelectorSpec[] = [
  { sel: '.nav-menu > .nav-link', prop: 'textContent' },
  { sel: '.nav-menu > .mobile-media-link', prop: 'textContent' },
  { sel: '.header-media-links > a', prop: 'textContent' },
  { sel: '#signInBtn', prop: 'textContent' },
  { sel: '#searchBtn', prop: 'textContent' },
  { sel: '#searchInput', prop: 'placeholder' },
  { sel: '.footer-bottom p', prop: 'innerHTML' },
  { sel: 'h1', prop: 'textContent' },
  { sel: 'h2', prop: 'textContent' },
  { sel: 'h3.widget-title', prop: 'textContent' },
  { sel: '.sidebar-widget label', prop: 'textContent' },
  { sel: '.btn', prop: 'textContent' },
  { sel: 'button[type="submit"]', prop: 'textContent' },
  // Dynamic content (feed cards + section headings use global class names).
  { sel: '.section-title', prop: 'textContent' },
  { sel: '.content-card-title', prop: 'textContent' },
  { sel: '.content-card-category', prop: 'textContent' },
];

const TEMPLATE_STRINGS = [
  'HOME', 'DEVOTIONALS', 'SERMONS', 'FAITH', 'FAMILY', 'COMMUNITY', 'ENCOURAGEMENT',
  'PRAYER', 'MUSIC', 'RADIO', 'AI BIBLE CHAT',
  'Prayer', 'Music', 'Radio', 'AI Bible Chat',
  'Sign In', 'Sign Out', 'Profile Settings', 'Search good news...',
  'Languages', 'Search languages...', 'No languages found',
];
// The footer's four column headings and their sixteen links used to be seeded
// here. The footer is now just the copyright line, and this list is only a
// warm-up — collectElements() adds whatever is actually on the page — so seeding
// strings nothing renders just paid the translation API to translate them.

type TranslationMap = Record<string, string>;

interface CollectedItem {
  el: HTMLElement;
  prop: SelectorSpec['prop'];
  text: string;
}

export function getSiteLang(): string {
  if (typeof window === 'undefined') return 'en-US';
  return window.localStorage.getItem(SITE_LANG_KEY) || 'en-US';
}

export function setSiteLang(code: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(SITE_LANG_KEY, code);
}

function getCache(lang: string): { map: TranslationMap } | null {
  try {
    const raw = window.localStorage.getItem(CACHE_PREFIX + lang);
    return raw ? (JSON.parse(raw) as { map: TranslationMap }) : null;
  } catch {
    return null;
  }
}

function setCache(lang: string, map: TranslationMap): void {
  try {
    window.localStorage.setItem(CACHE_PREFIX + lang, JSON.stringify({ map, ts: Date.now() }));
  } catch {
    // localStorage full — evict the oldest cached language and retry once.
    try {
      const keys: string[] = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k && k.startsWith(CACHE_PREFIX)) keys.push(k);
      }
      if (keys.length > 10) {
        keys.sort();
        window.localStorage.removeItem(keys[0]);
        window.localStorage.setItem(CACHE_PREFIX + lang, JSON.stringify({ map, ts: Date.now() }));
      }
    } catch {
      /* give up silently */
    }
  }
}

function collectElements(): CollectedItem[] {
  const items: CollectedItem[] = [];
  SELECTORS.forEach((s) => {
    document.querySelectorAll<HTMLElement>(s.sel).forEach((el) => {
      // Skip elements already translated in a previous pass (avoids re-sending
      // already-translated text to the API and prevents observer loops).
      if (el.dataset.jvT === '1') return;
      const text =
        s.prop === 'placeholder'
          ? (el as HTMLInputElement).placeholder
          : s.prop === 'innerHTML'
            ? el.innerHTML.trim()
            : (el.textContent || '').trim();
      if (text && text.length > 0 && text.length < 500) {
        items.push({ el, prop: s.prop, text });
      }
    });
  });
  return items;
}

function applyTranslations(items: CollectedItem[], map: TranslationMap): void {
  items.forEach((item) => {
    const tr = map[item.text];
    if (!tr) return;
    if (item.prop === 'placeholder') (item.el as HTMLInputElement).placeholder = tr;
    else if (item.prop === 'innerHTML') item.el.innerHTML = tr;
    else item.el.textContent = tr;
    item.el.dataset.jvT = '1';
  });
}

/**
 * Translate the current page into `lang`. No-op for English. Returns true if a
 * network translation pass ran (so the caller can show/hide a loading bar).
 */
export async function translatePage(lang: string): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  if (!lang || lang.startsWith('en')) return false;

  const items = collectElements();
  const textSet = new Set(TEMPLATE_STRINGS);
  items.forEach((item) => textSet.add(item.text));
  const allTexts = Array.from(textSet).filter((t) => t && t.trim());
  if (allTexts.length === 0) return false;

  // Start from the cached map (apply known strings instantly) and only fetch the
  // strings we don't have yet — so newly-rendered content still gets translated
  // even when the cache is already warm.
  const cachedMap: TranslationMap = getCache(lang)?.map || {};
  if (Object.keys(cachedMap).length > 0) applyTranslations(items, cachedMap);
  const missing = allTexts.filter((t) => !(t in cachedMap));
  if (missing.length === 0) return false;

  const langName = getLangName(lang);
  const CHUNK = 80;
  const translationMap: TranslationMap = { ...cachedMap };
  let fetchedAny = false;
  try {
    for (let i = 0; i < missing.length; i += CHUNK) {
      const chunk = missing.slice(i, i + CHUNK);
      const resp = await fetch('/api/translate-batch', {
        method: 'POST',
        // A signed-in reader's session cookie makes this a CSRF-guarded call;
        // without the header the backend answers 403 and the page silently
        // stayed in English.
        headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
        body: JSON.stringify({ texts: chunk, targetLang: lang, targetLangName: langName }),
      });
      if (!resp.ok) {
        // Swallowing this is what made the failure invisible: the language
        // picker appeared to do nothing at all, with nothing in the console.
        console.warn('[SiteTranslate] /api/translate-batch failed:', resp.status);
        continue;
      }
      const data = await resp.json();
      if (data.translations && Object.keys(data.translations).length > 0) {
        Object.assign(translationMap, data.translations);
        fetchedAny = true;
      }
    }
    if (fetchedAny) {
      applyTranslations(items, translationMap);
      setCache(lang, translationMap);
    }
  } catch (e) {
    console.warn('[SiteTranslate]', (e as Error).message);
  }
  return true;
}

/**
 * Keep the page translated as content loads/changes: runs an initial pass, then
 * re-translates (debounced) whenever the DOM mutates. Returns a cleanup fn.
 * No-op for English / SSR.
 */
export function observeContentTranslation(lang: string): () => void {
  if (typeof window === 'undefined' || !lang || lang.startsWith('en')) return () => {};
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;

  const run = () => {
    if (running) {
      schedule();
      return;
    }
    running = true;
    void translatePage(lang).finally(() => {
      running = false;
    });
  };
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(run, 700);
  };

  const observer = new MutationObserver(() => schedule());
  observer.observe(document.body, { childList: true, subtree: true });
  return () => {
    if (timer) clearTimeout(timer);
    observer.disconnect();
  };
}
