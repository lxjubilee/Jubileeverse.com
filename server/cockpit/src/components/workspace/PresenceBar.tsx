/**
 * PresenceBar.tsx — Phase 5 real-time presence avatars
 */
import { usePresence } from '../../hooks/usePresence'
import { useCockpitStore } from '../../hooks/useCockpitStore'

interface PresenceBarProps {
  objectId: string
}

const AVATAR_COLORS = [
  'bg-blue-500',
  'bg-green-500',
  'bg-purple-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-teal-500',
]

function avatarColor(email: string): string {
  const code = email.charCodeAt(0) || 0
  return AVATAR_COLORS[code % AVATAR_COLORS.length]
}

export function PresenceBar({ objectId }: PresenceBarProps) {
  const users = usePresence(objectId)
  const selfEmail = useCockpitStore(s => s.user?.email ?? '')

  const others = users.filter(u => u.email !== selfEmail)
  if (others.length === 0) return null

  const MAX_SHOWN = 5
  const shown = others.slice(0, MAX_SHOWN)
  const overflow = others.length - MAX_SHOWN

  return (
    <div className="flex items-center gap-0.5" title="Currently viewing">
      {shown.map((user, i) => (
        <div
          key={user.email}
          className="relative group"
          style={{ zIndex: shown.length - i }}
        >
          <div
            className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold text-white border-2 border-background ${avatarColor(user.email)}`}
            style={{ marginLeft: i > 0 ? '-6px' : '0' }}
          >
            {user.email.charAt(0).toUpperCase()}
          </div>
          {/* Tooltip */}
          <div className="absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 hidden group-hover:block z-50 pointer-events-none">
            <div className="bg-popover border text-popover-foreground text-[11px] px-2 py-1 rounded shadow-md whitespace-nowrap">
              {user.email}
              <span className="ml-1 text-muted-foreground">({user.role})</span>
            </div>
          </div>
        </div>
      ))}

      {overflow > 0 && (
        <div
          className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold bg-muted text-muted-foreground border-2 border-background"
          style={{ marginLeft: '-6px' }}
          title={`${overflow} more viewer${overflow > 1 ? 's' : ''}`}
        >
          +{overflow}
        </div>
      )}
    </div>
  )
}
