/**
 * WorkspaceCenter.tsx — Tabbed center panel: Content / Prayers / Music (Phase 4A)
 */

import { useCockpitStore } from '../../hooks/useCockpitStore'
import { useContentList } from '../../hooks/useContent'
import { useAuthors } from '../../hooks/useAuthors'
import { BulkActionBar } from '../content/BulkActionBar'
import { ContentGrid } from './grids/ContentGrid'
import { PrayersGrid } from './grids/PrayersGrid'
import { MusicGrid } from './grids/MusicGrid'
import { AuthorGrid } from './grids/AuthorGrid'
import { ImagesGrid } from './grids/ImagesGrid'
import { Badge } from '../ui/Badge'

const ARTICLE_TYPES = 'article,blog_post,page,news_item,devotional'

interface WorkspaceCenterProps {
  onRowSelect: (id: string) => void
}

export function WorkspaceCenter({ onRowSelect }: WorkspaceCenterProps) {
  const activeTab = useCockpitStore(s => s.activeTab)
  const setActiveTab = useCockpitStore(s => s.setActiveTab)
  const selectedObjectIds = useCockpitStore(s => s.selectedObjectIds)

  // Tab counts — global totals per type (unconditional hooks)
  const { data: contentData }  = useContentList({ type: ARTICLE_TYPES, limit: 1 })
  const { data: prayersData }  = useContentList({ type: 'prayer',       limit: 1 })
  const { data: musicData }    = useContentList({ type: 'music',        limit: 1 })
  const { data: authorsData } = useAuthors()

  const contentCount = contentData?.total            ?? 0
  const prayersCount = prayersData?.total            ?? 0
  const musicCount   = musicData?.total              ?? 0
  const authorsCount = authorsData?.authors?.length  ?? 0

  const tabs = [
    { id: 'content' as const, label: 'Content',  count: contentCount },
    { id: 'prayers' as const, label: 'Prayers',  count: prayersCount },
    { id: 'music'   as const, label: 'Music',    count: musicCount   },
    { id: 'authors' as const, label: 'Authors',  count: authorsCount },
    { id: 'images'  as const, label: 'Images',   count: 0            },
  ]

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Tab bar */}
      <div className="flex items-center gap-0 border-b shrink-0 px-2">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={[
              'flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 -mb-px transition-colors',
              activeTab === tab.id
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            ].join(' ')}
          >
            {tab.label}
            {tab.id !== 'images' && (
              <Badge variant="secondary" className="text-xs px-1.5 py-0 h-4 min-w-[20px] text-center">
                {tab.count}
              </Badge>
            )}
          </button>
        ))}
      </div>

      {/* Bulk action bar */}
      {selectedObjectIds.size > 0 && (
        <div className="shrink-0 border-b">
          <BulkActionBar />
        </div>
      )}

      {/* Grid */}
      <div className="flex-1 overflow-auto">
        {activeTab === 'content' && <ContentGrid  onRowSelect={onRowSelect} />}
        {activeTab === 'prayers' && <PrayersGrid  onRowSelect={onRowSelect} />}
        {activeTab === 'music'   && <MusicGrid    onRowSelect={onRowSelect} />}
        {activeTab === 'authors' && <AuthorGrid   onRowSelect={onRowSelect} />}
        {activeTab === 'images'  && <ImagesGrid   onRowSelect={onRowSelect} />}
      </div>
    </div>
  )
}
