/**
 * WebsitePreviewPanel.tsx — Full-width flex container: center iframe + right controls sidebar (Part 4 S12)
 */

import * as React from 'react'
import { RefreshCw, ExternalLink } from 'lucide-react'
import { useSite } from '../../hooks/useSites'
import { useTaxonomyAssignments } from '../../hooks/useWebsites'

interface WebsitePreviewPanelProps {
  siteId: string
}

type Env = 'staging' | 'production'
type Viewport = 'desktop' | 'tablet' | 'mobile'

const VIEWPORT_WIDTHS: Record<Viewport, string> = {
  desktop: '100%',
  tablet: '768px',
  mobile: '375px',
}

export function WebsitePreviewPanel({ siteId }: WebsitePreviewPanelProps) {
  const { data: site } = useSite(siteId)
  const { data: assignments = [] } = useTaxonomyAssignments(siteId)

  const ext = (site?.extension_data ?? {}) as Record<string, unknown>
  const domain = ext.domain as string | undefined

  const [env, setEnv] = React.useState<Env>('staging')
  const [viewport, setViewport] = React.useState<Viewport>('desktop')
  const [refreshKey, setRefreshKey] = React.useState(0)
  const [taxonomySlug, setTaxonomySlug] = React.useState<string>('')

  // Build iframe src
  const iframeSrc = React.useMemo(() => {
    if (!domain) return ''
    const base = taxonomySlug
      ? `https://${domain}/taxonomy/${taxonomySlug}`
      : `https://${domain}`
    return `${base}?api=${env}`
  }, [domain, env, taxonomySlug])

  function openInTab() {
    if (iframeSrc) window.open(iframeSrc, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Center — iframe area */}
      <div className="flex-1 overflow-auto flex items-start justify-center bg-muted/20 p-4">
        {domain ? (
          <iframe
            key={refreshKey}
            src={iframeSrc}
            title="Site preview"
            className="border rounded shadow-sm bg-background transition-all"
            style={{ width: VIEWPORT_WIDTHS[viewport], height: '100%', minHeight: '600px' }}
            sandbox="allow-scripts allow-same-origin"
          />
        ) : (
          <div className="flex items-center justify-center h-64 text-sm text-muted-foreground">
            No domain configured for this site
          </div>
        )}
      </div>

      {/* Right controls sidebar — 280px */}
      <div className="w-[280px] border-l flex flex-col shrink-0 overflow-y-auto">
        {/* Environment */}
        <div className="px-3 py-3 border-b">
          <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Environment</p>
          <div className="flex gap-2">
            {(['staging', 'production'] as const).map(e => (
              <button
                key={e}
                onClick={() => setEnv(e)}
                className={[
                  'flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors',
                  env === e
                    ? e === 'staging' ? 'bg-amber-100 text-amber-800 border border-amber-300' : 'bg-green-100 text-green-800 border border-green-300'
                    : 'bg-muted/50 text-muted-foreground hover:text-foreground border border-transparent',
                ].join(' ')}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${e === 'staging' ? 'bg-amber-400' : 'bg-green-500'}`} />
                {e.charAt(0).toUpperCase() + e.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Viewport */}
        <div className="px-3 py-3 border-b">
          <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Viewport</p>
          <div className="flex gap-1">
            {(['desktop', 'tablet', 'mobile'] as const).map(v => (
              <button
                key={v}
                onClick={() => setViewport(v)}
                className={[
                  'flex-1 text-xs px-2 py-1 rounded capitalize transition-colors',
                  viewport === v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground bg-muted/50',
                ].join(' ')}
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="px-3 py-3 border-b flex gap-2">
          <button
            onClick={() => setRefreshKey(k => k + 1)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded border hover:bg-muted/50 transition-colors text-foreground"
            title="Refresh preview"
          >
            <RefreshCw size={12} />
            Refresh
          </button>
          <button
            onClick={openInTab}
            disabled={!domain}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded border hover:bg-muted/50 transition-colors text-foreground disabled:opacity-40"
            title="Open in new tab"
          >
            <ExternalLink size={12} />
            Open
          </button>
        </div>

        {/* Taxonomy page tester */}
        <div className="px-3 py-3">
          <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Taxonomy Tester</p>
          <select
            value={taxonomySlug}
            onChange={e => setTaxonomySlug(e.target.value)}
            className="w-full text-xs border rounded px-2 h-7 bg-background text-foreground"
          >
            <option value="">— Homepage —</option>
            {assignments.map(a => (
              <option key={a.id} value={a.slug}>
                {a.custom_label ?? a.name}
              </option>
            ))}
          </select>
          {taxonomySlug && (
            <p className="mt-1 text-xs text-muted-foreground truncate">/taxonomy/{taxonomySlug}</p>
          )}
        </div>
      </div>
    </div>
  )
}
