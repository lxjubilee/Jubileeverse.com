import TopicPortal from './TopicPortal';
import { fetchCategoryArticles, fetchCategoryLabel } from '@/lib/articles';

/**
 * Server shell for the category portal.
 *
 * Articles come from the published article bundles — the local working folder
 * while developing, the CDN once deployed (see @/lib/articles). That bundle's
 * manifest is the whole story: nothing from the older CDN articles catalog is
 * shown here, and a category whose manifest is empty renders as empty.
 *
 * Resolution stays on the server because the CDN sends no CORS headers; only
 * the fields the cards need cross to the browser.
 */
export default async function TopicPortalPage({
  params,
}: {
  params: Promise<{ topic: string }>;
}) {
  const { topic } = await params;
  const [categoryLabel, articles] = await Promise.all([
    fetchCategoryLabel(topic),
    fetchCategoryArticles(topic),
  ]);

  return <TopicPortal categoryLabel={categoryLabel} articles={articles} />;
}
