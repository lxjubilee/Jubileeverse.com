import * as RadixCheckbox from '@radix-ui/react-checkbox'

export interface CheckboxProps {
  checked?: boolean | 'indeterminate'
  onCheckedChange?: (checked: boolean | 'indeterminate') => void
  disabled?: boolean
  id?: string
  className?: string
}

export function Checkbox({ className = '', ...props }: CheckboxProps) {
  return (
    <RadixCheckbox.Root
      className={[
        'h-4 w-4 shrink-0 rounded-sm border border-primary shadow',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground',
        className,
      ].join(' ')}
      {...props}
    >
      <RadixCheckbox.Indicator className="flex items-center justify-center text-current">
        <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none">
          <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </RadixCheckbox.Indicator>
    </RadixCheckbox.Root>
  )
}
