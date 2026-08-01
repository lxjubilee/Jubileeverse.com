import SiteShell from '@/components/layout/SiteShell';
import { fetchNavCategories } from '@/lib/articles';

/**
 * Layout for all public-facing pages — wraps them in the site chrome.
 *
 * The nav categories are resolved here (server side) from the five published
 * article bundles on the CDN, which sends no CORS headers — the browser must
 * never read those manifests itself. Only the five slug/label pairs cross to
 * the client.
 */
export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const navCategories = await fetchNavCategories();

  return <SiteShell navCategories={navCategories}>{children}</SiteShell>;
}
