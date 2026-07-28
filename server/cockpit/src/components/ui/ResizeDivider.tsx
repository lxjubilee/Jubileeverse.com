import * as React from 'react'

interface ResizeDividerProps {
  onMouseDown: (e: React.MouseEvent) => void
}

/**
 * ResizeDivider — a thin vertical drag handle between panels.
 * Place directly after the left panel element.
 */
export function ResizeDivider({ onMouseDown }: ResizeDividerProps) {
  return (
    <div
      onMouseDown={onMouseDown}
      className="w-1 shrink-0 cursor-col-resize bg-border/0 hover:bg-primary/40 active:bg-primary/60 transition-colors z-10"
      title="Drag to resize"
    />
  )
}
