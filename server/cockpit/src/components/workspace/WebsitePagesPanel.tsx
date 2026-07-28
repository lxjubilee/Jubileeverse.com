/**
 * WebsitePagesPanel.tsx — Custom web pages management (Part 4 S9–11)
 *
 * Center: pages grid with + New Page and Delete
 * Right: page content editor (slug, title, nav, status, body HTML, SEO)
 */

import * as React from 'react'
import { Plus, Trash2, X } from 'lucide-react'
import {
  useWebsitePages,
  useCreateWebsitePage,
  useUpdateWebsitePage,
  useDeleteWebsitePage,
} from '../../hooks/useWebsites'
import type { WebsitePage } from '../../types/content-objects'

interface WebsitePagesPanelProps {
  siteId: string
  canManage: boolean
}

const NAV_POSITIONS = [
  { value: 'primary_nav',   label: 'Primary Nav' },
  { value: 'secondary_nav', label: 'Secondary Nav' },
  { value: 'footer_nav',    label: 'Footer Nav' },
  { value: 'hidden',        label: 'Hidden' },
]

const STATUSES = [
  { value: 'draft',     label: 'Draft' },
  { value: 'published', label: 'Published' },
  { value: 'archived',  label: 'Archived' },
]

function StatusBadge({ status }: { status: WebsitePage['status'] }) {
  const classes =
    status === 'published' ? 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300' :
    status === 'draft'     ? 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300' :
    'bg-muted text-muted-foreground'
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium capitalize ${classes}`}>
      {status}
    </span>
  )
}

// ── Page editor right panel ───────────────────────────────────────────────────

function PageEditor({
  siteId,
  pageId,
  onClose,
}: {
  siteId: string
  pageId: string
  onClose: () => void
}) {
  const pages = useWebsitePages(siteId)
  const update = useUpdateWebsitePage()

  const page = pages.data?.find(p => p.id === pageId)

  const [title, setTitle] = React.useState(page?.page_title ?? '')
  const [slug, setSlug] = React.useState(page?.page_slug ?? '')
  const [navPos, setNavPos] = React.useState(page?.nav_position ?? 'primary_nav')
  const [status, setStatus] = React.useState<WebsitePage['status']>(page?.status ?? 'draft')
  const [bodyHtml, setBodyHtml] = React.useState(page?.body_html ?? '')
  const [metaTitle, setMetaTitle] = React.useState(String((page?.seo_metadata?.title) ?? ''))
  const [metaDesc, setMetaDesc] = React.useState(String((page?.seo_metadata?.description) ?? ''))

  // Sync state when page data loads/changes
  React.useEffect(() => {
    if (page) {
      setTitle(page.page_title)
      setSlug(page.page_slug)
      setNavPos(page.nav_position)
      setStatus(page.status)
      setBodyHtml(page.body_html ?? '')
      setMetaTitle(String(page.seo_metadata?.title ?? ''))
      setMetaDesc(String(page.seo_metadata?.description ?? ''))
    }
  }, [page?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  function save(overrides?: Partial<WebsitePage>) {
    update.mutate({
      siteId,
      pageId,
      data: {
        page_title: title,
        page_slug: slug,
        nav_position: navPos,
        status,
        body_html: bodyHtml,
        seo_metadata: { title: metaTitle, description: metaDesc },
        ...overrides,
      },
    })
  }

  if (!page) return null

  return (
    <div className="flex flex-col h-full border-l">
      <div className="flex items-center gap-2 px-3 h-10 border-b shrink-0">
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
          <X size={14} />
        </button>
        <span className="text-xs font-medium flex-1 truncate">{page.page_title || 'Untitled'}</span>
        <span className="text-xs text-muted-foreground">v{page.version}</span>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3 text-xs">
        <div>
          <label className="block text-muted-foreground mb-1">Page title</label>
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            onBlur={() => save({ page_title: title })}
            className="w-full border rounded px-2 h-7 bg-background text-xs"
          />
        </div>
        <div>
          <label className="block text-muted-foreground mb-1">Slug</label>
          <input
            type="text"
            value={slug}
            onChange={e => setSlug(e.target.value)}
            onBlur={() => save({ page_slug: slug })}
            className="w-full border rounded px-2 h-7 bg-background text-xs font-mono"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-muted-foreground mb-1">Nav position</label>
            <select
              value={navPos}
              onChange={e => { setNavPos(e.target.value); setTimeout(() => save({ nav_position: e.target.value }), 0) }}
              className="w-full border rounded px-2 h-7 bg-background text-xs"
            >
              {NAV_POSITIONS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-muted-foreground mb-1">Status</label>
            <select
              value={status}
              onChange={e => {
                const v = e.target.value as WebsitePage['status']
                setStatus(v)
                setTimeout(() => save({ status: v }), 0)
              }}
              className="w-full border rounded px-2 h-7 bg-background text-xs"
            >
              {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-muted-foreground mb-1">Body HTML</label>
          <textarea
            value={bodyHtml}
            onChange={e => setBodyHtml(e.target.value)}
            onBlur={() => save({ body_html: bodyHtml })}
            rows={10}
            className="w-full border rounded px-2 py-1.5 bg-background text-xs font-mono resize-y"
          />
        </div>

        <div>
          <p className="text-muted-foreground font-medium mb-2">SEO</p>
          <div className="space-y-2">
            <div>
              <label className="block text-muted-foreground mb-1">Meta title</label>
              <input
                type="text"
                value={metaTitle}
                onChange={e => setMetaTitle(e.target.value)}
                onBlur={() => save({ seo_metadata: { title: metaTitle, description: metaDesc } })}
                className="w-full border rounded px-2 h-7 bg-background text-xs"
              />
            </div>
            <div>
              <label className="block text-muted-foreground mb-1">Meta description</label>
              <textarea
                value={metaDesc}
                onChange={e => setMetaDesc(e.target.value)}
                onBlur={() => save({ seo_metadata: { title: metaTitle, description: metaDesc } })}
                rows={3}
                className="w-full border rounded px-2 py-1.5 bg-background text-xs resize-none"
              />
            </div>
          </div>
        </div>

        {update.isError && <p className="text-xs text-destructive">Save failed</p>}
      </div>
    </div>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function WebsitePagesPanel({ siteId, canManage }: WebsitePagesPanelProps) {
  const { data: pages = [], isLoading, error } = useWebsitePages(siteId)
  const createPage = useCreateWebsitePage()
  const deletePage = useDeleteWebsitePage()

  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = React.useState<string | null>(null)

  function handleCreate() {
    createPage.mutate(
      { siteId, data: { page_title: 'New Page', page_slug: `page-${Date.now()}`, status: 'draft' } },
      { onSuccess: (page) => setSelectedId(page.id) }
    )
  }

  function handleDelete(id: string) {
    deletePage.mutate({ siteId, pageId: id }, {
      onSuccess: () => {
        if (selectedId === id) setSelectedId(null)
        setConfirmDeleteId(null)
      },
    })
  }

  function formatDate(iso: string) {
    try {
      return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    } catch {
      return iso
    }
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Center grid */}
      <div className="flex flex-col flex-1 overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center gap-2 px-4 h-10 border-b shrink-0">
          <span className="text-xs font-medium flex-1">Custom Pages ({pages.length})</span>
          {canManage && (
            <button
              onClick={handleCreate}
              disabled={createPage.isPending}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors"
            >
              <Plus size={12} />
              New Page
            </button>
          )}
        </div>

        {isLoading && (
          <div className="flex-1 p-4 space-y-2">
            {[...Array(4)].map((_, i) => <div key={i} className="h-8 bg-muted/40 animate-pulse rounded" />)}
          </div>
        )}
        {error && (
          <div className="flex-1 flex items-center justify-center text-sm text-destructive">
            Failed to load pages
          </div>
        )}

        {!isLoading && !error && (
          <div className="flex-1 overflow-auto">
            {!pages.length ? (
              <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
                No custom pages yet
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur-sm">
                  <tr className="border-b">
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Title</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Slug</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Nav</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Status</th>
                    <th className="text-right px-3 py-2 font-medium text-muted-foreground">v</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Updated</th>
                    {canManage && <th className="px-3 py-2" />}
                  </tr>
                </thead>
                <tbody>
                  {pages.map(page => (
                    <tr
                      key={page.id}
                      className={[
                        'border-b cursor-pointer transition-colors',
                        selectedId === page.id ? 'bg-primary/5' : 'hover:bg-muted/40',
                      ].join(' ')}
                      onClick={() => setSelectedId(prev => prev === page.id ? null : page.id)}
                    >
                      <td className="px-3 py-2 font-medium max-w-[160px] truncate">{page.page_title}</td>
                      <td className="px-3 py-2 text-muted-foreground font-mono">{page.page_slug}</td>
                      <td className="px-3 py-2 text-muted-foreground capitalize">{page.nav_position.replace(/_/g, ' ')}</td>
                      <td className="px-3 py-2"><StatusBadge status={page.status} /></td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{page.version}</td>
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{formatDate(page.updated_at)}</td>
                      {canManage && (
                        <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                          {confirmDeleteId === page.id ? (
                            <div className="flex items-center gap-1">
                              <button onClick={() => handleDelete(page.id)} className="text-xs text-destructive hover:opacity-80">Confirm</button>
                              <button onClick={() => setConfirmDeleteId(null)} className="text-xs text-muted-foreground hover:text-foreground">Cancel</button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setConfirmDeleteId(page.id)}
                              className="text-muted-foreground hover:text-destructive transition-colors"
                              title="Delete page"
                            >
                              <Trash2 size={12} />
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* Right panel */}
      {selectedId && (
        <div className="w-[360px] shrink-0">
          <PageEditor siteId={siteId} pageId={selectedId} onClose={() => setSelectedId(null)} />
        </div>
      )}
    </div>
  )
}
