/**
 * PromptNodeTree.tsx — Recursive collapsible tree for prompt navigation nodes
 *
 * Uses @radix-ui/react-context-menu for right-click interactions,
 * mirroring the NodeContextMenu / TaxonomyTree pattern.
 */

import * as React from 'react'
import * as ContextMenu from '@radix-ui/react-context-menu'
import {
  useCreatePromptTreeNode,
  useUpdatePromptTreeNode,
  useDeletePromptTreeNode,
} from '../../hooks/usePromptTree'
import type { PromptNavNode } from '../../lib/api'

interface PromptNodeTreeProps {
  node: PromptNavNode
  depth: number
  searchQuery?: string
  selectedNodeId: string | null
  onSelect: (id: string | null) => void
}

const CTX_ITEM =
  'relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none focus:bg-accent focus:text-accent-foreground'

export function PromptNodeTree({
  node,
  depth,
  searchQuery,
  selectedNodeId,
  onSelect,
}: PromptNodeTreeProps) {
  const [expanded, setExpanded] = React.useState(depth < 1)
  const children = node.children ?? []

  const createNode = useCreatePromptTreeNode()
  const updateNode = useUpdatePromptTreeNode()
  const deleteNode = useDeletePromptTreeNode()

  // Filter: show if this node or any descendant matches search
  const matches = !searchQuery || node.title.toLowerCase().includes(searchQuery.toLowerCase())
  const descendantMatches =
    !searchQuery || children.some(c => nodeOrDescendantMatches(c, searchQuery))
  if (!matches && !descendantMatches) return null

  function handleAddChild() {
    const title = prompt(`Add child to "${node.title}":`)
    if (!title) return
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
    createNode.mutate({ parent_id: node.id, slug, title })
  }

  function handleRename() {
    const title = prompt('New title:', node.title)
    if (!title || title === node.title) return
    updateNode.mutate({ id: node.id, data: { title } })
  }

  function handleDelete() {
    if (!confirm(`Delete "${node.title}" and all its descendants?`)) return
    deleteNode.mutate(node.id)
  }

  const isSelected = node.id === selectedNodeId

  return (
    <div>
      <ContextMenu.Root>
        <ContextMenu.Trigger asChild>
          <div
            className={[
              'group flex items-center gap-1 rounded-md py-1 text-sm cursor-pointer select-none',
              isSelected
                ? 'bg-primary text-primary-foreground'
                : 'hover:bg-accent hover:text-accent-foreground',
            ].join(' ')}
            style={{ paddingLeft: `${8 + depth * 16}px`, paddingRight: '8px' }}
            onClick={() => onSelect(isSelected ? null : node.id)}
          >
            {/* Expand toggle */}
            {children.length > 0 ? (
              <button
                className="h-4 w-4 shrink-0 opacity-50 hover:opacity-100"
                onClick={e => {
                  e.stopPropagation()
                  setExpanded(v => !v)
                }}
              >
                {expanded ? '▾' : '▸'}
              </button>
            ) : (
              <span className="h-4 w-4 shrink-0" />
            )}
            <span className="flex-1 truncate">{node.title}</span>
          </div>
        </ContextMenu.Trigger>

        <ContextMenu.Portal>
          <ContextMenu.Content className="z-50 min-w-[160px] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
            <ContextMenu.Item className={CTX_ITEM} onSelect={handleAddChild}>
              + Add Child Node
            </ContextMenu.Item>
            <ContextMenu.Item className={CTX_ITEM} onSelect={handleRename}>
              Rename Node
            </ContextMenu.Item>
            <ContextMenu.Separator className="my-1 h-px bg-border" />
            <ContextMenu.Item
              className={`${CTX_ITEM} text-destructive focus:text-destructive`}
              onSelect={handleDelete}
            >
              Delete Node
            </ContextMenu.Item>
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>

      {/* Children */}
      {expanded &&
        children.map(child => (
          <PromptNodeTree
            key={child.id}
            node={child}
            depth={depth + 1}
            searchQuery={searchQuery}
            selectedNodeId={selectedNodeId}
            onSelect={onSelect}
          />
        ))}
    </div>
  )
}

function nodeOrDescendantMatches(node: PromptNavNode, query: string): boolean {
  if (node.title.toLowerCase().includes(query.toLowerCase())) return true
  return (node.children ?? []).some(c => nodeOrDescendantMatches(c, query))
}
