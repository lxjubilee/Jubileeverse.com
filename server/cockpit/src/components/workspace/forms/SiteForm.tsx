/**
 * SiteForm.tsx — Phase 8 inline edit form for site content objects
 *
 * Edits extension_data typed as SiteExtension. Auto-saves on blur
 * using the same useUpdateContent pattern as PersonaForm.
 */

import * as React from 'react'
import { useUpdateContent } from '../../../hooks/useContent'
import { Input }  from '../../ui/Input'
import { Select } from '../../ui/Select'
import { Button } from '../../ui/Button'
import type { ContentObject, SiteExtension } from '../../../types/content-objects'

interface SiteFormProps {
  item: ContentObject
}

const TONE_OPTIONS = [
  { value: '',              label: '— none —' },
  { value: 'warm',          label: 'Warm' },
  { value: 'authoritative', label: 'Authoritative' },
  { value: 'poetic',        label: 'Poetic' },
  { value: 'prophetic',     label: 'Prophetic' },
  { value: 'scholarly',     label: 'Scholarly' },
  { value: 'urgent',        label: 'Urgent' },
]

export function SiteForm({ item }: SiteFormProps) {
  const update = useUpdateContent()
  const rawExt = (item.extension_data ?? {}) as SiteExtension
  const rules  = rawExt.publishing_rules ?? {}
  const taxMap = rawExt.taxonomy_mapping ?? {}

  const [domain,         setDomain]         = React.useState(rawExt.domain            ?? '')
  const [siteTone,       setSiteTone]       = React.useState(rawExt.site_tone          ?? '')
  const [autoPublish,    setAutoPublish]    = React.useState(rules.auto_publish         ?? false)
  const [requireApproval, setRequireApproval] = React.useState(rules.require_site_owner_approval ?? false)
  const [whitelistText,  setWhitelistText]  = React.useState((rules.content_type_whitelist ?? []).join(', '))
  const [blackoutText,   setBlackoutText]   = React.useState((rules.blackout_dates ?? []).join('\n'))
  const [rootIdsText,    setRootIdsText]    = React.useState((taxMap.root_ids ?? []).join(', '))

  function buildExt(): SiteExtension {
    return {
      ...rawExt,
      domain: domain || undefined,
      site_tone: siteTone || undefined,
      publishing_rules: {
        auto_publish: autoPublish,
        require_site_owner_approval: requireApproval,
        content_type_whitelist: whitelistText
          ? whitelistText.split(',').map(s => s.trim()).filter(Boolean)
          : [],
        blackout_dates: blackoutText
          ? blackoutText.split('\n').map(s => s.trim()).filter(Boolean)
          : [],
      },
      taxonomy_mapping: {
        root_ids: rootIdsText
          ? rootIdsText.split(',').map(s => Number(s.trim())).filter(n => !isNaN(n))
          : [],
      },
    }
  }

  function save() {
    update.mutate({ id: item.id, data: { extension_data: buildExt() as Record<string, unknown> } })
  }

  const saving = update.isPending

  return (
    <div className="flex flex-col gap-4 p-3">

      {/* Identity */}
      <section className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Identity</p>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Domain</label>
          <Input
            className="h-7 text-xs font-mono"
            value={domain}
            onChange={e => setDomain(e.target.value)}
            onBlur={save}
            placeholder="e.g. jubileeverse.com"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Site tone</label>
          <Select
            className="w-full h-7 text-xs"
            value={siteTone}
            onValueChange={v => { setSiteTone(v); setTimeout(save, 0) }}
            options={TONE_OPTIONS}
          />
        </div>
      </section>

      {/* Publishing rules */}
      <section className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Publishing Rules</p>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={autoPublish}
            onChange={e => { setAutoPublish(e.target.checked); save() }}
            className="accent-primary"
          />
          <span className="text-xs">Auto-publish content</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={requireApproval}
            onChange={e => { setRequireApproval(e.target.checked); save() }}
            className="accent-primary"
          />
          <span className="text-xs">Require site owner approval</span>
        </label>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Content type whitelist (comma-separated)</label>
          <Input
            className="h-7 text-xs font-mono"
            value={whitelistText}
            onChange={e => setWhitelistText(e.target.value)}
            onBlur={save}
            placeholder="article, devotional, prayer"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Blackout dates (one per line, YYYY-MM-DD)</label>
          <textarea
            value={blackoutText}
            onChange={e => setBlackoutText(e.target.value)}
            onBlur={save}
            rows={2}
            placeholder={"2026-12-25\n2026-01-01"}
            className="w-full text-xs border rounded px-2 py-1 bg-background focus:outline-none focus:ring-1 focus:ring-ring resize-none font-mono"
          />
        </div>
      </section>

      {/* Taxonomy mapping */}
      <section className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Taxonomy Mapping</p>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Root category IDs (comma-separated)</label>
          <Input
            className="h-7 text-xs font-mono"
            value={rootIdsText}
            onChange={e => setRootIdsText(e.target.value)}
            onBlur={save}
            placeholder="64166, 64148"
          />
        </div>
      </section>

      {/* Save button */}
      <Button size="sm" className="w-full h-7 text-xs" onClick={save} disabled={saving}>
        {saving ? 'Saving…' : 'Save Site'}
      </Button>

      {update.isSuccess && (
        <p className="text-xs text-green-600 text-center">Saved</p>
      )}
    </div>
  )
}
