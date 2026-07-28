/**
 * UserAccountsWorkspace.tsx — Part 3 Section 7 three-panel Users workspace
 *
 * Layout mirrors AuthorsWorkspace:
 *   Left 280px (UserListPanel) | Center flex-1 (UserActivityPanel) | Right 420px (UserEditorPanel)
 *
 * Admin-only — BackOfficeShell already guards the /users route.
 */

import * as React from 'react'
import { useCockpitStore } from '../../hooks/useCockpitStore'
import { useResizablePanel } from '../../hooks/useResizablePanel'
import { ResizeDivider } from '../ui/ResizeDivider'
import { UserListPanel }     from './UserListPanel'
import { UserActivityPanel } from './UserActivityPanel'
import { UserEditorPanel }   from './UserEditorPanel'
import type { CmsUser } from '../../types/content-objects'

export function UserAccountsWorkspace() {
  const user                = useCockpitStore(s => s.user)
  const setSelectedObjectId = useCockpitStore(s => s.setSelectedObjectId)
  const editModeActive      = useCockpitStore(s => s.editModeActive)

  const isAdmin = user?.role === 'admin'
  const { width: leftWidth, startResize } = useResizablePanel('users')

  const [selectedUserId,    setSelectedUserId]    = React.useState<number | null>(null)
  const [selectedUserEmail, setSelectedUserEmail] = React.useState<string | null>(null)

  // Clear Content workspace selection when this workspace mounts
  React.useEffect(() => {
    setSelectedObjectId(null)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function handleSelectUser(user: CmsUser) {
    setSelectedUserId(user.id)
    setSelectedUserEmail(user.email)
    setSelectedObjectId(String(user.id))
  }

  function handleClose() {
    setSelectedUserId(null)
    setSelectedUserEmail(null)
    setSelectedObjectId(null)
  }

  return (
    <div className="relative flex h-full overflow-hidden">
      {/* ── Left panel (User list) ───────────────────────────────────────── */}
      <div
        className="shrink-0 overflow-hidden"
        style={{
          width: `${leftWidth}px`,
          transform: editModeActive ? `translateX(-${leftWidth}px)` : 'translateX(0)',
          marginLeft: editModeActive ? `-${leftWidth}px` : '0',
          transition: 'transform 250ms ease-in-out, margin-left 250ms ease-in-out',
        }}
      >
        <UserListPanel
          selectedUserId={selectedUserId}
          onSelectUser={handleSelectUser}
          isAdmin={isAdmin}
        />
      </div>
      {!editModeActive && <ResizeDivider onMouseDown={startResize} />}

      {/* ── Center panel (Activity) ──────────────────────────────────────── */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <UserActivityPanel
          userId={selectedUserId}
          userEmail={selectedUserEmail}
          isAdmin={isAdmin}
        />
      </div>

      {/* ── Right panel (Editor) ─────────────────────────────────────────── */}
      <div
        className="shrink-0 overflow-hidden"
        style={{
          width: '420px',
          transform: selectedUserId ? 'translateX(0)' : 'translateX(420px)',
          marginRight: selectedUserId ? '0' : '-420px',
          transition: 'transform 250ms ease-in-out, margin-right 250ms ease-in-out',
        }}
      >
        <UserEditorPanel
          userId={selectedUserId}
          onClose={handleClose}
          isAdmin={isAdmin}
        />
      </div>
    </div>
  )
}
