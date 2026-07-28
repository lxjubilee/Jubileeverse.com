/**
 * WorkflowPanel.tsx — Phase 5 workflow state machine UI
 *
 * Shows current status badge + valid transition buttons for the user's role.
 * Special cases: review→draft requires reason; approved→scheduled requires datetime.
 */
import * as React from 'react'
import { useCockpitStore } from '../../hooks/useCockpitStore'
import { useTransitionContent } from '../../hooks/useWorkflow'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import type { ObjectStatus } from '../../types/content-objects'
import { CLIENT_WORKFLOW_TRANSITIONS } from '../../types/content-objects'

interface WorkflowPanelProps {
  objectId: string
  currentStatus: ObjectStatus
  onTransitioned?: () => void
}

const STATUS_COLORS: Record<ObjectStatus, string> = {
  draft:           'secondary',
  review:          'warning',
  approved:        'success',
  scheduled:       'info',
  published:       'default',
  archived:        'outline',
  internal_audit:  'secondary',
  additional_work: 'warning',
  pending_review:  'info',
}

export function WorkflowPanel({ objectId, currentStatus, onTransitioned }: WorkflowPanelProps) {
  const user = useCockpitStore(s => s.user)
  const role = user?.role ?? ''
  const transition = useTransitionContent()

  const [pendingTo, setPendingTo] = React.useState<ObjectStatus | null>(null)
  const [reason, setReason] = React.useState('')
  const [scheduledAt, setScheduledAt] = React.useState('')

  const availableTransitions: ObjectStatus[] =
    CLIENT_WORKFLOW_TRANSITIONS[currentStatus]?.[role] ?? []

  async function handleTransition(toStatus: ObjectStatus) {
    // For review→draft: wait for reason to be entered before allowing action
    if (currentStatus === 'review' && toStatus === 'draft' && pendingTo !== toStatus) {
      setPendingTo(toStatus); return
    }
    // For approved→scheduled: wait for datetime
    if (currentStatus === 'approved' && toStatus === 'scheduled' && pendingTo !== toStatus) {
      setPendingTo(toStatus); return
    }
    try {
      await transition.mutateAsync({
        id: objectId,
        body: {
          to_status: toStatus,
          reason: reason.trim() || undefined,
          scheduled_at: scheduledAt || undefined,
        },
      })
      setPendingTo(null); setReason(''); setScheduledAt('')
      onTransitioned?.()
    } catch {}
  }

  function handleCancel() { setPendingTo(null); setReason(''); setScheduledAt('') }

  return (
    <div className="space-y-2 px-3 py-2 border-b">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Status:</span>
        <Badge variant={STATUS_COLORS[currentStatus] as Parameters<typeof Badge>[0]['variant']}>
          {currentStatus}
        </Badge>
      </div>

      {/* Pending: reason input for review→draft */}
      {pendingTo === 'draft' && currentStatus === 'review' && (
        <div className="space-y-1.5">
          <textarea
            placeholder="Reason for returning to draft (required)…"
            value={reason}
            onChange={e => setReason(e.target.value)}
            rows={2}
            className="w-full rounded border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary resize-none"
          />
          <div className="flex gap-1.5">
            <Button
              size="sm"
              variant="destructive"
              disabled={!reason.trim() || transition.isPending}
              onClick={() => handleTransition('draft')}
              className="text-xs h-7"
            >
              {transition.isPending ? 'Returning…' : 'Return to Draft'}
            </Button>
            <Button size="sm" variant="ghost" onClick={handleCancel} className="text-xs h-7">Cancel</Button>
          </div>
        </div>
      )}

      {/* Pending: datetime input for approved→scheduled */}
      {pendingTo === 'scheduled' && currentStatus === 'approved' && (
        <div className="space-y-1.5">
          <input
            type="datetime-local"
            value={scheduledAt}
            onChange={e => setScheduledAt(e.target.value)}
            min={new Date(Date.now() + 60_000).toISOString().slice(0, 16)}
            className="w-full rounded border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <div className="flex gap-1.5">
            <Button
              size="sm"
              disabled={!scheduledAt || transition.isPending}
              onClick={() => handleTransition('scheduled')}
              className="text-xs h-7"
            >
              {transition.isPending ? 'Scheduling…' : 'Schedule'}
            </Button>
            <Button size="sm" variant="ghost" onClick={handleCancel} className="text-xs h-7">Cancel</Button>
          </div>
        </div>
      )}

      {/* Standard transition buttons */}
      {!pendingTo && availableTransitions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {availableTransitions.map(toStatus => (
            <Button
              key={toStatus}
              size="sm"
              variant={toStatus === 'archived' ? 'destructive' : toStatus === 'published' ? 'default' : 'outline'}
              disabled={transition.isPending}
              onClick={() => handleTransition(toStatus)}
              className="text-xs h-7 capitalize"
            >
              {transition.isPending && transition.variables?.body.to_status === toStatus
                ? 'Working…'
                : `→ ${toStatus}`
              }
            </Button>
          ))}
        </div>
      )}

      {availableTransitions.length === 0 && !pendingTo && (
        <p className="text-xs text-muted-foreground">No transitions available for your role.</p>
      )}
    </div>
  )
}
