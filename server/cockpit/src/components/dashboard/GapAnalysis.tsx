/**
 * GapAnalysis.tsx — Highlights zero-count content types for selected node (Phase 4, AC4)
 */

import { Badge }   from '../ui/Badge'
import { Button }  from '../ui/Button'
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card'
import { useContentSearch } from '../../hooks/useContent'
import { useTaxonomyNode }  from '../../hooks/useTaxonomy'
import { useCockpitStore }  from '../../hooks/useCockpitStore'
import { OBJECT_TYPES }     from '../../types/content-objects'
import type { ObjectType }  from '../../types/content-objects'

interface GapAnalysisProps {
  onGenerate: (objectType: ObjectType) => void
}

export function GapAnalysis({ onGenerate }: GapAnalysisProps) {
  const selectedNodeId = useCockpitStore(s => s.selectedNodeId)
  const selectedNodeSlug = useCockpitStore(s => s.selectedNodeSlug)
  const selectedTaxonomyType = useCockpitStore(s => s.selectedTaxonomyType)

  const { data: nodeDetail } = useTaxonomyNode(
    selectedTaxonomyType as import('../../types/taxonomy').TaxonomyType,
    selectedNodeSlug
  )
  const { data: searchData } = useContentSearch(
    selectedNodeId != null ? { taxonomy_node_id: selectedNodeId, limit: 1 } : { limit: 1 }
  )

  const facets        = searchData?.facets?.type ?? {}
  const nodeConfig    = nodeDetail?.config ?? {}
  const allowedTypes  = (nodeConfig as { allowed_content_types?: ObjectType[] }).allowed_content_types
    ?? OBJECT_TYPES

  const missingTypes = allowedTypes.filter(t => !facets[t] || facets[t] === 0)

  if (!selectedNodeId) {
    return (
      <Card className="m-3">
        <CardContent>
          <p className="py-4 text-xs text-muted-foreground text-center">
            Select a taxonomy node to see gap analysis.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="m-3">
      <CardHeader>
        <CardTitle>Gap Analysis</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {missingTypes.length === 0 ? (
          <p className="text-xs text-green-600">All content types are covered.</p>
        ) : (
          missingTypes.map(type => (
            <div key={type} className="flex items-center justify-between rounded px-2 py-1 bg-destructive/10">
              <div className="flex items-center gap-1.5">
                <Badge variant="destructive" className="text-xs px-1.5 py-0">Missing</Badge>
                <span className="text-xs capitalize">{type.replace('_', ' ')}</span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => onGenerate(type)}
              >
                Generate
              </Button>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
}
