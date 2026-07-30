import { notFound } from 'next/navigation';
import TopicPortal from '../TopicPortal';
import { fetchSubcategoryView } from '@/lib/cdn';

/**
 * A subcategory level inside a category portal, e.g.
 * /covenant-identity/hebrew-meaning-of-your-name/supreme-name-above-every-name
 *
 * The CDN catalog nests four levels of subcategories under each category, so
 * this catch-all renders any of them: the node's own children as chips (which
 * link one level deeper) plus every article published beneath it. The deepest
 * level has no children and renders as articles only.
 *
 * Resolution happens here on the server because the catalog is ~2.5 MB and
 * served without CORS headers — the browser can never fetch it.
 */
export default async function SubcategoryPage({
  params,
}: {
  params: Promise<{ topic: string; sub: string[] }>;
}) {
  const { topic, sub } = await params;
  const view = await fetchSubcategoryView(topic, sub);
  if (!view) notFound();

  return (
    <TopicPortal
      subcategories={view.children}
      categoryLabel={view.label}
      articles={view.articles}
      subPath={sub}
      trail={view.trail}
    />
  );
}
