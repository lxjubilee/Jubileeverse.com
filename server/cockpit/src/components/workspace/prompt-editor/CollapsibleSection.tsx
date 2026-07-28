/**
 * CollapsibleSection.tsx — Expand/collapse form section with chevron header
 */

import * as React from 'react'
import { ChevronDown } from 'lucide-react'

interface CollapsibleSectionProps {
  title: string
  children: React.ReactNode
  defaultOpen?: boolean
}

export function CollapsibleSection({ title, children, defaultOpen = true }: CollapsibleSectionProps) {
  const [open, setOpen] = React.useState(defaultOpen)

  return (
    <div className="border-b">
      <button
        type="button"
        className="flex w-full items-center justify-between px-4 py-2.5 text-xs font-semibold uppercase text-muted-foreground tracking-wide hover:bg-muted/30 transition-colors"
        onClick={() => setOpen(v => !v)}
      >
        {title}
        <ChevronDown
          size={14}
          style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 150ms' }}
        />
      </button>
      {open && <div className="px-4 pb-4 pt-2 space-y-3">{children}</div>}
    </div>
  )
}
