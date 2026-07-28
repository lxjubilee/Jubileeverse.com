import * as React from 'react'

/**
 * useResizablePanel — drag-to-resize a left panel.
 *
 * Persists width to localStorage under `panel-width-{storageKey}`.
 * Returns the current width and a mousedown handler to attach to a resize divider.
 */
export function useResizablePanel(
  storageKey: string,
  defaultWidth = 280,
  minWidth = 160,
  maxWidth = 520,
) {
  const [width, setWidth] = React.useState<number>(() => {
    try {
      const stored = localStorage.getItem(`panel-width-${storageKey}`)
      if (stored) {
        const n = parseInt(stored, 10)
        if (!isNaN(n)) return Math.max(minWidth, Math.min(maxWidth, n))
      }
    } catch {}
    return defaultWidth
  })

  const startResize = React.useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      const startX = e.clientX
      const startWidth = width

      function onMove(ev: MouseEvent) {
        const newW = Math.max(minWidth, Math.min(maxWidth, startWidth + ev.clientX - startX))
        setWidth(newW)
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        setWidth(w => {
          try { localStorage.setItem(`panel-width-${storageKey}`, String(w)) } catch {}
          return w
        })
      }

      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
    },
    [width, storageKey, minWidth, maxWidth],
  )

  return { width, startResize }
}
