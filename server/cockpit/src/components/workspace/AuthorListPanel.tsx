/**
 * AuthorListPanel.tsx — Three-root collapsible author taxonomy tree.
 *
 * Root nodes:
 *   ▶ Inspire Family      — 12 AI personas (author_group: 'inspire_family')
 *   ▶ Contributing Authors — external contributors (author_group: 'contributing' or unset)
 *   ▶ Jubilee Ministers    — minister profiles (author_group: 'ministers')
 *
 * Each root expands to show author rows. Search filters all groups simultaneously.
 * Clicking an author row fires onSelectAuthor(id) for the editor panel.
 */

import * as React from 'react'
import { ChevronDown, ChevronRight, Plus, Search } from 'lucide-react'
import { useAuthors, useCreateAuthor } from '../../hooks/useAuthors'
import type { ContentObject, AuthorExtension } from '../../types/content-objects'

interface AuthorListPanelProps {
  selectedAuthorId: string | null
  onSelectAuthor: (id: string) => void
  isAdmin: boolean
}

// The three fixed root nodes
const ROOT_NODES = [
  { key: 'inspire_family', label: 'Inspire Family' },
  { key: 'contributing',   label: 'Contributing Authors' },
  { key: 'ministers',      label: 'Jubilee Ministers' },
] as const

type GroupKey = (typeof ROOT_NODES)[number]['key']

// ── Helpers ──────────────────────────────────────────────────────────────────

const AVATAR_HUES = [0, 30, 60, 120, 160, 200, 240, 280, 320]

function avatarHue(id: string): number {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0
  return AVATAR_HUES[Math.abs(hash) % AVATAR_HUES.length]
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

function authorDisplayName(item: ContentObject): string {
  const ext = item.extension_data as AuthorExtension & { display_name?: string }
  return ext?.display_name || item.title || 'Unnamed Author'
}

function authorRole(item: ContentObject): string {
  const ext = item.extension_data as Record<string, unknown>
  return (ext?.role as string) ?? ''
}

function isActive(item: ContentObject): boolean {
  const ext = item.extension_data as AuthorExtension
  return ext?.is_active !== false
}

function getAuthorGroup(item: ContentObject): GroupKey {
  const ext = item.extension_data as Record<string, unknown>
  const g = ext?.author_group as string | undefined
  if (g === 'inspire_family') return 'inspire_family'
  if (g === 'ministers')      return 'ministers'
  return 'contributing'
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AuthorListPanel({ selectedAuthorId, onSelectAuthor, isAdmin }: AuthorListPanelProps) {
  const { data, isLoading } = useAuthors()
  const authors: ContentObject[] = data?.authors ?? []
  const createAuthor = useCreateAuthor()
  const [search, setSearch] = React.useState('')
  // Inspire Family open by default
  const [expanded, setExpanded] = React.useState<Set<GroupKey>>(new Set(['inspire_family']))

  function toggle(key: GroupKey) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const q = search.toLowerCase()
  const filtered = q
    ? authors.filter(a => authorDisplayName(a).toLowerCase().includes(q))
    : authors

  // Group filtered authors into buckets
  const groups: Record<GroupKey, ContentObject[]> = {
    inspire_family: [],
    contributing:   [],
    ministers:      [],
  }
  for (const a of filtered) {
    groups[getAuthorGroup(a)].push(a)
  }

  // Sort each group: inspire_family by name, others alphabetically
  for (const key of Object.keys(groups) as GroupKey[]) {
    groups[key].sort((a, b) => authorDisplayName(a).localeCompare(authorDisplayName(b)))
  }

  async function handleNewAuthor() {
    const result = await createAuthor.mutateAsync({
      title: 'New Author',
      extension_data: {
        display_name:  'New Author',
        author_group:  'contributing',
        is_active:     true,
        model:         'claude-haiku-4-5-20251001',
      },
    })
    onSelectAuthor(result.id)
  }

  return (
    <div className="flex flex-col h-full overflow-hidden border-r bg-background">
      {/* Header */}
      <div className="px-3 pt-3 pb-2 shrink-0 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Authors
          </span>
          {isAdmin && (
            <button
              onClick={handleNewAuthor}
              disabled={createAuthor.isPending}
              title="New Author"
              className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 disabled:opacity-50 transition-colors"
            >
              <Plus size={13} />
              New
            </button>
          )}
        </div>

        {/* Search */}
        <div className="relative">
          <Search
            size={12}
            className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
          />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search authors…"
            className="w-full h-7 pl-6 pr-2 text-xs border rounded bg-background focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="px-3 py-4 text-xs text-muted-foreground text-center">Loading…</div>
        ) : (
          ROOT_NODES.map(node => {
            const nodeAuthors = groups[node.key]
            const isExpanded = expanded.has(node.key)

            return (
              <div key={node.key}>
                {/* Root node toggle row */}
                <button
                  className="flex items-center gap-1.5 w-full px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted/50 transition-colors border-b border-transparent hover:border-border/30"
                  onClick={() => toggle(node.key)}
                >
                  {isExpanded
                    ? <ChevronDown size={12} className="shrink-0 text-muted-foreground" />
                    : <ChevronRight size={12} className="shrink-0 text-muted-foreground" />}
                  <span className="flex-1 text-left">{node.label}</span>
                  {nodeAuthors.length > 0 && (
                    <span className="text-muted-foreground font-normal tabular-nums text-[10px]">
                      {nodeAuthors.length}
                    </span>
                  )}
                </button>

                {/* Author rows */}
                {isExpanded && (
                  nodeAuthors.length === 0 ? (
                    <p className="pl-8 pr-3 py-2 text-[11px] text-muted-foreground italic">
                      {q
                        ? 'No results.'
                        : node.key === 'inspire_family'
                          ? 'Inspire Family authors are loading…'
                          : 'No authors in this group yet.'}
                    </p>
                  ) : (
                    nodeAuthors.map(author => {
                      const name     = authorDisplayName(author)
                      const role     = authorRole(author)
                      const hue      = avatarHue(author.id)
                      const active   = isActive(author)
                      const selected = author.id === selectedAuthorId

                      return (
                        <button
                          key={author.id}
                          onClick={() => onSelectAuthor(author.id)}
                          className={[
                            'w-full flex items-center gap-2.5 pl-7 pr-3 py-2 text-left transition-colors',
                            selected
                              ? 'bg-primary/10 text-foreground'
                              : 'hover:bg-muted/60 text-foreground',
                          ].join(' ')}
                        >
                          {/* Avatar */}
                          <div
                            className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-semibold text-white"
                            style={{ backgroundColor: `hsl(${hue}, 55%, 45%)` }}
                          >
                            {initials(name)}
                          </div>

                          {/* Name + role */}
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-medium truncate leading-tight">{name}</div>
                            {role && (
                              <div className="text-[10px] text-muted-foreground truncate">{role}</div>
                            )}
                          </div>

                          {/* Active dot */}
                          <div
                            className="shrink-0 w-1.5 h-1.5 rounded-full"
                            style={{ backgroundColor: active ? 'hsl(142, 70%, 45%)' : 'hsl(0, 0%, 70%)' }}
                            title={active ? 'Active' : 'Inactive'}
                          />
                        </button>
                      )
                    })
                  )
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
