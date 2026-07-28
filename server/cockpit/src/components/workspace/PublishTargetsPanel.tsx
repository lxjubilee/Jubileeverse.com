/**
 * PublishTargetsPanel.tsx — Phase 8 cross-site publishing panel
 *
 * Shown as the "Publish" tab in InlineEditorPanel.
 * Allows editors to manage which sites a content object is published to,
 * set per-site overrides (title, summary), and trigger site publishing.
 */

import * as React from 'react'
import { Loader2, Globe, CheckCircle, Clock, XCircle, RefreshCw } from 'lucide-react'
import { Button }  from '../ui/Button'
import { Select }  from '../ui/Select'
import { Input }   from '../ui/Input'
import { Badge }   from '../ui/Badge'
import { useSites, useUpdatePublishTargets, useSitePublish } from '../../hooks/useSites'
import type { ContentObject, SitePublishTarget, SiteExtension } from '../../types/content-objects'

interface PublishTargetsPanelProps {
  item: ContentObject
}

const STATUS_ICONS = {
  published:   <CheckCircle size={11} className="text-green-600" />,
  pending:     <Clock       size={11} className="text-yellow-600" />,
  unpublished: <XCircle     size={11} className="text-muted-foreground" />,
}

const STATUS_LABELS: Record<string, string> = {
  published:   'Published',
  pending:     'Pending',
  unpublished: 'Excluded',
}

export function PublishTargetsPanel({ item }: PublishTargetsPanelProps) {
  const { data: sitesData } = useSites()
  const allSites = sitesData?.sites ?? []

  const targets: SitePublishTarget[] = (item.publish_targets ?? []) as SitePublishTarget[]

  const updateTargets = useUpdatePublishTargets()
  const sitePublish   = useSitePublish()

  const [addSiteId, setAddSiteId] = React.useState<string>('')

  // Sites not yet in targets
  const addableOptions = allSites
    .filter(s => !targets.find(t => t.site_id === s.id))
    .map(s => {
      const ext = (s.extension_data ?? {}) as SiteExtension
      return { value: s.id, label: ext.domain || s.title || s.id }
    })

  function getSiteName(siteId: string) {
    const site = allSites.find(s => s.id === siteId)
    if (!site) return siteId
    const ext = (site.extension_data ?? {}) as SiteExtension
    return ext.domain || site.title || siteId
  }

  function addTarget() {
    if (!addSiteId) return
    const newTarget: SitePublishTarget = {
      site_id: addSiteId,
      status: 'pending',
      overrides: {},
    }
    updateTargets.mutate({ id: item.id, targets: [...targets, newTarget] })
    setAddSiteId('')
  }

  function removeTarget(siteId: string) {
    updateTargets.mutate({ id: item.id, targets: targets.filter(t => t.site_id !== siteId) })
  }

  function updateOverride(siteId: string, field: 'title' | 'summary', value: string) {
    updateTargets.mutate({
      id: item.id,
      targets: targets.map(t =>
        t.site_id === siteId
          ? { ...t, overrides: { ...t.overrides, [field]: value || null } }
          : t
      ),
    })
  }

  const canPush = item.status === 'published' && targets.length > 0

  return (
    <div className="flex flex-col gap-4 p-3">

      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Publish Targets
        </p>
        {canPush && (
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-xs px-2 gap-1"
            onClick={() => sitePublish.mutate(item.id)}
            disabled={sitePublish.isPending}
          >
            {sitePublish.isPending
              ? <Loader2 size={10} className="animate-spin" />
              : <RefreshCw size={10} />
            }
            Push to All
          </Button>
        )}
      </div>

      {item.status !== 'published' && targets.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Content must be in <strong>published</strong> status to push to sites.
        </p>
      )}

      {/* Target list */}
      {targets.length === 0 ? (
        <p className="text-xs text-muted-foreground">No publish targets set. Add a site below.</p>
      ) : (
        <div className="space-y-2">
          {targets.map((target) => {
            const siteName = getSiteName(target.site_id)
            return (
              <div key={target.site_id} className="border rounded p-2 space-y-2 bg-muted/20">
                {/* Target header */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <Globe size={11} className="text-muted-foreground shrink-0" />
                    <span className="text-xs font-medium truncate">{siteName}</span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      {STATUS_ICONS[target.status as keyof typeof STATUS_ICONS] ?? null}
                      {STATUS_LABELS[target.status] ?? target.status}
                    </span>
                    <button
                      onClick={() => removeTarget(target.site_id)}
                      className="text-xs text-muted-foreground hover:text-destructive px-1"
                    >
                      ✕
                    </button>
                  </div>
                </div>

                {/* Published URL */}
                {target.published_url && (
                  <a
                    href={target.published_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] text-blue-600 hover:underline truncate block"
                  >
                    {target.published_url}
                  </a>
                )}

                {/* Overrides */}
                <div className="space-y-1">
                  <Input
                    className="h-6 text-xs"
                    value={target.overrides?.title ?? ''}
                    onChange={e => {
                      const newTargets = targets.map(t =>
                        t.site_id === target.site_id
                          ? { ...t, overrides: { ...t.overrides, title: e.target.value || null } }
                          : t
                      )
                      updateTargets.mutate({ id: item.id, targets: newTargets })
                    }}
                    onBlur={e => updateOverride(target.site_id, 'title', e.target.value)}
                    placeholder="Title override (optional)"
                  />
                  <Input
                    className="h-6 text-xs"
                    value={target.overrides?.summary ?? ''}
                    onChange={e => {
                      const newTargets = targets.map(t =>
                        t.site_id === target.site_id
                          ? { ...t, overrides: { ...t.overrides, summary: e.target.value || null } }
                          : t
                      )
                      updateTargets.mutate({ id: item.id, targets: newTargets })
                    }}
                    onBlur={e => updateOverride(target.site_id, 'summary', e.target.value)}
                    placeholder="Summary override (optional)"
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Add target row */}
      {addableOptions.length > 0 && (
        <div className="flex gap-2 items-center">
          <Select
            className="flex-1 h-7 text-xs"
            value={addSiteId}
            onValueChange={setAddSiteId}
            options={[{ value: '', label: 'Add a site…' }, ...addableOptions]}
          />
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs px-2 shrink-0"
            onClick={addTarget}
            disabled={!addSiteId || updateTargets.isPending}
          >
            Add
          </Button>
        </div>
      )}

      {updateTargets.isError && (
        <p className="text-xs text-destructive">
          {updateTargets.error instanceof Error ? updateTargets.error.message : 'Failed to update'}
        </p>
      )}
      {sitePublish.isError && (
        <p className="text-xs text-destructive">
          {sitePublish.error instanceof Error ? sitePublish.error.message : 'Failed to push'}
        </p>
      )}
      {sitePublish.isSuccess && (
        <p className="text-xs text-green-600 text-center">Pushed successfully</p>
      )}

      {/* Publishing report hint */}
      <div className="border-t pt-2">
        <p className="text-xs text-muted-foreground">
          <Badge variant="secondary" className="text-xs px-1.5 py-0 mr-1">{targets.length}</Badge>
          target{targets.length !== 1 ? 's' : ''} configured
          {targets.filter(t => t.status === 'published').length > 0 && (
            <span className="ml-1 text-green-700">
              · {targets.filter(t => t.status === 'published').length} published
            </span>
          )}
          {targets.filter(t => t.status === 'pending').length > 0 && (
            <span className="ml-1 text-yellow-700">
              · {targets.filter(t => t.status === 'pending').length} pending
            </span>
          )}
        </p>
      </div>
    </div>
  )
}
