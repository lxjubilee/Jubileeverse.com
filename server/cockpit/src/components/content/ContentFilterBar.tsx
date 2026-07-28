/**
 * ContentFilterBar.tsx — Type / status / language filter bar (Phase 4)
 */

import { Select }       from '../ui/Select'
import { Input }        from '../ui/Input'
import { Button }       from '../ui/Button'
import { Badge }        from '../ui/Badge'
import { useCockpitStore } from '../../hooks/useCockpitStore'
import { OBJECT_TYPES, OBJECT_STATUSES } from '../../types/content-objects'

const TYPE_OPTIONS = [
  { value: '', label: 'All types' },
  ...OBJECT_TYPES.map(t => ({ value: t, label: t.replace('_', ' ') })),
]

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  ...OBJECT_STATUSES.map(s => ({ value: s, label: s })),
]

const LANG_OPTIONS = [
  { value: '',     label: 'All languages' },
  { value: 'en',   label: 'English' },
  { value: 'es',   label: 'Spanish' },
  { value: 'fr',   label: 'French' },
]

export function ContentFilterBar() {
  const filters = useCockpitStore(s => s.filters)
  const setFilters = useCockpitStore(s => s.setFilters)

  const activeCount = [filters.type, filters.status, filters.language, filters.q]
    .filter(Boolean).length

  function clearAll() {
    setFilters({ type: undefined, status: undefined, language: undefined, q: undefined })
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-b bg-background px-3 py-2">
      <Input
        placeholder="Search…"
        className="h-7 w-40 text-xs"
        value={filters.q ?? ''}
        onChange={e => setFilters({ q: e.target.value || undefined })}
      />
      <Select
        className="w-36 text-xs h-7"
        value={filters.type ?? ''}
        onValueChange={v => setFilters({ type: v || undefined })}
        options={TYPE_OPTIONS}
        placeholder="Type"
      />
      <Select
        className="w-32 text-xs h-7"
        value={filters.status ?? ''}
        onValueChange={v => setFilters({ status: v || undefined })}
        options={STATUS_OPTIONS}
        placeholder="Status"
      />
      <Select
        className="w-32 text-xs h-7"
        value={filters.language ?? ''}
        onValueChange={v => setFilters({ language: v || undefined })}
        options={LANG_OPTIONS}
        placeholder="Language"
      />
      {activeCount > 0 && (
        <>
          <Badge variant="secondary" className="text-xs">{activeCount} active</Badge>
          <Button variant="ghost" size="sm" className="h-7 text-xs px-2" onClick={clearAll}>
            Clear
          </Button>
        </>
      )}
    </div>
  )
}
