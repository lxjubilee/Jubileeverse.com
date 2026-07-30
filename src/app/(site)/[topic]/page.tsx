import TopicPortal from './TopicPortal';
import { fetchCategoryArticles, fetchCategoryLabel, fetchSubcategories } from '@/lib/cdn';

/**
 * Server shell for the category portal. Resolves the category's subcategories,
 * label and articles from the CDN articles catalog and hands them to the client
 * portal, which renders them directly — no client-side article fetch.
 *
 * The catalog is ~2.5 MB and served without CORS headers, so all three fetches
 * must stay on the server; only the fields the cards need cross to the browser.
 * All three read one memoised copy of the catalog, so rendering this page costs
 * a single CDN download rather than one per helper.
 */
export default async function TopicPortalPage({
  params,
}: {
  params: Promise<{ topic: string }>;
}) {
  const { topic } = await params;
  const [subcategories, categoryLabel, articles] = await Promise.all([
    fetchSubcategories(topic),
    fetchCategoryLabel(topic),
    fetchCategoryArticles(topic),
  ]);

  return (
    <TopicPortal
      subcategories={subcategories}
      categoryLabel={categoryLabel}
      articles={articles}
    />
  );
}
