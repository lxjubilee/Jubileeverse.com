/**
 * PreviewModal.tsx — Read-only assembled-prompt preview
 *
 * Substitutes variable default values into system_prompt and user_template
 * and shows the result in two labeled <pre> blocks. Purely client-side.
 */

import { X } from 'lucide-react'
import {
  DialogRoot, DialogContent, DialogTitle, DialogClose,
} from '../../ui/Dialog'
import type { PromptVariable } from '../../../types/content-objects'

interface PreviewModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  systemPrompt: string
  userTemplate: string
  variables: PromptVariable[]
}

function substituteVars(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`)
}

export function PreviewModal({
  open,
  onOpenChange,
  systemPrompt,
  userTemplate,
  variables,
}: PreviewModalProps) {
  // Build sample substitution map from variable defaults
  const sampleVars: Record<string, string> = {}
  for (const v of variables) {
    sampleVars[v.name] = v.default_value || `<${v.name}>`
  }

  const assembledSystem = substituteVars(systemPrompt, sampleVars)
  const assembledUser   = substituteVars(userTemplate,  sampleVars)

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b">
          <DialogTitle className="text-base font-semibold p-0">
            Preview Assembled Prompt
          </DialogTitle>
          <DialogClose asChild>
            <button className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground">
              <X size={16} />
            </button>
          </DialogClose>
        </div>

        <div className="px-6 py-4 space-y-4">
          <div>
            <p className="text-xs font-semibold uppercase text-muted-foreground mb-1 tracking-wide">System Prompt</p>
            <pre className="text-xs font-mono bg-muted rounded p-3 whitespace-pre-wrap break-words max-h-60 overflow-y-auto">
              {assembledSystem || <span className="italic text-muted-foreground">(empty)</span>}
            </pre>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase text-muted-foreground mb-1 tracking-wide">User Template</p>
            <pre className="text-xs font-mono bg-muted rounded p-3 whitespace-pre-wrap break-words max-h-60 overflow-y-auto">
              {assembledUser || <span className="italic text-muted-foreground">(empty)</span>}
            </pre>
          </div>
          <p className="text-xs text-muted-foreground">
            Variable placeholders are filled with their default values (or &lt;name&gt; if no default).
          </p>
        </div>

        <div className="flex justify-end px-6 pb-5">
          <DialogClose asChild>
            <button className="rounded border px-4 py-1.5 text-sm hover:bg-muted">Close</button>
          </DialogClose>
        </div>
      </DialogContent>
    </DialogRoot>
  )
}
