/**
 * CockpitLayout.tsx — Three-panel editorial cockpit main view (Phase 4)
 *
 * Left:   TaxonomyNavigator
 * Center: ContentList
 * Right:  ContextualDashboard
 */

import * as React from 'react'
import { ThreePanelLayout }      from '../components/layout/ThreePanelLayout'
import { TaxonomyNavigator }     from '../components/taxonomy/TaxonomyNavigator'
import { ContentList }           from '../components/content/ContentList'
import { ContextualDashboard }   from '../components/dashboard/ContextualDashboard'
import { useCockpitStore }       from '../hooks/useCockpitStore'
import { Button }                from '../components/ui/Button'
import { useNavigate }           from 'react-router-dom'

export function CockpitLayout() {
  const user                       = useCockpitStore(s => s.user)
  const [rightOpen, setRightOpen]  = React.useState(false)
  const navigate                   = useNavigate()

  // Redirect to login if not authenticated
  React.useEffect(() => {
    if (!user) navigate('/backoffice/login', { replace: true })
  }, [user, navigate])

  if (!user) return null

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {/* Top bar */}
      <header className="flex h-10 flex-shrink-0 items-center justify-between border-b px-4">
        <div className="flex items-center gap-3">
          <span className="font-semibold text-sm">JubileeVerse PubOS</span>
          <span className="text-xs text-muted-foreground">Editorial Back Office</span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setRightOpen(o => !o)}>
            Dashboard ▾
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => { window.location.href = '/auth/logout' }}>
            Sign out
          </Button>
        </div>
      </header>

      {/* Three-panel body */}
      <div className="flex-1 overflow-hidden">
        <ThreePanelLayout
          left={<TaxonomyNavigator />}
          center={<ContentList />}
          right={<ContextualDashboard />}
          rightPanelOpen={rightOpen}
          onRightPanelOpenChange={setRightOpen}
        />
      </div>
    </div>
  )
}
