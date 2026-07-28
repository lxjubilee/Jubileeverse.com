/**
 * RevisionSidebar.tsx — Version history + diff viewer (Phase 4)
 */

import * as React from 'react'
import { Button }  from '../ui/Button'
import { Badge }   from '../ui/Badge'
import { ScrollArea } from '../ui/ScrollArea'
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card'
import { useRevisions } from '../../hooks/useContent'
import { useRollbackContent } from '../../hooks/useContent'
import * as api from '../../lib/api'
import type { ContentDiffResponse } from '../../types/content-objects'

export interface RevisionSidebarProps {
  objectId: string
}

export function RevisionSidebar({ objectId }: RevisionSidebarProps) {
  const { data: revisions = [], isLoading } = useRevisions(objectId)
  const rollback = useRollbackContent()
  const [diffA, setDiffA] = React.useState<number | null>(null)
  const [diffB, setDiffB] = React.useState<number | null>(null)
  const [diff,  setDiff]  = React.useState<ContentDiffResponse | null>(null)
  const [diffLoading, setDiffLoading] = React.useState(false)

  async function viewDiff() {
    if (diffA == null || diffB == null) return
    setDiffLoading(true)
    try {
      const result = await api.diffContent(objectId, Math.min(diffA, diffB), Math.max(diffA, diffB))
      setDiff(result)
    } catch {
      setDiff(null)
    } finally {
      setDiffLoading(false)
    }
  }

  async function handleRollback(version: number) {
    if (!confirm(`Rollback to version ${version}?`)) return
    await rollback.mutateAsync({ id: objectId, version })
  }

  return (
    <div className="space-y-3 p-3 text-sm">
      <Card>
        <CardHeader><CardTitle>Revision History</CardTitle></CardHeader>
        <CardContent>
          {isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}
          <ScrollArea className="max-h-64">
            <div className="space-y-1">
              {revisions.map(rev => (
                <div key={rev.id} className="flex items-center gap-2 rounded px-2 py-1 hover:bg-muted/50 group">
                  <Badge variant="secondary" className="text-xs px-1.5 py-0 flex-shrink-0">
                    v{rev.version}
                  </Badge>
                  <span className="flex-1 truncate text-xs text-muted-foreground">
                    {rev.change_summary ?? 'Saved'}
                  </span>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100">
                    <button
                      className="text-xs px-1 rounded hover:bg-muted"
                      onClick={() => setDiffA(a => a == null ? rev.version : a === rev.version ? null : a)}
                      title="Select for diff (from)"
                    >
                      {diffA === rev.version ? '✓A' : 'A'}
                    </button>
                    <button
                      className="text-xs px-1 rounded hover:bg-muted"
                      onClick={() => setDiffB(b => b == null ? rev.version : b === rev.version ? null : b)}
                      title="Select for diff (to)"
                    >
                      {diffB === rev.version ? '✓B' : 'B'}
                    </button>
                    <button
                      className="text-xs px-1 rounded hover:bg-destructive/20 text-destructive"
                      onClick={() => handleRollback(rev.version)}
                      title="Rollback to this version"
                      disabled={rollback.isPending}
                    >
                      ↩
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>

          {diffA != null && diffB != null && (
            <Button size="sm" className="mt-2 h-7 text-xs w-full" onClick={viewDiff} disabled={diffLoading}>
              {diffLoading ? 'Loading diff…' : `Diff v${Math.min(diffA, diffB)} → v${Math.max(diffA, diffB)}`}
            </Button>
          )}
        </CardContent>
      </Card>

      {diff && (
        <Card>
          <CardHeader>
            <CardTitle>Diff v{diff.from} → v{diff.to}</CardTitle>
          </CardHeader>
          <CardContent>
            {Object.keys(diff.diff).length === 0 ? (
              <p className="text-xs text-muted-foreground">No differences.</p>
            ) : (
              <div className="space-y-1 text-xs font-mono">
                {Object.entries(diff.diff).map(([field, entry]) => {
                  const { from, to } = entry as { from: unknown; to: unknown }
                  return (
                    <div key={field} className="rounded border p-1.5">
                      <p className="font-semibold text-foreground mb-0.5">{field}</p>
                      <p className="text-red-500 line-through truncate">- {JSON.stringify(from)}</p>
                      <p className="text-green-600 truncate">+ {JSON.stringify(to)}</p>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
