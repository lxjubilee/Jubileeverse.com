'use client';

/**
 * Whether this document has already made a client-side navigation.
 *
 * `document.referrer` cannot answer "did the reader arrive here from our own
 * site?" in an App Router SPA: it is stamped once, when the document loads, and
 * a <Link> click never updates it. A reader who opens JubileeVerse directly and
 * then taps through the feed to a story therefore still carries an empty
 * referrer, so any guard written against it reads every in-app arrival as a cold
 * hit. Module state has exactly the lifetime we want instead — it survives
 * client navigations and resets on a real page load.
 */
let navigatedInApp = false;

/** Called by <NavigationTracker> on every client-side route change. */
export function recordInAppNavigation(): void {
  navigatedInApp = true;
}

/**
 * True when there is a page of ours behind this one, so a Back control can hand
 * the reader to history rather than bouncing them to a fallback route.
 */
export function hasInAppHistory(): boolean {
  if (typeof window === 'undefined') return false;
  // Nothing behind us at all (a shared link opened in a fresh tab): going back
  // would be a no-op, which reads as a dead button.
  if (window.history.length <= 1) return false;
  if (navigatedInApp) return true;
  // No client-side navigation yet, but a full-page load from one of our own
  // pages does leave a usable referrer.
  try {
    return Boolean(document.referrer && new URL(document.referrer).host === window.location.host);
  } catch {
    /* malformed referrer */
    return false;
  }
}
