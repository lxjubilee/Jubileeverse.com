/**
 * Editor.tsx — Full-screen content editor with TipTap + sidebars (Phase 4)
 *
 * Route: /cockpit/editor/:id
 * Sidebars: Metadata | Revisions | Comments
 */

import * as React from 'react'
import { useParams, useNavigate }  from 'react-router-dom'
import { TabsRoot, TabsList, TabsTrigger, TabsContent } from '../components/ui/Tabs'
import { ScrollArea }              from '../components/ui/ScrollArea'
import { Button }                  from '../components/ui/Button'
import { RichTextEditor }          from '../components/editor/RichTextEditor'
import { MetadataSidebar }         from '../components/editor/MetadataSidebar'
import { RevisionSidebar }         from '../components/editor/RevisionSidebar'
import { CommentThread }           from '../components/editor/CommentThread'
import { useContentObject, useUpdateContent } from '../hooks/useContent'
import type { UpdateContentObjectRequest } from '../types/content-objects'

export function Editor() {
  const { id }   = useParams<{ id: string }>()
  const navigate = useNavigate()

  const { data: obj, isLoading, isError } = useContentObject(id ?? null)
  const updateContent = useUpdateContent()

  const [localHtml,   setLocalHtml]   = React.useState<string>('')
  const [pendingPatch, setPendingPatch] = React.useState<UpdateContentObjectRequest>({})
  const [saving, setSaving]            = React.useState(false)
  const [sidebarTab, setSidebarTab]    = React.useState('metadata')

  // Populate editor when object loads
  React.useEffect(() => {
    if (obj) {
      const body = (obj.extension_data as Record<string, unknown>)?.body_html as string ?? ''
      setLocalHtml(body)
    }
  }, [obj?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleHtmlChange(html: string) {
    setLocalHtml(html)
  }

  function handleMetaChange(patch: UpdateContentObjectRequest) {
    setPendingPatch(p => ({ ...p, ...patch }))
  }

  async function handleSave(changeSummary = 'Manual save') {
    if (!id) return
    setSaving(true)
    try {
      await updateContent.mutateAsync({
        id,
        data: {
          ...pendingPatch,
          extension_data: {
            ...(obj?.extension_data ?? {}),
            body_html: localHtml,
          },
          change_summary: changeSummary,
        },
      })
      setPendingPatch({})
    } finally {
      setSaving(false)
    }
  }

  async function handleAutoSave(html: string) {
    if (!id) return
    await updateContent.mutateAsync({
      id,
      data: {
        extension_data: { ...(obj?.extension_data ?? {}), body_html: html },
        change_summary: 'Auto-save',
      },
    }).catch(() => {}) // silently swallow auto-save errors
  }

  if (isLoading) {
    return <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">Loading…</div>
  }
  if (isError || !obj) {
    return <div className="flex h-screen items-center justify-center text-sm text-destructive">Content object not found.</div>
  }

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {/* Top bar */}
      <header className="flex h-10 flex-shrink-0 items-center gap-3 border-b px-4">
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => navigate('/')}>
          ← Back
        </Button>
        <span className="flex-1 truncate text-sm font-medium">{obj.title ?? 'Untitled'}</span>
        <span className="text-xs text-muted-foreground capitalize">{obj.object_type.replace('_', ' ')}</span>
        <Button
          size="sm"
          className="h-7 text-xs"
          onClick={() => handleSave()}
          disabled={saving}
        >
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </header>

      {/* Editor + sidebar */}
      <div className="flex flex-1 overflow-hidden">
        {/* Main editor area */}
        <div className="flex-1 p-4 overflow-hidden">
          <RichTextEditor
            initialHtml={localHtml}
            onChange={handleHtmlChange}
            onAutoSave={handleAutoSave}
          />
        </div>

        {/* Right sidebar */}
        <div className="w-72 flex-shrink-0 border-l">
          <TabsRoot value={sidebarTab} onValueChange={setSidebarTab} className="flex flex-col h-full">
            <TabsList className="mx-2 mt-2 h-7 text-xs rounded">
              <TabsTrigger value="metadata"  className="text-xs px-2 py-0.5 h-6">Meta</TabsTrigger>
              <TabsTrigger value="revisions" className="text-xs px-2 py-0.5 h-6">History</TabsTrigger>
              <TabsTrigger value="comments"  className="text-xs px-2 py-0.5 h-6">Comments</TabsTrigger>
            </TabsList>

            <ScrollArea className="flex-1 mt-1">
              <TabsContent value="metadata">
                <MetadataSidebar
                  object={{ ...obj, ...pendingPatch } as typeof obj}
                  onChange={handleMetaChange}
                />
              </TabsContent>
              <TabsContent value="revisions">
                <RevisionSidebar objectId={obj.id} />
              </TabsContent>
              <TabsContent value="comments">
                <CommentThread objectId={obj.id} />
              </TabsContent>
            </ScrollArea>
          </TabsRoot>
        </div>
      </div>
    </div>
  )
}
