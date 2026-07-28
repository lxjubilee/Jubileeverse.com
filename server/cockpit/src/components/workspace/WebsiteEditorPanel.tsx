/**
 * WebsiteEditorPanel.tsx — Right panel for overview/config (Part 4 S9–11)
 *
 * Wraps existing SiteForm for the 'overview' section.
 * Taxonomy/pages/packages sections render their own inline right panels.
 */

import { X } from 'lucide-react'
import { useSite } from '../../hooks/useSites'
import { WebsiteConfigEditor } from './WebsiteConfigEditor'

interface WebsiteEditorPanelProps {
  siteId: string
  onClose: () => void
}

export function WebsiteEditorPanel({ siteId, onClose }: WebsiteEditorPanelProps) {
  const { data: site, isLoading } = useSite(siteId)

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 h-10 border-b shrink-0">
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground transition-colors"
          title="Close"
        >
          <X size={14} />
        </button>
        <span className="text-xs font-medium">Configuration</span>
      </div>

      {isLoading && (
        <div className="flex-1 p-4 space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-5 bg-muted/40 animate-pulse rounded" />
          ))}
        </div>
      )}

      {site && (
        <div className="flex-1 overflow-y-auto">
          <WebsiteConfigEditor site={site} />
        </div>
      )}
    </div>
  )
}
