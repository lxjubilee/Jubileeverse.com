/**
 * CommentThread.tsx — Threaded inline comments (Phase 4 / Phase 5)
 *
 * Phase 5 adds: range_start_offset / range_end_offset capture + display.
 * Sidebar list with anchor text — no TipTap overlay.
 */

import * as React from 'react'
import { Button }   from '../ui/Button'
import { ScrollArea } from '../ui/ScrollArea'
import { Badge }    from '../ui/Badge'
import { useComments, useCreateComment, useUpdateComment, useDeleteComment } from '../../hooks/useComments'
import { useCockpitStore } from '../../hooks/useCockpitStore'
import type { Comment } from '../../lib/api'

const OBJECT_TYPE = 'jv_content_objects'

// ── Single comment ────────────────────────────────────────────────────────────

interface CommentItemProps {
  comment: Comment
  objectId: string
  onReply: (parentId: number) => void
}

function CommentItem({ comment, objectId, onReply }: CommentItemProps) {
  const [editing, setEditing]   = React.useState(false)
  const [editBody, setEditBody] = React.useState(comment.body)
  const updateComment = useUpdateComment()
  const deleteComment = useDeleteComment()

  async function saveEdit() {
    await updateComment.mutateAsync({
      id: comment.id, objectType: OBJECT_TYPE, objectId, data: { body: editBody },
    })
    setEditing(false)
  }

  async function toggleResolve() {
    await updateComment.mutateAsync({
      id: comment.id, objectType: OBJECT_TYPE, objectId, data: { resolved: !comment.resolved },
    })
  }

  async function handleDelete() {
    if (!confirm('Delete this comment?')) return
    await deleteComment.mutateAsync({ id: comment.id, objectType: OBJECT_TYPE, objectId })
  }

  const hasRange = comment.range_start_offset != null && comment.range_end_offset != null

  return (
    <div className={['rounded-md border p-2 text-xs', comment.resolved ? 'opacity-50' : ''].join(' ')}>
      <div className="flex items-center gap-1.5 mb-1 flex-wrap">
        <span className="font-medium truncate max-w-[120px]">{comment.author_id}</span>
        <span className="text-muted-foreground text-[10px]">
          {new Date(comment.created_at).toLocaleString()}
        </span>
        {comment.resolved && <Badge variant="outline" className="text-[10px] px-1 py-0">Resolved</Badge>}
        {comment.anchor_text && (
          <Badge variant="secondary" className="text-[10px] px-1 py-0 max-w-[80px] truncate" title={comment.anchor_text}>
            "{comment.anchor_text}"
            {hasRange && (
              <span className="ml-0.5 opacity-70">
                ({comment.range_start_offset}–{comment.range_end_offset})
              </span>
            )}
          </Badge>
        )}
      </div>

      {editing ? (
        <div className="space-y-1">
          <textarea
            className="w-full rounded border px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring resize-none"
            rows={2}
            value={editBody}
            onChange={e => setEditBody(e.target.value)}
          />
          <div className="flex gap-1">
            <Button size="sm" className="h-6 px-2 text-xs" onClick={saveEdit}>Save</Button>
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </div>
      ) : (
        <p className="text-muted-foreground leading-relaxed">{comment.body}</p>
      )}

      <div className="flex gap-1 mt-1.5">
        <button className="text-[10px] text-muted-foreground hover:text-foreground" onClick={() => onReply(comment.id)}>
          Reply
        </button>
        <button className="text-[10px] text-muted-foreground hover:text-foreground" onClick={toggleResolve}>
          {comment.resolved ? 'Unresolve' : 'Resolve'}
        </button>
        <button className="text-[10px] text-muted-foreground hover:text-foreground" onClick={() => setEditing(true)}>
          Edit
        </button>
        <button className="text-[10px] text-destructive hover:text-destructive/80" onClick={handleDelete}>
          Delete
        </button>
      </div>
    </div>
  )
}

// ── Comment form ──────────────────────────────────────────────────────────────

interface CommentFormProps {
  objectId: string
  parentId?: number
  onSubmit: () => void
  onCancel?: () => void
  placeholder?: string
}

function CommentForm({ objectId, parentId, onSubmit, onCancel, placeholder = 'Write a comment…' }: CommentFormProps) {
  const [body, setBody] = React.useState('')
  const [anchorText, setAnchorText] = React.useState<string | undefined>(undefined)
  const [rangeStart, setRangeStart] = React.useState<number | undefined>(undefined)
  const [rangeEnd,   setRangeEnd]   = React.useState<number | undefined>(undefined)
  const createComment = useCreateComment()

  // Capture any text the user has selected when they focus the comment textarea
  function captureSelection() {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return
    const range = sel.getRangeAt(0)
    const text = sel.toString().trim()
    if (!text) return
    setAnchorText(text.substring(0, 200))
    setRangeStart(range.startOffset)
    setRangeEnd(range.endOffset)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!body.trim()) return
    await createComment.mutateAsync({
      object_type: OBJECT_TYPE,
      object_id: objectId,
      body,
      parent_id: parentId,
      anchor_text: anchorText,
      range_start_offset: rangeStart,
      range_end_offset: rangeEnd,
    })
    setBody('')
    setAnchorText(undefined)
    setRangeStart(undefined)
    setRangeEnd(undefined)
    onSubmit()
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-1.5">
      {anchorText && (
        <div className="flex items-center gap-1">
          <Badge variant="secondary" className="text-[10px] px-1 py-0 max-w-full truncate" title={anchorText}>
            Anchor: "{anchorText}"
            {rangeStart != null && <span className="ml-0.5 opacity-70">({rangeStart}–{rangeEnd})</span>}
          </Badge>
          <button
            type="button"
            onClick={() => { setAnchorText(undefined); setRangeStart(undefined); setRangeEnd(undefined) }}
            className="text-[10px] text-muted-foreground hover:text-foreground"
          >
            ×
          </button>
        </div>
      )}
      <textarea
        className="w-full rounded border border-input px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring resize-none bg-background"
        rows={2}
        value={body}
        onChange={e => setBody(e.target.value)}
        onFocus={captureSelection}
        placeholder={placeholder}
      />
      <div className="flex gap-1">
        <Button type="submit" size="sm" className="h-6 px-2 text-xs" disabled={createComment.isPending || !body.trim()}>
          {createComment.isPending ? 'Posting…' : 'Post'}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={onCancel}>Cancel</Button>
        )}
      </div>
    </form>
  )
}

// ── Public component ──────────────────────────────────────────────────────────

export interface CommentThreadProps {
  objectId: string
}

export function CommentThread({ objectId }: CommentThreadProps) {
  const user = useCockpitStore(s => s.user)
  const [replyTo, setReplyTo] = React.useState<number | null>(null)

  const { data: comments = [], isLoading } = useComments(OBJECT_TYPE, objectId)

  // Group by parent: top-level first, then replies keyed by parent_id
  const topLevel = comments.filter(c => c.parent_id == null)
  const replies  = comments.filter(c => c.parent_id != null)
  const byParent = replies.reduce<Record<number, Comment[]>>((acc, c) => {
    const p = c.parent_id!
    acc[p] = [...(acc[p] ?? []), c]
    return acc
  }, {})

  return (
    <div className="flex flex-col h-full p-3 space-y-3 text-sm">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Comments ({comments.length})
      </h3>

      <ScrollArea className="flex-1 max-h-[400px]">
        {isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}
        {!isLoading && topLevel.length === 0 && (
          <p className="text-xs text-muted-foreground">No comments yet.</p>
        )}
        <div className="space-y-2">
          {topLevel.map(comment => (
            <div key={comment.id}>
              <CommentItem comment={comment} objectId={objectId} onReply={setReplyTo} />
              {/* Threaded replies */}
              {(byParent[comment.id] ?? []).map(reply => (
                <div key={reply.id} className="ml-4 mt-1">
                  <CommentItem comment={reply} objectId={objectId} onReply={setReplyTo} />
                </div>
              ))}
              {replyTo === comment.id && (
                <div className="ml-4 mt-1">
                  <CommentForm
                    objectId={objectId}
                    parentId={comment.id}
                    onSubmit={() => setReplyTo(null)}
                    onCancel={() => setReplyTo(null)}
                    placeholder="Reply…"
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      </ScrollArea>

      {/* New top-level comment */}
      {user && (
        <div className="border-t pt-2">
          <CommentForm objectId={objectId} onSubmit={() => {}} />
        </div>
      )}
      {!user && (
        <p className="text-xs text-muted-foreground border-t pt-2">
          Log in to leave a comment.
        </p>
      )}
    </div>
  )
}
