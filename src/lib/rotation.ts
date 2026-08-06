/**
 * Time-boxed shuffling for article listings.
 *
 * A category portal shows every published article at once, so without this the
 * top of the page is frozen until something new is published. Re-ordering on a
 * clock gives the page a fresh face each day.
 *
 * The order must be the same for every reader inside one window: it is derived
 * from the window and a caller-supplied key, never from a random source, so two
 * people opening the same category at the same moment see the same page — and
 * so a server render and its hydration agree.
 *
 * A window is one PST day, turning over at midnight. That is the boundary the
 * backend already locks its portal layout on (`generatePortalLayout` in
 * server.js, seeded from the PST date), so the whole site changes face at one
 * moment rather than drifting apart through the day — and a reader who returns
 * in the afternoon finds the page as they left it that morning.
 *
 * The window size is still a parameter, so a caller that wants finer rotation
 * can ask for it. Nothing here reads the clock unless asked: pass `now` and the
 * result is fully determined.
 */

/** Hours per rotation window — one full PST day. */
export const ROTATION_HOURS = 24;

/** The timezone whose day and 6-hour boundaries the site runs on. */
const ROTATION_TIME_ZONE = 'America/Los_Angeles';

/**
 * The current rotation window, as `YYYY-MM-DDTHH` in PST.
 *
 * The hour is the window's opening hour, so at the 24-hour default every
 * instant of a PST day yields `...T00` and the key is that day's date; at six
 * hours, everything between 06:00:00 and 11:59:59 yields `...T06`. Intl does
 * the timezone work, which is what keeps this correct across DST — the offset
 * is not a constant to subtract.
 */
export function rotationWindow(now: Date = new Date(), hours: number = ROTATION_HOURS): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ROTATION_TIME_ZONE,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
  }).formatToParts(now);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  // Hour-cycle h24 reports midnight as "24"; the calendar fields have already
  // rolled over, so it means hour 0 of the date alongside it.
  const hour = Number(get('hour')) % 24;
  const span = Math.max(1, Math.floor(hours));
  const opening = Math.floor(hour / span) * span;

  return `${get('year')}-${get('month')}-${get('day')}T${String(opening).padStart(2, '0')}`;
}

/**
 * Deterministic Fisher-Yates, seeded from a string.
 *
 * Same xorshift32 the backend's portal layout uses (`seededShuffle` in
 * server.js), so the two rotations behave alike and one explanation covers
 * both. The seed is forced non-zero: xorshift is stuck at zero forever, which
 * would return a fixed, non-random permutation for any key that happened to
 * hash to it.
 */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const out = [...items];
  if (out.length < 2) return out;

  let state = 0;
  for (let i = 0; i < seed.length; i++) state = (state * 31 + seed.charCodeAt(i)) >>> 0;
  state = state || 1;

  const next = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x1_0000_0000;
  };

  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * One listing's order for the current window.
 *
 * `key` separates the listings from one another — pass the category slug, so
 * the five portals shuffle independently rather than all landing on the same
 * permutation of their own articles.
 *
 * Returns a new array; the input is left alone, so a memoised manifest is never
 * reordered under another caller.
 */
export function rotateForWindow<T>(items: readonly T[], key: string, now?: Date): T[] {
  return seededShuffle(items, `${key}:${rotationWindow(now)}`);
}
