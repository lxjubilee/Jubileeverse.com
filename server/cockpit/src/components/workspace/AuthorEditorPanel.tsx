/**
 * AuthorEditorPanel.tsx — Part 3 Section 5 right-panel editor
 *
 * Three collapsible sections:
 *   1. Profile — display_name, canonical_slug, AvatarPicker, social_links, default_language,
 *                is_active, model
 *   2. Voice Configuration — tone, vocabulary_level, sentence_style, theological_tradition,
 *                            mission_statement, boundaries, example_outputs
 *   3. Channel Bios — DB-backed bio variants via jv_author_bios (inline expand/edit)
 */

import * as React from 'react'
import { X, ChevronDown, ChevronRight, Star, Trash2, Plus } from 'lucide-react'
import {
  useAuthor,
  useAuthorBios, useAuthorBioChannels,
  useCreateAuthorBio, useUpdateAuthorBio, useDeleteAuthorBio,
} from '../../hooks/useAuthors'
import { useUpdateContent } from '../../hooks/useContent'
import { Input }        from '../ui/Input'
import { Select }       from '../ui/Select'
import { Button }       from '../ui/Button'
import { AvatarPicker } from '../ui/AvatarPicker'
import type { AuthorExtension, AuthorBio } from '../../types/content-objects'

// ── Helpers ───────────────────────────────────────────────────────────────────

function countWords(text: string): number {
  return text.trim() === '' ? 0 : text.trim().split(/\s+/).length
}

function toSlug(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

// ── Collapsible section wrapper ───────────────────────────────────────────────

function Section({ title, defaultOpen = true, children }: {
  title: string; defaultOpen?: boolean; children: React.ReactNode
}) {
  const [open, setOpen] = React.useState(defaultOpen)
  return (
    <div className="border-b">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-1.5 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors text-left"
      >
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        {title}
      </button>
      {open && <div className="px-3 pb-3 space-y-2">{children}</div>}
    </div>
  )
}

// ── Voice options ─────────────────────────────────────────────────────────────

const TONE_OPTS = [
  { value: '', label: '— none —' }, { value: 'warm', label: 'Warm' },
  { value: 'authoritative', label: 'Authoritative' }, { value: 'poetic', label: 'Poetic' },
  { value: 'prophetic', label: 'Prophetic' }, { value: 'scholarly', label: 'Scholarly' },
  { value: 'urgent', label: 'Urgent' },
]
const VOCAB_OPTS = [
  { value: '', label: '— none —' }, { value: 'simplified', label: 'Simplified' },
  { value: 'moderate', label: 'Moderate' }, { value: 'academic', label: 'Academic' },
]
const STYLE_OPTS = [
  { value: '', label: '— none —' }, { value: 'short_declarative', label: 'Short / Declarative' },
  { value: 'flowing_narrative', label: 'Flowing Narrative' }, { value: 'conversational', label: 'Conversational' },
]
const TRADITION_OPTS = [
  { value: '', label: '— none —' }, { value: 'reformed', label: 'Reformed' },
  { value: 'charismatic', label: 'Charismatic' }, { value: 'liturgical', label: 'Liturgical' },
  { value: 'ecumenical', label: 'Ecumenical' },
]
const LANGUAGE_OPTS = [
  { value: 'en-US', label: 'English (US)' }, { value: 'es-MX', label: 'Spanish (MX)' },
  { value: 'fr-FR', label: 'French (FR)' }, { value: 'pt-BR', label: 'Portuguese (BR)' },
  { value: 'de-DE', label: 'German (DE)' },
]

// ── Inline Bio row ────────────────────────────────────────────────────────────

function BioRow({ bio, authorId, isAdmin }: { bio: AuthorBio; authorId: string; isAdmin: boolean }) {
  const [expanded, setExpanded] = React.useState(false)
  const [bioText,   setBioText]  = React.useState(bio.bio_text)
  const [bioShort,  setBioShort] = React.useState(bio.bio_short ?? '')
  const [language,  setLanguage] = React.useState(bio.language)
  const [isPrimary, setIsPrimary] = React.useState(bio.is_primary)

  const updateBio = useUpdateAuthorBio()
  const deleteBio = useDeleteAuthorBio()

  async function handleSave() {
    await updateBio.mutateAsync({
      authorId, bioId: bio.id,
      data: { bio_text: bioText, bio_short: bioShort || undefined, language, is_primary: isPrimary },
    })
    setExpanded(false)
  }

  async function handleDelete() {
    if (!confirm(`Delete the "${bio.channel}" bio?`)) return
    await deleteBio.mutateAsync({ authorId, bioId: bio.id })
  }

  const preview = bio.bio_text.length > 60 ? bio.bio_text.slice(0, 57) + '…' : bio.bio_text

  return (
    <div className="border rounded bg-background">
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-muted/40 transition-colors rounded"
      >
        <span className="text-[10px] font-semibold uppercase tracking-wide bg-muted px-1.5 py-0.5 rounded shrink-0">
          {bio.channel}
        </span>
        {bio.is_primary && <Star size={9} className="text-amber-500 shrink-0 fill-amber-500" />}
        <span className="text-[11px] text-muted-foreground truncate flex-1">{preview || '…'}</span>
        <span className="text-[10px] text-muted-foreground shrink-0">{bio.word_count}w</span>
        <span className="text-[10px] text-muted-foreground shrink-0">{bio.language}</span>
      </button>
      {expanded && isAdmin && (
        <div className="px-2.5 pb-2.5 pt-1 space-y-2 border-t">
          <div>
            <div className="flex items-center justify-between mb-0.5">
              <label className="text-[10px] text-muted-foreground">Bio text</label>
              <span className="text-[10px] text-muted-foreground">{countWords(bioText)} words</span>
            </div>
            <textarea value={bioText} onChange={e => setBioText(e.target.value)} rows={5}
              className="w-full text-xs border rounded px-2 py-1 bg-background focus:outline-none focus:ring-1 focus:ring-ring resize-none" />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground block mb-0.5">Short bio (≤ 500 chars)</label>
            <Input className="h-7 text-xs" value={bioShort}
              onChange={e => setBioShort(e.target.value)} maxLength={500}
              placeholder="1-2 sentence summary…" />
          </div>
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <label className="text-[10px] text-muted-foreground block mb-0.5">Language</label>
              <Select className="w-full h-7 text-xs" value={language}
                onValueChange={setLanguage} options={LANGUAGE_OPTS} />
            </div>
            <label className="flex items-center gap-1.5 cursor-pointer mt-4">
              <input type="checkbox" checked={isPrimary}
                onChange={e => setIsPrimary(e.target.checked)} className="accent-amber-500" />
              <span className="text-[11px]">Primary</span>
            </label>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <Button size="sm" className="flex-1 h-7 text-xs"
              onClick={handleSave} disabled={updateBio.isPending}>
              {updateBio.isPending ? 'Saving…' : 'Save'}
            </Button>
            <button type="button" onClick={handleDelete} disabled={deleteBio.isPending}
              className="text-muted-foreground hover:text-destructive transition-colors p-1.5" title="Delete bio">
              <Trash2 size={13} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Add Bio form ──────────────────────────────────────────────────────────────

function AddBioForm({ authorId, usedChannelKeys, onDone }: {
  authorId: string; usedChannelKeys: string[]; onDone: () => void
}) {
  const { data: channelsData } = useAuthorBioChannels()
  const channels = channelsData?.channels ?? []
  const [channel,   setChannel]   = React.useState('')
  const [bioText,   setBioText]   = React.useState('')
  const [bioShort,  setBioShort]  = React.useState('')
  const [language,  setLanguage]  = React.useState('en-US')
  const [isPrimary, setIsPrimary] = React.useState(false)
  const createBio = useCreateAuthorBio()

  const availableChannels = channels
    .filter(c => !usedChannelKeys.includes(`${c.slug}:${language}`))
    .map(c => ({ value: c.slug, label: c.label }))

  async function handleAdd() {
    if (!channel || !bioText.trim()) return
    await createBio.mutateAsync({
      authorId,
      data: {
        channel, bio_text: bioText.trim(),
        bio_short: bioShort.trim() || undefined,
        language, is_primary: isPrimary,
      },
    })
    onDone()
  }

  return (
    <div className="border rounded bg-muted/20 p-2.5 space-y-2">
      <div>
        <label className="text-[10px] text-muted-foreground block mb-0.5">Channel</label>
        <Select className="w-full h-7 text-xs" value={channel} onValueChange={setChannel}
          options={[{ value: '', label: '— choose channel —' }, ...availableChannels]} />
      </div>
      <div>
        <label className="text-[10px] text-muted-foreground block mb-0.5">Language</label>
        <Select className="w-full h-7 text-xs" value={language}
          onValueChange={setLanguage} options={LANGUAGE_OPTS} />
      </div>
      <div>
        <div className="flex items-center justify-between mb-0.5">
          <label className="text-[10px] text-muted-foreground">Bio text</label>
          <span className="text-[10px] text-muted-foreground">{countWords(bioText)} words</span>
        </div>
        <textarea value={bioText} onChange={e => setBioText(e.target.value)} rows={4}
          placeholder="Write the bio copy…"
          className="w-full text-xs border rounded px-2 py-1 bg-background focus:outline-none focus:ring-1 focus:ring-ring resize-none" />
      </div>
      <div>
        <label className="text-[10px] text-muted-foreground block mb-0.5">Short bio (optional, ≤ 500 chars)</label>
        <Input className="h-7 text-xs" value={bioShort} onChange={e => setBioShort(e.target.value)}
          maxLength={500} placeholder="1-2 sentence summary…" />
      </div>
      <label className="flex items-center gap-1.5 cursor-pointer">
        <input type="checkbox" checked={isPrimary}
          onChange={e => setIsPrimary(e.target.checked)} className="accent-amber-500" />
        <span className="text-[11px]">Set as primary bio</span>
      </label>
      <div className="flex items-center gap-2 pt-1">
        <Button size="sm" className="flex-1 h-7 text-xs" onClick={handleAdd}
          disabled={createBio.isPending || !channel || !bioText.trim()}>
          {createBio.isPending ? 'Saving…' : 'Add Bio'}
        </Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onDone}>Cancel</Button>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface AuthorEditorPanelProps {
  authorId: string | null
  onClose:  () => void
  isAdmin?: boolean
}

export function AuthorEditorPanel({ authorId, onClose, isAdmin = false }: AuthorEditorPanelProps) {
  const { data: author }   = useAuthor(authorId)
  const { data: biosData } = useAuthorBios(authorId)
  const bios               = biosData?.bios ?? []
  const updateContent      = useUpdateContent()

  const rawExt = (author?.extension_data ?? {}) as AuthorExtension
  const vp     = rawExt.voice_profile ?? {}

  // Profile state
  const [displayName,    setDisplayName]   = React.useState(rawExt.display_name    ?? '')
  const [canonicalSlug,  setCanonicalSlug] = React.useState(rawExt.canonical_slug  ?? '')
  const [avatarAssetId,  setAvatarAssetId] = React.useState<string | null>(rawExt.avatar_asset_id ?? null)
  const [avatarUrl,      setAvatarUrl]     = React.useState<string | null>(rawExt.avatar_url      ?? null)
  const [twitterUrl,     setTwitterUrl]    = React.useState(rawExt.social_links?.twitter   ?? '')
  const [instagramUrl,   setInstagramUrl]  = React.useState(rawExt.social_links?.instagram ?? '')
  const [linkedinUrl,    setLinkedInUrl]   = React.useState(rawExt.social_links?.linkedin  ?? '')
  const [websiteUrl,     setWebsiteUrl]    = React.useState(rawExt.social_links?.website   ?? '')
  const [defaultLang,    setDefaultLang]   = React.useState(rawExt.default_language ?? 'en-US')
  const [isActive,       setIsActive]      = React.useState(rawExt.is_active        ?? true)
  const [model,          setModel]         = React.useState(rawExt.model            ?? 'claude-haiku-4-5-20251001')

  // Voice state
  const [tone,         setTone]         = React.useState(vp.tone                  ?? '')
  const [vocabLevel,   setVocabLevel]   = React.useState(vp.vocabulary_level      ?? '')
  const [sentStyle,    setSentStyle]    = React.useState(vp.sentence_style        ?? '')
  const [tradition,    setTradition]    = React.useState(vp.theological_tradition ?? '')
  const [mission,      setMission]      = React.useState(rawExt.mission_statement ?? '')
  const [boundaryText, setBoundaryText] = React.useState((rawExt.boundaries ?? []).join('\n'))
  const [examples,     setExamples]     = React.useState(rawExt.example_outputs   ?? [])

  // Sync on author load
  React.useEffect(() => {
    if (!author) return
    const e = (author.extension_data ?? {}) as AuthorExtension
    const v = e.voice_profile ?? {}
    setDisplayName(e.display_name    ?? '')
    setCanonicalSlug(e.canonical_slug  ?? '')
    setAvatarAssetId(e.avatar_asset_id ?? null)
    setAvatarUrl(e.avatar_url      ?? null)
    setTwitterUrl(e.social_links?.twitter   ?? '')
    setInstagramUrl(e.social_links?.instagram ?? '')
    setLinkedInUrl(e.social_links?.linkedin  ?? '')
    setWebsiteUrl(e.social_links?.website   ?? '')
    setDefaultLang(e.default_language ?? 'en-US')
    setIsActive(e.is_active        ?? true)
    setModel(e.model            ?? 'claude-haiku-4-5-20251001')
    setTone(v.tone                  ?? '')
    setVocabLevel(v.vocabulary_level      ?? '')
    setSentStyle(v.sentence_style        ?? '')
    setTradition(v.theological_tradition ?? '')
    setMission(e.mission_statement ?? '')
    setBoundaryText((e.boundaries ?? []).join('\n'))
    setExamples(e.example_outputs   ?? [])
  }, [author?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  function buildExt(overrides?: Partial<AuthorExtension>): AuthorExtension {
    return {
      ...rawExt,
      display_name:     displayName    || undefined,
      canonical_slug:   canonicalSlug  || undefined,
      avatar_asset_id:  avatarAssetId  ?? undefined,
      avatar_url:       avatarUrl      ?? undefined,
      social_links: {
        twitter:   twitterUrl   || undefined,
        instagram: instagramUrl || undefined,
        linkedin:  linkedinUrl  || undefined,
        website:   websiteUrl   || undefined,
      },
      default_language:  defaultLang,
      is_active:         isActive,
      model:             model || 'claude-haiku-4-5-20251001',
      voice_profile: {
        tone:                  tone       || undefined,
        vocabulary_level:      vocabLevel || undefined,
        sentence_style:        sentStyle  || undefined,
        theological_tradition: tradition  || undefined,
      },
      mission_statement: mission      || undefined,
      boundaries:        boundaryText ? boundaryText.split('\n').map(s => s.trim()).filter(Boolean) : [],
      example_outputs:   examples.length > 0 ? examples : undefined,
      ...overrides,
    }
  }

  function saveProfile() {
    if (!author) return
    updateContent.mutate({ id: author.id, data: { extension_data: buildExt() as Record<string, unknown> } })
  }

  function handleDisplayNameBlur() {
    if (!canonicalSlug && displayName) setCanonicalSlug(toSlug(displayName))
    saveProfile()
  }

  function handleAvatarChange(assetId: string, publicUrl: string) {
    setAvatarAssetId(assetId)
    setAvatarUrl(publicUrl)
    if (!author) return
    updateContent.mutate({
      id: author.id,
      data: { extension_data: buildExt({ avatar_asset_id: assetId, avatar_url: publicUrl }) as Record<string, unknown> },
    })
  }

  const [showAddBio, setShowAddBio] = React.useState(false)
  const usedChannelKeys = bios.map(b => `${b.channel}:${b.language}`)

  const headerLabel = author
    ? rawExt.display_name || author.title || 'Author'
    : 'Author'

  if (!authorId) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
        No author selected
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden border-l bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-3 h-10 border-b bg-muted/30 shrink-0">
        <span className="text-xs font-semibold text-foreground truncate pr-2">{headerLabel}</span>
        <button onClick={onClose}
          className="text-muted-foreground hover:text-foreground transition-colors shrink-0" title="Close">
          <X size={14} />
        </button>
      </div>

      {/* Sections */}
      <div className="flex-1 overflow-y-auto">
        {!author ? (
          <div className="px-3 py-4 text-xs text-muted-foreground text-center">Loading…</div>
        ) : (
          <>
            {/* ── Section 1: Profile ──────────────────────────────────── */}
            <Section title="Profile">
              <div>
                <label className="text-[10px] text-muted-foreground block mb-0.5">Display name</label>
                <Input className="h-7 text-xs" value={displayName}
                  onChange={e => setDisplayName(e.target.value)}
                  onBlur={handleDisplayNameBlur}
                  placeholder={author.title ?? undefined} />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground block mb-0.5">Canonical slug</label>
                <Input className="h-7 text-xs font-mono" value={canonicalSlug}
                  onChange={e => setCanonicalSlug(e.target.value)}
                  onBlur={saveProfile} placeholder="e.g. john-doe" />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground block mb-1">Avatar</label>
                <AvatarPicker
                  value={avatarAssetId}
                  currentUrl={avatarUrl}
                  name={displayName || author.title || ''}
                  onChange={handleAvatarChange}
                  disabled={!isAdmin}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] text-muted-foreground block">Social links</label>
                {([
                  ['Twitter',   twitterUrl,   setTwitterUrl  ],
                  ['Instagram', instagramUrl, setInstagramUrl],
                  ['LinkedIn',  linkedinUrl,  setLinkedInUrl ],
                  ['Website',   websiteUrl,   setWebsiteUrl  ],
                ] as [string, string, (v: string) => void][]).map(([platform, value, setter]) => (
                  <div key={platform} className="flex items-center gap-1.5">
                    <span className="text-[10px] w-16 text-muted-foreground shrink-0">{platform}</span>
                    <Input className="h-6 text-[11px] flex-1" value={value}
                      onChange={e => setter(e.target.value)} onBlur={saveProfile}
                      placeholder="https://…" />
                  </div>
                ))}
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground block mb-0.5">Default language</label>
                <Select className="w-full h-7 text-xs" value={defaultLang}
                  onValueChange={v => { setDefaultLang(v); setTimeout(saveProfile, 0) }}
                  options={LANGUAGE_OPTS} />
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={isActive}
                  onChange={e => { setIsActive(e.target.checked); setTimeout(saveProfile, 0) }}
                  className="accent-primary" />
                <span className="text-xs">Active author</span>
              </label>
              <div>
                <label className="text-[10px] text-muted-foreground block mb-0.5">AI model</label>
                <Input className="h-7 text-xs font-mono" value={model}
                  onChange={e => setModel(e.target.value)} onBlur={saveProfile} />
              </div>
            </Section>

            {/* ── Section 2: Voice Configuration ───────────────────────── */}
            <Section title="Voice Configuration" defaultOpen={false}>
              <div>
                <label className="text-[10px] text-muted-foreground block mb-0.5">Tone</label>
                <Select className="w-full h-7 text-xs" value={tone}
                  onValueChange={v => { setTone(v); setTimeout(saveProfile, 0) }} options={TONE_OPTS} />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground block mb-0.5">Vocabulary level</label>
                <Select className="w-full h-7 text-xs" value={vocabLevel}
                  onValueChange={v => { setVocabLevel(v); setTimeout(saveProfile, 0) }} options={VOCAB_OPTS} />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground block mb-0.5">Sentence style</label>
                <Select className="w-full h-7 text-xs" value={sentStyle}
                  onValueChange={v => { setSentStyle(v); setTimeout(saveProfile, 0) }} options={STYLE_OPTS} />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground block mb-0.5">Theological tradition</label>
                <Select className="w-full h-7 text-xs" value={tradition}
                  onValueChange={v => { setTradition(v); setTimeout(saveProfile, 0) }} options={TRADITION_OPTS} />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground block mb-0.5">Mission statement</label>
                <textarea value={mission} onChange={e => setMission(e.target.value)}
                  onBlur={saveProfile} rows={3}
                  placeholder="Describe this author's purpose and calling…"
                  className="w-full text-xs border rounded px-2 py-1 bg-background focus:outline-none focus:ring-1 focus:ring-ring resize-none" />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground block mb-0.5">Boundaries (one per line)</label>
                <textarea value={boundaryText} onChange={e => setBoundaryText(e.target.value)}
                  onBlur={saveProfile} rows={3}
                  placeholder="Never provide medical advice"
                  className="w-full text-xs border rounded px-2 py-1 bg-background focus:outline-none focus:ring-1 focus:ring-ring resize-none font-mono" />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[10px] text-muted-foreground">Example outputs</label>
                  <Button size="sm" variant="ghost" className="h-5 text-[10px] px-2"
                    onClick={() => setExamples(p => [...p, { content_type: '', sample_text: '', context_note: '' }])}>
                    + Add
                  </Button>
                </div>
                {examples.map((ex, i) => (
                  <div key={i} className="border rounded p-2 space-y-1 bg-muted/20 mb-1.5">
                    <div className="flex items-center gap-1.5">
                      <Input className="h-6 text-xs flex-1" value={ex.content_type}
                        onChange={e => setExamples(p => p.map((x, j) => j === i ? { ...x, content_type: e.target.value } : x))}
                        onBlur={saveProfile} placeholder="Content type" />
                      <button type="button"
                        onClick={() => setExamples(p => p.filter((_, j) => j !== i))}
                        className="text-xs text-muted-foreground hover:text-destructive px-1">✕</button>
                    </div>
                    <textarea value={ex.sample_text}
                      onChange={e => setExamples(p => p.map((x, j) => j === i ? { ...x, sample_text: e.target.value } : x))}
                      onBlur={saveProfile} rows={2} placeholder="Sample output text…"
                      className="w-full text-xs border rounded px-2 py-1 bg-background focus:outline-none focus:ring-1 focus:ring-ring resize-none" />
                    <Input className="h-6 text-xs" value={ex.context_note ?? ''}
                      onChange={e => setExamples(p => p.map((x, j) => j === i ? { ...x, context_note: e.target.value } : x))}
                      onBlur={saveProfile} placeholder="Context note (optional)" />
                  </div>
                ))}
              </div>
            </Section>

            {/* ── Section 3: Channel Bios ───────────────────────────────── */}
            <Section title="Channel Bios">
              {bios.length === 0 && !showAddBio && (
                <p className="text-[11px] text-muted-foreground text-center py-2">
                  No bios yet.{isAdmin ? ' Click "+ Add Bio" to create one.' : ''}
                </p>
              )}
              <div className="space-y-1.5">
                {bios.map(bio => (
                  <BioRow key={bio.id} bio={bio} authorId={authorId!} isAdmin={isAdmin} />
                ))}
              </div>
              {showAddBio ? (
                <AddBioForm
                  authorId={authorId!}
                  usedChannelKeys={usedChannelKeys}
                  onDone={() => setShowAddBio(false)}
                />
              ) : isAdmin ? (
                <button type="button" onClick={() => setShowAddBio(true)}
                  className="w-full flex items-center justify-center gap-1.5 text-xs text-primary hover:text-primary/80 border-2 border-dashed border-muted rounded py-2 mt-1 transition-colors hover:border-primary/40">
                  <Plus size={11} /> Add Bio
                </button>
              ) : null}
            </Section>
          </>
        )}
      </div>
    </div>
  )
}
