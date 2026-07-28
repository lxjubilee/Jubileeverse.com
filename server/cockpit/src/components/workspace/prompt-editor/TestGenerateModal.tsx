/**
 * TestGenerateModal.tsx — Ephemeral test-generation result display
 *
 * On open: POST /api/v1/prompt-recipes/test with current prompt state.
 * Displays output text + token usage + duration. Output is NOT saved.
 */

import * as React from 'react'
import { X, Loader2 } from 'lucide-react'
import { DialogRoot, DialogContent, DialogTitle } from '../../ui/Dialog'
import { testGeneratePrompt } from '../../../lib/api'
import type { PromptVariable } from '../../../types/content-objects'

interface TestGenerateModalProps {
  open: boolean
  onClose: () => void
  systemPrompt: string
  userTemplate: string
  variables: PromptVariable[]
  model?: string
  maxTokens?: number
}

interface TestResult {
  output:        string
  model:         string
  input_tokens:  number
  output_tokens: number
  duration_ms:   number
}

export function TestGenerateModal({
  open,
  onClose,
  systemPrompt,
  userTemplate,
  variables,
  model = 'claude-haiku-4-5-20251001',
  maxTokens = 500,
}: TestGenerateModalProps) {
  const [result, setResult]   = React.useState<TestResult | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError]     = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) { setResult(null); setError(null); return }

    // Build sample vars map
    const sampleVars: Record<string, string> = {}
    for (const v of variables) {
      sampleVars[v.name] = v.default_value || `<${v.name}>`
    }

    setLoading(true)
    setError(null)
    testGeneratePrompt({
      system_prompt: systemPrompt,
      user_template: userTemplate,
      variables: sampleVars,
      model,
      max_tokens: maxTokens,
    })
      .then(r => setResult(r))
      .catch(e => setError(e.message ?? 'Generation failed'))
      .finally(() => setLoading(false))
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleClose() {
    setResult(null)
    setError(null)
    onClose()
  }

  return (
    <DialogRoot open={open} onOpenChange={v => { if (!v) handleClose() }}>
      <DialogContent className="max-w-3xl">
        <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b">
          <DialogTitle className="text-base font-semibold p-0">Test Generation</DialogTitle>
          <button
            onClick={handleClose}
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-6 py-4 min-h-[200px]">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
              <Loader2 size={18} className="animate-spin" />
              <span className="text-sm">Generating…</span>
            </div>
          )}

          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {result && !loading && (
            <div className="space-y-4">
              <div>
                <p className="text-xs font-semibold uppercase text-muted-foreground mb-1 tracking-wide">
                  Generated Output
                </p>
                <pre className="text-xs font-mono bg-muted rounded p-3 whitespace-pre-wrap break-words max-h-80 overflow-y-auto">
                  {result.output}
                </pre>
              </div>

              <div className="flex items-center gap-4 text-xs text-muted-foreground border-t pt-3">
                <span>Model: <strong className="text-foreground">{result.model}</strong></span>
                <span>Input: <strong className="text-foreground">{result.input_tokens}</strong> tokens</span>
                <span>Output: <strong className="text-foreground">{result.output_tokens}</strong> tokens</span>
                <span>Duration: <strong className="text-foreground">{result.duration_ms}ms</strong></span>
              </div>

              <p className="text-xs text-muted-foreground italic">
                This output is ephemeral and has not been saved as a content object.
              </p>
            </div>
          )}
        </div>

        <div className="flex justify-end px-6 pb-5">
          <button
            onClick={handleClose}
            className="rounded border px-4 py-1.5 text-sm hover:bg-muted"
          >
            Close
          </button>
        </div>
      </DialogContent>
    </DialogRoot>
  )
}
