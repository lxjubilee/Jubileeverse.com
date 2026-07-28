/**
 * PromptNavPanel.tsx — Left 280px panel for the Prompts workspace
 *
 * Header (label + add-root button) → scrollable tree → bottom debounced search.
 * Mirrors TaxonomyPanelFull layout.
 */

import * as React from 'react'
import { Plus, Search } from 'lucide-react'
import { ScrollArea } from '../ui/ScrollArea'
import { usePromptTree, useCreatePromptTreeNode } from '../../hooks/usePromptTree'
import { PromptNodeTree } from '../taxonomy/PromptNodeTree'
import type { PromptNavNode } from '../../lib/api'

interface PromptNavPanelProps {
  selectedNodeId: string | null
  onNodeSelect: (id: string | null) => void
}

export function PromptNavPanel({ selectedNodeId, onNodeSelect }: PromptNavPanelProps) {
  const { data, isLoading } = usePromptTree()
  const createNode = useCreatePromptTreeNode()
  const roots: PromptNavNode[] = data?.nodes ?? []

  const [searchRaw, setSearchRaw] = React.useState('')
  const [searchQuery, setSearchQuery] = React.useState('')
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  function handleSearchChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value
    setSearchRaw(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setSearchQuery(val), 200)
  }

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter' || !searchQuery.trim()) return
    function find(nodes: PromptNavNode[]): PromptNavNode | null {
      for (const n of nodes) {
        if (n.title.toLowerCase().includes(searchQuery.toLowerCase())) return n
        if (n.children) {
          const f = find(n.children)
          if (f) return f
        }
      }
      return null
    }
    const match = find(roots)
    if (match) onNodeSelect(match.id)
  }

  function handleAddRoot() {
    const title = prompt('Root node title:')
    if (!title) return
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
    createNode.mutate({ slug, title })
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <span className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">
          Prompt Library
        </span>
        <button
          onClick={handleAddRoot}
          title="Add root node"
          className="h-6 w-6 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* Scrollable tree */}
      <ScrollArea className="flex-1">
        <div className="p-1">
          {isLoading && (
            <p className="text-xs text-muted-foreground px-2 py-1">Loading…</p>
          )}
          {!isLoading && roots.length === 0 && (
            <p className="text-xs text-muted-foreground px-2 py-1">No nodes found.</p>
          )}
          {roots.map(node => (
            <PromptNodeTree
              key={node.id}
              node={node}
              depth={0}
              searchQuery={searchQuery}
              selectedNodeId={selectedNodeId}
              onSelect={onNodeSelect}
            />
          ))}
        </div>
      </ScrollArea>

      {/* Search pinned to bottom — mirrors TaxonomyPanelFull */}
      <div className="border-t p-2">
        <div className="relative">
          <Search
            size={12}
            className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
          />
          <input
            type="text"
            placeholder="Search nodes… (Enter to jump)"
            value={searchRaw}
            onChange={handleSearchChange}
            onKeyDown={handleSearchKeyDown}
            className="w-full rounded border bg-background pl-6 pr-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>
    </div>
  )
}
