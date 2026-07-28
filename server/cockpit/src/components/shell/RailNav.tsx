/**
 * RailNav.tsx — 46px icon-only vertical rail navigation.
 *
 * Three groups separated by two dividers:
 *   Group 1 (Editorial):  Portal, Content, Authors, Images, Websites
 *   Group 2 (System):     Prompts (admin), Automation, Audit
 *   Group 3 (Admin):      User Accounts (admin), Servers (admin)
 *
 * Each icon is wrapped in a full-width centering div so the w-9 h-9 button
 * is always pixel-perfectly centered inside the 46px rail regardless of how
 * the Radix Tooltip.Root renders in the React tree.
 */

import { LayoutDashboard, FileText, PenLine, Globe, BookOpen, Zap, UserCog, Image, ShieldCheck, Server } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { Tooltip } from '../ui/Tooltip'
import { useCockpitStore } from '../../hooks/useCockpitStore'

interface RailNavProps {
  canViewPortal?: boolean
  canViewImages?: boolean
  canViewAudit?: boolean
}

const NAV_LINK_CLASS = ({ isActive }: { isActive: boolean }) =>
  [
    'flex items-center justify-center rounded-lg w-9 h-9 shrink-0 transition-colors focus:outline-none',
    isActive
      ? 'bg-[#E6AC00]/15 text-[#E6AC00]'
      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
  ].join(' ')

/** Wrapper that guarantees horizontal + vertical centering of each icon within the 46px rail */
function NavItem({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-center w-full h-9">
      {children}
    </div>
  )
}

export function RailNav({ canViewPortal = false, canViewImages = false, canViewAudit = false }: RailNavProps) {
  const user = useCockpitStore(s => s.user)
  const isAdmin = user?.role === 'admin'

  return (
    <nav
      className="flex flex-col gap-0.5 py-2 border-r bg-background shrink-0"
      style={{ width: '46px' }}
      aria-label="Main navigation"
    >
      {/* ── Group 1: Editorial workspaces ─────────────────────────────── */}

      {canViewPortal && (
        <NavItem>
          <Tooltip content="Portal" side="right">
            <NavLink to="/portal" className={NAV_LINK_CLASS} aria-label="Portal">
              <LayoutDashboard size={16} />
            </NavLink>
          </Tooltip>
        </NavItem>
      )}

      <NavItem>
        <Tooltip content="Content" side="right">
          <NavLink to="/content" end className={NAV_LINK_CLASS} aria-label="Content">
            <FileText size={16} />
          </NavLink>
        </Tooltip>
      </NavItem>

      <NavItem>
        <Tooltip content="Authors" side="right">
          <NavLink to="/authors" className={NAV_LINK_CLASS} aria-label="Authors">
            <PenLine size={16} />
          </NavLink>
        </Tooltip>
      </NavItem>

      {canViewImages && (
        <NavItem>
          <Tooltip content="Images" side="right">
            <NavLink to="/images" className={NAV_LINK_CLASS} aria-label="Images">
              <Image size={16} />
            </NavLink>
          </Tooltip>
        </NavItem>
      )}

      <NavItem>
        <Tooltip content="Websites" side="right">
          <NavLink to="/websites" className={NAV_LINK_CLASS} aria-label="Websites">
            <Globe size={16} />
          </NavLink>
        </Tooltip>
      </NavItem>

      {/* ── Divider: Editorial ↔ System tools ─────────────────────────── */}
      <div className="flex items-center justify-center w-full my-0.5" aria-hidden="true">
        <div className="w-8 border-t border-border" />
      </div>

      {/* ── Group 2: System tools ──────────────────────────────────────── */}

      {isAdmin && (
        <NavItem>
          <Tooltip content="Prompts" side="right">
            <NavLink to="/prompts" className={NAV_LINK_CLASS} aria-label="Prompts">
              <BookOpen size={16} />
            </NavLink>
          </Tooltip>
        </NavItem>
      )}

      <NavItem>
        <Tooltip content="Automation" side="right">
          <NavLink to="/automation" className={NAV_LINK_CLASS} aria-label="Automation">
            <Zap size={16} />
          </NavLink>
        </Tooltip>
      </NavItem>

      {canViewAudit && (
        <NavItem>
          <Tooltip content="Audit" side="right">
            <NavLink to="/audit" className={NAV_LINK_CLASS} aria-label="Audit">
              <ShieldCheck size={16} />
            </NavLink>
          </Tooltip>
        </NavItem>
      )}

      {/* ── Divider: System tools ↔ Administration ─────────────────────── */}
      <div className="flex items-center justify-center w-full my-0.5" aria-hidden="true">
        <div className="w-8 border-t border-border" />
      </div>

      {/* ── Group 3: Administration ────────────────────────────────────── */}

      {isAdmin && (
        <NavItem>
          <Tooltip content="User Accounts" side="right">
            <NavLink to="/users" className={NAV_LINK_CLASS} aria-label="User Accounts">
              <UserCog size={16} />
            </NavLink>
          </Tooltip>
        </NavItem>
      )}

      {isAdmin && (
        <NavItem>
          <Tooltip content="Servers" side="right">
            <NavLink to="/servers" className={NAV_LINK_CLASS} aria-label="Servers">
              <Server size={16} />
            </NavLink>
          </Tooltip>
        </NavItem>
      )}
    </nav>
  )
}
