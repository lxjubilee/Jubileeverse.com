/**
 * ShellHeader.tsx — 56px fixed top bar for the back-office shell (Phase 4A / Phase 5)
 */

import * as React from 'react'
import { Bell, ExternalLink, KeyRound, LogOut, User } from 'lucide-react'
import { useCockpitStore } from '../../hooks/useCockpitStore'
import { useUnreadCount } from '../../hooks/useNotifications'
import { NotificationCenter } from './NotificationCenter'

function getInitials(name: string | null | undefined, email: string | null | undefined): string {
  const src = name || email || ''
  if (!src) return '?'
  return src
    .split(/\s+/)
    .map((n: string) => n[0] ?? '')
    .join('')
    .toUpperCase()
    .substring(0, 2) || '?'
}

// ── Profile Settings Modal ─────────────────────────────────────────────────
function ProfileSettingsModal({ onClose }: { onClose: () => void }) {
  const user = useCockpitStore(s => s.user)
  const [tab, setTab] = React.useState<'info' | 'password'>('info')
  const [currentPw, setCurrentPw] = React.useState('')
  const [newPw, setNewPw] = React.useState('')
  const [confirmPw, setConfirmPw] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [msg, setMsg] = React.useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault()
    setMsg(null)
    if (newPw !== confirmPw) { setMsg({ type: 'err', text: 'New passwords do not match.' }); return }
    if (newPw.length < 8) { setMsg({ type: 'err', text: 'New password must be at least 8 characters.' }); return }
    setBusy(true)
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ current_password: currentPw, new_password: newPw }),
      })
      const json = await res.json()
      if (!res.ok) { setMsg({ type: 'err', text: json.error || 'Failed to change password.' }); return }
      setMsg({ type: 'ok', text: 'Password changed successfully.' })
      setCurrentPw(''); setNewPw(''); setConfirmPw('')
    } catch {
      setMsg({ type: 'err', text: 'Network error. Please try again.' })
    } finally { setBusy(false) }
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{ background: '#18181b', border: '1px solid #27272a', borderRadius: 12, width: 420, maxWidth: '95vw', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #27272a', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontWeight: 600, fontSize: '0.95rem', color: '#fafafa' }}>Profile Settings</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#71717a', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: 2 }}>✕</button>
        </div>
        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid #27272a' }}>
          {(['info', 'password'] as const).map(t => (
            <button key={t} onClick={() => { setTab(t); setMsg(null) }}
              style={{ flex: 1, padding: '10px 0', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 500, color: tab === t ? '#ca8a04' : '#71717a', borderBottom: tab === t ? '2px solid #ca8a04' : '2px solid transparent' }}>
              {t === 'info' ? 'Account Info' : 'Change Password'}
            </button>
          ))}
        </div>
        {/* Body */}
        <div style={{ padding: 20 }}>
          {tab === 'info' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#ca8a04', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '1.1rem', flexShrink: 0 }}>
                  {getInitials(user?.name, user?.email)}
                </div>
                <div>
                  <div style={{ fontWeight: 600, color: '#fafafa', fontSize: '0.9rem' }}>{user?.name || '—'}</div>
                  <div style={{ color: '#71717a', fontSize: '0.8rem' }}>{user?.email}</div>
                </div>
              </div>
              <div style={{ background: '#09090b', borderRadius: 8, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <Row label="Role" value={user?.role ?? '—'} />
                <Row label="Email" value={user?.email ?? '—'} />
                <Row label="Name" value={user?.name ?? '—'} />
              </div>
            </div>
          )}
          {tab === 'password' && (
            <form onSubmit={handleChangePassword} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {msg && (
                <div style={{ padding: '8px 12px', borderRadius: 6, fontSize: '0.8rem', background: msg.type === 'ok' ? '#14532d' : '#450a0a', color: msg.type === 'ok' ? '#86efac' : '#fca5a5' }}>
                  {msg.text}
                </div>
              )}
              <Field label="Current password" type="password" value={currentPw} onChange={setCurrentPw} required />
              <Field label="New password" type="password" value={newPw} onChange={setNewPw} required />
              <Field label="Confirm new password" type="password" value={confirmPw} onChange={setConfirmPw} required />
              <button type="submit" disabled={busy}
                style={{ marginTop: 4, padding: '9px 0', background: busy ? '#a16207' : '#ca8a04', border: 'none', borderRadius: 6, color: '#fff', fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer', fontSize: '0.85rem' }}>
                {busy ? 'Saving…' : 'Update Password'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem' }}>
      <span style={{ color: '#71717a' }}>{label}</span>
      <span style={{ color: '#fafafa', textTransform: 'capitalize' }}>{value}</span>
    </div>
  )
}

function Field({ label, type, value, onChange, required }: { label: string; type: string; value: string; onChange: (v: string) => void; required?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: '0.78rem', color: '#a1a1aa', fontWeight: 500 }}>{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} required={required}
        style={{ padding: '7px 10px', background: '#09090b', border: '1px solid #27272a', borderRadius: 6, color: '#fafafa', fontSize: '0.85rem', outline: 'none' }} />
    </div>
  )
}

// ── Profile Dropdown ───────────────────────────────────────────────────────
function ProfileDropdown({ onClose, onOpenSettings }: { onClose: () => void; onOpenSettings: () => void }) {
  const user = useCockpitStore(s => s.user)
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  async function handleSignOut() {
    try {
      await fetch('/auth/logout', { method: 'POST', credentials: 'include' })
    } catch {}
    window.location.href = '/'
  }

  return (
    <div ref={ref} style={{
      position: 'absolute', top: '100%', right: 0, marginTop: 8, width: 220,
      background: '#18181b', border: '1px solid #27272a', borderRadius: 10,
      boxShadow: '0 8px 24px rgba(0,0,0,0.5)', zIndex: 200, overflow: 'hidden',
    }}>
      {/* User info */}
      <div style={{ padding: '12px 14px', borderBottom: '1px solid #27272a' }}>
        <div style={{ fontWeight: 600, fontSize: '0.85rem', color: '#fafafa', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user?.name || user?.email}</div>
        {user?.name && <div style={{ fontSize: '0.75rem', color: '#71717a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user?.email}</div>}
        <div style={{ marginTop: 4, display: 'inline-block', fontSize: '0.68rem', color: '#ca8a04', background: 'rgba(202,138,4,0.15)', borderRadius: 4, padding: '1px 6px', textTransform: 'capitalize' }}>{user?.role}</div>
      </div>
      {/* Menu items */}
      <div style={{ padding: '6px 0' }}>
        <DropdownItem icon={<User size={13} />} label="Profile Settings" onClick={() => { onClose(); onOpenSettings() }} />
        <DropdownItem icon={<KeyRound size={13} />} label="Change Password" onClick={() => { onClose(); onOpenSettings() }} />
        <div style={{ margin: '4px 0', borderTop: '1px solid #27272a' }} />
        <DropdownItem icon={<LogOut size={13} />} label="Sign Out" onClick={handleSignOut} danger />
      </div>
    </div>
  )
}

function DropdownItem({ icon, label, onClick, danger }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  const [hover, setHover] = React.useState(false)
  return (
    <button onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '7px 14px', background: hover ? '#27272a' : 'none', border: 'none', cursor: 'pointer', color: danger ? '#f87171' : '#d4d4d8', fontSize: '0.82rem', textAlign: 'left', transition: 'background 0.1s' }}>
      {icon}{label}
    </button>
  )
}

export function ShellHeader() {
  const user = useCockpitStore(s => s.user)
  const initials = getInitials(user?.name, user?.email)
  const [notifOpen, setNotifOpen] = React.useState(false)
  const [profileOpen, setProfileOpen] = React.useState(false)
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const avatarRef = React.useRef<HTMLDivElement>(null)
  const { data: unreadData } = useUnreadCount()
  const unreadCount = unreadData?.count ?? 0

  return (
    <header
      className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-4 border-b bg-background"
      style={{ height: '56px' }}
    >
      {/* Left: wordmark — Orbitron to match jubileeverse.com branding */}
      <div className="flex items-center gap-3">
        <img
          src="/images/JubileeLogo.png"
          alt="Jubilee"
          style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
        />
        <span
          className="tracking-wider leading-none select-none"
          style={{ fontFamily: "'Orbitron', sans-serif", fontWeight: 700, fontSize: '24px' }}
        >
          <span className="text-foreground">Jubilee</span><span style={{ color: '#E6AC00' }}>Verse</span><span className="text-foreground" style={{ fontSize: '16px', opacity: 0.65 }}>.com</span>
        </span>
        <span className="text-[10px] text-muted-foreground hidden sm:block uppercase tracking-widest border border-border/60 rounded px-1.5 py-0.5">
          Back Office
        </span>
      </div>

      {/* Right: actions */}
      <div className="flex items-center gap-3">
        <a
          href="/"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          title="View public site"
        >
          <ExternalLink size={14} />
          <span className="hidden sm:inline">View Site</span>
        </a>

        {/* Bell with unread badge and NotificationCenter panel */}
        <div className="relative">
          <button
            onClick={() => setNotifOpen(v => !v)}
            className="rounded-full p-1.5 hover:bg-muted transition-colors relative"
            title="Notifications"
            aria-label="Notifications"
          >
            <Bell size={16} />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[9px] rounded-full min-w-[16px] h-4 flex items-center justify-center px-0.5 leading-none">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>
          {notifOpen && <NotificationCenter onClose={() => setNotifOpen(false)} />}
        </div>

        {/* Profile avatar with dropdown */}
        <div className="relative" ref={avatarRef}>
          <button
            onClick={() => setProfileOpen(v => !v)}
            className="h-7 w-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-semibold select-none hover:opacity-80 transition-opacity cursor-pointer"
            title="Profile settings"
            aria-label="Profile settings"
          >
            {initials}
          </button>
          {profileOpen && (
            <ProfileDropdown
              onClose={() => setProfileOpen(false)}
              onOpenSettings={() => setSettingsOpen(true)}
            />
          )}
        </div>
      </div>

      {settingsOpen && <ProfileSettingsModal onClose={() => setSettingsOpen(false)} />}
    </header>
  )
}
