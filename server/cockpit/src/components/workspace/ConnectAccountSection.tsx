/**
 * ConnectAccountSection.tsx — Section 11: OAuth / API-key execution identity UI
 *
 * Rendered inside AutomationJobPanel's identity section when identity_type === 'user'.
 * Allows the user to:
 *   1. Connect their own Anthropic API key (validated against the API before storing)
 *   2. View their connected account (masked key)
 *   3. Disconnect (revoke) their token
 *
 * The connected API key is stored encrypted on the server; only a masked version
 * (e.g. "sk-ant-...abc4") is ever shown in the UI.
 */

import * as React from 'react'
import { KeyRound, CheckCircle2, Loader2, Trash2, ChevronDown, ChevronUp } from 'lucide-react'
import { useOAuthTokens, useValidateApiKey, useRevokeOAuthToken } from '../../hooks/useOAuthTokens'
import type { OAuthToken } from '../../lib/api'

// ── Token status pill ─────────────────────────────────────────────────────────

function TokenPill({ token }: { token: OAuthToken }) {
  const revoke    = useRevokeOAuthToken()
  const [confirm, setConfirm] = React.useState(false)

  return (
    <div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2">
      <CheckCircle2 size={14} className="text-green-600 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium text-green-800">{token.provider} connected</div>
        <div className="text-xs text-green-700 font-mono truncate">
          {/* Show masked indicator — real key never sent from server */}
          {token.provider.startsWith('sk-') ? token.provider : 'API key •••'}
        </div>
        {token.last_used_at && (
          <div className="text-[10px] text-muted-foreground mt-0.5">
            Last used: {new Date(token.last_used_at).toLocaleDateString()}
          </div>
        )}
      </div>
      {confirm ? (
        <div className="flex items-center gap-1">
          <span className="text-xs text-destructive">Remove?</span>
          <button
            onClick={() => { revoke.mutate(token.id); setConfirm(false) }}
            disabled={revoke.isPending}
            className="text-xs text-destructive hover:underline"
          >
            Yes
          </button>
          <button
            onClick={() => setConfirm(false)}
            className="text-xs text-muted-foreground hover:underline"
          >
            No
          </button>
        </div>
      ) : (
        <button
          onClick={() => setConfirm(true)}
          className="shrink-0 text-muted-foreground hover:text-destructive"
          title="Remove token"
        >
          <Trash2 size={13} />
        </button>
      )}
    </div>
  )
}

// ── API key entry form ────────────────────────────────────────────────────────

function ApiKeyForm({ provider, onSuccess }: { provider: string; onSuccess: () => void }) {
  const [apiKey, setApiKey] = React.useState('')
  const validate = useValidateApiKey()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!apiKey.trim()) return
    try {
      await validate.mutateAsync({ provider, api_key: apiKey.trim() })
      setApiKey('')
      onSuccess()
    } catch { /* error shown below */ }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <div>
        <label className="text-xs text-muted-foreground block mb-1">
          {provider === 'anthropic' ? 'Anthropic API Key' : 'API Key'}
        </label>
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="sk-ant-api..."
          value={apiKey}
          onChange={e => setApiKey(e.target.value)}
          className="w-full rounded border px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      {validate.isError && (
        <p className="text-xs text-destructive">
          {(validate.error as Error)?.message ?? 'Validation failed'}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={validate.isPending || !apiKey.trim()}
          className="flex items-center gap-1.5 rounded px-3 py-1.5 text-xs bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {validate.isPending ? <Loader2 size={11} className="animate-spin" /> : <KeyRound size={11} />}
          {validate.isPending ? 'Validating…' : 'Connect'}
        </button>
      </div>

      <p className="text-[10px] text-muted-foreground">
        Your key is validated against the Anthropic API and then stored encrypted.
        It is never shown in full after submission.
      </p>
    </form>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface ConnectAccountSectionProps {
  /** The user email to scope token lookup (identity_id from the job) */
  userEmail: string
  /** Provider to connect (defaults to 'anthropic') */
  provider?: string
}

export function ConnectAccountSection({ userEmail, provider = 'anthropic' }: ConnectAccountSectionProps) {
  const { data, isLoading } = useOAuthTokens()
  const [showForm, setShowForm] = React.useState(false)

  // Find active token for this provider
  const token = data?.tokens.find(
    t => t.provider === provider && t.is_active && t.user_email === userEmail
  )

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
        <Loader2 size={12} className="animate-spin" />
        Loading account…
      </div>
    )
  }

  if (token) {
    return (
      <div className="space-y-2">
        <TokenPill token={token} />
        <p className="text-[10px] text-muted-foreground">
          Jobs with User identity will use your connected API key for generation.
        </p>
      </div>
    )
  }

  // No token yet — show connect button / form
  return (
    <div className="space-y-2">
      <div className="rounded-md border border-dashed px-3 py-2">
        <button
          onClick={() => setShowForm(v => !v)}
          className="flex items-center gap-1.5 w-full text-left text-xs text-muted-foreground hover:text-foreground"
        >
          <KeyRound size={12} />
          <span className="flex-1">Connect your {provider} account</span>
          {showForm ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>

        {showForm && (
          <div className="mt-3 border-t pt-3">
            <ApiKeyForm provider={provider} onSuccess={() => setShowForm(false)} />
          </div>
        )}
      </div>

      {!showForm && (
        <p className="text-[10px] text-muted-foreground">
          Connect your API key to run jobs using your identity and usage quota.
        </p>
      )}
    </div>
  )
}
