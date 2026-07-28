import * as RadixSelect from '@radix-ui/react-select'

export interface SelectOption {
  value: string
  label: string
}

export interface SelectProps {
  value?: string
  onValueChange?: (value: string) => void
  options: SelectOption[]
  placeholder?: string
  disabled?: boolean
  className?: string
}

// Radix Select.Item forbids value=''. We use this sentinel internally so that
// "All / None" options (value: '') work correctly — the sentinel is mapped back
// to '' before calling onValueChange, and '' is mapped to undefined for Radix
// (which clears the selection and shows the placeholder).
const CLEAR_SENTINEL = '__select_clear__'

export function Select({ value, onValueChange, options, placeholder = 'Select…', disabled, className = '' }: SelectProps) {
  // Split options: empty-value option becomes the placeholder label + a clear item
  const clearOption = options.find(o => o.value === '')
  const selectableOptions = options.filter(o => o.value !== '')
  const effectivePlaceholder = clearOption ? clearOption.label : placeholder

  // Radix value: '' and undefined both mean "show placeholder"
  const radixValue = (value === '' || value == null) ? undefined : value

  function handleChange(v: string) {
    onValueChange?.(v === CLEAR_SENTINEL ? '' : v)
  }

  return (
    <RadixSelect.Root value={radixValue} onValueChange={handleChange} disabled={disabled}>
      <RadixSelect.Trigger
        className={[
          'flex h-9 w-full items-center justify-between rounded-md border border-input',
          'bg-background px-3 py-2 text-sm shadow-sm',
          'focus:outline-none focus:ring-1 focus:ring-ring',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        ].join(' ')}
      >
        <RadixSelect.Value placeholder={effectivePlaceholder} />
        <RadixSelect.Icon className="ml-2 opacity-50">▾</RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content
          className="z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md"
          position="popper"
          sideOffset={4}
        >
          <RadixSelect.Viewport className="p-1">
            {clearOption && (
              <RadixSelect.Item
                key={CLEAR_SENTINEL}
                value={CLEAR_SENTINEL}
                className="relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
              >
                <RadixSelect.ItemText>{clearOption.label}</RadixSelect.ItemText>
              </RadixSelect.Item>
            )}
            {selectableOptions.map(opt => (
              <RadixSelect.Item
                key={opt.value}
                value={opt.value}
                className="relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
              >
                <RadixSelect.ItemText>{opt.label}</RadixSelect.ItemText>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  )
}
