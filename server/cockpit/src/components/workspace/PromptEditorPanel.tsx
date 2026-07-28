/**
 * PromptEditorPanel.tsx — Full Prompt Recipe Editor (Part 2 Section 5)
 *
 * Six collapsible sections:
 *   1. Identity & Metadata
 *   2. Author & Context Binding
 *   3. Prompt Instructions (Monaco editors)
 *   4. Variables
 *   5. Output Schema & Constraints
 *   6. Prompt Tree Assignments
 *
 * Action buttons: Save | Save & Close | Cancel | Test Generate
 */

import * as React from 'react'
import { X, Star, Loader2 } from 'lucide-react'
import { useCockpitStore }         from '../../hooks/useCockpitStore'
import { useContentObject, useUpdateContent, useCreateContent } from '../../hooks/useContent'
import { useAuthors }              from '../../hooks/useAuthors'
import { usePromptRecipeAssignments, useRemovePromptAssignment, useSetAssignmentPrimary } from '../../hooks/usePromptRecipeAssignments'
import { Badge }                   from '../ui/Badge'
import { Input }                   from '../ui/Input'
import { Textarea }                from '../ui/Textarea'
import { ScrollArea }              from '../ui/ScrollArea'
import { CollapsibleSection }      from './prompt-editor/CollapsibleSection'
import { TagInput }                from './prompt-editor/TagInput'
import { VariablesSection }        from './prompt-editor/VariablesSection'
import { PreviewModal }            from './prompt-editor/PreviewModal'
import { TestGenerateModal }       from './prompt-editor/TestGenerateModal'
import { TreePickerModal }         from './prompt-editor/TreePickerModal'
import type { PromptVariable }     from '../../types/content-objects'

// Lazy-load Monaco to keep the main bundle small
const MonacoEditor = React.lazy(() => import('@monaco-editor/react'))

// ── Form state shape ──────────────────────────────────────────────────────────

interface PromptFormState {
  title:                    string
  slug:                     string
  status:                   string
  target_content_type:      string
  description:              string
  system_prompt:            string
  user_template:            string
  author_id:                string
  applicable_site_ids:      string[]
  language_context:         string
  variables:                PromptVariable[]
  output_schema_text:       string
  max_length:               string
  min_length:               string
  required_scripture_count: string
  max_tokens:               string
  required_sections:        string[]
  forbidden_topics:         string[]
  post_processors:          string[]
}

const EMPTY_FORM: PromptFormState = {
  title:                    '',
  slug:                     '',
  status:                   'draft',
  target_content_type:      'article',
  description:              '',
  system_prompt:            '',
  user_template:            '',
  author_id:                '',
  applicable_site_ids:      [],
  language_context:         'en-US',
  variables:                [],
  output_schema_text:       '',
  max_length:               '',
  min_length:               '',
  required_scripture_count: '',
  max_tokens:               '',
  required_sections:        [],
  forbidden_topics:         [],
  post_processors:          [],
}

const POST_PROCESSOR_OPTIONS = [
  { value: 'scripture_validator',  label: 'Scripture Validator'  },
  { value: 'readability_scorer',   label: 'Readability Scorer'   },
  { value: 'seo_optimizer',        label: 'SEO Optimizer'        },
  { value: 'theological_checker',  label: 'Theological Checker'  },
  { value: 'tone_consistency',     label: 'Tone Consistency'     },
]

const TARGET_TYPE_OPTIONS = [
  { value: 'article',        label: 'Article'         },
  { value: 'prayer',         label: 'Prayer'          },
  { value: 'music',          label: 'Music'           },
  { value: 'radio_episode',  label: 'Radio Episode'   },
  { value: 'podcast',        label: 'Podcast'         },
  { value: 'social_snippet', label: 'Social Snippet'  },
]

const LANGUAGE_OPTIONS = [
  { value: 'en-US', label: 'English (US)'    },
  { value: 'es',    label: 'Spanish'         },
  { value: 'fr',    label: 'French'          },
  { value: 'de',    label: 'German'          },
  { value: 'pt',    label: 'Portuguese'      },
  { value: 'ko',    label: 'Korean'          },
  { value: 'zh',    label: 'Chinese'         },
]

// ── Helper: build form state from a loaded content object ─────────────────────

function itemToFormState(item: NonNullable<ReturnType<typeof useContentObject>['data']>): PromptFormState {
  const ext = (item.extension_data ?? {}) as Record<string, unknown>
  const constraints = (ext.constraints ?? {}) as Record<string, unknown>
  return {
    title:                    item.title ?? '',
    slug:                     item.slug ?? '',
    status:                   item.status ?? 'draft',
    target_content_type:      (ext.target_content_type as string) ?? 'article',
    description:              item.summary ?? '',
    system_prompt:            (ext.system_prompt as string) ?? '',
    user_template:            (ext.user_template as string) ?? '',
    author_id:                (ext.author_id as string) ?? '',
    applicable_site_ids:      (ext.applicable_site_ids as string[]) ?? [],
    language_context:         (ext.language_context as string) ?? (item.language ?? 'en-US'),
    variables:                (ext.variables as PromptVariable[]) ?? [],
    output_schema_text:       ext.output_schema ? JSON.stringify(ext.output_schema, null, 2) : '',
    max_length:               String(constraints.max_length ?? ''),
    min_length:               String(constraints.min_length ?? ''),
    required_scripture_count: String(constraints.required_scripture_count ?? ''),
    max_tokens:               String(ext.max_tokens ?? ''),
    required_sections:        (constraints.required_sections as string[]) ?? [],
    forbidden_topics:         (constraints.forbidden_topics as string[]) ?? [],
    post_processors:          (ext.post_processors as string[]) ?? [],
  }
}

// ── Helper: slugify a title ───────────────────────────────────────────────────

function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

// ── Helper: form state → extension_data ──────────────────────────────────────

function buildExtensionData(f: PromptFormState): Record<string, unknown> {
  const constraints: Record<string, unknown> = {}
  if (f.max_length)               constraints.max_length               = Number(f.max_length)
  if (f.min_length)               constraints.min_length               = Number(f.min_length)
  if (f.required_scripture_count) constraints.required_scripture_count = Number(f.required_scripture_count)
  if (f.required_sections.length) constraints.required_sections        = f.required_sections
  if (f.forbidden_topics.length)  constraints.forbidden_topics         = f.forbidden_topics

  const ext: Record<string, unknown> = {
    system_prompt:       f.system_prompt,
    user_template:       f.user_template,
    target_content_type: f.target_content_type,
  }
  if (f.max_tokens)                  ext.max_tokens            = Number(f.max_tokens)
  if (f.variables.length)            ext.variables             = f.variables
  if (f.applicable_site_ids.length)  ext.applicable_site_ids   = f.applicable_site_ids
  if (f.language_context)            ext.language_context      = f.language_context
  if (f.author_id)                   ext.author_id             = f.author_id
  if (f.post_processors.length)      ext.post_processors       = f.post_processors
  if (Object.keys(constraints).length) ext.constraints         = constraints

  if (f.output_schema_text.trim()) {
    try { ext.output_schema = JSON.parse(f.output_schema_text) } catch { /* invalid JSON — caller validates */ }
  }

  return ext
}

// ── Label helper ─────────────────────────────────────────────────────────────

function Label({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="block text-xs font-medium text-muted-foreground mb-1">
      {children}{required && <span className="text-destructive ml-0.5">*</span>}
    </label>
  )
}

// ── Monaco placeholder while loading ─────────────────────────────────────────

function MonacoFallback({ height }: { height: string }) {
  return <div className="rounded border bg-muted animate-pulse" style={{ height }} />
}

// ── Main component ────────────────────────────────────────────────────────────

export function PromptEditorPanel() {
  const selectedObjectId    = useCockpitStore(s => s.selectedObjectId)
  const setSelectedObjectId = useCockpitStore(s => s.setSelectedObjectId)

  const isNew = selectedObjectId === 'new'

  const { data: item, isLoading } = useContentObject(isNew ? null : selectedObjectId)
  const updateContent = useUpdateContent()
  const createContent = useCreateContent()

  const { data: authorsData } = useAuthors()
  const authors = authorsData?.authors ?? []

  const { data: assignmentsData } = usePromptRecipeAssignments(isNew ? null : selectedObjectId)
  const assignments = assignmentsData?.assignments ?? []

  const removeAssignment  = useRemovePromptAssignment()
  const setPrimaryAssign  = useSetAssignmentPrimary()

  // ── Form state ──────────────────────────────────────────────────────────────
  const [formState, setFormState]       = React.useState<PromptFormState>(EMPTY_FORM)
  const [initialFormState, setInitial]  = React.useState<PromptFormState>(EMPTY_FORM)
  const [slugManual, setSlugManual]     = React.useState(false)
  const [schemaError, setSchemaError]   = React.useState<string | null>(null)
  const [saveStatus, setSaveStatus]     = React.useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [validationErrors, setValidationErrors] = React.useState<string[]>([])

  // ── Modal states ────────────────────────────────────────────────────────────
  const [previewOpen, setPreviewOpen]   = React.useState(false)
  const [testOpen, setTestOpen]         = React.useState(false)
  const [treePickerOpen, setTreePickerOpen] = React.useState(false)

  // ── Load item into form state ───────────────────────────────────────────────
  React.useEffect(() => {
    if (item) {
      const state = itemToFormState(item)
      setFormState(state)
      setInitial(state)
      setSlugManual(true) // treat loaded slug as manually set
      setSchemaError(null)
      setValidationErrors([])
    } else if (isNew) {
      setFormState(EMPTY_FORM)
      setInitial(EMPTY_FORM)
      setSlugManual(false)
    }
  }, [item, isNew])

  const isDirty = JSON.stringify(formState) !== JSON.stringify(initialFormState)

  function set<K extends keyof PromptFormState>(key: K, value: PromptFormState[K]) {
    setFormState(s => ({ ...s, [key]: value }))
  }

  // Auto-generate slug from title if not manually edited
  function handleTitleBlur() {
    if (!slugManual && formState.title) {
      set('slug', slugify(formState.title))
    }
  }

  // ── Validation ──────────────────────────────────────────────────────────────
  function validate(): string[] {
    const errors: string[] = []
    if (formState.title.trim().length < 3)    errors.push('Prompt Name must be at least 3 characters')
    if (!formState.slug.trim())               errors.push('Slug is required')
    if (!formState.status)                    errors.push('Status is required')
    if (!formState.target_content_type)       errors.push('Target Content Type is required')
    if (!formState.system_prompt.trim())      errors.push('System Prompt is required')
    if (formState.output_schema_text.trim()) {
      try { JSON.parse(formState.output_schema_text) }
      catch { errors.push('Output Schema contains invalid JSON') }
    }
    return errors
  }

  // ── Save ────────────────────────────────────────────────────────────────────
  async function handleSave(): Promise<boolean> {
    const errors = validate()
    if (errors.length) { setValidationErrors(errors); return false }
    setValidationErrors([])
    setSaveStatus('saving')

    const extension_data = buildExtensionData(formState)
    const payload = {
      title:          formState.title,
      slug:           formState.slug,
      status:         formState.status as 'draft' | 'published' | 'archived' | 'review',
      extension_data,
      change_summary: 'Prompt editor save',
      ...(formState.description ? { summary: formState.description } : {}),
    }

    try {
      if (isNew) {
        await createContent.mutateAsync({
          object_type: 'prompt_recipe',
          title:       formState.title,
          slug:        formState.slug,
          status:      formState.status as 'draft',
          language:    formState.language_context || 'en-US',
          extension_data,
        })
      } else {
        await updateContent.mutateAsync({ id: selectedObjectId!, data: payload })
      }
      setInitial(formState)
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus('idle'), 3000)
      return true
    } catch (e: unknown) {
      setSaveStatus('error')
      setTimeout(() => setSaveStatus('idle'), 5000)
      return false
    }
  }

  async function handleSaveClose() {
    const ok = await handleSave()
    if (ok) setSelectedObjectId(null)
  }

  function handleCancel() {
    if (isDirty && !confirm('Discard unsaved changes?')) return
    setSelectedObjectId(null)
  }

  // ── Validate JSON button ────────────────────────────────────────────────────
  function handleValidateJson() {
    if (!formState.output_schema_text.trim()) { setSchemaError(null); return }
    try { JSON.parse(formState.output_schema_text); setSchemaError(null) }
    catch (e: unknown) { setSchemaError((e as Error).message) }
  }

  // ── Loading / empty state ───────────────────────────────────────────────────
  if (!isNew && isLoading) {
    return (
      <div className="flex flex-col h-full">
        <PanelHeader title="Loading…" onClose={() => setSelectedObjectId(null)} />
        <div className="flex-1 flex items-center justify-center">
          <Loader2 size={20} className="animate-spin text-muted-foreground" />
        </div>
      </div>
    )
  }

  const version = item?.version ?? null

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <PanelHeader
        title={isNew ? 'New Prompt' : (formState.title || 'Prompt Editor')}
        version={version}
        onClose={() => setSelectedObjectId(null)}
      />

      {/* Validation errors */}
      {validationErrors.length > 0 && (
        <div className="px-4 py-2 bg-destructive/10 border-b border-destructive/20">
          {validationErrors.map(e => (
            <p key={e} className="text-xs text-destructive">{e}</p>
          ))}
        </div>
      )}

      {/* Scrollable sections */}
      <ScrollArea className="flex-1">

        {/* 1. Identity & Metadata */}
        <CollapsibleSection title="Identity & Metadata">
          <div>
            <Label required>Prompt Name</Label>
            <Input
              value={formState.title}
              onChange={e => set('title', e.target.value)}
              onBlur={handleTitleBlur}
              placeholder="e.g. Devotional Article Writer"
            />
          </div>
          <div>
            <Label required>Slug</Label>
            <Input
              value={formState.slug}
              onChange={e => { setSlugManual(true); set('slug', e.target.value) }}
              placeholder="devotional-article-writer"
              className="font-mono text-xs"
            />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <Label required>Status</Label>
              <select
                value={formState.status}
                onChange={e => set('status', e.target.value)}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="published">Published</option>
                <option value="draft">Draft</option>
                <option value="deprecated">Deprecated</option>
                <option value="archived">Archived</option>
              </select>
            </div>
            {version !== null && (
              <div className="shrink-0">
                <Label>Version</Label>
                <div className="h-9 flex items-center">
                  <Badge variant="secondary">v{version}</Badge>
                </div>
              </div>
            )}
          </div>
          <div>
            <Label required>Target Content Type</Label>
            <select
              value={formState.target_content_type}
              onChange={e => set('target_content_type', e.target.value)}
              className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {TARGET_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <Label>Description</Label>
            <Textarea
              rows={3}
              value={formState.description}
              onChange={e => set('description', e.target.value)}
              placeholder="Internal notes about when and how to use this prompt…"
            />
          </div>
        </CollapsibleSection>

        {/* 2. Author & Context Binding */}
        <CollapsibleSection title="Author & Context Binding">
          <div>
            <Label>Default Author</Label>
            <select
              value={formState.author_id}
              onChange={e => set('author_id', e.target.value)}
              className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">— None —</option>
              {authors.map(p => (
                <option key={p.id} value={p.id}>{p.title ?? p.id}</option>
              ))}
            </select>
          </div>
          <div>
            <Label>Applicable Sites</Label>
            <TagInput
              value={formState.applicable_site_ids}
              onChange={v => set('applicable_site_ids', v)}
              placeholder="Add site ID…"
            />
          </div>
          <div>
            <Label>Language Context</Label>
            <select
              value={formState.language_context}
              onChange={e => set('language_context', e.target.value)}
              className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {LANGUAGE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <Label>Audience Scope</Label>
            <p className="text-xs text-muted-foreground italic">Coming soon</p>
          </div>
        </CollapsibleSection>

        {/* 3. Prompt Instructions */}
        <CollapsibleSection title="Prompt Instructions">
          <div>
            <Label required>System Prompt</Label>
            <React.Suspense fallback={<MonacoFallback height="200px" />}>
              <MonacoEditor
                height="200px"
                defaultLanguage="plaintext"
                value={formState.system_prompt}
                onChange={val => set('system_prompt', val ?? '')}
                theme="vs-dark"
                options={{
                  wordWrap: 'on',
                  minimap: { enabled: false },
                  lineNumbers: 'on',
                  fontSize: 12,
                  fontFamily: "'Fira Code', 'Cascadia Code', monospace",
                  scrollBeyondLastLine: false,
                  renderLineHighlight: 'none',
                }}
              />
            </React.Suspense>
          </div>
          <div>
            <Label>User Template</Label>
            <React.Suspense fallback={<MonacoFallback height="200px" />}>
              <MonacoEditor
                height="200px"
                defaultLanguage="plaintext"
                value={formState.user_template}
                onChange={val => set('user_template', val ?? '')}
                theme="vs-dark"
                options={{
                  wordWrap: 'on',
                  minimap: { enabled: false },
                  lineNumbers: 'on',
                  fontSize: 12,
                  fontFamily: "'Fira Code', 'Cascadia Code', monospace",
                  scrollBeyondLastLine: false,
                  renderLineHighlight: 'none',
                }}
              />
            </React.Suspense>
          </div>
          <button
            type="button"
            onClick={() => setPreviewOpen(true)}
            className="rounded border px-3 py-1.5 text-xs hover:bg-muted"
          >
            Preview Assembled Prompt
          </button>
        </CollapsibleSection>

        {/* 4. Variables */}
        <CollapsibleSection title="Variables">
          <VariablesSection
            variables={formState.variables}
            onChange={v => set('variables', v)}
          />
        </CollapsibleSection>

        {/* 5. Output Schema & Constraints */}
        <CollapsibleSection title="Output Schema & Constraints">
          <div>
            <Label>Output Schema (JSON)</Label>
            <React.Suspense fallback={<MonacoFallback height="150px" />}>
              <MonacoEditor
                height="150px"
                defaultLanguage="json"
                value={formState.output_schema_text}
                onChange={val => { set('output_schema_text', val ?? ''); setSchemaError(null) }}
                theme="vs-dark"
                options={{
                  wordWrap: 'on',
                  minimap: { enabled: false },
                  lineNumbers: 'on',
                  fontSize: 12,
                  fontFamily: "'Fira Code', 'Cascadia Code', monospace",
                  scrollBeyondLastLine: false,
                }}
              />
            </React.Suspense>
            <button
              type="button"
              onClick={handleValidateJson}
              className="mt-1.5 rounded border px-2 py-1 text-xs hover:bg-muted"
            >
              Validate JSON
            </button>
            {schemaError && (
              <p className="mt-1 text-xs text-destructive">{schemaError}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Max Length (words)</Label>
              <Input type="number" min={0} value={formState.max_length}
                onChange={e => set('max_length', e.target.value)} placeholder="1200" />
            </div>
            <div>
              <Label>Min Length (words)</Label>
              <Input type="number" min={0} value={formState.min_length}
                onChange={e => set('min_length', e.target.value)} placeholder="400" />
            </div>
            <div>
              <Label>Min Scripture Citations</Label>
              <Input type="number" min={0} value={formState.required_scripture_count}
                onChange={e => set('required_scripture_count', e.target.value)} placeholder="0" />
            </div>
            <div>
              <Label>Max Tokens</Label>
              <Input type="number" min={100} value={formState.max_tokens}
                onChange={e => set('max_tokens', e.target.value)} placeholder="3000" />
            </div>
          </div>

          <div>
            <Label>Required Sections</Label>
            <TagInput value={formState.required_sections}
              onChange={v => set('required_sections', v)} placeholder="verse, chorus…" />
          </div>
          <div>
            <Label>Forbidden Topics</Label>
            <TagInput value={formState.forbidden_topics}
              onChange={v => set('forbidden_topics', v)} placeholder="Add topic…" />
          </div>

          <div>
            <Label>Post-Processors</Label>
            <div className="space-y-1.5">
              {POST_PROCESSOR_OPTIONS.map(opt => (
                <label key={opt.value} className="flex items-center gap-2 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formState.post_processors.includes(opt.value)}
                    onChange={e => {
                      const next = e.target.checked
                        ? [...formState.post_processors, opt.value]
                        : formState.post_processors.filter(p => p !== opt.value)
                      set('post_processors', next)
                    }}
                    className="rounded"
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>
        </CollapsibleSection>

        {/* 6. Prompt Tree Assignments */}
        <CollapsibleSection title="Prompt Tree Assignments">
          <div className="flex flex-wrap gap-1.5">
            {assignments.length === 0 && (
              <p className="text-xs text-muted-foreground">No assignments yet.</p>
            )}
            {assignments.map(a => (
              <span
                key={a.id}
                className="inline-flex items-center gap-1 rounded-full border bg-secondary px-2 py-0.5 text-xs"
              >
                <button
                  type="button"
                  title={a.is_primary ? 'Primary (click to reassign)' : 'Set as primary'}
                  onClick={() => {
                    if (!a.is_primary) {
                      setPrimaryAssign.mutate({ id: a.id, promptId: selectedObjectId! })
                    }
                  }}
                  className={a.is_primary ? 'text-amber-500' : 'text-muted-foreground hover:text-amber-400'}
                >
                  <Star size={10} fill={a.is_primary ? 'currentColor' : 'none'} />
                </button>
                <span>{a.node_title}</span>
                <button
                  type="button"
                  onClick={() => {
                    if (!confirm(`Remove assignment to "${a.node_title}"?`)) return
                    removeAssignment.mutate({ id: a.id, promptId: selectedObjectId! })
                  }}
                  className="opacity-50 hover:opacity-100 text-muted-foreground hover:text-destructive"
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
          {!isNew && (
            <button
              type="button"
              onClick={() => setTreePickerOpen(true)}
              className="mt-2 flex items-center gap-1 rounded border px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              + Assign to Node
            </button>
          )}
          {isNew && (
            <p className="text-xs text-muted-foreground italic">Save the prompt first to assign it to nodes.</p>
          )}
        </CollapsibleSection>

      </ScrollArea>

      {/* Footer action buttons */}
      <div className="shrink-0 border-t px-4 py-3 flex items-center gap-2 bg-background">
        <button
          type="button"
          onClick={handleSave}
          disabled={saveStatus === 'saving'}
          className="flex items-center gap-1.5 rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
        >
          {saveStatus === 'saving' && <Loader2 size={12} className="animate-spin" />}
          {saveStatus === 'saved' ? 'Saved ✓' : 'Save'}
        </button>
        <button
          type="button"
          onClick={handleSaveClose}
          disabled={saveStatus === 'saving'}
          className="rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
        >
          Save &amp; Close
        </button>
        <button
          type="button"
          onClick={handleCancel}
          className="rounded border px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => setTestOpen(true)}
          className="ml-auto rounded border px-3 py-1.5 text-xs hover:bg-muted"
        >
          Test Generate
        </button>
      </div>

      {/* Save error message */}
      {saveStatus === 'error' && (
        <p className="px-4 pb-2 text-xs text-destructive">Save failed. Please try again.</p>
      )}

      {/* Modals */}
      <PreviewModal
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        systemPrompt={formState.system_prompt}
        userTemplate={formState.user_template}
        variables={formState.variables}
      />

      <TestGenerateModal
        open={testOpen}
        onClose={() => setTestOpen(false)}
        systemPrompt={formState.system_prompt}
        userTemplate={formState.user_template}
        variables={formState.variables}
        model="claude-haiku-4-5-20251001"
        maxTokens={Number(formState.max_tokens) || 500}
      />

      {!isNew && selectedObjectId && (
        <TreePickerModal
          open={treePickerOpen}
          onClose={() => setTreePickerOpen(false)}
          promptId={selectedObjectId}
          existingNodeIds={assignments.map(a => a.prompt_nav_node_id)}
        />
      )}
    </div>
  )
}

// ── Panel header sub-component ────────────────────────────────────────────────

function PanelHeader({
  title,
  version,
  onClose,
}: {
  title: string
  version?: number | null
  onClose: () => void
}) {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-sm font-semibold truncate">{title}</span>
        {version !== null && version !== undefined && (
          <Badge variant="secondary" className="text-xs shrink-0">v{version}</Badge>
        )}
      </div>
      <button
        type="button"
        onClick={onClose}
        className="h-7 w-7 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground shrink-0"
      >
        <X size={16} />
      </button>
    </div>
  )
}
