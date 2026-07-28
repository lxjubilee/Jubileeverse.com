/**
 * CoverageMetrics.tsx — Object counts by type for selected taxonomy node (Phase 4, AC4)
 */

import { Badge }   from '../ui/Badge'
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card'
import { useContentSearch } from '../../hooks/useContent'
import { useCockpitStore }  from '../../hooks/useCockpitStore'
import { OBJECT_TYPES }     from '../../types/content-objects'

export function CoverageMetrics() {
  const selectedNodeId = useCockpitStore(s => s.selectedNodeId)

  const { data, isLoading } = useContentSearch(
    selectedNodeId != null
      ? { taxonomy_node_id: selectedNodeId, limit: 1 }
      : { limit: 1 }
  )

  const facets = data?.facets?.type ?? {}

  return (
    <Card className="m-3">
      <CardHeader>
        <CardTitle>Coverage by Type</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}
        {!isLoading && (
          <div className="grid grid-cols-2 gap-1.5 text-xs">
            {OBJECT_TYPES.map(type => {
              const count = facets[type] ?? 0
              return (
                <div key={type} className="flex items-center justify-between rounded px-2 py-1 bg-muted/50">
                  <span className="text-muted-foreground capitalize">{type.replace('_', ' ')}</span>
                  <Badge variant={count > 0 ? 'secondary' : 'outline'} className="text-xs px-1.5 py-0">
                    {count}
                  </Badge>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
