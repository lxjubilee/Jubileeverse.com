/**
 * MetadataSidebar.tsx — Base fields editor for content objects (Phase 4)
 */

import { Input }    from '../ui/Input'
import { Select }   from '../ui/Select'
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card'
import { OBJECT_STATUSES } from '../../types/content-objects'
import type { ContentObject, UpdateContentObjectRequest } from '../../types/content-objects'

const STATUS_OPTIONS = OBJECT_STATUSES.map(s => ({ value: s, label: s }))

const LANG_OPTIONS = [
  { value: 'en',    label: 'English' },
  { value: 'es',    label: 'Spanish' },
  { value: 'fr',    label: 'French' },
  { value: 'de',    label: 'German' },
  { value: 'pt',    label: 'Portuguese' },
  { value: 'zh',    label: 'Chinese' },
]

export interface MetadataSidebarProps {
  object: ContentObject
  onChange: (patch: UpdateContentObjectRequest) => void
}

export function MetadataSidebar({ object, onChange }: MetadataSidebarProps) {
  function field<K extends keyof UpdateContentObjectRequest>(key: K, value: UpdateContentObjectRequest[K]) {
    onChange({ [key]: value } as UpdateContentObjectRequest)
  }

  return (
    <div className="space-y-3 p-3 text-sm">
      <Card>
        <CardHeader><CardTitle>Details</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Title</label>
            <Input
              className="h-8 text-xs"
              value={object.title ?? ''}
              onChange={e => field('title', e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Slug</label>
            <Input
              className="h-8 text-xs font-mono"
              value={object.slug ?? ''}
              onChange={e => field('slug', e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Summary</label>
            <textarea
              className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
              rows={3}
              value={object.summary ?? ''}
              onChange={e => field('summary', e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Status</label>
            <Select
              className="h-8 text-xs"
              value={object.status}
              onValueChange={v => field('status', v as ContentObject['status'])}
              options={STATUS_OPTIONS}
            />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Language</label>
            <Select
              className="h-8 text-xs"
              value={object.language}
              onValueChange={v => field('language', v)}
              options={LANG_OPTIONS}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>SEO</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">SEO title</label>
            <Input
              className="h-8 text-xs"
              value={(object.meta_data?.seo_title as string) ?? ''}
              onChange={e => onChange({ meta_data: { ...object.meta_data, seo_title: e.target.value } })}
            />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">SEO description</label>
            <textarea
              className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
              rows={2}
              value={(object.meta_data?.seo_description as string) ?? ''}
              onChange={e => onChange({ meta_data: { ...object.meta_data, seo_description: e.target.value } })}
            />
          </div>
        </CardContent>
      </Card>

      <div className="text-xs text-muted-foreground space-y-0.5 px-1">
        <p>Created: {new Date(object.created_at).toLocaleDateString()}</p>
        <p>Updated: {new Date(object.updated_at).toLocaleDateString()}</p>
        <p>Version: {object.version}</p>
        <p className="font-mono truncate">{object.id}</p>
      </div>
    </div>
  )
}
