/**
 * ArticleForm.tsx — Inline edit form for article/blog_post/page/news_item/devotional (Phase 4A)
 */

import * as React from 'react'
import { RichTextEditor } from '../../editor/RichTextEditor'
import { useUpdateContent } from '../../../hooks/useContent'
import { Input } from '../../ui/Input'
import type { ContentObject } from '../../../types/content-objects'

interface ArticleFormProps {
  item: ContentObject
}

export function ArticleForm({ item }: ArticleFormProps) {
  const update = useUpdateContent()
  const ext = (item.extension_data ?? {}) as Record<string, unknown>

  const [metaTitle, setMetaTitle] = React.useState((ext.meta_title as string) ?? '')
  const [metaDesc,  setMetaDesc]  = React.useState((ext.meta_description as string) ?? '')
  const [featImg,   setFeatImg]   = React.useState((ext.featured_image_url as string) ?? '')

  const autoSaveRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  function scheduleAutoSave(bodyHtml: string) {
    if (autoSaveRef.current) clearTimeout(autoSaveRef.current)
    autoSaveRef.current = setTimeout(() => {
      update.mutate({
        id: item.id,
        data: {
          extension_data: { ...ext, body_html: bodyHtml },
          change_summary: 'Auto-save',
        },
      })
    }, 30_000)
  }

  function saveMetaFields() {
    update.mutate({
      id: item.id,
      data: {
        extension_data: {
          ...ext,
          meta_title: metaTitle,
          meta_description: metaDesc,
          featured_image_url: featImg,
        },
      },
    })
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      {/* Rich text body */}
      <div className="min-h-[200px] border rounded">
        <RichTextEditor
          initialHtml={(ext.body_html as string) ?? ''}
          onChange={scheduleAutoSave}
          placeholder="Start writing…"
        />
      </div>

      {/* SEO fields */}
      <div className="space-y-2">
        <label className="block text-xs font-medium text-muted-foreground">SEO Title</label>
        <Input
          value={metaTitle}
          onChange={e => setMetaTitle(e.target.value)}
          onBlur={saveMetaFields}
          placeholder="Override title for search engines"
          className="h-7 text-xs"
        />
      </div>
      <div className="space-y-2">
        <label className="block text-xs font-medium text-muted-foreground">SEO Description</label>
        <textarea
          value={metaDesc}
          onChange={e => setMetaDesc(e.target.value)}
          onBlur={saveMetaFields}
          placeholder="Meta description (max 160 chars)"
          maxLength={160}
          rows={2}
          className="w-full rounded border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary resize-none"
        />
      </div>
      <div className="space-y-2">
        <label className="block text-xs font-medium text-muted-foreground">Featured Image URL</label>
        <Input
          value={featImg}
          onChange={e => setFeatImg(e.target.value)}
          onBlur={saveMetaFields}
          placeholder="https://…"
          className="h-7 text-xs"
        />
      </div>
    </div>
  )
}
