/**
 * ServersWorkspace.tsx — Three-panel Servers Module workspace (Part 6 S3)
 *
 * Left 280px:  Node list with health indicators
 * Center flex: Sync dashboard for selected node
 * Right 420px: Node registration / management form
 */

import * as React from 'react'
import { Server, Plus, RefreshCw, Circle, CheckCircle, AlertTriangle, XCircle } from 'lucide-react'
import { useServerNodes, useRegisterServerNode, useUpdateServerNode, useDisableServerNode, useTriggerNodeSync } from '../../hooks/useServers'
import { useCockpitStore } from '../../hooks/useCockpitStore'
import { useResizablePanel } from '../../hooks/useResizablePanel'
import { ResizeDivider } from '../ui/ResizeDivider'
import type { ServerNode } from '../../types/content-objects'

// ── Health status helpers ─────────────────────────────────────────────────────

function HealthDot({ status }: { status: ServerNode['health_status'] }) {
  const map: Record<string, string> = {
    healthy:     'text-green-500',
    degraded:    'text-amber-500',
    unreachable: 'text-red-500',
    maintenance: 'text-blue-400',
    unknown:     'text-muted-foreground',
  }
  const Icon = status === 'healthy' ? CheckCircle
    : status === 'degraded' ? AlertTriangle
    : status === 'unreachable' ? XCircle
    : Circle
  return <Icon size={14} className={map[status] ?? map.unknown} />
}

function EnvBadge({ env }: { env: string }) {
  const cls = env === 'production' ? 'bg-green-50 text-green-700 border-green-200'
    : env === 'staging' ? 'bg-amber-50 text-amber-700 border-amber-200'
    : 'bg-muted text-muted-foreground border-border'
  return <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${cls}`}>{env}</span>
}

// ── Left panel: Node list ──────────────────────────────────────────────────────

function NodeList({ selectedId, onSelect, onRegister }: {
  selectedId: string | null
  onSelect: (id: string) => void
  onRegister: () => void
}) {
  const { data: nodes = [], isLoading } = useServerNodes()
  const user = useCockpitStore(s => s.user)
  const isAdmin = user?.role === 'admin'

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 h-10 border-b shrink-0">
        <span className="text-xs font-semibold">Server Nodes</span>
        {isAdmin && (
          <button
            onClick={onRegister}
            className="flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <Plus size={12} /> Register
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <p className="text-xs text-muted-foreground p-3">Loading nodes…</p>
        )}
        {nodes.map(node => (
          <button
            key={node.id}
            onClick={() => onSelect(node.id)}
            className={[
              'w-full text-left px-3 py-2.5 border-b flex flex-col gap-0.5 hover:bg-muted/50 transition-colors',
              selectedId === node.id ? 'bg-primary/5' : '',
            ].join(' ')}
          >
            <div className="flex items-center gap-1.5">
              <HealthDot status={node.health_status} />
              <span className="text-sm font-medium truncate">{node.node_name}</span>
            </div>
            <div className="flex items-center gap-1.5 pl-5">
              <EnvBadge env={node.environment} />
              {node.region && <span className="text-xs text-muted-foreground">{node.region}</span>}
            </div>
          </button>
        ))}
        {!isLoading && nodes.length === 0 && (
          <p className="text-xs text-muted-foreground p-3">No nodes registered.</p>
        )}
      </div>
    </div>
  )
}

// ── Center panel: Sync dashboard ──────────────────────────────────────────────

function SyncDashboard({ nodeId }: { nodeId: string }) {
  const { data: nodes = [] } = useServerNodes()
  const triggerSync = useTriggerNodeSync()
  const node = nodes.find(n => n.id === nodeId)

  if (!node) return null

  const healthColor = node.health_status === 'healthy' ? 'text-green-600'
    : node.health_status === 'degraded' ? 'text-amber-600'
    : node.health_status === 'unreachable' ? 'text-red-600'
    : 'text-muted-foreground'

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Server size={16} />
            {node.node_name}
          </h2>
          <div className="flex items-center gap-2 mt-1">
            <EnvBadge env={node.environment} />
            {node.region && <span className="text-xs text-muted-foreground">{node.region}</span>}
          </div>
        </div>
        <button
          onClick={() => triggerSync.mutate(nodeId)}
          disabled={triggerSync.isPending}
          className="flex items-center gap-1.5 text-xs border rounded px-2.5 py-1.5 hover:bg-muted disabled:opacity-50"
        >
          <RefreshCw size={12} className={triggerSync.isPending ? 'animate-spin' : ''} />
          Sync Now
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 max-w-lg mb-6">
        <StatCard label="Health" value={node.health_status} valueClass={healthColor} />
        <StatCard label="Cache" value={node.cache_status} />
        <StatCard label="DB Role" value={node.database_role} />
        <StatCard label="Version" value={node.software_version ?? '—'} />
        {node.replication_lag_ms !== null && (
          <StatCard label="Replication Lag" value={`${node.replication_lag_ms}ms`}
            valueClass={node.replication_lag_ms > 5000 ? 'text-amber-600' : ''} />
        )}
        <StatCard label="Pending Sync" value={String(node.pending_sync_count)} />
      </div>

      {node.last_heartbeat_at && (
        <p className="text-xs text-muted-foreground mb-4">
          Last heartbeat: {new Date(node.last_heartbeat_at).toLocaleString()}
        </p>
      )}
      {node.last_sync_at && (
        <p className="text-xs text-muted-foreground mb-4">
          Last sync: {new Date(node.last_sync_at).toLocaleString()}
        </p>
      )}

      {node.base_url && (
        <div className="rounded border bg-muted/10 p-3 mb-4">
          <p className="text-xs font-medium mb-1">Endpoint</p>
          <p className="text-xs font-mono text-muted-foreground break-all">{node.base_url}</p>
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value, valueClass = '' }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="rounded border bg-muted/20 px-3 py-2">
      <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
      <p className={`text-sm font-medium truncate capitalize ${valueClass}`}>{value}</p>
    </div>
  )
}

// ── Right panel: Node form ─────────────────────────────────────────────────────

function NodeForm({ nodeId, onClose }: { nodeId: string | null; onClose: () => void }) {
  const { data: nodes = [] } = useServerNodes()
  const register = useRegisterServerNode()
  const update   = useUpdateServerNode()
  const disable  = useDisableServerNode()

  const existing = nodeId ? nodes.find(n => n.id === nodeId) : null

  const [form, setForm] = React.useState<{
    node_name: string
    environment: 'production' | 'staging' | 'development'
    region: string
    base_url: string
    internal_sync_endpoint: string
    database_role: 'primary' | 'replica' | 'read_replica'
  }>({
    node_name: '', environment: 'production', region: '',
    base_url: '', internal_sync_endpoint: '', database_role: 'replica',
  })

  React.useEffect(() => {
    if (existing) {
      setForm({
        node_name: existing.node_name,
        environment: existing.environment,
        region: existing.region ?? '',
        base_url: existing.base_url ?? '',
        internal_sync_endpoint: existing.internal_sync_endpoint ?? '',
        database_role: existing.database_role,
      })
    } else {
      setForm({ node_name: '', environment: 'production' as const, region: '', base_url: '', internal_sync_endpoint: '', database_role: 'replica' })
    }
  }, [nodeId])

  function handleSave() {
    if (existing) {
      update.mutate({ nodeId: existing.id, data: form }, { onSuccess: onClose })
    } else {
      register.mutate(form, { onSuccess: onClose })
    }
  }

  const isPending = register.isPending || update.isPending

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 h-10 border-b shrink-0">
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-xs">✕</button>
        <span className="text-xs font-medium">{existing ? 'Edit Node' : 'Register Node'}</span>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        <Field label="Node Name" value={form.node_name} onChange={v => setForm(f => ({ ...f, node_name: v }))} />
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Environment</label>
          <select
            value={form.environment}
            onChange={e => setForm(f => ({ ...f, environment: e.target.value as 'production' | 'staging' | 'development' }))}
            className="w-full text-sm border rounded px-2 py-1.5 bg-background"
          >
            {['production', 'staging', 'development'].map(e => <option key={e} value={e}>{e}</option>)}
          </select>
        </div>
        <Field label="Region" value={form.region} onChange={v => setForm(f => ({ ...f, region: v }))} placeholder="us-west-2" />
        <Field label="Base URL" value={form.base_url} onChange={v => setForm(f => ({ ...f, base_url: v }))} placeholder="https://node.example.com" />
        <Field label="Internal Sync Endpoint" value={form.internal_sync_endpoint} onChange={v => setForm(f => ({ ...f, internal_sync_endpoint: v }))} placeholder="https://internal.node.example.com" />
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Database Role</label>
          <select
            value={form.database_role}
            onChange={e => setForm(f => ({ ...f, database_role: e.target.value as 'primary' | 'replica' | 'read_replica' }))}
            className="w-full text-sm border rounded px-2 py-1.5 bg-background"
          >
            {['primary', 'replica', 'read_replica'].map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <button
          onClick={handleSave}
          disabled={isPending || !form.node_name}
          className="w-full text-sm bg-primary text-primary-foreground rounded py-2 disabled:opacity-50 hover:opacity-90"
        >
          {isPending ? 'Saving…' : existing ? 'Save Changes' : 'Register Node'}
        </button>
        {existing && (
          <button
            onClick={() => { if (confirm('Disable this node?')) disable.mutate(existing.id, { onSuccess: onClose }) }}
            className="w-full text-sm text-destructive border border-destructive/30 rounded py-2 hover:bg-destructive/5"
          >
            Disable Node
          </button>
        )}
      </div>
    </div>
  )
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className="block text-xs text-muted-foreground mb-1">{label}</label>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full text-sm border rounded px-2 py-1.5 bg-background"
      />
    </div>
  )
}

// ── Main workspace ────────────────────────────────────────────────────────────

export function ServersWorkspace() {
  const [selectedNodeId, setSelectedNodeId] = React.useState<string | null>(null)
  const [rightMode, setRightMode] = React.useState<'form' | null>(null)
  const [editNodeId, setEditNodeId] = React.useState<string | null>(null)
  const { width: leftWidth, startResize } = useResizablePanel('servers')

  function handleSelectNode(id: string) {
    setSelectedNodeId(id)
    setRightMode(null)
  }

  function handleRegister() {
    setEditNodeId(null)
    setRightMode('form')
  }

  const showRight = rightMode === 'form'

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left panel */}
      <div className="shrink-0 border-r flex flex-col overflow-hidden" style={{ width: `${leftWidth}px` }}>
        <NodeList
          selectedId={selectedNodeId}
          onSelect={handleSelectNode}
          onRegister={handleRegister}
        />
      </div>
      <ResizeDivider onMouseDown={startResize} />

      {/* Center panel */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {selectedNodeId ? (
          <SyncDashboard nodeId={selectedNodeId} />
        ) : (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
            Select a server node to view its sync dashboard
          </div>
        )}
      </div>

      {/* Right panel — registration / edit form */}
      <div
        className="shrink-0 border-l flex flex-col overflow-hidden transition-all duration-250"
        style={{ width: showRight ? '420px' : '0px', opacity: showRight ? 1 : 0 }}
      >
        {showRight && (
          <NodeForm
            nodeId={editNodeId}
            onClose={() => setRightMode(null)}
          />
        )}
      </div>
    </div>
  )
}
