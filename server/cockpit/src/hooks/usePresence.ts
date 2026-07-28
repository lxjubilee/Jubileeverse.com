/**
 * hooks/usePresence.ts — Phase 5 WebSocket presence hook
 *
 * Connects to the server WebSocket, sends join_object/leave_object messages,
 * and returns the list of other users currently viewing the same object.
 * Auth via session cookie (same-origin WebSocket carries cookies automatically).
 */
import * as React from 'react'
import { useCockpitStore } from './useCockpitStore'
import type { PresenceUser } from '../types/content-objects'

export function usePresence(objectId: string | null): PresenceUser[] {
  const user = useCockpitStore(s => s.user)
  const selfEmail = user?.email ?? ''
  const [users, setUsers] = React.useState<PresenceUser[]>([])
  const wsRef = React.useRef<WebSocket | null>(null)
  const reconnectRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  React.useEffect(() => {
    if (!user || !objectId) {
      setUsers([])
      return
    }

    function connect() {
      // Determine WebSocket URL (same host as page, ws:// or wss://)
      const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      // In dev, Vite runs on a different port than the server; use the API server port
      const host = window.location.hostname
      const port = import.meta.env.VITE_API_PORT || '3107'
      const url = `${wsProto}//${host}:${port}`
      const ws = new WebSocket(url)
      wsRef.current = ws

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'join_object', objectId }))
      }

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          if (msg.type === 'presence_update' && msg.objectId === objectId) {
            // Exclude self from displayed list
            setUsers((msg.users as PresenceUser[]).filter(u => u.email !== selfEmail))
          }
        } catch {}
      }

      ws.onclose = (ev) => {
        // Reconnect unless closed intentionally (code 4001 = auth failure, 1000 = clean close)
        if (ev.code !== 4001 && ev.code !== 1000) {
          reconnectRef.current = setTimeout(connect, 2000)
        }
      }
    }

    connect()

    return () => {
      if (reconnectRef.current) clearTimeout(reconnectRef.current)
      if (wsRef.current) {
        wsRef.current.send(JSON.stringify({ type: 'leave_object' }))
        wsRef.current.close(1000, 'unmount')
        wsRef.current = null
      }
      setUsers([])
    }
  }, [user, objectId, selfEmail])

  return users
}
