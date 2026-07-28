/**
 * WebsiteNavPanel.tsx — Left 280px panel: site tree + section nav (Part 4 S9–11)
 */

import * as React from 'react'
import { Globe, ChevronDown, ChevronRight, Plus } from 'lucide-react'
import { useSites } from '../../hooks/useSites'

type WebsiteSection = 'overview' | 'taxonomy' | 'pages' | 'packages' | 'preview' | null

interface WebsiteNavPanelProps {
  selectedSiteId: string | null
  onSelectSite: (id: string) => void
  selectedSection: WebsiteSection
  onSelectSection: (section: WebsiteSection) => void
  isAdmin: boolean
}

const SECTION_NODES: { key: WebsiteSection; label: string }[] = [
  { key: 'taxonomy', label: 'Taxonomy' },
  { key: 'pages',    label: 'Web Pages' },
  { key: 'packages', label: 'Packages' },
  { key: 'preview',  label: 'Preview' },
]

function statusDotClass(status: string | undefined) {
  switch (status) {
    case 'published': return 'bg-green-500'
    case 'draft':     return 'bg-amber-400'
    case 'archived':  return 'bg-gray-400'
    default:          return 'bg-gray-300'
  }
}

export function WebsiteNavPanel({
  selectedSiteId,
  onSelectSite,
  selectedSection,
  onSelectSection,
  isAdmin,
}: WebsiteNavPanelProps) {
  const { data: sitesData, isLoading } = useSites()
  const sites = sitesData?.sites ?? []
  const [search, setSearch] = React.useState('')
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set())

  // Auto-expand selected site
  React.useEffect(() => {
    if (selectedSiteId) {
      setExpanded(prev => new Set([...prev, selectedSiteId]))
    }
  }, [selectedSiteId])

  function toggleExpand(id: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const filtered = sites.filter(s => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    const ext = (s.extension_data ?? {}) as Record<string, unknown>
    return (
      (s.title ?? '').toLowerCase().includes(q) ||
      String(ext.domain ?? '').toLowerCase().includes(q)
    )
  })

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 h-10 border-b shrink-0">
        <Globe size={14} className="text-muted-foreground" />
        <span className="text-xs font-medium text-foreground flex-1">Websites</span>
        {isAdmin && (
          <button
            className="text-muted-foreground hover:text-foreground transition-colors"
            title="Register new website"
            onClick={() => {/* Trigger site creation via ContentWorkspace pattern */}}
          >
            <Plus size={13} />
          </button>
        )}
      </div>

      {/* Site tree */}
      <div className="flex-1 overflow-y-auto py-1">
        {isLoading && (
          <div className="space-y-1 px-3 py-2">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-6 bg-muted/40 animate-pulse rounded" />
            ))}
          </div>
        )}

        {!isLoading && !filtered.length && (
          <p className="px-3 py-4 text-xs text-muted-foreground">
            {search ? 'No sites match your search' : 'No websites registered'}
          </p>
        )}

        {filtered.map(site => {
          const ext = (site.extension_data ?? {}) as Record<string, unknown>
          const domain = ext.domain as string | undefined
          const isExpanded = expanded.has(site.id)
          const isSelected = selectedSiteId === site.id

          return (
            <div key={site.id}>
              {/* Site root row */}
              <button
                className={[
                  'flex items-center gap-1.5 w-full px-3 py-1.5 text-xs transition-colors text-left',
                  isSelected && selectedSection === 'overview'
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-foreground hover:bg-muted/50',
                ].join(' ')}
                onClick={() => {
                  onSelectSite(site.id)
                  toggleExpand(site.id)
                }}
              >
                {isExpanded
                  ? <ChevronDown size={11} className="shrink-0 text-muted-foreground" />
                  : <ChevronRight size={11} className="shrink-0 text-muted-foreground" />
                }
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusDotClass(site.status)}`} />
                <span className="flex-1 truncate">{site.title}</span>
                {domain && (
                  <span className="text-muted-foreground truncate max-w-[80px]" style={{ fontSize: '10px' }}>
                    {domain}
                  </span>
                )}
              </button>

              {/* Section children */}
              {isExpanded && SECTION_NODES.map(({ key, label }) => (
                <button
                  key={key}
                  className={[
                    'flex items-center w-full pl-8 pr-3 py-1 text-xs transition-colors',
                    isSelected && selectedSection === key
                      ? 'bg-primary/10 text-primary font-medium'
                      : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                  ].join(' ')}
                  onClick={() => {
                    onSelectSite(site.id)
                    onSelectSection(key)
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          )
        })}
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-t shrink-0">
        <input
          type="text"
          placeholder="Search websites…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full text-xs border rounded px-2 h-7 bg-background text-foreground placeholder:text-muted-foreground"
        />
      </div>
    </div>
  )
}
