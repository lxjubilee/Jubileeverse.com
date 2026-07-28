/**
 * BackOfficeShell.tsx — Back-office entry page (Part 6 S2 — final configuration)
 *
 * Renders the 56px header + 64px rail nav + workspace area.
 * Auth is validated via session cookie (/api/auth/me) — no localStorage.
 * Shows inline login form if no valid session is found.
 */

import * as React from 'react'
import { useLocation, Navigate } from 'react-router-dom'
import { useCockpitStore } from '../hooks/useCockpitStore'
import { ShellHeader } from '../components/shell/ShellHeader'
import { RailNav } from '../components/shell/RailNav'
import { ContentWorkspace } from '../components/workspace/ContentWorkspace'
import { PromptsWorkspace } from '../components/workspace/PromptsWorkspace'
import { AutomationWorkspace } from '../components/workspace/AutomationWorkspace'
import { AuthorsWorkspace } from '../components/workspace/AuthorsWorkspace'
import { UserAccountsWorkspace } from '../components/workspace/UserAccountsWorkspace'
import { PortalWorkspace } from '../components/workspace/PortalWorkspace'
import { WebsitesWorkspace } from '../components/workspace/WebsitesWorkspace'
import { ImagesWorkspace } from '../components/workspace/ImagesWorkspace'
import { ServersWorkspace } from '../components/workspace/ServersWorkspace'
import { AuditWorkspace } from '../components/workspace/AuditWorkspace'

const PORTAL_VIEWER_ROLES = ['admin', 'publisher', 'site_owner', 'reviewer']
const IMAGE_VIEWER_ROLES  = ['admin', 'publisher', 'editor', 'reviewer']
const AUDIT_VIEWER_ROLES  = ['admin', 'publisher', 'site_owner', 'reviewer']

// Inline login form — password-based auth for production; dev bypass when LOCAL_AUTH_ENABLED=true.
function InlineLoginForm() {
  const [email,    setEmail]    = React.useState('')
  const [password, setPassword] = React.useState('')
  const [error,    setError]    = React.useState('')
  const [busy,     setBusy]     = React.useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const body = new URLSearchParams({ email, password, redirect: '/backoffice/' })
      const res  = await fetch('/auth/local-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        credentials: 'include',
        redirect: 'manual',
      })
      // Successful login returns a 302 redirect (opaque) — reload to pick up cookie
      if (res.type === 'opaqueredirect' || res.status === 0) {
        window.location.href = '/backoffice/'
        return
      }
      if (!res.ok) {
        try {
          const json = await res.json()
          setError(json.error || 'Login failed.')
        } catch {
          setError('Login failed. Please try again.')
        }
        setBusy(false)
        return
      }
      // Unexpected 200 — treat as success and reload
      window.location.href = '/backoffice/'
    } catch {
      setError('Network error. Please try again.')
      setBusy(false)
    }
  }

  return (
    <div style={{
      margin: 0, background: '#09090b', color: '#fafafa',
      fontFamily: 'system-ui,sans-serif', display: 'flex',
      alignItems: 'center', justifyContent: 'center', minHeight: '100vh',
    }}>
      <div style={{
        background: '#18181b', border: '1px solid #27272a', borderRadius: 12,
        padding: '2rem', width: '100%', maxWidth: 360,
      }}>
        <div style={{ color: '#ca8a04', fontWeight: 700, fontSize: '1.5rem', marginBottom: '1rem' }}>
          Jubilee<span style={{ color: '#fafafa' }}>Verse</span>
        </div>
        <h1 style={{ margin: '0 0 4px', fontSize: '1.25rem' }}>Back Office Sign In</h1>
        <p style={{ color: '#a1a1aa', fontSize: '.875rem', margin: '0 0 1.5rem' }}>
          Sign in with your email and password.
        </p>
        {error && (
          <p style={{ color: '#dc2626', fontSize: '.875rem', margin: '0 0 12px' }}>{error}</p>
        )}
        <form onSubmit={handleSubmit}>
          <label style={{ display: 'block', fontSize: '.875rem', fontWeight: 500, marginBottom: 4 }}>
            Email address
          </label>
          <input
            type="email" required autoFocus value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="you@example.com"
            style={{
              width: '100%', padding: '8px 12px', background: '#09090b',
              border: '1px solid #27272a', borderRadius: 6, color: '#fafafa',
              fontSize: '.875rem', marginBottom: '1rem', boxSizing: 'border-box',
            }}
          />
          <label style={{ display: 'block', fontSize: '.875rem', fontWeight: 500, marginBottom: 4 }}>
            Password
          </label>
          <input
            type="password" required value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="••••••••"
            style={{
              width: '100%', padding: '8px 12px', background: '#09090b',
              border: '1px solid #27272a', borderRadius: 6, color: '#fafafa',
              fontSize: '.875rem', marginBottom: '1rem', boxSizing: 'border-box',
            }}
          />
          <button
            type="submit" disabled={busy}
            style={{
              width: '100%', padding: 10, background: busy ? '#a16207' : '#ca8a04',
              border: 'none', borderRadius: 6, color: '#fff', fontWeight: 600,
              cursor: busy ? 'not-allowed' : 'pointer', fontSize: '.875rem',
            }}
          >
            {busy ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  )
}

export default function BackOfficeShell() {
  const location = useLocation()
  const user = useCockpitStore(s => s.user)
  const sessionChecked = useCockpitStore(s => s.sessionChecked)
  const checkSession = useCockpitStore(s => s.checkSession)

  React.useEffect(() => {
    if (!sessionChecked) checkSession()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Still loading session
  if (!sessionChecked) {
    return (
      <div className="flex items-center justify-center h-screen text-sm text-muted-foreground">
        Loading…
      </div>
    )
  }

  // No valid session — show inline login form (avoids browser-cached redirects)
  if (!user) {
    return <InlineLoginForm />
  }

  const role = user.role
  const path = location.pathname
  const canViewPortal = PORTAL_VIEWER_ROLES.includes(role)
  const canViewImages = IMAGE_VIEWER_ROLES.includes(role)
  const canViewAudit  = AUDIT_VIEWER_ROLES.includes(role)

  function renderWorkspace() {
    if (path === '/portal') {
      if (!canViewPortal) return <Navigate to="/content" replace />
      return <PortalWorkspace />
    }
    if (path === '/' || path === '/content') {
      return <ContentWorkspace />
    }
    if (path === '/personas') {
      return <Navigate to="/authors" replace />
    }
    if (path === '/authors') {
      return <AuthorsWorkspace />
    }
    if (path === '/users') {
      if (role !== 'admin') return <Navigate to="/content" replace />
      return <UserAccountsWorkspace />
    }
    if (path === '/websites') {
      return <WebsitesWorkspace />
    }
    if (path === '/images') {
      if (!canViewImages) return <Navigate to="/content" replace />
      return <ImagesWorkspace />
    }
    if (path === '/prompts') {
      if (role !== 'admin') return <Navigate to="/content" replace />
      return <PromptsWorkspace />
    }
    if (path === '/automation') {
      return <AutomationWorkspace />
    }
    if (path === '/audit') {
      if (!canViewAudit) return <Navigate to="/content" replace />
      return <AuditWorkspace />
    }
    if (path === '/servers') {
      if (role !== 'admin') return <Navigate to="/content" replace />
      return <ServersWorkspace />
    }
    return null
  }

  return (
    <div className="h-screen overflow-hidden bg-background">
      <ShellHeader />
      <div
        className="flex"
        style={{ height: 'calc(100vh - 56px)', marginTop: '56px' }}
      >
        <RailNav canViewPortal={canViewPortal} canViewImages={canViewImages} canViewAudit={canViewAudit} />
        <main className="flex-1 overflow-hidden">
          {renderWorkspace()}
        </main>
      </div>
    </div>
  )
}
