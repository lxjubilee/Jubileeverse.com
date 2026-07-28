/**
 * InlineEditorPanel.tsx — Sliding 420px right editor panel (Phase 4A / Phase 5)
 *
 * Always rendered in DOM; off-screen when selectedObjectId is null.
 * Opens to 420px when a row is selected.
 *
 * Tabs: Edit | Meta | History | Comments | Tasks
 * Form: ArticleForm | PrayerForm | MusicForm (based on object_type)
 */

import { useNavigate } from 'react-router-dom'
import { X, ExternalLink } from 'lucide-react'
import { useCockpitStore } from '../../hooks/useCockpitStore'
import { useContentObject, useUpdateContent } from '../../hooks/useContent'
import { TabsRoot, TabsList, TabsTrigger, TabsContent } from '../ui/Tabs'
import { MetadataSidebar } from '../editor/MetadataSidebar'
import { RevisionSidebar } from '../editor/RevisionSidebar'
import { CommentThread } from '../editor/CommentThread'
import { ArticleForm }  from './forms/ArticleForm'
import { PrayerForm }  from './forms/PrayerForm'
import { MusicForm }   from './forms/MusicForm'
import { AuthorForm }  from './forms/AuthorForm'
import { SiteForm }    from './forms/SiteForm'
import { WorkflowPanel } from './WorkflowPanel'
import { TaskPanel } from './TaskPanel'
import { PresenceBar } from './PresenceBar'
import { GenerateButton } from './GenerateButton'
import { AutomateGenerationButton } from './AutomateGenerationButton'
import { PublishTargetsPanel } from './PublishTargetsPanel'
import { AuthorAttributionSection } from './AuthorAttributionSection'
import { Badge } from '../ui/Badge'

const ARTICLE_TYPES    = new Set(['article', 'blog_post', 'page', 'news_item', 'devotional'])
const AUTHOR_TAB_TYPES = new Set([
  'article', 'blog_post', 'news_item', 'devotional', 'sermon', 'testimony',
  'prayer', 'music', 'radio_episode', 'podcast',
])

function FormForType({ item }: { item: NonNullable<ReturnType<typeof useContentObject>['data']> }) {
  if (ARTICLE_TYPES.has(item.object_type)) return <ArticleForm  item={item} />
  if (item.object_type === 'prayer')       return <PrayerForm   item={item} />
  if (item.object_type === 'music')        return <MusicForm    item={item} />
  if (item.object_type === 'author')       return <AuthorForm   item={item} />
  if (item.object_type === 'site')         return <SiteForm     item={item} />
  return (
    <p className="text-xs text-muted-foreground p-4">
      No inline editor available for type: {item.object_type}
    </p>
  )
}

export function InlineEditorPanel() {
  const navigate = useNavigate()
  const user             = useCockpitStore(s => s.user)
  const selectedObjectId = useCockpitStore(s => s.selectedObjectId)
  const setSelectedObjectId = useCockpitStore(s => s.setSelectedObjectId)

  const isAdmin = user?.role === 'admin'

  const { data: item, isLoading } = useContentObject(selectedObjectId)
  const update = useUpdateContent()

  function handleClose() {
    setSelectedObjectId(null)
  }

  function handleOpenFull() {
    if (selectedObjectId) navigate(`/editor/${selectedObjectId}`)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Panel header */}
      <div className="flex items-center justify-between px-3 py-2 border-b shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          {item && (
            <Badge variant="secondary" className="text-xs px-1.5 py-0 shrink-0 capitalize">
              {item.object_type.replace('_', ' ')}
            </Badge>
          )}
          <span className="text-sm font-medium truncate">
            {isLoading ? 'Loading…' : (item?.title ?? 'Select a row')}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {selectedObjectId && <PresenceBar objectId={selectedObjectId} />}
          {item && <AutomateGenerationButton item={item} />}
          {item && <GenerateButton item={item} />}
          <button
            onClick={handleOpenFull}
            className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
            aria-label="Open full editor"
            title="Full editor"
          >
            <ExternalLink size={13} />
          </button>
          <button
            onClick={handleClose}
            className="p-1 rounded hover:bg-muted transition-colors"
            aria-label="Close editor panel"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Workflow status + transitions */}
      {item && selectedObjectId && (
        <div className="px-3 py-2 border-b shrink-0">
          <WorkflowPanel
            objectId={selectedObjectId}
            currentStatus={item.status}
          />
        </div>
      )}

      {/* Tabs */}
      {item ? (
        <TabsRoot defaultValue="edit" className="flex flex-col flex-1 overflow-hidden">
          <TabsList className="shrink-0 border-b rounded-none px-2 justify-start gap-0">
            <TabsTrigger value="edit"     className="text-xs px-3 py-2 rounded-none border-b-2 border-transparent data-[state=active]:border-primary">Edit</TabsTrigger>
            {AUTHOR_TAB_TYPES.has(item.object_type) && (
              <TabsTrigger value="authors" className="text-xs px-3 py-2 rounded-none border-b-2 border-transparent data-[state=active]:border-primary">Authors</TabsTrigger>
            )}
            <TabsTrigger value="meta"     className="text-xs px-3 py-2 rounded-none border-b-2 border-transparent data-[state=active]:border-primary">Meta</TabsTrigger>
            <TabsTrigger value="history"  className="text-xs px-3 py-2 rounded-none border-b-2 border-transparent data-[state=active]:border-primary">History</TabsTrigger>
            <TabsTrigger value="comments" className="text-xs px-3 py-2 rounded-none border-b-2 border-transparent data-[state=active]:border-primary">Comments</TabsTrigger>
            <TabsTrigger value="tasks"    className="text-xs px-3 py-2 rounded-none border-b-2 border-transparent data-[state=active]:border-primary">Tasks</TabsTrigger>
            <TabsTrigger value="publish"  className="text-xs px-3 py-2 rounded-none border-b-2 border-transparent data-[state=active]:border-primary">Publish</TabsTrigger>
          </TabsList>

          <div className="flex-1 overflow-auto">
            <TabsContent value="edit"     className="h-full m-0">
              <FormForType item={item} />
            </TabsContent>
            {AUTHOR_TAB_TYPES.has(item.object_type) && (
              <TabsContent value="authors" className="h-full m-0">
                <AuthorAttributionSection contentId={item.id} isAdmin={isAdmin} />
              </TabsContent>
            )}
            <TabsContent value="meta"     className="h-full m-0">
              <MetadataSidebar
                object={item}
                onChange={(patch) => update.mutate({ id: item.id, data: patch })}
              />
            </TabsContent>
            <TabsContent value="history"  className="h-full m-0">
              <RevisionSidebar objectId={item.id} />
            </TabsContent>
            <TabsContent value="comments" className="h-full m-0">
              <CommentThread objectId={item.id} />
            </TabsContent>
            <TabsContent value="tasks"    className="h-full m-0 p-3">
              <TaskPanel objectId={item.id} />
            </TabsContent>
            <TabsContent value="publish"  className="h-full m-0">
              <PublishTargetsPanel item={item} />
            </TabsContent>
          </div>
        </TabsRoot>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-xs text-muted-foreground">
            {isLoading ? 'Loading…' : 'Select a row to edit'}
          </p>
        </div>
      )}
    </div>
  )
}
