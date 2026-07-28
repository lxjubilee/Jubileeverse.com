/**
 * AuthorForm.tsx — Phase 7 inline edit form for author content objects
 *
 * Edits extension_data typed as AuthorExtension. Auto-saves on blur
 * using the same useUpdateContent pattern as ArticleForm.
 */

import * as React from 'react'
import { useUpdateContent } from '../../../hooks/useContent'
import { Input }    from '../../ui/Input'
import { Select }   from '../../ui/Select'
import { Button }   from '../../ui/Button'
import type { ContentObject, AuthorExtension } from '../../../types/content-objects'

interface AuthorFormProps {
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

const VOCAB_OPTIONS = [
  { value: '',          label: '— none —' },
  { value: 'simplified', label: 'Simplified' },
  { value: 'moderate',   label: 'Moderate' },
  { value: 'academic',   label: 'Academic' },
]

const STYLE_OPTIONS = [
  { value: '',                   label: '— none —' },
  { value: 'short_declarative',  label: 'Short / Declarative' },
  { value: 'flowing_narrative',  label: 'Flowing Narrative' },
  { value: 'conversational',     label: 'Conversational' },
]

const TRADITION_OPTIONS = [
  { value: '',            label: '— none —' },
  { value: 'reformed',    label: 'Reformed' },
  { value: 'charismatic', label: 'Charismatic' },
  { value: 'liturgical',  label: 'Liturgical' },
  { value: 'ecumenical',  label: 'Ecumenical' },
]

export function AuthorForm({ item }: AuthorFormProps) {
  const update = useUpdateContent()
  const rawExt = (item.extension_data ?? {}) as AuthorExtension
  const vp = rawExt.voice_profile ?? {}

  // Local state for all fields
  const [displayName,  setDisplayName]  = React.useState(rawExt.display_name  ?? '')
  const [isActive,     setIsActive]     = React.useState(rawExt.is_active     ?? true)
  const [tone,         setTone]         = React.useState(vp.tone              ?? '')
  const [vocabLevel,   setVocabLevel]   = React.useState(vp.vocabulary_level  ?? '')
  const [sentStyle,    setSentStyle]    = React.useState(vp.sentence_style     ?? '')
  const [tradition,    setTradition]    = React.useState(vp.theological_tradition ?? '')
  const [mission,      setMission]      = React.useState(rawExt.mission_statement ?? '')
  const [boundaryText, setBoundaryText] = React.useState((rawExt.boundaries ?? []).join('\n'))
  const [model,        setModel]        = React.useState(rawExt.model         ?? 'claude-haiku-4-5-20251001')
  const [examples,     setExamples]     = React.useState(rawExt.example_outputs ?? [])

  function buildExt(): AuthorExtension {
    return {
      ...rawExt,
      display_name:      displayName || undefined,
      is_active:         isActive,
      voice_profile: {
        tone:                  tone        || undefined,
        vocabulary_level:      vocabLevel  || undefined,
        sentence_style:        sentStyle   || undefined,
        theological_tradition: tradition   || undefined,
      },
      mission_statement: mission || undefined,
      boundaries:        boundaryText ? boundaryText.split('\n').map(s => s.trim()).filter(Boolean) : [],
      model:             model || 'claude-haiku-4-5-20251001',
      example_outputs:   examples.length > 0 ? examples : undefined,
    }
  }

  function save() {
    update.mutate({ id: item.id, data: { extension_data: buildExt() as Record<string, unknown> } })
  }

  function addExample() {
    setExamples(prev => [...prev, { content_type: '', sample_text: '', context_note: '' }])
  }

  function removeExample(i: number) {
    setExamples(prev => prev.filter((_, idx) => idx !== i))
  }

  function updateExample(i: number, field: string, val: string) {
    setExamples(prev => prev.map((e, idx) => idx === i ? { ...e, [field]: val } : e))
  }

  const saving = update.isPending

  return (
    <div className="flex flex-col gap-4 p-3">

      {/* Identity */}
      <section className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Identity</p>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Display name</label>
          <Input
            className="h-7 text-xs"
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
            placeholder={item.title ?? undefined}
            onBlur={save}
          />
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={isActive}
            onChange={e => { setIsActive(e.target.checked); save() }}
            className="accent-primary"
          />
          <span className="text-xs">Active author</span>
        </label>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Model</label>
          <Input
            className="h-7 text-xs font-mono"
            value={model}
            onChange={e => setModel(e.target.value)}
            onBlur={save}
          />
        </div>
      </section>

      {/* Voice profile */}
      <section className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Voice Profile</p>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Tone</label>
          <Select className="w-full h-7 text-xs" value={tone}
            onValueChange={v => { setTone(v); setTimeout(save, 0) }} options={TONE_OPTIONS} />
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Vocabulary level</label>
          <Select className="w-full h-7 text-xs" value={vocabLevel}
            onValueChange={v => { setVocabLevel(v); setTimeout(save, 0) }} options={VOCAB_OPTIONS} />
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Sentence style</label>
          <Select className="w-full h-7 text-xs" value={sentStyle}
            onValueChange={v => { setSentStyle(v); setTimeout(save, 0) }} options={STYLE_OPTIONS} />
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Theological tradition</label>
          <Select className="w-full h-7 text-xs" value={tradition}
            onValueChange={v => { setTradition(v); setTimeout(save, 0) }} options={TRADITION_OPTIONS} />
        </div>
      </section>

      {/* Mission + Boundaries */}
      <section className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Mission & Constraints</p>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Mission statement</label>
          <textarea
            value={mission}
            onChange={e => setMission(e.target.value)}
            onBlur={save}
            rows={3}
            placeholder="Describe this author's purpose and calling…"
            className="w-full text-xs border rounded px-2 py-1 bg-background focus:outline-none focus:ring-1 focus:ring-ring resize-none"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Boundaries (one per line)</label>
          <textarea
            value={boundaryText}
            onChange={e => setBoundaryText(e.target.value)}
            onBlur={save}
            rows={3}
            placeholder={"Never provide medical advice\nAvoid denominational attacks"}
            className="w-full text-xs border rounded px-2 py-1 bg-background focus:outline-none focus:ring-1 focus:ring-ring resize-none font-mono"
          />
        </div>
      </section>

      {/* Example outputs */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Example Outputs</p>
          <Button size="sm" variant="ghost" className="h-6 text-xs px-2" onClick={addExample}>
            + Add
          </Button>
        </div>
        {examples.map((ex, i) => (
          <div key={i} className="border rounded p-2 space-y-1.5 bg-muted/30">
            <div className="flex items-center gap-1.5">
              <Input
                className="h-6 text-xs flex-1"
                value={ex.content_type}
                onChange={e => updateExample(i, 'content_type', e.target.value)}
                onBlur={save}
                placeholder="Content type (e.g. devotional)"
              />
              <button
                onClick={() => removeExample(i)}
                className="text-xs text-muted-foreground hover:text-destructive px-1"
              >
                ✕
              </button>
            </div>
            <textarea
              value={ex.sample_text}
              onChange={e => updateExample(i, 'sample_text', e.target.value)}
              onBlur={save}
              rows={2}
              placeholder="Sample output text…"
              className="w-full text-xs border rounded px-2 py-1 bg-background focus:outline-none focus:ring-1 focus:ring-ring resize-none"
            />
            <Input
              className="h-6 text-xs"
              value={ex.context_note ?? ''}
              onChange={e => updateExample(i, 'context_note', e.target.value)}
              onBlur={save}
              placeholder="Context note (optional)"
            />
          </div>
        ))}
      </section>

      {/* Save button */}
      <Button size="sm" className="w-full h-7 text-xs" onClick={save} disabled={saving}>
        {saving ? 'Saving…' : 'Save Author'}
      </Button>

      {update.isSuccess && (
        <p className="text-xs text-green-600 text-center">Saved</p>
      )}
    </div>
  )
}
