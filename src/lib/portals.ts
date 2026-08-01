/**
 * jubileeinspire.com portals that live at the root of jubileeverse.com.
 *
 * These have dedicated backend endpoints (`/api/portal/:slug`) rather than
 * published article bundles, so nothing in @/lib/articles knows about them.
 * The list is stated once here because two places need it: the portal itself,
 * and the root segment's dispatcher, which has to know that `/hope-restored`
 * is navigation rather than an article slug.
 */
export const NAMED_PORTAL_SLUGS = new Set([
  'encouragement',
  'faith-builders',
  'hope-restored',
  'lets-celebrate',
  'purpose-driven',
  'live-inspired',
]);
