import SiteShell from '@/components/layout/SiteShell';
import { fetchNavCategories } from '@/lib/cdn';

/**
 * Layout for all public-facing pages — wraps them in the site chrome.
 *
 * The nav categories are read from the CDN articles catalog here (server side):
 * the catalog is ~2.6 MB and sends no CORS headers, so the browser must never
 * fetch it directly. Only the five slug/label pairs cross to the client.
 */
export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const navCategories = await fetchNavCategories();

  return <SiteShell navCategories={navCategories}>{children}</SiteShell>;
}
