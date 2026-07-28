import * as RadixPopover from '@radix-ui/react-popover'

export const PopoverRoot    = RadixPopover.Root
export const PopoverTrigger = RadixPopover.Trigger

export interface PopoverContentProps extends RadixPopover.PopoverContentProps {
  className?: string
}

export function PopoverContent({ className = '', children, sideOffset = 4, ...props }: PopoverContentProps) {
  return (
    <RadixPopover.Portal>
      <RadixPopover.Content
        sideOffset={sideOffset}
        className={[
          'z-50 w-72 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none',
          'data-[state=open]:animate-in data-[state=closed]:animate-out',
          'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
          className,
        ].join(' ')}
        {...props}
      >
        {children}
      </RadixPopover.Content>
    </RadixPopover.Portal>
  )
}
