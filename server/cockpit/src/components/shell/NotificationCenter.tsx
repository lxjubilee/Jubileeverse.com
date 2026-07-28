/**
 * NotificationCenter.tsx — Phase 5 in-app notification dropdown
 */
import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, MessageSquare, CheckSquare, Send, X } from 'lucide-react'
import { useNotifications, useMarkNotificationRead, useMarkAllRead } from '../../hooks/useNotifications'
import type { Notification } from '../../types/content-objects'

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

const TYPE_ICONS: Record<string, React.ElementType> = {
  status_change:    Bell,
  comment_mention:  MessageSquare,
  task_assigned:    CheckSquare,
  published:        Send,
}

interface NotificationCenterProps {
  onClose: () => void
}

export function NotificationCenter({ onClose }: NotificationCenterProps) {
  const navigate = useNavigate()
  const { data: notifications = [] } = useNotifications()
  const markRead = useMarkNotificationRead()
  const markAll = useMarkAllRead()
  const panelRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [onClose])

  function handleClick(n: Notification) {
    markRead.mutate(n.id)
    if (n.object_id) navigate('/content')
    onClose()
  }

  return (
    <div
      ref={panelRef}
      className="absolute top-14 right-4 z-50 w-80 max-h-96 overflow-y-auto rounded-lg border bg-background shadow-lg"
    >
      <div className="flex items-center justify-between px-3 py-2 border-b sticky top-0 bg-background">
        <span className="text-sm font-semibold">Notifications</span>
        <div className="flex gap-1">
          <button
            onClick={() => markAll.mutate()}
            className="text-xs text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded hover:bg-muted"
          >
            Mark all read
          </button>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-0.5 rounded hover:bg-muted">
            <X size={14} />
          </button>
        </div>
      </div>

      {notifications.length === 0 && (
        <p className="text-xs text-muted-foreground text-center py-6">No notifications yet.</p>
      )}

      {notifications.map(n => {
        const Icon = TYPE_ICONS[n.type] ?? Bell
        return (
          <button
            key={n.id}
            onClick={() => handleClick(n)}
            className={`w-full text-left px-3 py-2.5 border-b last:border-b-0 hover:bg-muted/50 flex gap-2.5 ${!n.read ? 'bg-primary/5' : ''}`}
          >
            <div className="relative mt-0.5 shrink-0">
              <Icon size={14} className="text-muted-foreground" />
              {!n.read && (
                <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-blue-500" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium line-clamp-2">{n.title}</p>
              {n.body && (
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{n.body}</p>
              )}
              <p className="text-[10px] text-muted-foreground mt-0.5">{timeAgo(n.created_at)}</p>
            </div>
          </button>
        )
      })}
    </div>
  )
}
