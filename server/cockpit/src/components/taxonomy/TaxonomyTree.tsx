/**
 * TaxonomyTree.tsx — Recursive collapsible tree (Phase 4)
 */

import * as React from 'react'
import { Badge } from '../ui/Badge'
import { NodeContextMenu } from './NodeContextMenu'
import { useTaxonomyNode } from '../../hooks/useTaxonomy'
import { useCockpitStore } from '../../hooks/useCockpitStore'
import type { TaxonomyNode } from '../../lib/api'
import type { TaxonomyType } from '../../types/taxonomy'

// ── Freshness dot ─────────────────────────────────────────────────────────────

function FreshnessDot({ updatedAt }: { updatedAt: string }) {
  const age = Date.now() - new Date(updatedAt).getTime()
  const days = age / 86_400_000
  const color = days < 7 ? 'bg-green-500' : days < 30 ? 'bg-yellow-500' : 'bg-red-400'
  return <span className={`inline-block h-1.5 w-1.5 rounded-full ${color} ml-1.5 flex-shrink-0`} />
}

// ── Single tree node ──────────────────────────────────────────────────────────

interface TreeNodeProps {
  node: TaxonomyNode
  depth: number
  searchQuery?: string
  onSelectNode: (node: TaxonomyNode) => void
  selectedNodeId: number | null
  taxonomyType: TaxonomyType
}

function TreeNode({ node, depth, searchQuery, onSelectNode, selectedNodeId, taxonomyType }: TreeNodeProps) {
  const [expanded, setExpanded] = React.useState(depth < 1)
  // Lazy-load children on expand
  const { data: detail } = useTaxonomyNode(
    taxonomyType,
    expanded && !node.children ? node.slug : null
  )
  const children = node.children ?? detail?.children ?? []

  const isSelected  = node.id === selectedNodeId
  const hasChildren = children.length > 0 ||
    parseInt((node as unknown as Record<string, string>).child_count ?? '0') > 0 ||
    !!(node.config as Record<string, unknown>)?.has_children

  // Filter by search query
  const label = node.title || node.name
  if (searchQuery && !label.toLowerCase().includes(searchQuery.toLowerCase())) return null

  return (
    <div>
      <NodeContextMenu
        node={node}
        onCreateChild={n => console.log('create child', n)}
        onEdit={n => console.log('edit', n)}
        onMove={n => console.log('move', n)}
        onViewContent={onSelectNode}
        onCopyPath={n => navigator.clipboard?.writeText(n.materialized_path)}
        onDelete={n => console.log('delete', n)}
      >
        <div
          className={[
            'group flex items-center gap-1 rounded-md px-2 py-1 text-sm cursor-pointer select-none',
            isSelected
              ? 'bg-primary text-primary-foreground'
              : 'hover:bg-accent hover:text-accent-foreground',
          ].join(' ')}
          style={{ paddingLeft: `${8 + depth * 16}px` }}
          onClick={() => onSelectNode(node)}
        >
          {/* Collapse toggle */}
          {hasChildren ? (
            <button
              className="h-4 w-4 shrink-0 opacity-50 hover:opacity-100"
              onClick={e => { e.stopPropagation(); setExpanded(v => !v) }}
            >
              {expanded ? '▾' : '▸'}
            </button>
          ) : (
            <span className="h-4 w-4 shrink-0" />
          )}

          <span className="flex-1 truncate">{label}</span>

          {node.content_count != null && node.content_count > 0 && (
            <Badge variant="secondary" className="ml-auto text-xs px-1.5 py-0">
              {node.content_count}
            </Badge>
          )}

          <FreshnessDot updatedAt={node.updated_at} />
        </div>
      </NodeContextMenu>

      {expanded && children.length > 0 && (
        <div>
          {children.map(child => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              searchQuery={searchQuery}
              onSelectNode={onSelectNode}
              selectedNodeId={selectedNodeId}
              taxonomyType={taxonomyType}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Public component ──────────────────────────────────────────────────────────

export interface TaxonomyTreeProps {
  nodes: TaxonomyNode[]
  searchQuery?: string
  taxonomyType: TaxonomyType
}

export function TaxonomyTree({ nodes, searchQuery, taxonomyType }: TaxonomyTreeProps) {
  const selectedNodeId = useCockpitStore(s => s.selectedNodeId)
  const setSelectedNode = useCockpitStore(s => s.setSelectedNode)

  function handleSelect(node: TaxonomyNode) {
    setSelectedNode(node.id, node.slug, node.materialized_path ?? null)
  }

  return (
    <div className="py-1">
      {nodes.map(node => (
        <TreeNode
          key={node.id}
          node={node}
          depth={0}
          searchQuery={searchQuery}
          onSelectNode={handleSelect}
          selectedNodeId={selectedNodeId}
          taxonomyType={taxonomyType}
        />
      ))}
    </div>
  )
}
