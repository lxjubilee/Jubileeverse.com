/**
 * UserEditorPanel.tsx — Part 3 Section 9 right-panel editor
 *
 * Four collapsible sections:
 *   1. Profile      — name (editable), email (read-only), meta fields
 *   2. Role & Permissions — role selector + scoped taxonomy permissions
 *   3. Account Controls  — enable/disable/lock/unlock/force-reset/mfa-reset/revoke
 *   4. Account Change History — jv_audit_log entries for this user
 */

import * as React from 'react'
import { X, ChevronDown, ChevronRight, Trash2, Plus } from 'lucide-react'
import {
  useCmsUser,
  useUpdateCmsUser,
  useEnableCmsUser,
  useDisableCmsUser,
  useLockCmsUser,
  useUnlockCmsUser,
  useForcePasswordReset,
  useResetUserMfa,
  useRevokeAllUserSessions,
  useUserAccountAudit,
  useUpdateCmsRoles,
  useRevokeEntitlement,
} from '../../hooks/useUsers'
import { getUserPermissions, addUserPermission, removeUserPermission } from '../../lib/api'
import { Input }   from '../ui/Input'
import { Select }  from '../ui/Select'
import { Button }  from '../ui/Button'
import type { AuditLogEntry, CmsUserRole } from '../../types/content-objects'
import type { UserPermissionGrant } from '../../lib/api'

interface UserEditorPanelProps {
  userId:   number | null
  onClose:  () => void
  isAdmin:  boolean
}

// ── Collapsible section ────────────────────────────────────────────────────────

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

// ── Field row helper ──────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-xs">
      <span className="w-28 text-muted-foreground shrink-0 pt-0.5">{label}</span>
      <div className="flex-1">{children}</div>
    </div>
  )
}

// ── Role options ──────────────────────────────────────────────────────────────

const ROLE_OPTIONS = [
  { value: 'admin',           label: 'Admin' },
  { value: 'site_owner',      label: 'Site Owner' },
  { value: 'publisher',       label: 'Publisher' },
  { value: 'reviewer',        label: 'Reviewer' },
  { value: 'editor',          label: 'Editor' },
  { value: 'author_operator', label: 'Author Operator' },
]

// ── Permissions section ───────────────────────────────────────────────────────

const PERMISSION_OPTS = [
  { value: 'edit',    label: 'edit' },
  { value: 'review',  label: 'review' },
  { value: 'publish', label: 'publish' },
  { value: 'manage',  label: 'manage' },
]

function PermissionsSection({ userId }: { userId: number }) {
  const [permissions, setPermissions] = React.useState<UserPermissionGrant[]>([])
  const [loading, setLoading] = React.useState(false)
  const [newNodeId, setNewNodeId]     = React.useState('')
  const [newPerm, setNewPerm]         = React.useState('edit')

  React.useEffect(() => {
    setLoading(true)
    getUserPermissions(userId)
      .then(data => setPermissions(Array.isArray(data) ? data : []))
      .catch(() => setPermissions([]))
      .finally(() => setLoading(false))
  }, [userId])

  async function addPerm() {
    if (!newNodeId) return
    await addUserPermission(userId, { taxonomy_node_id: parseInt(newNodeId, 10), permission: newPerm })
    setNewNodeId('')
    const data = await getUserPermissions(userId)
    setPermissions(Array.isArray(data) ? data : [])
  }

  async function removePerm(grantId: number) {
    await removeUserPermission(userId, grantId)
    setPermissions(ps => ps.filter(p => p.id !== grantId))
  }

  if (loading) return <div className="text-xs text-muted-foreground">Loading…</div>

  return (
    <div className="space-y-1">
      {permissions.length === 0 && (
        <div className="text-xs text-muted-foreground">No scoped permissions assigned.</div>
      )}
      {permissions.map(p => (
        <div key={p.id} className="flex items-center gap-2 text-xs border rounded px-2 py-1 bg-muted/30">
          <span className="font-mono">{p.taxonomy_node_id}</span>
          <span className="flex-1">{p.permission}</span>
          <span className="text-muted-foreground text-[10px] truncate">{p.granted_by}</span>
          <button onClick={() => removePerm(p.id)} className="text-muted-foreground hover:text-destructive">
            <Trash2 size={11} />
          </button>
        </div>
      ))}
      {/* Add form */}
      <div className="flex items-center gap-1 pt-1">
        <Input
          className="h-6 text-xs flex-1"
          placeholder="Node ID…"
          value={newNodeId}
          onChange={e => setNewNodeId(e.target.value)}
        />
        <Select
          className="h-6 text-xs w-24"
          value={newPerm}
          onValueChange={setNewPerm}
          options={PERMISSION_OPTS}
        />
        <Button size="sm" className="h-6 text-xs px-2" onClick={addPerm} disabled={!newNodeId}>
          <Plus size={11} />
        </Button>
      </div>
    </div>
  )
}

// ── CMS Roles section ─────────────────────────────────────────────────────────

const CMS_ROLE_OPTIONS = [
  { value: 'publisher',       label: 'Publisher' },
  { value: 'reviewer',        label: 'Reviewer' },
  { value: 'editor',          label: 'Editor' },
  { value: 'site_owner',      label: 'Site Owner' },
  { value: 'author_operator', label: 'Author Operator' },
  { value: 'admin',           label: 'Admin' },
]

function CmsRolesSection({ userId, currentRoles }: { userId: number; currentRoles: CmsUserRole[] }) {
  const updateRoles = useUpdateCmsRoles()
  const [newRole, setNewRole]   = React.useState('publisher')
  const [newScope, setNewScope] = React.useState('')

  async function addRole() {
    const next = [...currentRoles, { role: newRole, ...(newScope ? { scope: newScope } : {}) }]
    await updateRoles.mutateAsync({ id: userId, cms_roles: next })
    setNewScope('')
  }

  async function removeRole(idx: number) {
    const next = currentRoles.filter((_, i) => i !== idx)
    await updateRoles.mutateAsync({ id: userId, cms_roles: next })
  }

  return (
    <div className="space-y-1">
      {currentRoles.length === 0 && (
        <div className="text-xs text-muted-foreground">No CMS roles assigned.</div>
      )}
      {currentRoles.map((r, i) => (
        <div key={i} className="flex items-center gap-2 text-xs border rounded px-2 py-1 bg-muted/30">
          <span className="font-medium">{r.role.replace(/_/g, ' ')}</span>
          {r.scope && <span className="text-muted-foreground text-[10px] flex-1 truncate">scope: {r.scope}</span>}
          {!r.scope && <span className="flex-1" />}
          <button
            onClick={() => removeRole(i)}
            className="text-muted-foreground hover:text-destructive"
            disabled={updateRoles.isPending}
          >
            <Trash2 size={11} />
          </button>
        </div>
      ))}
      {/* Add form */}
      <div className="flex items-center gap-1 pt-1">
        <Select
          className="h-6 text-xs w-28"
          value={newRole}
          onValueChange={setNewRole}
          options={CMS_ROLE_OPTIONS}
        />
        <Input
          className="h-6 text-xs flex-1"
          placeholder="Scope (optional)…"
          value={newScope}
          onChange={e => setNewScope(e.target.value)}
        />
        <Button
          size="sm"
          className="h-6 text-xs px-2"
          onClick={addRole}
          disabled={updateRoles.isPending}
        >
          <Plus size={11} />
        </Button>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function UserEditorPanel({ userId, onClose, isAdmin }: UserEditorPanelProps) {
  const { data } = useCmsUser(userId)
  const user = data?.user

  const updateUser            = useUpdateCmsUser()
  const enableUser            = useEnableCmsUser()
  const disableUser           = useDisableCmsUser()
  const lockUser              = useLockCmsUser()
  const unlockUser            = useUnlockCmsUser()
  const forceReset            = useForcePasswordReset()
  const resetMfa              = useResetUserMfa()
  const revokeSessions        = useRevokeAllUserSessions()
  const revokeEntitlement     = useRevokeEntitlement()
  const { data: auditData }   = useUserAccountAudit(userId)

  // Name edit
  const [pendingName, setPendingName]   = React.useState<string | null>(null)
  const displayName = pendingName !== null ? pendingName : (user?.name ?? '')

  // Role confirm
  const [pendingRole, setPendingRole]   = React.useState<string | null>(null)

  // Typed confirmation for destructive actions
  const [confirmAction, setConfirmAction] = React.useState<string | null>(null)
  const [confirmInput, setConfirmInput]   = React.useState('')

  if (!userId || !user) return null

  async function saveName() {
    if (pendingName === null || pendingName === user!.name) { setPendingName(null); return }
    await updateUser.mutateAsync({ id: userId!, data: { name: pendingName } })
    setPendingName(null)
  }

  async function confirmRole() {
    if (!pendingRole) return
    await updateUser.mutateAsync({ id: userId!, data: { role: pendingRole } })
    setPendingRole(null)
  }

  async function doAction(action: string) {
    if (!userId) return
    if (action === 'disable' || action === 'lock' || action === 'revoke-entitlement') {
      if (confirmInput !== user!.email) return
    }
    setConfirmAction(null)
    setConfirmInput('')
    if (action === 'enable')   await enableUser.mutateAsync(userId)
    if (action === 'disable')  await disableUser.mutateAsync(userId)
    if (action === 'lock')     await lockUser.mutateAsync(userId)
    if (action === 'unlock')   await unlockUser.mutateAsync(userId)
    if (action === 'force-reset')   await forceReset.mutateAsync(userId)
    if (action === 'reset-mfa')     await resetMfa.mutateAsync(userId)
    if (action === 'revoke-sessions') await revokeSessions.mutateAsync(userId)
    if (action === 'revoke-entitlement') await revokeEntitlement.mutateAsync(userId)
  }

  function requestAction(action: string) {
    if (action === 'disable' || action === 'lock' || action === 'revoke-entitlement') {
      setConfirmAction(action)
      setConfirmInput('')
    } else {
      if (!window.confirm(`Are you sure you want to ${action.replace(/-/g, ' ')} this account?`)) return
      doAction(action)
    }
  }

  const auditItems = auditData?.items ?? []

  return (
    <div className="flex flex-col h-full overflow-hidden border-l bg-background">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b shrink-0">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold truncate">{user.name || user.email}</div>
          <div className="text-[10px] text-muted-foreground truncate">{user.email}</div>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X size={14} />
        </button>
      </div>

      {/* Scrollable sections */}
      <div className="flex-1 overflow-y-auto">

        {/* 1. Profile */}
        <Section title="Profile" defaultOpen>
          <Field label="Name">
            <Input
              className="h-6 text-xs"
              value={displayName}
              onChange={e => setPendingName(e.target.value)}
              onBlur={saveName}
              onKeyDown={e => { if (e.key === 'Enter') saveName() }}
            />
          </Field>
          <Field label="Email">
            <div className="text-xs text-muted-foreground font-mono">{user.email}</div>
          </Field>
          <Field label="User ID">
            <div className="text-[10px] font-mono text-muted-foreground">{user.id}</div>
          </Field>
          <Field label="Created">
            <div className="text-xs text-muted-foreground">{new Date(user.created_at).toLocaleDateString()}</div>
          </Field>
          <Field label="Last login">
            <div className="text-xs text-muted-foreground">
              {user.last_login_at ? new Date(user.last_login_at).toLocaleString() : 'Never'}
            </div>
          </Field>
          <Field label="MFA">
            {user.mfa_enabled
              ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 border border-green-300">Enabled</span>
              : <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border">Disabled</span>
            }
          </Field>
          {!!user.force_password_reset && (
            <div className="text-[10px] font-semibold px-2 py-1 rounded bg-amber-100 text-amber-700 border border-amber-300">
              Password Reset Pending
            </div>
          )}
          <p className="text-[10px] text-muted-foreground italic">
            Account managed through Jubilee Inspire identity platform.
          </p>
        </Section>

        {/* 2. Role & Permissions */}
        <Section title="Role & Permissions" defaultOpen>
          <Field label="Role">
            <Select
              className="h-7 text-xs"
              value={pendingRole ?? user.role}
              onValueChange={v => setPendingRole(v === user.role ? null : v)}
              options={ROLE_OPTIONS}
            />
          </Field>
          {pendingRole && pendingRole !== user.role && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">Confirm role change to <strong>{pendingRole}</strong>?</span>
              <Button size="sm" className="h-6 text-xs" onClick={confirmRole} disabled={updateUser.isPending}>
                Confirm
              </Button>
              <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setPendingRole(null)}>
                Cancel
              </Button>
            </div>
          )}
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mt-1">Scoped Permissions</div>
          {isAdmin && <PermissionsSection userId={userId} />}
        </Section>

        {/* 2b. CMS Roles */}
        {isAdmin && (
          <Section title="CMS Roles" defaultOpen={false}>
            <CmsRolesSection userId={userId} currentRoles={user.cms_roles ?? []} />
          </Section>
        )}

        {/* 3. Account Controls */}
        <Section title="Account Controls" defaultOpen>
          {/* Status badges */}
          <div className="flex gap-1.5 mb-2">
            {user.is_active && !user.is_locked
              ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 border border-green-300">Active</span>
              : !user.is_active
                ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border">Disabled</span>
                : null
            }
            {!!user.is_locked && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-destructive/15 text-destructive border border-destructive/30">Locked</span>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap gap-1.5">
            {user.is_active
              ? <Button size="sm" variant="outline" className="h-7 text-xs border-amber-400 text-amber-700 hover:bg-amber-50" onClick={() => requestAction('disable')}>Disable</Button>
              : <Button size="sm" variant="outline" className="h-7 text-xs border-green-500 text-green-700 hover:bg-green-50" onClick={() => requestAction('enable')}>Enable</Button>
            }
            {user.is_locked
              ? <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => requestAction('unlock')}>Unlock</Button>
              : (user.is_active && isAdmin && (
                  <Button size="sm" variant="outline" className="h-7 text-xs border-destructive/50 text-destructive hover:bg-destructive/10" onClick={() => requestAction('lock')}>Lock</Button>
                ))
            }
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => requestAction('force-reset')}>Force Password Reset</Button>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => requestAction('reset-mfa')}>Reset MFA</Button>
            <Button size="sm" variant="outline" className="h-7 text-xs border-destructive/50 text-destructive hover:bg-destructive/10" onClick={() => requestAction('revoke-sessions')}>Revoke Sessions</Button>
            {isAdmin && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs border-destructive/50 text-destructive hover:bg-destructive/10"
                onClick={() => requestAction('revoke-entitlement')}
                disabled={revokeEntitlement.isPending}
              >
                Revoke CMS Access
              </Button>
            )}
          </div>

          {/* Two-step confirm UI */}
          {confirmAction && (
            <div className="mt-2 space-y-1 border rounded p-2 bg-muted/30">
              <div className="text-xs font-medium">
                Type <strong>{user.email}</strong> to confirm {confirmAction}:
              </div>
              <Input
                className="h-6 text-xs font-mono"
                value={confirmInput}
                onChange={e => setConfirmInput(e.target.value)}
                placeholder={user.email}
              />
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  variant="destructive"
                  className="h-6 text-xs"
                  disabled={confirmInput !== user.email}
                  onClick={() => doAction(confirmAction)}
                >
                  Confirm {confirmAction}
                </Button>
                <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => { setConfirmAction(null); setConfirmInput('') }}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </Section>

        {/* 4. Account Change History */}
        <Section title="Account Change History" defaultOpen={false}>
          {auditItems.length === 0 && (
            <div className="text-xs text-muted-foreground">No account changes recorded yet.</div>
          )}
          {(auditItems as AuditLogEntry[]).map((item, i) => (
            <div key={i} className="flex flex-col gap-0.5 text-xs border-b pb-1.5">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground text-[10px]">
                  {new Date(item.created_at).toLocaleString()}
                </span>
                <span className="font-medium">
                  {item.event_type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                </span>
              </div>
              <div className="text-muted-foreground text-[10px]">
                by {item.actor_id ?? '—'}
                {item.details && ` · ${JSON.stringify(item.details).slice(0, 60)}`}
              </div>
            </div>
          ))}
        </Section>

      </div>
    </div>
  )
}
