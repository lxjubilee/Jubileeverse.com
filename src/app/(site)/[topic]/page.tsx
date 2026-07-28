import TopicPortal from './TopicPortal';
import { fetchSubcategories } from '@/lib/cdn';

/**
 * Server shell for the category portal. Resolves the category's subcategories
 * from the CDN articles catalog and hands them to the client portal, which
 * still loads its articles from the Express API on the client as before.
 *
 * The catalog is ~2.6 MB and served without CORS headers, so this fetch must
 * stay on the server; only the handful of slug/label pairs cross to the browser.
 */
export default async function TopicPortalPage({
  params,
}: {
  params: Promise<{ topic: string }>;
}) {
  const { topic } = await params;
  const subcategories = await fetchSubcategories(topic);

  return <TopicPortal subcategories={subcategories} />;
}
