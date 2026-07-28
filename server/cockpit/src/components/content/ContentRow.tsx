/**
 * ContentRow.tsx — Single content object row with hover Popover preview (Phase 4)
 */

import { Badge }           from '../ui/Badge'
import { Checkbox }        from '../ui/Checkbox'
import { PopoverRoot, PopoverTrigger, PopoverContent } from '../ui/Popover'
import { useCockpitStore } from '../../hooks/useCockpitStore'
import type { ContentObject } from '../../types/content-objects'
import type { BadgeVariant } from '../ui/Badge'

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  draft:     'secondary',
  review:    'warning',
  approved:  'success',
  scheduled: 'warning',
  published: 'success',
  archived:  'outline',
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export interface ContentRowProps {
  item: ContentObject
  onEdit: (id: string) => void
}

export function ContentRow({ item, onEdit }: ContentRowProps) {
  const selectedObjectIds = useCockpitStore(s => s.selectedObjectIds)
  const toggleObjectSelection = useCockpitStore(s => s.toggleObjectSelection)
  const isSelected = selectedObjectIds.has(item.id)

  return (
    <tr className={['border-b transition-colors text-sm', isSelected ? 'bg-primary/5' : 'hover:bg-muted/40'].join(' ')}>
      <td className="w-8 px-2 py-2">
        <Checkbox
          checked={isSelected}
          onCheckedChange={() => toggleObjectSelection(item.id)}
        />
      </td>
      <td className="px-2 py-2">
        <Badge variant="secondary" className="text-xs">
          {item.object_type.replace('_', ' ')}
        </Badge>
      </td>
      <td className="px-2 py-2 max-w-xs">
        <PopoverRoot>
          <PopoverTrigger asChild>
            <button
              className="text-left truncate font-medium hover:underline focus:outline-none"
              onClick={() => onEdit(item.id)}
            >
              {item.title ?? <span className="text-muted-foreground italic">Untitled</span>}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-80 p-3 text-xs space-y-1">
            <p className="font-semibold text-sm">{item.title ?? 'Untitled'}</p>
            {item.summary && <p className="text-muted-foreground line-clamp-3">{item.summary}</p>}
            <div className="flex gap-2 pt-1">
              <Badge variant={STATUS_VARIANT[item.status] ?? 'default'}>{item.status}</Badge>
              <span className="text-muted-foreground">{item.language}</span>
            </div>
          </PopoverContent>
        </PopoverRoot>
      </td>
      <td className="px-2 py-2">
        <Badge variant={STATUS_VARIANT[item.status] ?? 'default'}>{item.status}</Badge>
      </td>
      <td className="px-2 py-2 text-muted-foreground text-xs">{item.language}</td>
      <td className="px-2 py-2 text-muted-foreground text-xs">{formatDate(item.updated_at)}</td>
    </tr>
  )
}
