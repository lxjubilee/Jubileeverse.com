/**
 * ThreePanelLayout.tsx — Resizable three-panel cockpit shell (Phase 4)
 *
 * Uses react-resizable-panels for drag-to-resize behaviour.
 * Responsive: right panel collapses at ≤1200px; left panel collapses at ≤900px.
 */

import * as React from 'react'
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels'
import * as RadixDialog from '@radix-ui/react-dialog'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ThreePanelLayoutProps {
  left:   React.ReactNode
  center: React.ReactNode
  right:  React.ReactNode
  /** Controlled sheet state for the right panel at narrow widths */
  rightPanelOpen?: boolean
  onRightPanelOpenChange?: (open: boolean) => void
}

// ── Resize handle ─────────────────────────────────────────────────────────────

function ResizeHandle({ className = '' }: { className?: string }) {
  return (
    <PanelResizeHandle
      className={[
        'w-1 bg-border hover:bg-primary/40 transition-colors cursor-col-resize',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        className,
      ].join(' ')}
    />
  )
}

// ── Slide-out sheet (Radix Dialog) ────────────────────────────────────────────

interface SheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: React.ReactNode
  title: string
}

function Sheet({ open, onOpenChange, children, title }: SheetProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-black/40 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <RadixDialog.Content
          className={[
            'fixed right-0 top-0 z-50 h-full w-80 max-w-full bg-background shadow-xl',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right',
          ].join(' ')}
        >
          <RadixDialog.Title className="sr-only">{title}</RadixDialog.Title>
          <div className="h-full overflow-auto">{children}</div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function ThreePanelLayout({
  left,
  center,
  right,
  rightPanelOpen = false,
  onRightPanelOpenChange,
}: ThreePanelLayoutProps) {
  // Detect breakpoints via CSS media query
  const [isNarrow,  setIsNarrow]  = React.useState(false)  // ≤ 900px
  const [isMedium,  setIsMedium]  = React.useState(false)  // ≤ 1200px

  React.useEffect(() => {
    const narrowMq = window.matchMedia('(max-width: 900px)')
    const medMq    = window.matchMedia('(max-width: 1200px)')

    const onNarrow = (e: MediaQueryListEvent | MediaQueryList) => setIsNarrow(e.matches)
    const onMed    = (e: MediaQueryListEvent | MediaQueryList) => setIsMedium(e.matches)

    onNarrow(narrowMq)
    onMed(medMq)
    narrowMq.addEventListener('change', onNarrow)
    medMq.addEventListener('change', onMed)
    return () => {
      narrowMq.removeEventListener('change', onNarrow)
      medMq.removeEventListener('change', onMed)
    }
  }, [])

  // Very narrow: both side panels become sheets
  if (isNarrow) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex-1 overflow-hidden">{center}</div>
        <Sheet open={rightPanelOpen} onOpenChange={onRightPanelOpenChange ?? (() => {})} title="Dashboard">
          {right}
        </Sheet>
      </div>
    )
  }

  // Medium: right panel becomes a sheet
  if (isMedium) {
    return (
      <PanelGroup orientation="horizontal" className="h-full">
        <Panel defaultSize={25} minSize={18} maxSize={35}>
          <div className="h-full overflow-hidden">{left}</div>
        </Panel>
        <ResizeHandle />
        <Panel>
          <div className="h-full overflow-hidden">{center}</div>
        </Panel>
        <Sheet open={rightPanelOpen} onOpenChange={onRightPanelOpenChange ?? (() => {})} title="Dashboard">
          {right}
        </Sheet>
      </PanelGroup>
    )
  }

  // Full layout (≥ 1200px)
  return (
    <PanelGroup orientation="horizontal" className="h-full">
      <Panel defaultSize={22} minSize={17} maxSize={33}>
        <div className="h-full overflow-hidden">{left}</div>
      </Panel>
      <ResizeHandle />
      <Panel>
        <div className="h-full overflow-hidden">{center}</div>
      </Panel>
      <ResizeHandle />
      <Panel defaultSize={28} minSize={23} maxSize={40}>
        <div className="h-full overflow-hidden">{right}</div>
      </Panel>
    </PanelGroup>
  )
}
