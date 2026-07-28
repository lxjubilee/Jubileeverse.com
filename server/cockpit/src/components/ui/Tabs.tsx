import * as RadixTabs from '@radix-ui/react-tabs'

export const TabsRoot = RadixTabs.Root

export function TabsList({ className = '', ...props }: RadixTabs.TabsListProps) {
  return (
    <RadixTabs.List
      className={[
        'inline-flex h-9 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground',
        className,
      ].join(' ')}
      {...props}
    />
  )
}

export function TabsTrigger({ className = '', ...props }: RadixTabs.TabsTriggerProps) {
  return (
    <RadixTabs.Trigger
      className={[
        'inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium',
        'ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2',
        'focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
        'data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow',
        className,
      ].join(' ')}
      {...props}
    />
  )
}

export function TabsContent({ className = '', ...props }: RadixTabs.TabsContentProps) {
  return (
    <RadixTabs.Content
      className={[
        'mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2',
        'focus-visible:ring-ring focus-visible:ring-offset-2',
        className,
      ].join(' ')}
      {...props}
    />
  )
}
