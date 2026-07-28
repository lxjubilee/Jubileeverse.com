/**
 * TreePickerModal.tsx — Prompt-tree node picker for prompt recipe assignments
 *
 * Renders the prompt navigation tree in read-only single-click-to-select mode.
 * On node click: calls assignPromptToNode then closes.
 */

import * as React from 'react'
import { X, ChevronRight, ChevronDown } from 'lucide-react'
import { DialogRoot, DialogContent, DialogTitle } from '../../ui/Dialog'
import { ScrollArea } from '../../ui/ScrollArea'
import { usePromptTree } from '../../../hooks/usePromptTree'
import { useAssignPromptToNode } from '../../../hooks/usePromptRecipeAssignments'
import type { PromptNavNode } from '../../../lib/api'

interface TreePickerModalProps {
  open: boolean
  onClose: () => void
  promptId: string
  existingNodeIds: string[]
}

export function TreePickerModal({ open, onClose, promptId, existingNodeIds }: TreePickerModalProps) {
  const { data, isLoading } = usePromptTree()
  const assign = useAssignPromptToNode()
  const roots: PromptNavNode[] = data?.nodes ?? []

  function handleSelect(nodeId: string) {
    if (existingNodeIds.includes(nodeId)) return
    assign.mutate({ prompt_id: promptId, node_id: nodeId, is_primary: existingNodeIds.length === 0 })
    onClose()
  }

  return (
    <DialogRoot open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-md">
        <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b">
          <DialogTitle className="text-base font-semibold p-0">Assign to Node</DialogTitle>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-2 py-2">
          <p className="px-4 pb-2 text-xs text-muted-foreground">
            Click a node to assign this prompt. Already-assigned nodes are greyed out.
          </p>
          <ScrollArea className="h-72">
            {isLoading && (
              <p className="text-xs text-muted-foreground px-4 py-2">Loading tree…</p>
            )}
            {!isLoading && roots.length === 0 && (
              <p className="text-xs text-muted-foreground px-4 py-2">No nodes found.</p>
            )}
            {roots.map(node => (
              <PickerNode
                key={node.id}
                node={node}
                depth={0}
                existingNodeIds={existingNodeIds}
                onSelect={handleSelect}
              />
            ))}
          </ScrollArea>
        </div>

        <div className="flex justify-end px-6 pb-5">
          <button onClick={onClose} className="rounded border px-4 py-1.5 text-sm hover:bg-muted">
            Cancel
          </button>
        </div>
      </DialogContent>
    </DialogRoot>
  )
}

function PickerNode({
  node,
  depth,
  existingNodeIds,
  onSelect,
}: {
  node: PromptNavNode
  depth: number
  existingNodeIds: string[]
  onSelect: (id: string) => void
}) {
  const [expanded, setExpanded] = React.useState(depth < 1)
  const children = node.children ?? []
  const alreadyAssigned = existingNodeIds.includes(node.id)

  return (
    <div>
      <div
        className={[
          'flex items-center gap-1 rounded py-1 text-sm select-none',
          alreadyAssigned
            ? 'opacity-40 cursor-not-allowed'
            : 'cursor-pointer hover:bg-accent hover:text-accent-foreground',
        ].join(' ')}
        style={{ paddingLeft: `${12 + depth * 16}px`, paddingRight: '12px' }}
        onClick={() => !alreadyAssigned && onSelect(node.id)}
      >
        {children.length > 0 ? (
          <button
            type="button"
            className="h-4 w-4 shrink-0 opacity-50 hover:opacity-100"
            onClick={e => { e.stopPropagation(); setExpanded(v => !v) }}
          >
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        ) : (
          <span className="h-4 w-4 shrink-0" />
        )}
        <span className="flex-1 truncate">{node.title}</span>
        {alreadyAssigned && (
          <span className="text-xs text-muted-foreground">assigned</span>
        )}
      </div>
      {expanded && children.map(child => (
        <PickerNode
          key={child.id}
          node={child}
          depth={depth + 1}
          existingNodeIds={existingNodeIds}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}
