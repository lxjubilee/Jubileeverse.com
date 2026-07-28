/**
 * UserListPanel.tsx — Part 3 Section 7 left panel
 *
 * Scrollable list of CMS users with:
 *   - Search input (client-side, 200ms debounce)
 *   - Group by: role / status / alpha
 *   - Initials avatar (hue derived from email hash)
 *   - Status dot (green=active, red=locked, gray=disabled)
 *   - Role badge
 */

import * as React from 'react'
import { Search, UserPlus } from 'lucide-react'
import { useUsers } from '../../hooks/useUsers'
import { DirectorySearchModal } from './DirectorySearchModal'
import type { CmsUser } from '../../types/content-objects'

interface UserListPanelProps {
  selectedUserId: number | null
  onSelectUser:   (user: CmsUser) => void
  isAdmin:        boolean
}

type GroupBy = 'role' | 'status' | 'alpha'

const AVATAR_HUES = [0, 30, 60, 120, 160, 200, 240, 280, 320]

function emailHue(email: string): number {
  let hash = 0
  for (let i = 0; i < email.length; i++) hash = (hash * 31 + email.charCodeAt(i)) | 0
  return AVATAR_HUES[Math.abs(hash) % AVATAR_HUES.length]
}

function userInitials(user: CmsUser): string {
  const name = user.name || user.email
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

function userDisplayName(user: CmsUser): string {
  return user.name || user.email
}

const ROLE_BADGE_CLASSES: Record<string, string> = {
  admin:            'bg-destructive/15 text-destructive border border-destructive/30',
  site_owner:       'bg-purple-100 text-purple-700 border border-purple-300',
  publisher:        'bg-blue-100 text-blue-700 border border-blue-300',
  reviewer:         'bg-amber-100 text-amber-700 border border-amber-300',
  editor:           'bg-green-100 text-green-700 border border-green-300',
  author_operator:  'bg-muted text-muted-foreground border border-border',
}

function RoleBadge({ role }: { role: string }) {
  const cls = ROLE_BADGE_CLASSES[role] ?? 'bg-muted text-muted-foreground border border-border'
  return (
    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${cls}`}>
      {role.replace(/_/g, ' ')}
    </span>
  )
}

function StatusDot({ user }: { user: CmsUser }) {
  if (user.is_locked) {
    return <span className="w-2 h-2 rounded-full bg-destructive shrink-0" title="Locked" />
  }
  if (!user.is_active) {
    return <span className="w-2 h-2 rounded-full bg-muted-foreground/40 shrink-0" title="Disabled" />
  }
  return <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" title="Active" />
}

function groupUsers(users: CmsUser[], groupBy: GroupBy): { label: string; items: CmsUser[] }[] {
  if (groupBy === 'role') {
    const map: Record<string, CmsUser[]> = {}
    for (const u of users) {
      if (!map[u.role]) map[u.role] = []
      map[u.role].push(u)
    }
    return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, items]) => ({ label: label.replace(/_/g, ' '), items }))
  }
  if (groupBy === 'status') {
    const active   = users.filter(u => u.is_active && !u.is_locked)
    const locked   = users.filter(u => u.is_locked)
    const disabled = users.filter(u => !u.is_active)
    return [
      { label: 'Active',   items: active },
      { label: 'Locked',   items: locked },
      { label: 'Disabled', items: disabled },
    ].filter(g => g.items.length > 0)
  }
  // alpha
  const sorted = [...users].sort((a, b) =>
    userDisplayName(a).localeCompare(userDisplayName(b))
  )
  return [{ label: '', items: sorted }]
}

export function UserListPanel({ selectedUserId, onSelectUser, isAdmin }: UserListPanelProps) {
  const { data, isLoading } = useUsers()
  const [search, setSearch]   = React.useState('')
  const [debouncedSearch, setDebouncedSearch] = React.useState('')
  const [groupBy, setGroupBy] = React.useState<GroupBy>('role')
  const [grantModalOpen, setGrantModalOpen] = React.useState(false)
  const debounceRef = React.useRef<ReturnType<typeof setTimeout>>()

  function handleSearch(v: string) {
    setSearch(v)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedSearch(v), 200)
  }

  const allUsers = data?.users ?? []
  const filtered = debouncedSearch
    ? allUsers.filter(u =>
        userDisplayName(u).toLowerCase().includes(debouncedSearch.toLowerCase()) ||
        u.email.toLowerCase().includes(debouncedSearch.toLowerCase())
      )
    : allUsers

  const groups = groupUsers(filtered, groupBy)

  return (
    <div className="flex flex-col h-full border-r overflow-hidden bg-background">
      {/* Header */}
      <div className="px-3 pt-3 pb-2 border-b shrink-0">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            {allUsers.length} users with CMS access
          </span>
          <div className="flex items-center gap-1.5">
            {isAdmin && (
              <button
                onClick={() => setGrantModalOpen(true)}
                className="flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded border border-border hover:bg-accent/50 text-muted-foreground hover:text-foreground transition-colors"
                title="Grant CMS Access"
              >
                <UserPlus size={10} />
                Grant Access
              </button>
            )}
            <select
              className="text-xs border rounded px-1 py-0.5 bg-background text-foreground"
              value={groupBy}
              onChange={e => setGroupBy(e.target.value as GroupBy)}
            >
              <option value="role">By Role</option>
              <option value="status">By Status</option>
              <option value="alpha">Alphabetical</option>
            </select>
          </div>
        </div>
        <div className="relative">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            className="w-full h-7 pl-6 pr-2 text-xs rounded border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder="Search users…"
            value={search}
            onChange={e => handleSearch(e.target.value)}
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <div className="p-4 text-xs text-muted-foreground text-center">Loading…</div>
        )}
        {!isLoading && filtered.length === 0 && (
          <div className="p-4 text-xs text-muted-foreground text-center">No users found</div>
        )}
        {groups.map(group => (
          <div key={group.label}>
            {group.label && (
              <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground bg-muted/30 border-b">
                {group.label}
              </div>
            )}
            {group.items.map(user => {
              const hue = emailHue(user.email)
              const isSelected = user.id === selectedUserId
              return (
                <button
                  key={user.id}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-accent/50 transition-colors border-b border-border/40 ${isSelected ? 'bg-accent' : ''}`}
                  onClick={() => onSelectUser(user)}
                >
                  {/* Avatar */}
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0"
                    style={{ backgroundColor: `hsl(${hue},60%,50%)` }}
                  >
                    {userInitials(user)}
                  </div>
                  {/* Name + email */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <StatusDot user={user} />
                      <span className="text-xs font-medium truncate">{userDisplayName(user)}</span>
                      {!!user.force_password_reset && (
                        <span className="text-[9px] font-semibold px-1 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-300 shrink-0">
                          Reset
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-muted-foreground truncate">{user.email}</div>
                  </div>
                  {/* Role badge */}
                  <div className="shrink-0">
                    <RoleBadge role={user.role} />
                  </div>
                </button>
              )
            })}
          </div>
        ))}
      </div>

      {isAdmin && (
        <DirectorySearchModal
          open={grantModalOpen}
          onOpenChange={setGrantModalOpen}
        />
      )}
    </div>
  )
}
