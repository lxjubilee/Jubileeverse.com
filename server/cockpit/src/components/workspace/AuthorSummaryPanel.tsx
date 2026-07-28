/**
 * AuthorSummaryPanel.tsx — Part 3 Section 4 center panel
 *
 * Two tabs:
 *   1. Content Summary — stats cards + sortable content grid
 *   2. Bios — bio variant cards + add new card
 */

import * as React from 'react'
import { FileText, ChevronUp, ChevronDown, Star } from 'lucide-react'
import { useAuthorBios } from '../../hooks/useAuthors'
import { useContentList } from '../../hooks/useContent'
import type { ContentObject, AuthorBio } from '../../types/content-objects'

interface AuthorSummaryPanelProps {
  authorId: string | null
  isAdmin:  boolean
}

type TabId = 'content' | 'bios'
type SortDir = 'asc' | 'desc'

const STATUS_LABELS: Record<string, string> = {
  draft:     'Draft',
  review:    'Review',
  approved:  'Approved',
  published: 'Published',
  archived:  'Archived',
}

const STATUS_COLORS: Record<string, string> = {
  draft:     'text-muted-foreground',
  review:    'text-amber-600',
  approved:  'text-blue-600',
  published: 'text-green-600',
  archived:  'text-muted-foreground line-through',
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' })
}

function countWords(text: string): number {
  return text.trim() === '' ? 0 : text.trim().split(/\s+/).length
}

// ── Content Summary Tab ───────────────────────────────────────────────────────

type ContentSortField = 'title' | 'object_type' | 'status' | 'updated_at'

interface ContentTabProps {
  authorId: string
}

function ContentTab({ authorId }: ContentTabProps) {
  const [statusFilter, setStatusFilter] = React.useState('')
  const [sortField, setSortField]       = React.useState<ContentSortField>('updated_at')
  const [sortDir, setSortDir]           = React.useState<SortDir>('desc')

  const { data, isLoading } = useContentList({
    author_id: authorId,
    status:    statusFilter || undefined,
    limit:     200,
  })

  const items: ContentObject[] = data?.items ?? []

  // Client-side sort
  const sorted = React.useMemo(() => {
    return [...items].sort((a, b) => {
      let av = '', bv = ''
      if (sortField === 'title')       { av = a.title ?? ''; bv = b.title ?? '' }
      if (sortField === 'object_type') { av = a.object_type; bv = b.object_type }
      if (sortField === 'status')      { av = a.status; bv = b.status }
      if (sortField === 'updated_at')  { av = a.updated_at; bv = b.updated_at }
      const cmp = av.localeCompare(bv)
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [items, sortField, sortDir])

  // Stats
  const typeCounts = React.useMemo(() => {
    const counts: Record<string, number> = {}
    for (const item of items) {
      counts[item.object_type] = (counts[item.object_type] ?? 0) + 1
    }
    return counts
  }, [items])

  function toggleSort(field: ContentSortField) {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir('asc')
    }
  }

  function SortIcon({ field }: { field: ContentSortField }) {
    if (sortField !== field) return null
    return sortDir === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />
  }

  return (
    <div className="flex flex-col gap-3 p-3 h-full overflow-y-auto">
      {/* Stats row */}
      <div className="flex flex-wrap gap-2">
        <div className="flex flex-col items-center px-3 py-2 rounded border bg-muted/30 min-w-[60px]">
          <span className="text-lg font-bold leading-tight">{items.length}</span>
          <span className="text-[10px] text-muted-foreground">Total</span>
        </div>
        {Object.entries(typeCounts).sort(([, a], [, b]) => b - a).map(([type, count]) => (
          <div key={type} className="flex flex-col items-center px-3 py-2 rounded border bg-muted/30 min-w-[60px]">
            <span className="text-lg font-bold leading-tight">{count}</span>
            <span className="text-[10px] text-muted-foreground capitalize">{type}</span>
          </div>
        ))}
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-2">
        <label className="text-xs text-muted-foreground shrink-0">Status:</label>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="h-6 text-xs border rounded px-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="">All</option>
          {Object.entries(STATUS_LABELS).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        <span className="text-xs text-muted-foreground ml-auto">{sorted.length} item{sorted.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="text-xs text-muted-foreground text-center py-4">Loading…</div>
      ) : sorted.length === 0 ? (
        <div className="text-xs text-muted-foreground text-center py-4">
          {items.length === 0 ? 'No content attributed to this author yet.' : 'No results match the filter.'}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-muted-foreground">
                {(
                  [
                    ['title',       'Title'],
                    ['object_type', 'Type'],
                    ['status',      'Status'],
                    ['updated_at',  'Updated'],
                  ] as [ContentSortField, string][]
                ).map(([field, label]) => (
                  <th
                    key={field}
                    className="text-left py-1.5 pr-3 font-medium cursor-pointer hover:text-foreground select-none whitespace-nowrap"
                    onClick={() => toggleSort(field)}
                  >
                    <span className="inline-flex items-center gap-0.5">
                      {label}
                      <SortIcon field={field} />
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map(item => (
                <tr key={item.id} className="border-b border-muted/40 hover:bg-muted/30 transition-colors">
                  <td className="py-1.5 pr-3 max-w-[180px]">
                    <span className="truncate block font-medium" title={item.title ?? undefined}>
                      {item.title || <span className="italic text-muted-foreground">Untitled</span>}
                    </span>
                  </td>
                  <td className="py-1.5 pr-3 capitalize text-muted-foreground">{item.object_type}</td>
                  <td className={`py-1.5 pr-3 ${STATUS_COLORS[item.status] ?? ''}`}>
                    {STATUS_LABELS[item.status] ?? item.status}
                  </td>
                  <td className="py-1.5 text-muted-foreground whitespace-nowrap">{formatDate(item.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Bios Tab ──────────────────────────────────────────────────────────────────

function BiosTab({ authorId }: { authorId: string }) {
  const { data, isLoading } = useAuthorBios(authorId)
  const bios: AuthorBio[] = data?.bios ?? []

  if (isLoading) {
    return <div className="text-xs text-muted-foreground text-center py-6">Loading…</div>
  }

  if (bios.length === 0) {
    return <div className="text-xs text-muted-foreground text-center py-6">No bio variants yet.</div>
  }

  return (
    <div className="p-3 h-full overflow-y-auto">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {bios.map(bio => {
          const preview = bio.bio_text.length > 120
            ? bio.bio_text.slice(0, 117) + '…'
            : bio.bio_text
          const words = countWords(bio.bio_text)
          return (
            <div
              key={bio.id}
              className="border rounded p-3 bg-background flex flex-col gap-1.5"
            >
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-semibold uppercase tracking-wide bg-muted px-1.5 py-0.5 rounded text-[10px] truncate">
                  {bio.channel}
                </span>
                {bio.is_primary && (
                  <span title="Primary bio"><Star size={10} className="text-amber-500 fill-amber-500 shrink-0" /></span>
                )}
                <span className="text-[10px] text-muted-foreground ml-auto shrink-0">{bio.language}</span>
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                {preview || <em>Empty</em>}
              </p>
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-auto pt-1">
                <span>{words} word{words !== 1 ? 's' : ''}</span>
                <span>·</span>
                <span>{formatDate(bio.updated_at)}</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export function AuthorSummaryPanel({ authorId, isAdmin: _isAdmin }: AuthorSummaryPanelProps) {
  const [activeTab, setActiveTab] = React.useState<TabId>('content')

  if (!authorId) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
        <FileText size={32} className="opacity-30" />
        <p className="text-sm">Select an author to view their content</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Tab bar */}
      <div className="flex items-center border-b shrink-0 px-3 gap-1 pt-2">
        {(['content', 'bios'] as TabId[]).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={[
              'text-xs px-3 py-1.5 border-b-2 -mb-px transition-colors capitalize',
              activeTab === tab
                ? 'border-primary text-foreground font-medium'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            ].join(' ')}
          >
            {tab === 'content' ? 'Content Summary' : 'Bios'}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'content'
          ? <ContentTab authorId={authorId} />
          : <BiosTab authorId={authorId} />
        }
      </div>
    </div>
  )
}
