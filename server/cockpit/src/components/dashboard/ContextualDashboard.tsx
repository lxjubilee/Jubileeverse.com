/**
 * ContextualDashboard.tsx — Right-panel tabbed dashboard (Phase 4)
 *
 * Four tabs: Metrics | Gaps | Generate | Activity
 */

import * as React from 'react'
import { TabsRoot, TabsList, TabsTrigger, TabsContent } from '../ui/Tabs'
import { ScrollArea }     from '../ui/ScrollArea'
import { CoverageMetrics }  from './CoverageMetrics'
import { GapAnalysis }      from './GapAnalysis'
import { AIGenerationPanel } from './AIGenerationPanel'
import { AuthorChatPanel }   from './AuthorChatPanel'
import { useCockpitStore } from '../../hooks/useCockpitStore'
import { useAuditLog }     from '../../hooks/useContent'
import type { ObjectType } from '../../types/content-objects'

export function ContextualDashboard() {
  const selectedNodeId = useCockpitStore(s => s.selectedNodeId)
  const [activeTab, setActiveTab] = React.useState('metrics')
  const [generateType, setGenerateType] = React.useState<ObjectType>('article')

  const { data: auditData } = useAuditLog({ limit: 20 })

  function handleGenerate(type: ObjectType) {
    setGenerateType(type)
    setActiveTab('generate')
  }

  return (
    <div className="flex h-full flex-col border-l bg-background">
      {/* Header */}
      <div className="border-b px-3 py-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {selectedNodeId ? 'Node Dashboard' : 'Dashboard'}
        </h3>
      </div>

      <TabsRoot value={activeTab} onValueChange={setActiveTab} className="flex flex-col flex-1 overflow-hidden">
        <TabsList className="mx-3 mt-2 h-7 text-xs rounded">
          <TabsTrigger value="metrics"  className="text-xs px-2 py-0.5 h-6">Metrics</TabsTrigger>
          <TabsTrigger value="gaps"     className="text-xs px-2 py-0.5 h-6">Gaps</TabsTrigger>
          <TabsTrigger value="generate" className="text-xs px-2 py-0.5 h-6">Generate</TabsTrigger>
          <TabsTrigger value="activity" className="text-xs px-2 py-0.5 h-6">Activity</TabsTrigger>
          <TabsTrigger value="chat"     className="text-xs px-2 py-0.5 h-6">Chat</TabsTrigger>
        </TabsList>

        <ScrollArea className="flex-1 mt-1">
          <TabsContent value="metrics">
            <CoverageMetrics />
          </TabsContent>

          <TabsContent value="gaps">
            <GapAnalysis onGenerate={handleGenerate} />
          </TabsContent>

          <TabsContent value="generate">
            <AIGenerationPanel initialType={generateType} />
          </TabsContent>

          <TabsContent value="chat">
            <AuthorChatPanel />
          </TabsContent>

          <TabsContent value="activity" className="px-3 pb-3">
            <p className="text-xs font-medium text-muted-foreground py-2">Recent Activity</p>
            {!auditData?.items.length && (
              <p className="text-xs text-muted-foreground">No recent activity.</p>
            )}
            <div className="space-y-1">
              {(auditData?.items ?? []).map(entry => (
                <div key={entry.id} className="rounded px-2 py-1 bg-muted/50 text-xs">
                  <span className="font-medium">{entry.event_type}</span>
                  <span className="ml-1 text-muted-foreground">{entry.actor_id}</span>
                  <div className="text-muted-foreground text-[10px]">
                    {new Date(entry.created_at).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          </TabsContent>
        </ScrollArea>
      </TabsRoot>
    </div>
  )
}
