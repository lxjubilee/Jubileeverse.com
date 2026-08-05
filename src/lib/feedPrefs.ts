/**
 * Feed personalization: which topics the reader follows or blocks, and which
 * individual stories they have hidden.
 *
 * One module because there are three writers — the card's ⋯ menu, the
 * Personalize popup, and the feed's own hide (✕) — and two readers, the home
 * feed and the topic portals. The key, the event name and the slug derivation
 * used to be copied into each of those files; identical by luck rather than by
 * construction, and a change in one would have broken the wiring silently.
 *
 * Storage shape (localStorage):
 *   jubileeVersePrefs   {"following": string[], "blocked": string[]}   topic slugs
 *   jubileeVerseHidden  string[]                                       story ids
 */

export const PREFS_KEY = 'jubileeVersePrefs';
export const HIDDEN_KEY = 'jubileeVerseHidden';

/** Dispatched on `window` after any write, so open views re-read immediately. */
export const PREFS_CHANGED_EVENT = 'jubilee:prefs-changed';

export interface FeedPrefs {
  following: string[];
  blocked: string[];
}

const EMPTY: FeedPrefs = { following: [], blocked: [] };

/**
 * The topic slug a story is filed under.
 *
 * The single definition on purpose: the card writes a preference under this
 * value and the feed matches against it, so the two must agree exactly.
 */
export function topicSlugOf(story: { topic?: string | null; category?: string | null }): string {
  return String(story.topic || story.category || '').toLowerCase();
}

export function readPrefs(): FeedPrefs {
  if (typeof window === 'undefined') return { ...EMPTY };
  try {
    const data = JSON.parse(window.localStorage.getItem(PREFS_KEY) || '{}');
    return {
      following: Array.isArray(data.following) ? data.following : [],
      blocked: Array.isArray(data.blocked) ? data.blocked : [],
    };
  } catch {
    return { ...EMPTY };
  }
}

/** Persist and notify. Both halves matter — a silent write leaves views stale. */
export function writePrefs(prefs: FeedPrefs): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({ following: prefs.following, blocked: prefs.blocked, ts: Date.now() }),
    );
    window.dispatchEvent(new CustomEvent(PREFS_CHANGED_EVENT));
  } catch {
    /* storage may be unavailable (private mode, quota) */
  }
}

/**
 * Apply one change to a topic and persist it. Following and blocking are
 * mutually exclusive; `clear` removes the topic from both, which is what the
 * card's menu does when the reader taps an already-active choice.
 */
export function setTopicPref(kind: 'follow' | 'block' | 'clear', slug: string): FeedPrefs {
  const key = String(slug || '').toLowerCase();
  if (!key) return readPrefs();

  const current = readPrefs();
  const following = new Set(current.following.map((s) => s.toLowerCase()));
  const blocked = new Set(current.blocked.map((s) => s.toLowerCase()));

  following.delete(key);
  blocked.delete(key);
  if (kind === 'follow') following.add(key);
  else if (kind === 'block') blocked.add(key);

  const next: FeedPrefs = { following: [...following], blocked: [...blocked] };
  writePrefs(next);
  return next;
}

export function readHidden(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(HIDDEN_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

/** Add a story to the hidden set and persist it. Returns the new set. */
export function addHidden(id: string | number, from?: Set<string>): Set<string> {
  const next = new Set(from ?? readHidden());
  next.add(String(id));
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(HIDDEN_KEY, JSON.stringify([...next]));
    } catch {
      /* ignore */
    }
  }
  return next;
}

/**
 * Subscribe to preference changes — both this tab's writes and another tab's,
 * which arrive as a `storage` event instead. Returns an unsubscribe function.
 */
export function onPrefsChanged(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === PREFS_KEY || e.key === HIDDEN_KEY) handler();
  };
  window.addEventListener(PREFS_CHANGED_EVENT, handler);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(PREFS_CHANGED_EVENT, handler);
    window.removeEventListener('storage', onStorage);
  };
}
