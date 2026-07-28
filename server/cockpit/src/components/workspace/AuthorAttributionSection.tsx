/**
 * AuthorAttributionSection.tsx — Multi-author attribution for InlineEditorPanel
 *
 * Lists authors assigned to a content object via jv_content_author_map.
 * Admin controls: role change, display_order, remove (×).
 * "+ Add Author": author search input + role select + Add button.
 */

import * as React from 'react'
import { X, Plus, GripVertical } from 'lucide-react'
import { useAuthors } from '../../hooks/useAuthors'
import {
  useContentAuthors,
  useAddContentAuthor,
  useUpdateContentAuthor,
  useRemoveContentAuthor,
} from '../../hooks/useContent'
import { Select } from '../ui/Select'
import { Input }  from '../ui/Input'
import { Button } from '../ui/Button'
import type { ContentAuthorRole } from '../../types/content-objects'

const ROLE_OPTIONS: { value: ContentAuthorRole; label: string }[] = [
  { value: 'primary_author', label: 'Primary Author' },
  { value: 'contributor',    label: 'Contributor' },
  { value: 'editor',         label: 'Editor' },
  { value: 'translator',     label: 'Translator' },
  { value: 'narrator',       label: 'Narrator' },
]

function avatarHue(id: string): number {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0
  return [0, 30, 60, 120, 160, 200, 240, 280, 320][Math.abs(hash) % 9]
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

interface AuthorAttributionSectionProps {
  contentId: string
  isAdmin:   boolean
}

export function AuthorAttributionSection({ contentId, isAdmin }: AuthorAttributionSectionProps) {
  const { data: authorsData } = useAuthors()
  const { data, isLoading }   = useContentAuthors(contentId)
  const attributions = data?.authors ?? []

  const addAuthor    = useAddContentAuthor()
  const updateAuthor = useUpdateContentAuthor()
  const removeAuthor = useRemoveContentAuthor()

  // Add author form state
  const [showAdd,     setShowAdd]     = React.useState(false)
  const [searchQuery, setSearchQuery] = React.useState('')
  const [selectedId,  setSelectedId]  = React.useState('')
  const [addRole,     setAddRole]     = React.useState<ContentAuthorRole>('primary_author')

  const allAuthors = authorsData?.authors ?? []
  const assignedIds = new Set(attributions.map(a => a.author_id))

  const filteredAuthors = allAuthors.filter(a => {
    if (assignedIds.has(a.id)) return false
    const name = (a.extension_data as { display_name?: string })?.display_name || a.title || ''
    return name.toLowerCase().includes(searchQuery.toLowerCase())
  })

  async function handleAdd() {
    if (!selectedId) return
    await addAuthor.mutateAsync({
      contentId,
      authorId:     selectedId,
      role:         addRole,
      displayOrder: attributions.length + 1,
    })
    setShowAdd(false)
    setSearchQuery('')
    setSelectedId('')
    setAddRole('primary_author')
  }

  if (isLoading) {
    return <div className="text-xs text-muted-foreground text-center py-4">Loading…</div>
  }

  return (
    <div className="flex flex-col gap-2 p-3">
      {/* Attribution list */}
      {attributions.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-2">No authors assigned yet.</p>
      ) : (
        <div className="space-y-1.5">
          {attributions.map(attr => {
            const name   = attr.display_name || 'Unknown'
            const hue    = avatarHue(attr.author_id)
            const roleOpt = ROLE_OPTIONS.find(r => r.value === attr.role)

            return (
              <div key={attr.id} className="flex items-center gap-2 px-2 py-1.5 rounded border bg-background">
                {/* Drag handle (decorative) */}
                {isAdmin && (
                  <GripVertical size={12} className="text-muted-foreground shrink-0 cursor-grab" />
                )}

                {/* Avatar */}
                <div
                  className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-semibold text-white"
                  style={{ backgroundColor: `hsl(${hue}, 55%, 45%)` }}
                >
                  {initials(name)}
                </div>

                {/* Name + role */}
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium truncate">{name}</div>
                  {isAdmin ? (
                    <Select
                      className="h-5 text-[10px] mt-0.5 w-full max-w-[140px]"
                      value={attr.role}
                      onValueChange={role =>
                        updateAuthor.mutate({ contentId, authorId: attr.author_id, role: role as ContentAuthorRole })
                      }
                      options={ROLE_OPTIONS}
                    />
                  ) : (
                    <span className="text-[10px] text-muted-foreground">{roleOpt?.label ?? attr.role}</span>
                  )}
                </div>

                {/* Remove */}
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => removeAuthor.mutate({ contentId, authorId: attr.author_id })}
                    disabled={removeAuthor.isPending}
                    className="text-muted-foreground hover:text-destructive transition-colors shrink-0 p-0.5"
                    title="Remove author"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Add author form */}
      {showAdd ? (
        <div className="border rounded p-2.5 bg-muted/20 space-y-2">
          <div>
            <label className="text-[10px] text-muted-foreground block mb-0.5">Search authors</label>
            <Input
              className="h-7 text-xs"
              value={searchQuery}
              onChange={e => { setSearchQuery(e.target.value); setSelectedId('') }}
              placeholder="Type name…"
            />
            {searchQuery && filteredAuthors.length > 0 && !selectedId && (
              <div className="border rounded mt-1 bg-background shadow-sm max-h-32 overflow-y-auto">
                {filteredAuthors.slice(0, 8).map(a => {
                  const name = (a.extension_data as { display_name?: string })?.display_name || a.title || 'Unknown'
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => { setSelectedId(a.id); setSearchQuery(name) }}
                      className="w-full text-left px-2 py-1.5 text-xs hover:bg-muted/60 transition-colors"
                    >
                      {name}
                    </button>
                  )
                })}
              </div>
            )}
            {searchQuery && filteredAuthors.length === 0 && !selectedId && (
              <p className="text-[10px] text-muted-foreground mt-1">No matching authors</p>
            )}
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground block mb-0.5">Role</label>
            <Select
              className="w-full h-7 text-xs"
              value={addRole}
              onValueChange={v => setAddRole(v as ContentAuthorRole)}
              options={ROLE_OPTIONS}
            />
          </div>
          <div className="flex items-center gap-2 pt-1">
            <Button
              size="sm"
              className="flex-1 h-7 text-xs"
              onClick={handleAdd}
              disabled={!selectedId || addAuthor.isPending}
            >
              {addAuthor.isPending ? 'Adding…' : 'Add'}
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs"
              onClick={() => { setShowAdd(false); setSearchQuery(''); setSelectedId('') }}>
              Cancel
            </Button>
          </div>
        </div>
      ) : isAdmin ? (
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="w-full flex items-center justify-center gap-1.5 text-xs text-primary hover:text-primary/80 border-2 border-dashed border-muted rounded py-2 transition-colors hover:border-primary/40"
        >
          <Plus size={11} />
          Add Author
        </button>
      ) : null}
    </div>
  )
}
