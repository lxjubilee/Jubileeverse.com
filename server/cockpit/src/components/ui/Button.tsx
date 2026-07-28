import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'

export type ButtonVariant = 'default' | 'outline' | 'ghost' | 'destructive' | 'link'
export type ButtonSize    = 'sm' | 'md' | 'lg' | 'icon'

const variantClasses: Record<ButtonVariant, string> = {
  default:     'bg-primary text-primary-foreground hover:bg-primary/90',
  outline:     'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
  ghost:       'hover:bg-accent hover:text-accent-foreground',
  destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
  link:        'text-primary underline-offset-4 hover:underline',
}

const sizeClasses: Record<ButtonSize, string> = {
  sm:   'h-8 px-3 text-xs rounded',
  md:   'h-9 px-4 py-2 text-sm rounded-md',
  lg:   'h-10 px-6 text-sm rounded-md',
  icon: 'h-9 w-9 rounded-md',
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  asChild?: boolean
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className = '', variant = 'default', size = 'md', asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        ref={ref}
        className={[
          'inline-flex items-center justify-center whitespace-nowrap font-medium',
          'ring-offset-background transition-colors focus-visible:outline-none',
          'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          'disabled:pointer-events-none disabled:opacity-50',
          variantClasses[variant],
          sizeClasses[size],
          className,
        ].join(' ')}
        {...props}
      />
    )
  }
)
Button.displayName = 'Button'
