'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * The article body.
 *
 * JubiLujah renders a pre-compiled block list here; this site keeps the raw
 * markdown from the `.md` file, so it goes through the same react-markdown
 * renderer the existing reader already uses. That keeps blockquotes, headings
 * and emphasis working without a second content format to maintain.
 *
 * Marked `'use client'` only because react-markdown wants a client boundary.
 * The markdown itself is passed in from a Server Component, so the rendered
 * body is still present in the server HTML: nothing is fetched after mount, and
 * a reader with JavaScript disabled still gets the whole article.
 */
export default function BackstageProse({
  markdown,
  className = 'bsa-body',
}: {
  markdown: string;
  className?: string;
}) {
  // The H1 is already shown in the hero overlay; drop the leading one so the
  // page does not open with the headline twice.
  const body = markdown.replace(/^#[^\n]*\n/, '');

  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
    </div>
  );
}
