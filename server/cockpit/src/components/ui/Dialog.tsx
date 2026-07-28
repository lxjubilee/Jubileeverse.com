/**
 * Dialog.tsx — Styled wrappers over @radix-ui/react-dialog
 */

import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'

export const DialogRoot      = DialogPrimitive.Root
export const DialogTrigger   = DialogPrimitive.Trigger
export const DialogPortal    = DialogPrimitive.Portal
export const DialogClose     = DialogPrimitive.Close
export const DialogTitle     = DialogPrimitive.Title
export const DialogDescription = DialogPrimitive.Description

export function DialogOverlay({ className = '', ...props }: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      className={[
        'fixed inset-0 z-50 bg-black/50 backdrop-blur-sm',
        'data-[state=open]:animate-in data-[state=closed]:animate-out',
        'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
        className,
      ].join(' ')}
      {...props}
    />
  )
}

export function DialogContent({
  className = '',
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        className={[
          'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2',
          'w-full max-w-2xl max-h-[85vh] overflow-y-auto',
          'rounded-lg bg-background shadow-xl p-0',
          'data-[state=open]:animate-in data-[state=closed]:animate-out',
          'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
          'data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%]',
          'data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]',
          className,
        ].join(' ')}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}
