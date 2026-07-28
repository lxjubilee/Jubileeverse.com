/**
 * SiteGrid.tsx — Site content grid (Phase 8)
 *
 * Columns: Domain | Title | Tone | Status | Updated
 */

import { useSites, useCreateSite } from '../../../hooks/useSites'
import { useCockpitStore } from '../../../hooks/useCockpitStore'
import { Badge }  from '../../ui/Badge'
import { Button } from '../../ui/Button'
import type { ContentObject, SiteExtension } from '../../../types/content-objects'

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'outline'> = {
  draft:      'secondary',
  review:     'warning',
  approved:   'default',
  published:  'success',
  archived:   'destructive',
}

interface SiteGridProps {
  onRowSelect: (id: string) => void
}

export function SiteGrid({ onRowSelect }: SiteGridProps) {
  const setSelectedObjectId = useCockpitStore(s => s.setSelectedObjectId)
  const { data, isLoading } = useSites()
  const createSite          = useCreateSite()

  const items: ContentObject[] = data?.sites ?? []

  async function handleNewSite() {
    const result = await createSite.mutateAsync({
      title: 'New Site',
      extension_data: {
        domain: '',
        site_tone: 'authoritative',
        publishing_rules: {
          auto_publish: false,
          require_site_owner_approval: true,
          content_type_whitelist: ['article', 'devotional'],
          blackout_dates: [],
        },
        taxonomy_mapping: { root_ids: [] },
        analytics_config: {},
      },
    })
    setSelectedObjectId(result.id)
    onRowSelect(result.id)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header with New button */}
      <div className="flex items-center justify-between px-3 py-2 border-b shrink-0">
        <span className="text-xs text-muted-foreground">{items.length} site{items.length !== 1 ? 's' : ''}</span>
        <Button
          size="sm"
          variant="outline"
          className="h-6 text-xs px-2"
          onClick={handleNewSite}
          disabled={createSite.isPending}
        >
          {createSite.isPending ? 'Creating…' : '+ New Site'}
        </Button>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <p className="text-xs text-muted-foreground p-4">Loading…</p>
        ) : items.length === 0 ? (
          <p className="text-xs text-muted-foreground p-4">No sites found. Create one to get started.</p>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-background border-b">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Domain</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground hidden sm:table-cell">Title</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground hidden md:table-cell">Tone</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Status</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground hidden md:table-cell">Updated</th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => {
                const ext = (item.extension_data ?? {}) as SiteExtension

                return (
                  <tr
                    key={item.id}
                    className="border-b hover:bg-muted/30 cursor-pointer"
                    onClick={() => onRowSelect(item.id)}
                  >
                    <td className="px-3 py-2 font-medium max-w-[180px]">
                      <span className="truncate block">{ext.domain || '—'}</span>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground hidden sm:table-cell max-w-[160px]">
                      <span className="truncate block">{item.title}</span>
                    </td>
                    <td className="px-3 py-2 hidden md:table-cell">
                      {ext.site_tone ? (
                        <Badge variant="secondary" className="text-xs px-1.5 py-0 capitalize">
                          {ext.site_tone}
                        </Badge>
                      ) : '—'}
                    </td>
                    <td className="px-3 py-2">
                      <Badge
                        variant={STATUS_VARIANT[item.status] ?? 'secondary'}
                        className="text-xs capitalize"
                      >
                        {item.status}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground hidden md:table-cell whitespace-nowrap">
                      {item.updated_at ? new Date(item.updated_at).toLocaleDateString() : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
