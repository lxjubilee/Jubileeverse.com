/**
 * AuditWorkspace.tsx — Three-panel Audit Module workspace (Part 6 S11-S17)
 *
 * Left 280px:  Audit domain tree (Content Audit, Image Audit, Policies, Self-Testing)
 * Center flex: Queue grid for selected domain/status
 * Right 420px: Audit detail + actions for selected item
 */

import * as React from 'react'
import { ShieldCheck, FileText, Image, Settings, FlaskConical, ChevronDown, ChevronRight, RefreshCw, Play } from 'lucide-react'
import { useAuditQueue, useAuditResults, useRerunAudit, useRewriteForAudit, useAuditRubrics, useSelfTestResults, useRunSelfTests, usePendingReview } from '../../hooks/useAudit'
import { useCockpitStore } from '../../hooks/useCockpitStore'
import { useResizablePanel } from '../../hooks/useResizablePanel'
import { ResizeDivider } from '../ui/ResizeDivider'
import type { SelfTestResult } from '../../types/content-objects'

// ── Score badge ───────────────────────────────────────────────────────────────

function ScoreBadge({ score }: { score?: number | null }) {
  if (score === undefined || score === null) return <span className="text-xs text-muted-foreground">—</span>
  const cls = score >= 80 ? 'bg-green-50 text-green-700 border-green-200'
    : score >= 60 ? 'bg-amber-50 text-amber-700 border-amber-200'
    : 'bg-red-50 text-red-700 border-red-200'
  return <span className={`text-xs font-medium px-1.5 py-0.5 rounded border ${cls}`}>{score.toFixed(0)}%</span>
}

function ResultBadge({ result }: { result?: string | null }) {
  if (!result) return null
  const map: Record<string, string> = {
    passed: 'bg-green-50 text-green-700 border-green-200',
    passed_with_warnings: 'bg-amber-50 text-amber-700 border-amber-200',
    failed: 'bg-red-50 text-red-700 border-red-200',
    pending: 'bg-muted text-muted-foreground border-border',
  }
  const label = result === 'passed_with_warnings' ? 'Warnings' : result.charAt(0).toUpperCase() + result.slice(1)
  return <span className={`text-xs font-medium px-1.5 py-0.5 rounded border ${map[result] ?? map.pending}`}>{label}</span>
}

// ── Left panel: Domain tree ───────────────────────────────────────────────────

type AuditDomain =
  | 'content:all' | 'content:pending_review' | 'content:passed' | 'content:failed'
  | 'image:pending' | 'image:failed'
  | 'policies:rubrics'
  | 'self_test:health'

const TREE_NODES = [
  { id: 'content', label: 'Content Audit', icon: FileText, children: [
    { id: 'content:pending_review', label: 'Pending Review', adminOnly: false },
    { id: 'content:all', label: 'All Audited', adminOnly: false },
    { id: 'content:failed', label: 'Audit Failed', adminOnly: false },
  ]},
  { id: 'image', label: 'Image Audit', icon: Image, children: [
    { id: 'image:pending', label: 'Pending Audit', adminOnly: false },
    { id: 'image:failed', label: 'Audit Failed', adminOnly: false },
  ]},
  { id: 'policies', label: 'Audit Policies', icon: Settings, adminOnly: true, children: [
    { id: 'policies:rubrics', label: 'Rubrics', adminOnly: true },
  ]},
  { id: 'self_test', label: 'Self-Testing', icon: FlaskConical, adminOnly: true, children: [
    { id: 'self_test:health', label: 'System Health', adminOnly: true },
  ]},
]

function DomainTree({ selected, onSelect, isAdmin }: {
  selected: AuditDomain | null
  onSelect: (d: AuditDomain) => void
  isAdmin: boolean
}) {
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set(['content']))

  function toggle(id: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  return (
    <div className="flex-1 overflow-y-auto py-2">
      {TREE_NODES.map(group => {
        if (group.adminOnly && !isAdmin) return null
        const isExpanded = expanded.has(group.id)
        const Icon = group.icon
        return (
          <div key={group.id}>
            <button
              onClick={() => toggle(group.id)}
              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted/50 text-sm font-medium"
            >
              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <Icon size={14} />
              {group.label}
            </button>
            {isExpanded && group.children.map(child => {
              if (child.adminOnly && !isAdmin) return null
              return (
                <button
                  key={child.id}
                  onClick={() => onSelect(child.id as AuditDomain)}
                  className={[
                    'w-full text-left text-sm pl-10 pr-3 py-1.5 hover:bg-muted/50 transition-colors',
                    selected === child.id ? 'bg-primary/5 text-primary font-medium' : 'text-muted-foreground',
                  ].join(' ')}
                >
                  {child.label}
                </button>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

// ── Center: Content audit queue ───────────────────────────────────────────────

function ContentAuditGrid({ domain, onSelect, selectedId }: {
  domain: AuditDomain
  onSelect: (id: string) => void
  selectedId: string | null
}) {
  const statusFilter = domain === 'content:pending_review' ? 'pending_review'
    : domain === 'content:failed' ? 'additional_work'
    : undefined

  // Always call both hooks unconditionally (React rules of hooks)
  const pendingResult = usePendingReview()
  const queueResult   = useAuditQueue(statusFilter)
  const { data, isLoading } = domain === 'content:pending_review' ? pendingResult : queueResult

  const items = data?.items ?? []

  if (isLoading) return <div className="p-4 text-sm text-muted-foreground">Loading…</div>

  return (
    <div className="flex-1 overflow-y-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-background border-b">
          <tr>
            <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Title</th>
            <th className="w-[100px] px-3 py-2 text-xs font-medium text-muted-foreground">Type</th>
            <th className="w-[120px] px-3 py-2 text-xs font-medium text-muted-foreground">Score</th>
            <th className="w-[140px] px-3 py-2 text-xs font-medium text-muted-foreground">Result</th>
            <th className="w-[140px] px-3 py-2 text-xs font-medium text-muted-foreground">Audited</th>
          </tr>
        </thead>
        <tbody>
          {items.map(item => (
            <tr
              key={item.id}
              onClick={() => onSelect(item.id ?? item.object_id)}
              className={['cursor-pointer border-b hover:bg-muted/40 transition-colors',
                selectedId === (item.id ?? item.object_id) ? 'bg-primary/5' : ''].join(' ')}
            >
              <td className="px-3 py-2 truncate max-w-[200px]">{item.title ?? '(untitled)'}</td>
              <td className="px-3 py-2 text-xs text-muted-foreground capitalize">{item.object_type}</td>
              <td className="px-3 py-2"><ScoreBadge score={item.audit_score} /></td>
              <td className="px-3 py-2"><ResultBadge result={item.audit_result ?? item.result} /></td>
              <td className="px-3 py-2 text-xs text-muted-foreground">
                {item.audited_at ? new Date(item.audited_at).toLocaleDateString() : '—'}
              </td>
            </tr>
          ))}
          {items.length === 0 && (
            <tr><td colSpan={5} className="px-3 py-6 text-center text-sm text-muted-foreground">No items found</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

// ── Center: Rubrics management ────────────────────────────────────────────────

function RubricsPanel({ onSelect, selectedId }: { onSelect: (id: string) => void; selectedId: string | null }) {
  const { data: rubrics = [], isLoading } = useAuditRubrics()
  if (isLoading) return <div className="p-4 text-sm text-muted-foreground">Loading…</div>
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="p-3 border-b">
        <p className="text-xs text-muted-foreground">Audit rubrics define scoring weights and system prompts for doctrinal evaluation.</p>
      </div>
      {rubrics.map(rubric => (
        <button
          key={rubric.id}
          onClick={() => onSelect(rubric.id)}
          className={['w-full text-left px-3 py-3 border-b hover:bg-muted/40 transition-colors',
            selectedId === rubric.id ? 'bg-primary/5' : ''].join(' ')}
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">{rubric.name}</span>
            {rubric.is_global && <span className="text-xs bg-primary/10 text-primary px-1.5 rounded">Global</span>}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs text-muted-foreground capitalize">{rubric.rubric_type}</span>
            <span className="text-xs text-muted-foreground">v{rubric.version}</span>
            <span className="text-xs text-muted-foreground">Pass: {rubric.pass_threshold}%</span>
          </div>
        </button>
      ))}
      {rubrics.length === 0 && (
        <p className="p-4 text-sm text-muted-foreground">No rubrics configured. The system uses a built-in default prompt.</p>
      )}
    </div>
  )
}

// ── Center: Self-testing dashboard ────────────────────────────────────────────

function SelfTestDashboard() {
  const { data, isLoading, refetch } = useSelfTestResults()
  const runTests = useRunSelfTests()

  function handleRun() {
    runTests.mutate(undefined, { onSuccess: () => setTimeout(() => refetch(), 5000) })
  }

  const results: SelfTestResult[] = data?.results ?? []
  const summary = data?.summary

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold">System Health</h3>
          {summary && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {summary.passed} passed · {summary.failed} failed · {summary.total} total
            </p>
          )}
        </div>
        <button
          onClick={handleRun}
          disabled={runTests.isPending}
          className="flex items-center gap-1.5 text-xs border rounded px-2.5 py-1.5 hover:bg-muted disabled:opacity-50"
        >
          <Play size={12} />
          Run Self-Test
        </button>
      </div>
      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!isLoading && results.length === 0 && (
        <p className="text-sm text-muted-foreground">No test results yet. Click "Run Self-Test" to execute all diagnostics.</p>
      )}
      {results.map(r => (
        <div key={r.id} className="border rounded mb-2 p-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium">{r.test_suite} — {r.test_name}</span>
            <span className={`text-xs font-medium px-1.5 py-0.5 rounded border ${
              r.result === 'passed' ? 'bg-green-50 text-green-700 border-green-200'
              : r.result === 'failed' ? 'bg-red-50 text-red-700 border-red-200'
              : r.result === 'error' ? 'bg-red-50 text-red-700 border-red-200'
              : 'bg-muted text-muted-foreground border-border'
            }`}>{r.result}</span>
          </div>
          {r.error_message && <p className="text-xs text-destructive">{r.error_message}</p>}
          {r.actual_value && <p className="text-xs text-muted-foreground">Actual: {r.actual_value}</p>}
          {r.remediation && <p className="text-xs text-amber-700 mt-1">Remediation: {r.remediation}</p>}
          {r.duration_ms !== null && <p className="text-xs text-muted-foreground">{r.duration_ms}ms</p>}
        </div>
      ))}
    </div>
  )
}

// ── Right panel: Audit detail ─────────────────────────────────────────────────

function AuditDetailPanel({ objectId, onClose }: { objectId: string; onClose: () => void }) {
  const { data, isLoading } = useAuditResults(objectId)
  const rerun = useRerunAudit()
  const rewrite = useRewriteForAudit()

  const latest = data?.reports?.[0]

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 h-10 border-b shrink-0">
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-xs">✕</button>
        <span className="text-xs font-medium">Audit Report</span>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!isLoading && !latest && <p className="text-sm text-muted-foreground">No audit report found.</p>}
        {latest && (
          <>
            <div className="flex items-center gap-2 mb-4">
              <ScoreBadge score={latest.scores?.composite} />
              <ResultBadge result={latest.result} />
              <span className="text-xs text-muted-foreground">
                {new Date(latest.audited_at).toLocaleDateString()}
              </span>
            </div>

            {/* Sub-scores */}
            <div className="space-y-2 mb-4">
              {[
                ['Scriptural Accuracy', latest.scores?.scriptural_accuracy],
                ['Doctrinal Clarity', latest.scores?.doctrinal_clarity],
                ['Pastoral Tone', latest.scores?.pastoral_tone],
                ['Misinterpretation Risk', latest.scores?.misinterpretation_risk],
                ['Promotion of Sin', latest.scores?.sin_promotion],
                ...(latest.scores?.worship_integrity !== undefined ? [['Worship Integrity', latest.scores?.worship_integrity]] : []),
              ].map(([label, score]) => score !== undefined && (
                <div key={label as string} className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground w-40 truncate">{label}</span>
                  <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${(score as number) >= 80 ? 'bg-green-500' : (score as number) >= 60 ? 'bg-amber-500' : 'bg-red-500'}`}
                      style={{ width: `${score}%` }}
                    />
                  </div>
                  <span className="text-xs font-medium w-8 text-right">{(score as number).toFixed(0)}%</span>
                </div>
              ))}
            </div>

            {/* Findings */}
            {latest.findings && latest.findings.length > 0 && (
              <div className="mb-4">
                <p className="text-xs font-semibold mb-2">Findings ({latest.findings.length})</p>
                {latest.findings.map((f, i) => (
                  <div key={i} className={`rounded border p-2 mb-2 text-xs ${
                    f.severity === 'critical' ? 'border-red-200 bg-red-50'
                    : f.severity === 'warning' ? 'border-amber-200 bg-amber-50'
                    : 'border-border bg-muted/10'
                  }`}>
                    <div className="flex items-center gap-1.5 font-medium mb-0.5 capitalize">
                      <span>{f.severity}</span>
                      <span>·</span>
                      <span>{f.category.replace(/_/g, ' ')}</span>
                    </div>
                    {f.excerpt && <p className="italic text-muted-foreground mb-1">"{f.excerpt}"</p>}
                    <p>{f.explanation}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Metadata */}
            <div className="text-xs text-muted-foreground space-y-1 mb-4">
              {latest.rubric_name && <p>Rubric: {latest.rubric_name}</p>}
              {latest.model_id && <p>Model: {latest.model_id}</p>}
            </div>

            {/* Actions */}
            <div className="flex flex-col gap-2">
              <button
                onClick={() => rerun.mutate(objectId)}
                disabled={rerun.isPending}
                className="flex items-center justify-center gap-1.5 text-xs border rounded px-3 py-2 hover:bg-muted disabled:opacity-50"
              >
                <RefreshCw size={12} className={rerun.isPending ? 'animate-spin' : ''} />
                Re-run Audit
              </button>
              <button
                onClick={() => rewrite.mutate(objectId)}
                disabled={rewrite.isPending}
                className="flex items-center justify-center gap-1.5 text-xs bg-primary text-primary-foreground rounded px-3 py-2 hover:opacity-90 disabled:opacity-50"
              >
                Rewrite to Improve Score
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Rubric detail panel ───────────────────────────────────────────────────────

function RubricDetailPanel({ rubricId, onClose }: { rubricId: string; onClose: () => void }) {
  const { data: rubrics = [] } = useAuditRubrics()
  const rubric = rubrics.find(r => r.id === rubricId)
  if (!rubric) return null
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 h-10 border-b shrink-0">
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-xs">✕</button>
        <span className="text-xs font-medium">Rubric: {rubric.name}</span>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div><span className="text-muted-foreground">Type:</span> <span className="capitalize">{rubric.rubric_type}</span></div>
          <div><span className="text-muted-foreground">Version:</span> {rubric.version}</div>
          <div><span className="text-muted-foreground">Pass threshold:</span> {rubric.pass_threshold}%</div>
          <div><span className="text-muted-foreground">Warning threshold:</span> {rubric.warning_threshold}%</div>
          <div><span className="text-muted-foreground">Global:</span> {rubric.is_global ? 'Yes' : 'No'}</div>
          <div><span className="text-muted-foreground">Active:</span> {rubric.is_active ? 'Yes' : 'No'}</div>
        </div>
        {rubric.system_prompt && (
          <div>
            <p className="text-xs font-medium mb-1">System Prompt</p>
            <pre className="text-xs bg-muted/30 p-2 rounded overflow-auto max-h-48 whitespace-pre-wrap">{rubric.system_prompt}</pre>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main workspace ────────────────────────────────────────────────────────────

export function AuditWorkspace() {
  const user = useCockpitStore(s => s.user)
  const isAdmin = user?.role === 'admin'
  const { width: leftWidth, startResize } = useResizablePanel('audit')

  const [selectedDomain, setSelectedDomain] = React.useState<AuditDomain | null>('content:pending_review')
  const [selectedItemId, setSelectedItemId] = React.useState<string | null>(null)

  const showRightPanel = selectedItemId !== null

  function renderCenter() {
    if (!selectedDomain) {
      return (
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
          Select a category from the left panel
        </div>
      )
    }
    if (selectedDomain.startsWith('content:')) {
      return (
        <ContentAuditGrid
          domain={selectedDomain}
          onSelect={setSelectedItemId}
          selectedId={selectedItemId}
        />
      )
    }
    if (selectedDomain === 'policies:rubrics') {
      return <RubricsPanel onSelect={setSelectedItemId} selectedId={selectedItemId} />
    }
    if (selectedDomain === 'self_test:health') {
      return <SelfTestDashboard />
    }
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        Coming soon
      </div>
    )
  }

  function renderRight() {
    if (!selectedItemId) return null
    if (selectedDomain === 'policies:rubrics') {
      return <RubricDetailPanel rubricId={selectedItemId} onClose={() => setSelectedItemId(null)} />
    }
    return <AuditDetailPanel objectId={selectedItemId} onClose={() => setSelectedItemId(null)} />
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left panel */}
      <div className="shrink-0 border-r flex flex-col overflow-hidden" style={{ width: `${leftWidth}px` }}>
        <div className="flex items-center gap-2 px-3 h-10 border-b shrink-0">
          <ShieldCheck size={14} />
          <span className="text-xs font-semibold">Audit</span>
        </div>
        <DomainTree selected={selectedDomain} onSelect={d => { setSelectedDomain(d); setSelectedItemId(null) }} isAdmin={isAdmin} />
      </div>
      <ResizeDivider onMouseDown={startResize} />

      {/* Center panel */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {renderCenter()}
      </div>

      {/* Right panel */}
      <div
        className="shrink-0 border-l flex flex-col overflow-hidden transition-all duration-250"
        style={{ width: showRightPanel ? '420px' : '0px', opacity: showRightPanel ? 1 : 0 }}
      >
        {showRightPanel && renderRight()}
      </div>
    </div>
  )
}
