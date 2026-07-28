import * as React from 'react'
import * as RadixScroll from '@radix-ui/react-scroll-area'

export interface ScrollAreaProps {
  className?: string
  children?: React.ReactNode
  orientation?: 'vertical' | 'horizontal' | 'both'
  style?: React.CSSProperties
}

export function ScrollArea({ className = '', children, orientation = 'vertical', style }: ScrollAreaProps) {
  return (
    <RadixScroll.Root
      className={['relative overflow-hidden', className].join(' ')}
      style={style}
    >
      <RadixScroll.Viewport className="h-full w-full rounded-[inherit]">
        {children}
      </RadixScroll.Viewport>
      {(orientation === 'vertical' || orientation === 'both') && (
        <RadixScroll.Scrollbar
          orientation="vertical"
          className="flex touch-none select-none transition-colors w-2.5 border-l border-l-transparent p-[1px]"
        >
          <RadixScroll.Thumb className="relative flex-1 rounded-full bg-border" />
        </RadixScroll.Scrollbar>
      )}
      {(orientation === 'horizontal' || orientation === 'both') && (
        <RadixScroll.Scrollbar
          orientation="horizontal"
          className="flex touch-none select-none transition-colors h-2.5 border-t border-t-transparent p-[1px] flex-col"
        >
          <RadixScroll.Thumb className="relative flex-1 rounded-full bg-border" />
        </RadixScroll.Scrollbar>
      )}
      <RadixScroll.Corner />
    </RadixScroll.Root>
  )
}
