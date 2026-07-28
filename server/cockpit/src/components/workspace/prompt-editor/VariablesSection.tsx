/**
 * VariablesSection.tsx — Repeatable variable rows for prompt recipes
 *
 * Each row: Name | Source | Required | Default | Description | ↑↓ | Trash
 */

import { Plus, Trash2, ChevronUp, ChevronDown } from 'lucide-react'
import { Input } from '../../ui/Input'
import { Switch } from '../../ui/Switch'
import type { PromptVariable } from '../../../types/content-objects'

interface VariablesSectionProps {
  variables: PromptVariable[]
  onChange: (vars: PromptVariable[]) => void
}

const SOURCE_OPTIONS: { value: PromptVariable['source']; label: string }[] = [
  { value: 'editor_input',     label: 'Editor Input'     },
  { value: 'taxonomy_context', label: 'Taxonomy Context' },
  { value: 'author_profile',   label: 'Author Profile'   },
  { value: 'system_computed',  label: 'System Computed'  },
  { value: 'job_parameter',    label: 'Job Parameter'    },
]

export function VariablesSection({ variables, onChange }: VariablesSectionProps) {
  function update(index: number, patch: Partial<PromptVariable>) {
    const next = variables.map((v, i) => (i === index ? { ...v, ...patch } : v))
    onChange(next)
  }

  function remove(index: number) {
    if (!confirm(`Remove variable "${variables[index].name || '(unnamed)'}"?`)) return
    onChange(variables.filter((_, i) => i !== index))
  }

  function moveUp(index: number) {
    if (index === 0) return
    const next = [...variables]
    ;[next[index - 1], next[index]] = [next[index], next[index - 1]]
    onChange(next)
  }

  function moveDown(index: number) {
    if (index === variables.length - 1) return
    const next = [...variables]
    ;[next[index], next[index + 1]] = [next[index + 1], next[index]]
    onChange(next)
  }

  function addVariable() {
    onChange([...variables, { name: '', source: 'editor_input', required: false }])
  }

  return (
    <div className="space-y-2">
      {variables.length === 0 && (
        <p className="text-xs text-muted-foreground py-1">No variables defined.</p>
      )}
      {variables.map((variable, index) => (
        <div key={index} className="rounded-md border bg-muted/20 p-2 space-y-2">
          {/* Row 1: Name + Source + Required */}
          <div className="flex items-center gap-2">
            <Input
              placeholder="variable_name"
              value={variable.name}
              onChange={e => update(index, { name: e.target.value })}
              className="flex-1 h-7 text-xs font-mono"
            />
            <select
              value={variable.source}
              onChange={e => update(index, { source: e.target.value as PromptVariable['source'] })}
              className="h-7 rounded border border-input bg-background px-1 text-xs"
            >
              {SOURCE_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <label className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
              <Switch
                checked={variable.required}
                onCheckedChange={v => update(index, { required: v })}
              />
              Req
            </label>
          </div>
          {/* Row 2: Default + Description */}
          <div className="flex items-center gap-2">
            <Input
              placeholder="Default value"
              value={variable.default_value ?? ''}
              onChange={e => update(index, { default_value: e.target.value || undefined })}
              className="w-1/3 h-7 text-xs"
            />
            <Input
              placeholder="Description"
              value={variable.description ?? ''}
              onChange={e => update(index, { description: e.target.value || undefined })}
              className="flex-1 h-7 text-xs"
            />
            {/* Reorder + remove */}
            <div className="flex items-center gap-0.5 shrink-0">
              <button
                type="button"
                onClick={() => moveUp(index)}
                disabled={index === 0}
                className="p-1 rounded hover:bg-muted disabled:opacity-30"
              >
                <ChevronUp size={12} />
              </button>
              <button
                type="button"
                onClick={() => moveDown(index)}
                disabled={index === variables.length - 1}
                className="p-1 rounded hover:bg-muted disabled:opacity-30"
              >
                <ChevronDown size={12} />
              </button>
              <button
                type="button"
                onClick={() => remove(index)}
                className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={addVariable}
        className="flex items-center gap-1 rounded border px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <Plus size={12} /> Add Variable
      </button>
    </div>
  )
}
