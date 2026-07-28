/**
 * BulkActionBar.tsx — Bulk status change and author reassignment for selected content objects
 */

import * as React from 'react'
import { UserCheck } from 'lucide-react'
import { Button }     from '../ui/Button'
import { Select }     from '../ui/Select'
import { useCockpitStore } from '../../hooks/useCockpitStore'
import { useUpdateContent, useArchiveContent, useBulkReassignAuthors } from '../../hooks/useContent'
import { useAuthors } from '../../hooks/useAuthors'
import { OBJECT_STATUSES } from '../../types/content-objects'
import type { ObjectStatus, ContentAuthorRole } from '../../types/content-objects'

const STATUS_OPTIONS = OBJECT_STATUSES
  .filter(s => s !== 'archived')
  .map(s => ({ value: s, label: s }))

const ROLE_OPTIONS: { value: ContentAuthorRole; label: string }[] = [
  { value: 'primary_author', label: 'Primary Author' },
  { value: 'contributor',    label: 'Contributor' },
  { value: 'editor',         label: 'Editor' },
  { value: 'translator',     label: 'Translator' },
  { value: 'narrator',       label: 'Narrator' },
]

export function BulkActionBar() {
  const selectedObjectIds = useCockpitStore(s => s.selectedObjectIds)
  const clearSelection = useCockpitStore(s => s.clearSelection)
  const user = useCockpitStore(s => s.user)
  const isAdmin = user?.role === 'admin'
  const [targetStatus, setTargetStatus] = React.useState<ObjectStatus>('review')
  const [confirming, setConfirming]     = React.useState(false)
  const [showReassign,  setShowReassign]  = React.useState(false)
  const [reassignAuthor, setReassignAuthor] = React.useState('')
  const [reassignRole,   setReassignRole]   = React.useState<ContentAuthorRole>('primary_author')

  const updateContent      = useUpdateContent()
  const archiveContent     = useArchiveContent()
  const bulkReassign       = useBulkReassignAuthors()
  const { data: authorsData } = useAuthors()

  const allAuthors = authorsData?.authors ?? []
  const authorOptions = allAuthors.map(a => ({
    value: a.id,
    label: (a.extension_data as { display_name?: string })?.display_name || a.title || a.id,
  }))

  const count = selectedObjectIds.size
  if (count === 0) return null

  async function applyStatus() {
    const ids = Array.from(selectedObjectIds)
    await Promise.all(ids.map(id => updateContent.mutateAsync({ id, data: { status: targetStatus } })))
    clearSelection()
  }

  async function applyArchive() {
    if (!confirming) { setConfirming(true); return }
    const ids = Array.from(selectedObjectIds)
    await Promise.all(ids.map(id => archiveContent.mutateAsync(id)))
    clearSelection()
    setConfirming(false)
  }

  async function applyReassign() {
    if (!reassignAuthor) return
    await bulkReassign.mutateAsync({
      contentIds: Array.from(selectedObjectIds),
      authorId:   reassignAuthor,
      role:       reassignRole,
    })
    setShowReassign(false)
    setReassignAuthor('')
    setReassignRole('primary_author')
    clearSelection()
  }

  return (
    <div className="flex flex-col border-b bg-muted/50">
      <div className="flex items-center gap-2 px-3 py-2 text-sm">
        <span className="font-medium">{count} selected</span>

        <Select
          className="w-32 h-7 text-xs"
          value={targetStatus}
          onValueChange={v => setTargetStatus(v as ObjectStatus)}
          options={STATUS_OPTIONS}
          placeholder="Status…"
        />
        <Button
          size="sm"
          className="h-7 text-xs"
          onClick={applyStatus}
          disabled={updateContent.isPending}
        >
          Apply to all
        </Button>

        {isAdmin && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1"
            onClick={() => setShowReassign(v => !v)}
          >
            <UserCheck size={12} />
            Reassign Author
          </Button>
        )}

        <Button
          variant="destructive"
          size="sm"
          className="h-7 text-xs ml-auto"
          onClick={applyArchive}
          disabled={archiveContent.isPending}
        >
          {confirming ? 'Confirm archive' : 'Archive'}
        </Button>
        {confirming && (
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        )}

        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={clearSelection}>
          Deselect
        </Button>
      </div>

      {/* Reassign author inline panel */}
      {showReassign && isAdmin && (
        <div className="flex items-center gap-2 px-3 pb-2 pt-0">
          <span className="text-xs text-muted-foreground shrink-0">Author:</span>
          <Select
            className="flex-1 h-7 text-xs"
            value={reassignAuthor}
            onValueChange={setReassignAuthor}
            options={authorOptions}
            placeholder="Select author…"
          />
          <span className="text-xs text-muted-foreground shrink-0">Role:</span>
          <Select
            className="w-36 h-7 text-xs"
            value={reassignRole}
            onValueChange={v => setReassignRole(v as ContentAuthorRole)}
            options={ROLE_OPTIONS}
          />
          <Button
            size="sm"
            className="h-7 text-xs"
            onClick={applyReassign}
            disabled={!reassignAuthor || bulkReassign.isPending}
          >
            {bulkReassign.isPending ? 'Applying…' : 'Apply'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={() => { setShowReassign(false); setReassignAuthor('') }}
          >
            Cancel
          </Button>
        </div>
      )}
    </div>
  )
}
