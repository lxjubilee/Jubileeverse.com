/**
 * AutomationTemplatesPanel.tsx — Job templates list + editor for the Automation workspace
 *
 * Rendered as the "Templates" tab inside AutomationJobsPanel.
 * Admin users can create, edit, delete, and apply templates.
 * Non-admin users can view templates and apply them (dispatch jobs).
 */

import * as React from 'react'
import { Plus, Pencil, Trash2, Play, X } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { ScrollArea } from '../ui/ScrollArea'
import { useContentList } from '../../hooks/useContent'
import {
  useAutomationJobTemplates,
  useCreateAutomationJobTemplate,
  useUpdateAutomationJobTemplate,
  useDeleteAutomationJobTemplate,
  useApplyAutomationJobTemplate,
} from '../../hooks/useAutomationJobTemplates'
import type { AutomationJobTemplate } from '../../lib/api'

// ── Apply modal ───────────────────────────────────────────────────────────────

interface ApplyModalProps {
  template: AutomationJobTemplate
  onClose: () => void
}

function ApplyModal({ template, onClose }: ApplyModalProps) {
  const apply = useApplyAutomationJobTemplate()
  const [nodeInput, setNodeInput] = React.useState('')
  const [quantity, setQuantity] = React.useState(template.default_quantity)
  const [priority, setPriority] = React.useState(template.default_priority)
  const [jobName, setJobName] = React.useState(template.template_name)
  const [applying, setApplying] = React.useState(false)
  const [result, setResult] = React.useState<{ count: number } | null>(null)

  async function handleApply() {
    setApplying(true)
    try {
      const nodeIds = nodeInput
        .split(',')
        .map(s => Number(s.trim()))
        .filter(n => !isNaN(n) && n > 0)
      const res = await apply.mutateAsync({
        id: template.id,
        data: {
          taxonomy_node_ids: nodeIds.length ? nodeIds : undefined,
          job_name: jobName || undefined,
          overrides: { quantity, priority },
        },
      })
      setResult({ count: res.count })
    } finally {
      setApplying(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-background border rounded-lg shadow-xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <span className="font-semibold text-sm">Apply Template — {template.template_name}</span>
          <button onClick={onClose} className="h-6 w-6 flex items-center justify-center rounded hover:bg-muted">
            <X size={14} />
          </button>
        </div>

        {result ? (
          <div className="px-4 py-6 text-center">
            <p className="text-sm font-medium text-green-700">
              {result.count} job{result.count !== 1 ? 's' : ''} created successfully.
            </p>
            <button
              onClick={onClose}
              className="mt-4 px-4 py-2 rounded-md text-sm bg-primary text-primary-foreground hover:bg-primary/90"
            >
              Close
            </button>
          </div>
        ) : (
          <div className="px-4 py-4 space-y-3">
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Job Name</label>
              <input
                className="w-full rounded border px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                value={jobName}
                onChange={e => setJobName(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">
                Taxonomy Node IDs{' '}
                <span className="font-normal">(comma-separated; leave blank for no node filter)</span>
              </label>
              <input
                className="w-full rounded border px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                value={nodeInput}
                onChange={e => setNodeInput(e.target.value)}
                placeholder="e.g. 64166, 64148"
              />
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-xs text-muted-foreground mb-1">Quantity</label>
                <input
                  type="number"
                  min={1}
                  max={100}
                  className="w-full rounded border px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  value={quantity}
                  onChange={e => setQuantity(Math.max(1, Math.min(100, Number(e.target.value))))}
                />
              </div>
              <div className="flex-1">
                <label className="block text-xs text-muted-foreground mb-1">Priority</label>
                <select
                  className="w-full rounded border px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  value={priority}
                  onChange={e => setPriority(Number(e.target.value))}
                >
                  <option value={1}>1 — Critical</option>
                  <option value={2}>2 — High</option>
                  <option value={3}>3 — Normal</option>
                  <option value={4}>4 — Low</option>
                  <option value={5}>5 — Background</option>
                </select>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button onClick={onClose} className="px-3 py-1.5 rounded-md text-xs border hover:bg-muted">
                Cancel
              </button>
              <button
                onClick={handleApply}
                disabled={applying}
                className="px-3 py-1.5 rounded-md text-xs bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {applying ? 'Creating jobs…' : 'Create Jobs'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Template edit form ────────────────────────────────────────────────────────

interface TemplateFormProps {
  template: AutomationJobTemplate | null   // null = new
  onClose: () => void
}

function TemplateForm({ template, onClose }: TemplateFormProps) {
  const isNew = !template

  const [name, setName] = React.useState(template?.template_name ?? '')
  const [contentType, setContentType] = React.useState(template?.target_content_type ?? 'article')
  const [promptId, setPromptId] = React.useState(template?.prompt_id ?? '')
  const [quantity, setQuantity] = React.useState(template?.default_quantity ?? 1)
  const [priority, setPriority] = React.useState(template?.default_priority ?? 3)
  const [description, setDescription] = React.useState(template?.description ?? '')
  const [isActive, setIsActive] = React.useState(template?.is_active ?? true)
  const [saving, setSaving] = React.useState(false)

  const createTemplate = useCreateAutomationJobTemplate()
  const updateTemplate = useUpdateAutomationJobTemplate()

  const { data: recipesData } = useContentList({ type: 'prompt_recipe', status: 'published', limit: 200 })
  const recipes = recipesData?.items ?? []

  async function handleSave() {
    if (!name.trim()) { alert('Template name is required.'); return }
    setSaving(true)
    try {
      const payload = {
        template_name:        name,
        target_content_type:  contentType,
        prompt_id:            promptId || null,
        default_quantity:     quantity,
        default_priority:     priority,
        description:          description || null,
        is_active:            isActive,
      }
      if (isNew) {
        await createTemplate.mutateAsync({ ...payload, template_name: name })
      } else {
        await updateTemplate.mutateAsync({ id: template.id, data: payload })
      }
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-background border rounded-lg shadow-xl w-full max-w-lg mx-4">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <span className="font-semibold text-sm">{isNew ? 'New Template' : 'Edit Template'}</span>
          <button onClick={onClose} className="h-6 w-6 flex items-center justify-center rounded hover:bg-muted">
            <X size={14} />
          </button>
        </div>
        <div className="px-4 py-4 space-y-3">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Template Name *</label>
            <input
              className="w-full rounded border px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Weekly Article Batch"
            />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-muted-foreground mb-1">Content Type</label>
              <select
                className="w-full rounded border px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                value={contentType}
                onChange={e => setContentType(e.target.value)}
              >
                <option value="article">Article</option>
                <option value="prayer">Prayer</option>
                <option value="music">Music</option>
                <option value="radio_episode">Radio Episode</option>
                <option value="podcast">Podcast</option>
                <option value="social_snippet">Social Snippet</option>
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-xs text-muted-foreground mb-1">Default Prompt</label>
              <select
                className="w-full rounded border px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                value={promptId}
                onChange={e => setPromptId(e.target.value)}
              >
                <option value="">— None —</option>
                {recipes.map(r => (
                  <option key={r.id} value={r.id}>{r.title}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-muted-foreground mb-1">Default Quantity</label>
              <input
                type="number"
                min={1}
                max={100}
                className="w-full rounded border px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                value={quantity}
                onChange={e => setQuantity(Math.max(1, Math.min(100, Number(e.target.value))))}
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-muted-foreground mb-1">Default Priority</label>
              <select
                className="w-full rounded border px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                value={priority}
                onChange={e => setPriority(Number(e.target.value))}
              >
                <option value={1}>1 — Critical</option>
                <option value={2}>2 — High</option>
                <option value={3}>3 — Normal</option>
                <option value={4}>4 — Low</option>
                <option value={5}>5 — Background</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Description</label>
            <textarea
              rows={2}
              className="w-full rounded border px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary resize-none"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Optional description"
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="is_active_chk"
              checked={isActive}
              onChange={e => setIsActive(e.target.checked)}
              className="h-4 w-4"
            />
            <label htmlFor="is_active_chk" className="text-sm cursor-pointer">Active</label>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t">
          <button onClick={onClose} className="px-3 py-1.5 rounded-md text-xs border hover:bg-muted">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-3 py-1.5 rounded-md text-xs bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save Template'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface AutomationTemplatesPanelProps {
  isAdmin: boolean
  selectedNodeId: string | null
}

export function AutomationTemplatesPanel({ isAdmin, selectedNodeId }: AutomationTemplatesPanelProps) {
  const [showInactive, setShowInactive] = React.useState(false)
  const [editingTemplate, setEditingTemplate] = React.useState<AutomationJobTemplate | null | 'new'>()
  const [applyingTemplate, setApplyingTemplate] = React.useState<AutomationJobTemplate | null>(null)

  const deleteTemplate = useDeleteAutomationJobTemplate()

  const { data, isLoading } = useAutomationJobTemplates({
    node_id:     selectedNodeId ?? undefined,
    active_only: !showInactive,
  })
  const templates = data?.templates ?? []

  async function handleDelete(t: AutomationJobTemplate) {
    if (!confirm(`Delete template "${t.template_name}"?`)) return
    await deleteTemplate.mutateAsync(t.id)
  }

  return (
    <>
      {/* New Template modal */}
      {editingTemplate === 'new' && (
        <TemplateForm template={null} onClose={() => setEditingTemplate(undefined)} />
      )}
      {editingTemplate && editingTemplate !== 'new' && (
        <TemplateForm template={editingTemplate} onClose={() => setEditingTemplate(undefined)} />
      )}
      {applyingTemplate && (
        <ApplyModal template={applyingTemplate} onClose={() => setApplyingTemplate(null)} />
      )}

      <div className="flex flex-col h-full">
        {/* Toolbar */}
        <div className="flex items-center justify-between px-4 py-2 border-b gap-3">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold">Templates</span>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={showInactive}
                onChange={e => setShowInactive(e.target.checked)}
                className="h-3.5 w-3.5"
              />
              Show inactive
            </label>
          </div>
          {isAdmin && (
            <button
              onClick={() => setEditingTemplate('new')}
              className="flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 shrink-0"
            >
              <Plus size={12} />
              New Template
            </button>
          )}
        </div>

        {/* List */}
        <ScrollArea className="flex-1">
          {isLoading ? (
            <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
              Loading…
            </div>
          ) : templates.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
              {isAdmin ? 'No templates. Click "New Template" to create one.' : 'No templates available.'}
            </div>
          ) : (
            <table className="w-full text-sm" style={{ tableLayout: 'fixed' }}>
              <thead className="sticky top-0 bg-background z-10">
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="text-left py-2 px-2 font-medium" style={{ width: 'auto' }}>Name</th>
                  <th className="text-left py-2 px-2 font-medium" style={{ width: '110px' }}>Type</th>
                  <th className="text-left py-2 px-2 font-medium" style={{ width: '160px' }}>Prompt</th>
                  <th className="text-left py-2 px-2 font-medium" style={{ width: '70px' }}>Qty</th>
                  <th className="text-left py-2 px-2 font-medium" style={{ width: '80px' }}>Priority</th>
                  <th className="text-left py-2 px-2 font-medium" style={{ width: '70px' }}>Status</th>
                  <th className="text-left py-2 px-2 font-medium" style={{ width: isAdmin ? '100px' : '60px' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {templates.map(t => (
                  <tr key={t.id} className="border-b hover:bg-muted/40">
                    <td className="py-2 px-2">
                      <div className="font-medium text-sm truncate">{t.template_name}</div>
                      {t.description && (
                        <div className="text-xs text-muted-foreground truncate">{t.description}</div>
                      )}
                    </td>
                    <td className="py-2 px-2">
                      <Badge variant="outline">{t.target_content_type}</Badge>
                    </td>
                    <td className="py-2 px-2 text-xs text-muted-foreground truncate">
                      {t.prompt_name ?? '—'}
                    </td>
                    <td className="py-2 px-2 text-xs text-muted-foreground">{t.default_quantity}</td>
                    <td className="py-2 px-2 text-xs text-muted-foreground">{t.default_priority}</td>
                    <td className="py-2 px-2">
                      {t.is_active
                        ? <Badge variant="success">Active</Badge>
                        : <Badge variant="secondary">Inactive</Badge>
                      }
                    </td>
                    <td className="py-2 px-2">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setApplyingTemplate(t)}
                          title="Apply template (create jobs)"
                          className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                          disabled={!t.is_active}
                        >
                          <Play size={12} />
                        </button>
                        {isAdmin && (
                          <>
                            <button
                              onClick={() => setEditingTemplate(t)}
                              title="Edit template"
                              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                            >
                              <Pencil size={12} />
                            </button>
                            <button
                              onClick={() => handleDelete(t)}
                              title="Delete template"
                              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-destructive"
                            >
                              <Trash2 size={12} />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </ScrollArea>
      </div>
    </>
  )
}
