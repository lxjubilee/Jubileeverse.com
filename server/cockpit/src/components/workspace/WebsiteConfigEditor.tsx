/**
 * WebsiteConfigEditor.tsx — 6-section configuration editor for sites (Part 4 S13)
 *
 * Replaces SiteForm in WebsiteEditorPanel. Uses CollapsibleSection for each
 * configuration group. Auto-saves on blur (text) or immediate (selects/toggles).
 */

import * as React from 'react'
import { useUpdateContent } from '../../hooks/useContent'
import { useContentRevisions } from '../../hooks/useWebsites'
import { CollapsibleSection } from './prompt-editor/CollapsibleSection'
import { Switch } from '../ui/Switch'
import type { ContentObject, SiteExtension, ContentRevisionSummary } from '../../types/content-objects'

interface WebsiteConfigEditorProps {
  site: ContentObject
}

const DEFAULT_FLAGS: Record<string, boolean> = {
  enable_search: false,
  enable_comments: false,
  enable_social_sharing: false,
  enable_dark_mode: false,
  enable_newsletter_signup: false,
  enable_donation_cta: false,
}

export function WebsiteConfigEditor({ site }: WebsiteConfigEditorProps) {
  const update = useUpdateContent()
  const { data: revisions = [] } = useContentRevisions(site.id)

  const ext = (site.extension_data ?? {}) as SiteExtension

  // ── Section 1: Identity & Domain ─────────────────────────────────────────────
  const [title, setTitle] = React.useState(site.title ?? '')
  const [domain, setDomain] = React.useState(ext.domain ?? '')
  const [altDomains, setAltDomains] = React.useState<string[]>(
    (ext.alternate_domains as string[] | undefined) ?? []
  )
  const [status, setStatus] = React.useState<string>(site.status ?? 'draft')
  const [faviconUrl, setFaviconUrl] = React.useState(ext.favicon_url ?? '')

  // ── Section 2: Theme & Branding ───────────────────────────────────────────────
  const [themeId, setThemeId] = React.useState((ext as Record<string, unknown>).theme_id as string ?? 'classic')
  const [primaryColor, setPrimaryColor] = React.useState(ext.primary_brand_color ?? '#000000')
  const [logoUrl, setLogoUrl] = React.useState(ext.logo_url ?? '')
  const [customCss, setCustomCss] = React.useState(ext.custom_css ?? '')

  // ── Section 3: Navigation & Layout ───────────────────────────────────────────
  const [portalBehavior, setPortalBehavior] = React.useState(
    ext.homepage_portal_behavior ?? 'auto_generate_daily'
  )
  const [navLayout, setNavLayout] = React.useState(ext.nav_layout ?? 'top-bar')
  const [maxTax, setMaxTax] = React.useState(String(ext.max_taxonomy_assignments ?? 12))
  const [footerHtml, setFooterHtml] = React.useState(ext.footer_html ?? '')

  // ── Section 4: API & Performance ─────────────────────────────────────────────
  const [apiBaseUrl, setApiBaseUrl] = React.useState(ext.api_base_url ?? '')
  const [cdnUrl, setCdnUrl] = React.useState(ext.cdn_url ?? '')
  const [cacheTtl, setCacheTtl] = React.useState(String(ext.cache_ttl ?? 300))
  const [serviceWorker, setServiceWorker] = React.useState(ext.enable_service_worker ?? false)

  // ── Section 5: Feature Flags ──────────────────────────────────────────────────
  const [flags, setFlags] = React.useState<Record<string, boolean>>(() => {
    const saved = (ext.feature_flags ?? {}) as Record<string, boolean | string>
    const merged = { ...DEFAULT_FLAGS }
    for (const [k, v] of Object.entries(saved)) {
      merged[k] = Boolean(v)
    }
    return merged
  })
  const [newFlagName, setNewFlagName] = React.useState('')

  // ── Section 6: Analytics ─────────────────────────────────────────────────────
  const [gaId, setGaId] = React.useState(ext.ga_id ?? '')
  const [fbPixelId, setFbPixelId] = React.useState(ext.fb_pixel_id ?? '')
  const [analyticsScript, setAnalyticsScript] = React.useState(ext.custom_analytics_script ?? '')

  // ── Version history ───────────────────────────────────────────────────────────
  const [expandedRevId, setExpandedRevId] = React.useState<number | null>(null)

  // ── Save helpers ──────────────────────────────────────────────────────────────
  function saveExt(patch: Partial<SiteExtension & Record<string, unknown>>) {
    update.mutate({ id: site.id, data: { extension_data: { ...(site.extension_data ?? {}), ...patch } } })
  }

  function saveTop(patch: { title?: string; status?: string }) {
    update.mutate({ id: site.id, data: patch as Record<string, unknown> })
  }

  function saveFlags(nextFlags: Record<string, boolean>) {
    saveExt({ feature_flags: nextFlags })
  }

  function toggleFlag(key: string, val: boolean) {
    const next = { ...flags, [key]: val }
    setFlags(next)
    saveFlags(next)
  }

  function addFlag() {
    const key = newFlagName.trim()
    if (!key || key in flags) return
    const next = { ...flags, [key]: false }
    setFlags(next)
    setNewFlagName('')
    saveFlags(next)
  }

  function removeFlag(key: string) {
    const next = { ...flags }
    delete next[key]
    setFlags(next)
    saveFlags(next)
  }

  function addAltDomain() {
    const updated = [...altDomains, '']
    setAltDomains(updated)
  }

  function updateAltDomain(i: number, val: string) {
    const updated = altDomains.map((d, idx) => (idx === i ? val : d))
    setAltDomains(updated)
  }

  function removeAltDomain(i: number) {
    const updated = altDomains.filter((_, idx) => idx !== i)
    setAltDomains(updated)
    saveExt({ alternate_domains: updated } as Record<string, unknown>)
  }

  function blurAltDomains() {
    saveExt({ alternate_domains: altDomains } as Record<string, unknown>)
  }

  const fieldClass = 'w-full text-xs border rounded px-2 h-7 bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary'
  const labelClass = 'block text-xs text-muted-foreground mb-1'

  return (
    <div className="flex flex-col gap-0">
      {/* ── Section 1: Identity & Domain ─────────────────────────────────── */}
      <CollapsibleSection title="Identity & Domain" defaultOpen>
        <div className="space-y-3 px-1">
          <div>
            <label className={labelClass}>Site Title</label>
            <input
              className={fieldClass}
              value={title}
              onChange={e => setTitle(e.target.value)}
              onBlur={() => saveTop({ title })}
              placeholder="My Website"
            />
          </div>
          <div>
            <label className={labelClass}>Domain</label>
            <input
              className={fieldClass}
              value={domain}
              onChange={e => setDomain(e.target.value)}
              onBlur={() => saveExt({ domain: domain || undefined })}
              placeholder="example.com"
            />
          </div>
          <div>
            <label className={labelClass}>Alternate Domains</label>
            {altDomains.map((d, i) => (
              <div key={i} className="flex gap-1 mb-1">
                <input
                  className={fieldClass}
                  value={d}
                  onChange={e => updateAltDomain(i, e.target.value)}
                  onBlur={blurAltDomains}
                  placeholder="alias.example.com"
                />
                <button
                  onClick={() => removeAltDomain(i)}
                  className="text-muted-foreground hover:text-destructive text-xs px-1"
                  title="Remove"
                >×</button>
              </div>
            ))}
            <button
              onClick={addAltDomain}
              className="text-xs text-primary hover:underline"
            >+ Add Domain</button>
          </div>
          <div>
            <label className={labelClass}>Status</label>
            <select
              className={fieldClass}
              value={status}
              onChange={e => { setStatus(e.target.value); setTimeout(() => saveTop({ status: e.target.value }), 0) }}
            >
              <option value="draft">Draft</option>
              <option value="published">Published</option>
              <option value="archived">Archived</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>Favicon URL</label>
            <input
              className={fieldClass}
              value={faviconUrl}
              onChange={e => setFaviconUrl(e.target.value)}
              onBlur={() => saveExt({ favicon_url: faviconUrl || undefined })}
              placeholder="https://example.com/favicon.ico"
            />
          </div>
        </div>
      </CollapsibleSection>

      {/* ── Section 2: Theme & Branding ───────────────────────────────────── */}
      <CollapsibleSection title="Theme & Branding">
        <div className="space-y-3 px-1">
          <div>
            <label className={labelClass}>Theme</label>
            <select
              className={fieldClass}
              value={themeId}
              onChange={e => { setThemeId(e.target.value); setTimeout(() => saveExt({ theme_id: e.target.value } as Record<string, unknown>), 0) }}
            >
              <option value="classic">Classic</option>
              <option value="modern">Modern</option>
              <option value="minimal">Minimal</option>
              <option value="bold">Bold</option>
              <option value="custom">Custom</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>Primary Brand Color</label>
            <input
              type="color"
              className="h-8 w-16 border rounded cursor-pointer"
              value={primaryColor}
              onChange={e => setPrimaryColor(e.target.value)}
              onBlur={() => saveExt({ primary_brand_color: primaryColor })}
            />
          </div>
          <div>
            <label className={labelClass}>Logo URL</label>
            <input
              className={fieldClass}
              value={logoUrl}
              onChange={e => setLogoUrl(e.target.value)}
              onBlur={() => saveExt({ logo_url: logoUrl || undefined })}
              placeholder="https://example.com/logo.png"
            />
          </div>
          <div>
            <label className={labelClass}>Custom CSS</label>
            <textarea
              rows={6}
              className="w-full text-xs border rounded px-2 py-1.5 bg-background text-foreground font-mono focus:outline-none focus:ring-1 focus:ring-primary resize-none"
              value={customCss}
              onChange={e => setCustomCss(e.target.value)}
              onBlur={() => saveExt({ custom_css: customCss || undefined })}
              placeholder=":root { --brand: #000; }"
            />
          </div>
        </div>
      </CollapsibleSection>

      {/* ── Section 3: Navigation & Layout ───────────────────────────────── */}
      <CollapsibleSection title="Navigation & Layout">
        <div className="space-y-3 px-1">
          <div>
            <label className={labelClass}>Homepage Portal Behavior</label>
            <select
              className={fieldClass}
              value={portalBehavior}
              onChange={e => {
                const v = e.target.value as SiteExtension['homepage_portal_behavior']
                setPortalBehavior(v ?? 'auto_generate_daily')
                setTimeout(() => saveExt({ homepage_portal_behavior: v }), 0)
              }}
            >
              <option value="auto_generate_daily">Auto Generate Daily</option>
              <option value="manual_curation">Manual Curation</option>
              <option value="featured_taxonomy_mix">Featured Taxonomy Mix</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>Navigation Layout</label>
            <select
              className={fieldClass}
              value={navLayout}
              onChange={e => {
                const v = e.target.value as SiteExtension['nav_layout']
                setNavLayout(v ?? 'top-bar')
                setTimeout(() => saveExt({ nav_layout: v }), 0)
              }}
            >
              <option value="top-bar">Top Bar</option>
              <option value="side-nav">Side Nav</option>
              <option value="mega-menu">Mega Menu</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>Max Taxonomy Assignments</label>
            <input
              type="number"
              min={1}
              max={50}
              className={fieldClass}
              value={maxTax}
              onChange={e => setMaxTax(e.target.value)}
              onBlur={() => saveExt({ max_taxonomy_assignments: parseInt(maxTax, 10) || 12 })}
            />
          </div>
          <div>
            <label className={labelClass}>Footer HTML</label>
            <textarea
              rows={6}
              className="w-full text-xs border rounded px-2 py-1.5 bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none"
              value={footerHtml}
              onChange={e => setFooterHtml(e.target.value)}
              onBlur={() => saveExt({ footer_html: footerHtml || undefined })}
              placeholder="<footer>...</footer>"
            />
          </div>
        </div>
      </CollapsibleSection>

      {/* ── Section 4: API & Performance ─────────────────────────────────── */}
      <CollapsibleSection title="API & Performance">
        <div className="space-y-3 px-1">
          <div>
            <label className={labelClass}>API Base URL</label>
            <input
              className={fieldClass}
              value={apiBaseUrl}
              onChange={e => setApiBaseUrl(e.target.value)}
              onBlur={() => saveExt({ api_base_url: apiBaseUrl || undefined })}
              placeholder="https://api.example.com"
            />
          </div>
          <div>
            <label className={labelClass}>CDN URL</label>
            <input
              className={fieldClass}
              value={cdnUrl}
              onChange={e => setCdnUrl(e.target.value)}
              onBlur={() => saveExt({ cdn_url: cdnUrl || undefined })}
              placeholder="https://cdn.example.com"
            />
          </div>
          <div>
            <label className={labelClass}>Cache TTL (seconds)</label>
            <input
              type="number"
              className={fieldClass}
              value={cacheTtl}
              onChange={e => setCacheTtl(e.target.value)}
              onBlur={() => saveExt({ cache_ttl: parseInt(cacheTtl, 10) || 300 })}
              placeholder="300"
            />
          </div>
          <div className="flex items-center justify-between">
            <label className={labelClass + ' mb-0'}>Enable Service Worker</label>
            <Switch
              checked={serviceWorker}
              onCheckedChange={v => { setServiceWorker(v); setTimeout(() => saveExt({ enable_service_worker: v }), 0) }}
            />
          </div>
        </div>
      </CollapsibleSection>

      {/* ── Section 5: Feature Flags ──────────────────────────────────────── */}
      <CollapsibleSection title="Feature Flags">
        <div className="space-y-2 px-1">
          {Object.entries(flags).map(([key, val]) => (
            <div key={key} className="flex items-center gap-2">
              <span className="flex-1 text-xs text-foreground font-mono truncate">{key}</span>
              <Switch
                checked={val}
                onCheckedChange={v => toggleFlag(key, v)}
              />
              <button
                onClick={() => removeFlag(key)}
                className="text-muted-foreground hover:text-destructive text-xs"
                title="Remove flag"
              >×</button>
            </div>
          ))}
          <div className="flex gap-1 mt-2">
            <input
              className={fieldClass + ' flex-1'}
              value={newFlagName}
              onChange={e => setNewFlagName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addFlag() }}
              placeholder="new_flag_name"
            />
            <button
              onClick={addFlag}
              className="text-xs px-2 py-1 border rounded hover:bg-muted/50 transition-colors"
            >+ Add</button>
          </div>
        </div>
      </CollapsibleSection>

      {/* ── Section 6: Analytics ─────────────────────────────────────────── */}
      <CollapsibleSection title="Analytics">
        <div className="space-y-3 px-1">
          <div>
            <label className={labelClass}>Google Analytics ID</label>
            <input
              className={fieldClass}
              value={gaId}
              onChange={e => setGaId(e.target.value)}
              onBlur={() => saveExt({ ga_id: gaId || undefined })}
              placeholder="G-XXXXXXXXXX"
            />
          </div>
          <div>
            <label className={labelClass}>Facebook Pixel ID</label>
            <input
              className={fieldClass}
              value={fbPixelId}
              onChange={e => setFbPixelId(e.target.value)}
              onBlur={() => saveExt({ fb_pixel_id: fbPixelId || undefined })}
              placeholder="123456789"
            />
          </div>
          <div>
            <label className={labelClass}>Custom Analytics Script</label>
            <textarea
              rows={4}
              className="w-full text-xs border rounded px-2 py-1.5 bg-background text-foreground font-mono focus:outline-none focus:ring-1 focus:ring-primary resize-none"
              value={analyticsScript}
              onChange={e => setAnalyticsScript(e.target.value)}
              onBlur={() => saveExt({ custom_analytics_script: analyticsScript || undefined })}
              placeholder="<!-- analytics script -->"
            />
          </div>
        </div>
      </CollapsibleSection>

      {/* ── Version History ───────────────────────────────────────────────── */}
      <CollapsibleSection title="Version History">
        <div className="px-1 space-y-1">
          {revisions.length === 0 && (
            <p className="text-xs text-muted-foreground">No revisions recorded yet.</p>
          )}
          {revisions.map((rev: ContentRevisionSummary) => (
            <div key={rev.id} className="border rounded">
              <button
                className="w-full text-left px-2 py-1.5 text-xs hover:bg-muted/30 transition-colors"
                onClick={() => setExpandedRevId(expandedRevId === rev.id ? null : rev.id)}
              >
                <span className="font-medium">v{rev.version}</span>
                <span className="text-muted-foreground ml-2">{new Date(rev.changed_at).toLocaleString()}</span>
                {rev.changed_by && <span className="text-muted-foreground ml-2">· {rev.changed_by}</span>}
                {rev.change_summary && <span className="text-muted-foreground ml-2">· {rev.change_summary}</span>}
              </button>
              {expandedRevId === rev.id && (
                <pre className="text-xs overflow-auto max-h-32 bg-muted/30 p-2 rounded-b border-t">
                  {JSON.stringify(rev, null, 2)}
                </pre>
              )}
            </div>
          ))}
        </div>
      </CollapsibleSection>
    </div>
  )
}
