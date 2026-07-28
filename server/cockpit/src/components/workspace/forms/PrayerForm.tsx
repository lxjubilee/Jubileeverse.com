/**
 * PrayerForm.tsx — Inline edit form for prayer content objects (Phase 4A)
 */

import * as React from 'react'
import { useUpdateContent } from '../../../hooks/useContent'
import { Select } from '../../ui/Select'
import { Plus, Trash2 } from 'lucide-react'
import type { ContentObject } from '../../../types/content-objects'

const OCCASION_OPTIONS = ['daily', 'morning', 'evening', 'weekly', 'special', 'general'].map(v => ({ value: v, label: v.charAt(0).toUpperCase() + v.slice(1) }))

interface PrayerFormProps {
  item: ContentObject
}

export function PrayerForm({ item }: PrayerFormProps) {
  const update = useUpdateContent()
  const ext = (item.extension_data ?? {}) as Record<string, unknown>

  const [prayerText, setPrayerText] = React.useState((ext.prayer_text as string) ?? '')
  const [occasion,   setOccasion]   = React.useState((ext.occasion_type as string) ?? 'general')
  const [author,     setAuthor]     = React.useState((ext.author_attribution as string) ?? '')
  const [refs, setRefs] = React.useState<string[]>(
    Array.isArray(ext.scripture_refs) ? (ext.scripture_refs as string[]) : []
  )

  const autoSaveRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  function scheduleAutoSave(updates: Record<string, unknown>) {
    if (autoSaveRef.current) clearTimeout(autoSaveRef.current)
    autoSaveRef.current = setTimeout(() => {
      update.mutate({ id: item.id, data: { extension_data: { ...ext, ...updates } } })
    }, 2_000)
  }

  function handleTextChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setPrayerText(e.target.value)
    scheduleAutoSave({ prayer_text: e.target.value })
  }

  function handleAuthorChange(e: React.ChangeEvent<HTMLInputElement>) {
    setAuthor(e.target.value)
    scheduleAutoSave({ author_attribution: e.target.value })
  }

  function handleOccasionChange(val: string) {
    setOccasion(val)
    update.mutate({ id: item.id, data: { extension_data: { ...ext, occasion_type: val } } })
  }

  function addRef() {
    const newRefs = [...refs, '']
    setRefs(newRefs)
  }

  function updateRef(i: number, val: string) {
    const newRefs = refs.map((r, idx) => idx === i ? val : r)
    setRefs(newRefs)
    scheduleAutoSave({ scripture_refs: newRefs })
  }

  function removeRef(i: number) {
    const newRefs = refs.filter((_, idx) => idx !== i)
    setRefs(newRefs)
    update.mutate({ id: item.id, data: { extension_data: { ...ext, scripture_refs: newRefs } } })
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      {/* Prayer text */}
      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1">Prayer Text</label>
        <textarea
          value={prayerText}
          onChange={handleTextChange}
          rows={6}
          placeholder="Enter the prayer text…"
          className="w-full rounded border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary resize-none"
        />
      </div>

      {/* Occasion type */}
      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1">Occasion Type</label>
        <Select
          value={occasion}
          onValueChange={handleOccasionChange}
          options={OCCASION_OPTIONS}
          className="h-7 text-xs"
        />
      </div>

      {/* Author attribution */}
      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1">Author Attribution</label>
        <input
          value={author}
          onChange={handleAuthorChange}
          placeholder="Optional author name"
          className="w-full rounded border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      {/* Scripture references repeater */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-medium text-muted-foreground">Scripture References</label>
          <button
            onClick={addRef}
            className="flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <Plus size={11} /> Add
          </button>
        </div>
        <div className="space-y-1">
          {refs.map((ref, i) => (
            <div key={i} className="flex gap-1">
              <input
                value={ref}
                onChange={e => updateRef(i, e.target.value)}
                placeholder="e.g. John 3:16"
                className="flex-1 rounded border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <button
                onClick={() => removeRef(i)}
                className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                aria-label="Remove reference"
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))}
          {refs.length === 0 && (
            <p className="text-xs text-muted-foreground italic">No references added.</p>
          )}
        </div>
      </div>
    </div>
  )
}
