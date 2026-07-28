/**
 * NodeContextMenu.tsx — Right-click context menu for taxonomy nodes (Phase 4)
 */

import * as React from 'react'
import * as ContextMenu from '@radix-ui/react-context-menu'
import type { TaxonomyNode } from '../../lib/api'

export interface NodeContextMenuProps {
  node: TaxonomyNode
  children: React.ReactNode
  onCreateChild: (node: TaxonomyNode) => void
  onEdit:        (node: TaxonomyNode) => void
  onMove:        (node: TaxonomyNode) => void
  onViewContent: (node: TaxonomyNode) => void
  onCopyPath:    (node: TaxonomyNode) => void
  onDelete:      (node: TaxonomyNode) => void
}

const itemClass = [
  'relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none',
  'focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
].join(' ')

export function NodeContextMenu({
  node, children,
  onCreateChild, onEdit, onMove, onViewContent, onCopyPath, onDelete,
}: NodeContextMenuProps) {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="z-50 min-w-[160px] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
          <ContextMenu.Item className={itemClass} onSelect={() => onCreateChild(node)}>
            + Create child node
          </ContextMenu.Item>
          <ContextMenu.Item className={itemClass} onSelect={() => onEdit(node)}>
            Edit node
          </ContextMenu.Item>
          <ContextMenu.Item className={itemClass} onSelect={() => onMove(node)}>
            Move node…
          </ContextMenu.Item>
          <ContextMenu.Separator className="my-1 h-px bg-border" />
          <ContextMenu.Item className={itemClass} onSelect={() => onViewContent(node)}>
            View content
          </ContextMenu.Item>
          <ContextMenu.Item className={itemClass} onSelect={() => onCopyPath(node)}>
            Copy path
          </ContextMenu.Item>
          <ContextMenu.Separator className="my-1 h-px bg-border" />
          <ContextMenu.Item
            className={[itemClass, 'text-destructive focus:text-destructive'].join(' ')}
            onSelect={() => onDelete(node)}
          >
            Delete node
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  )
}
