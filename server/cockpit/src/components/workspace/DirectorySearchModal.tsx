/**
 * DirectorySearchModal.tsx — Grant CMS Access via directory search (Part 3 Section 12)
 *
 * - Search input with 300ms debounce → useDirectorySearch(q)
 * - Results list: initials avatar, name, email, entitlement chip
 * - Click user → inline role picker (publisher / reviewer / editor / site_owner)
 * - Confirm → useGrantCmsAccess() → close on success
 */

import * as React from 'react'
import { Search, UserPlus, X } from 'lucide-react'
import { DialogRoot, DialogContent, DialogTitle } from '../ui/Dialog'
import { Button }  from '../ui/Button'
import { Input }   from '../ui/Input'
import { Select }  from '../ui/Select'
import { useDirectorySearch, useGrantCmsAccess } from '../../hooks/useUsers'
import type { DirectoryUser } from '../../types/content-objects'

interface DirectorySearchModalProps {
  open:         boolean
  onOpenChange: (open: boolean) => void
}

const ROLE_OPTIONS = [
  { value: 'publisher',       label: 'Publisher' },
  { value: 'reviewer',        label: 'Reviewer' },
  { value: 'editor',          label: 'Editor' },
  { value: 'site_owner',      label: 'Site Owner' },
  { value: 'author_operator', label: 'Author Operator' },
]

const AVATAR_HUES = [0, 30, 60, 120, 160, 200, 240, 280, 320]

function emailHue(email: string): number {
  let hash = 0
  for (let i = 0; i < email.length; i++) hash = (hash * 31 + email.charCodeAt(i)) | 0
  return AVATAR_HUES[Math.abs(hash) % AVATAR_HUES.length]
}

function userInitials(u: DirectoryUser): string {
  const name = u.name || u.email
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

function hasCmsAccess(u: DirectoryUser): boolean {
  return Array.isArray(u.entitlements) && u.entitlements.includes('jubileeverse_cms')
}

export function DirectorySearchModal({ open, onOpenChange }: DirectorySearchModalProps) {
  const [query,   setQuery]   = React.useState('')
  const [debounced, setDebounced] = React.useState('')
  const debounceRef = React.useRef<ReturnType<typeof setTimeout>>()

  const [selected, setSelected] = React.useState<DirectoryUser | null>(null)
  const [role, setRole]         = React.useState('publisher')
  const [error, setError]       = React.useState<string | null>(null)

  const { data, isFetching } = useDirectorySearch(debounced)
  const grant = useGrantCmsAccess()

  function handleQuery(v: string) {
    setQuery(v)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebounced(v), 300)
  }

  function reset() {
    setQuery('')
    setDebounced('')
    setSelected(null)
    setRole('publisher')
    setError(null)
  }

  function handleClose() {
    reset()
    onOpenChange(false)
  }

  function selectUser(u: DirectoryUser) {
    setSelected(u)
    setError(null)
  }

  async function handleGrant() {
    if (!selected) return
    setError(null)
    try {
      await grant.mutateAsync({
        email:        selected.email,
        idp_subject_id: selected.idp_subject_id ?? undefined,
        initial_role: role,
      })
      handleClose()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to grant access'
      setError(msg)
    }
  }

  const users: DirectoryUser[] = data?.users ?? []

  return (
    <DialogRoot open={open} onOpenChange={v => { if (!v) handleClose() }}>
      <DialogContent className="max-w-lg">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b">
          <div className="flex items-center gap-2">
            <UserPlus size={16} className="text-muted-foreground" />
            <DialogTitle className="text-sm font-semibold">Grant CMS Access</DialogTitle>
          </div>
          <button
            onClick={handleClose}
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
          >
            <X size={14} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Search */}
          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-7 h-8 text-xs"
              placeholder="Search by name or email…"
              value={query}
              onChange={e => handleQuery(e.target.value)}
              autoFocus
            />
          </div>

          {/* Results */}
          {debounced.length >= 2 && (
            <div className="border rounded overflow-hidden max-h-52 overflow-y-auto">
              {isFetching && (
                <div className="p-3 text-xs text-muted-foreground text-center">Searching…</div>
              )}
              {!isFetching && users.length === 0 && (
                <div className="p-3 text-xs text-muted-foreground text-center">No users found</div>
              )}
              {!isFetching && users.map(u => {
                const hue = emailHue(u.email)
                const isSelected = selected?.id === u.id
                const hasAccess = hasCmsAccess(u)
                return (
                  <button
                    key={u.id}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 text-left border-b last:border-b-0 hover:bg-accent/50 transition-colors ${isSelected ? 'bg-accent' : ''}`}
                    onClick={() => selectUser(u)}
                  >
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0"
                      style={{ backgroundColor: `hsl(${hue},60%,50%)` }}
                    >
                      {userInitials(u)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium truncate">{u.name || u.email}</div>
                      <div className="text-[10px] text-muted-foreground truncate">{u.email}</div>
                    </div>
                    {hasAccess && (
                      <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-green-100 text-green-700 border border-green-300 shrink-0">
                        CMS access
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          )}

          {debounced.length < 2 && (
            <p className="text-xs text-muted-foreground text-center py-1">
              Type at least 2 characters to search
            </p>
          )}

          {/* Role picker — shown when a user is selected */}
          {selected && (
            <div className="border rounded p-3 bg-muted/20 space-y-2">
              <div className="text-xs font-medium">
                Assign role for <span className="font-semibold">{selected.name || selected.email}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-10 shrink-0">Role</span>
                <Select
                  className="h-7 text-xs flex-1"
                  value={role}
                  onValueChange={setRole}
                  options={ROLE_OPTIONS}
                />
              </div>
              {hasCmsAccess(selected) && (
                <div className="text-[10px] text-amber-600">
                  This user already has CMS access. Their role will be updated.
                </div>
              )}
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="text-xs text-destructive border border-destructive/30 rounded px-3 py-2 bg-destructive/5">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 pb-5">
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            className="h-7 text-xs"
            onClick={handleGrant}
            disabled={!selected || grant.isPending}
          >
            {grant.isPending ? 'Granting…' : 'Grant Access'}
          </Button>
        </div>
      </DialogContent>
    </DialogRoot>
  )
}
