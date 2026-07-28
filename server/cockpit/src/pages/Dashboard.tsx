import { CONTENT_OBJECT_TYPES } from '@/types/objects'
import { ROLES, ROLE_LABELS, ROLE_DESCRIPTIONS } from '@/types/roles'

/**
 * Dashboard — Phase 1 Placeholder
 *
 * Displays the enumerated object types and role matrix to satisfy Phase 1
 * acceptance criteria: "All 13 object types are enumerable in the system."
 * Full cockpit UI will be built in Phase 2+.
 */
export default function Dashboard() {
  return (
    <div className="min-h-screen bg-background p-8">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-foreground">JubileeVerse Back Office</h1>
        <p className="text-muted-foreground mt-1">Publishing Operating System — Phase 1 Foundation</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Object Types */}
        <section className="rounded-lg border p-6">
          <h2 className="text-xl font-semibold mb-4">Content Object Types ({CONTENT_OBJECT_TYPES.length})</h2>
          <ul className="space-y-1">
            {CONTENT_OBJECT_TYPES.map((type) => (
              <li key={type} className="flex items-center gap-2 text-sm">
                <span className="w-2 h-2 rounded-full bg-primary inline-block" />
                <code className="font-mono">{type}</code>
              </li>
            ))}
          </ul>
        </section>

        {/* Roles */}
        <section className="rounded-lg border p-6">
          <h2 className="text-xl font-semibold mb-4">User Roles ({ROLES.length})</h2>
          <ul className="space-y-3">
            {ROLES.map((role) => (
              <li key={role}>
                <p className="font-medium text-sm">{ROLE_LABELS[role]}</p>
                <p className="text-xs text-muted-foreground">{ROLE_DESCRIPTIONS[role]}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <footer className="mt-12 text-xs text-muted-foreground">
        Phase 1 complete. ADRs in <code>docs/adr/</code>. DB migrations applied on server start.
      </footer>
    </div>
  )
}
