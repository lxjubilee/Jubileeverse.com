/**
 * AuthorGrid.tsx — Author content grid (Phase 7)
 *
 * Columns: Display Name | Title | Tone | Status | Updated
 */

import { useAuthors, useCreateAuthor } from '../../../hooks/useAuthors'
import { useCockpitStore } from '../../../hooks/useCockpitStore'
import { Badge }    from '../../ui/Badge'
import { Button }   from '../../ui/Button'
import type { ContentObject, AuthorExtension } from '../../../types/content-objects'

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'outline'> = {
  draft:      'secondary',
  review:     'warning',
  approved:   'default',
  published:  'success',
  archived:   'destructive',
}

interface AuthorGridProps {
  onRowSelect: (id: string) => void
}

export function AuthorGrid({ onRowSelect }: AuthorGridProps) {
  const setSelectedObjectId = useCockpitStore(s => s.setSelectedObjectId)
  const { data, isLoading } = useAuthors()
  const createAuthor        = useCreateAuthor()

  const items: ContentObject[] = (data?.authors ?? [])

  async function handleNewAuthor() {
    const result = await createAuthor.mutateAsync({
      title: 'New Author',
      extension_data: {
        display_name: 'New Author',
        is_active: true,
        model: 'claude-haiku-4-5-20251001',
      },
    })
    setSelectedObjectId(result.id)
    onRowSelect(result.id)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header with New button */}
      <div className="flex items-center justify-between px-3 py-2 border-b shrink-0">
        <span className="text-xs text-muted-foreground">{items.length} author{items.length !== 1 ? 's' : ''}</span>
        <Button
          size="sm"
          variant="outline"
          className="h-6 text-xs px-2"
          onClick={handleNewAuthor}
          disabled={createAuthor.isPending}
        >
          {createAuthor.isPending ? 'Creating…' : '+ New Author'}
        </Button>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <p className="text-xs text-muted-foreground p-4">Loading…</p>
        ) : items.length === 0 ? (
          <p className="text-xs text-muted-foreground p-4">No authors found. Create one to get started.</p>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-background border-b">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Display Name</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground hidden sm:table-cell">Title</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground hidden md:table-cell">Tone</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Status</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground hidden md:table-cell">Updated</th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => {
                const ext = (item.extension_data ?? {}) as AuthorExtension
                const vp  = ext.voice_profile ?? {}
                const displayName = ext.display_name || item.title

                return (
                  <tr
                    key={item.id}
                    className="border-b hover:bg-muted/30 cursor-pointer"
                    onClick={() => onRowSelect(item.id)}
                  >
                    <td className="px-3 py-2 font-medium max-w-[180px]">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate">{displayName}</span>
                        {ext.is_active === false && (
                          <Badge variant="outline" className="text-xs px-1 py-0 shrink-0">Inactive</Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground hidden sm:table-cell max-w-[160px]">
                      <span className="truncate block">{item.title}</span>
                    </td>
                    <td className="px-3 py-2 hidden md:table-cell">
                      {vp.tone ? (
                        <Badge variant="secondary" className="text-xs px-1.5 py-0 capitalize">
                          {vp.tone}
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
