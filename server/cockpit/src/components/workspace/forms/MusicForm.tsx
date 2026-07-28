/**
 * MusicForm.tsx — Inline edit form for music_track content objects (Phase 4A)
 */

import * as React from 'react'
import { useUpdateContent } from '../../../hooks/useContent'
import { Select } from '../../ui/Select'
import type { ContentObject } from '../../../types/content-objects'

const KEY_OPTIONS = ['C', 'D', 'E', 'F', 'G', 'A', 'B', 'Cm', 'Dm', 'Em', 'Fm', 'Gm', 'Am', 'Bm'].map(v => ({ value: v, label: v }))
const SECTION_MARKERS = ['[Verse 1]', '[Verse 2]', '[Chorus]', '[Bridge]', '[Outro]', '[Pre-Chorus]']

interface MusicFormProps {
  item: ContentObject
}

export function MusicForm({ item }: MusicFormProps) {
  const update = useUpdateContent()
  const ext = (item.extension_data ?? {}) as Record<string, unknown>

  const [key,    setKey]    = React.useState((ext.key  as string) ?? 'C')
  const [bpm,    setBpm]    = React.useState(String(ext.bpm ?? ''))
  const [ccli,   setCcli]   = React.useState((ext.ccli as string) ?? '')
  const [lyrics, setLyrics] = React.useState((ext.lyrics as string) ?? '')

  const autoSaveRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  function scheduleAutoSave(updates: Record<string, unknown>) {
    if (autoSaveRef.current) clearTimeout(autoSaveRef.current)
    autoSaveRef.current = setTimeout(() => {
      update.mutate({ id: item.id, data: { extension_data: { ...ext, ...updates } } })
    }, 2_000)
  }

  function handleKeyChange(val: string) {
    setKey(val)
    update.mutate({ id: item.id, data: { extension_data: { ...ext, key: val } } })
  }

  function handleBpmChange(e: React.ChangeEvent<HTMLInputElement>) {
    setBpm(e.target.value)
    const n = parseInt(e.target.value)
    if (!isNaN(n)) scheduleAutoSave({ bpm: n })
  }

  function handleCcliChange(e: React.ChangeEvent<HTMLInputElement>) {
    setCcli(e.target.value)
    scheduleAutoSave({ ccli: e.target.value })
  }

  function handleLyricsChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setLyrics(e.target.value)
    scheduleAutoSave({ lyrics: e.target.value })
  }

  function insertMarker(marker: string) {
    const ta = document.getElementById('music-lyrics-ta') as HTMLTextAreaElement | null
    if (!ta) {
      setLyrics(l => l + (l ? '\n\n' : '') + marker + '\n')
      return
    }
    const start = ta.selectionStart
    const end   = ta.selectionEnd
    const newVal = lyrics.substring(0, start) + (start > 0 && lyrics[start - 1] !== '\n' ? '\n' : '') + marker + '\n' + lyrics.substring(end)
    setLyrics(newVal)
    scheduleAutoSave({ lyrics: newVal })
    // Restore cursor position after state update
    setTimeout(() => {
      ta.selectionStart = ta.selectionEnd = start + marker.length + 1
      ta.focus()
    }, 0)
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      {/* Key + BPM row */}
      <div className="flex gap-2">
        <div className="flex-1">
          <label className="block text-xs font-medium text-muted-foreground mb-1">Key</label>
          <Select
            value={key}
            onValueChange={handleKeyChange}
            options={KEY_OPTIONS}
            className="h-7 text-xs"
          />
        </div>
        <div className="flex-1">
          <label className="block text-xs font-medium text-muted-foreground mb-1">BPM</label>
          <input
            type="number"
            min={40}
            max={240}
            value={bpm}
            onChange={handleBpmChange}
            placeholder="120"
            className="w-full rounded border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>

      {/* CCLI */}
      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1">CCLI Number</label>
        <input
          value={ccli}
          onChange={handleCcliChange}
          placeholder="e.g. 7089042"
          className="w-full rounded border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      {/* Lyrics editor */}
      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1">Lyrics</label>
        {/* Section marker buttons */}
        <div className="flex flex-wrap gap-1 mb-1.5">
          {SECTION_MARKERS.map(m => (
            <button
              key={m}
              onClick={() => insertMarker(m)}
              className="text-xs px-1.5 py-0.5 rounded border hover:bg-muted transition-colors"
            >
              {m}
            </button>
          ))}
        </div>
        <textarea
          id="music-lyrics-ta"
          value={lyrics}
          onChange={handleLyricsChange}
          rows={12}
          placeholder="[Verse 1]&#10;…&#10;&#10;[Chorus]&#10;…"
          className="w-full rounded border bg-background px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary resize-none"
        />
      </div>
    </div>
  )
}
