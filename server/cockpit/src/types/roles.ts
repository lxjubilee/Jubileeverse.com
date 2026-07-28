/**
 * PubOS Role & Permission Types — Phase 1
 *
 * Six roles form a hierarchy where each role's permissions are a strict subset
 * of the roles above it (with scope constraints). See ADR 007 for the auth strategy
 * and docs/adr/007-authentication.md for the Supabase migration plan.
 */

// ── Roles ─────────────────────────────────────────────────────────────────────

export type Role =
  | 'admin'
  | 'site_owner'
  | 'publisher'
  | 'reviewer'
  | 'editor'
  | 'author_operator'

export const ROLES: Role[] = [
  'admin',
  'site_owner',
  'publisher',
  'reviewer',
  'editor',
  'author_operator',
]

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Administrator',
  site_owner: 'Site Owner',
  publisher: 'Publisher',
  reviewer: 'Reviewer',
  editor: 'Editor',
  author_operator: 'Author Operator',
}

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  admin:
    'Full system governance: manage roles, sites, taxonomy, system config, and audit logs. Can perform all actions.',
  site_owner:
    'Configure site-level settings: domain, theme, navigation, taxonomy mapping, and publishing rules.',
  publisher:
    'Approve content for publication, schedule releases, trigger publish pipeline, manage archives.',
  reviewer:
    'Provide editorial feedback via inline comments, approve or request revisions, assign tasks back to editors.',
  editor:
    'Create, draft, and edit content objects. Use AI generation tools. Submit content for review.',
  author_operator:
    'Manage author profiles, update voice configs, interact via author chat, override author assignments.',
}

// ── Permissions ───────────────────────────────────────────────────────────────

export type Permission =
  | 'manage_roles'
  | 'manage_sites'
  | 'manage_taxonomy'
  | 'manage_system'
  | 'view_audit_logs'
  | 'approve_content'
  | 'schedule_publish'
  | 'create_content'
  | 'edit_content'
  | 'delete_content'
  | 'submit_review'
  | 'give_feedback'
  | 'manage_authors'
  | 'manage_assets'
  | 'manage_pipelines'
  | 'prompt:manage'
  | 'automation:view'

export type PermissionScope = 'global' | 'per_site' | 'assigned'

export interface RolePermission {
  role: Role
  permission: Permission
  scope: PermissionScope
}

// ── Permission matrix (mirrors SQLite jv_role_permissions seed data) ──────────

export const PERMISSION_MATRIX: RolePermission[] = [
  // admin — full global access
  { role: 'admin', permission: 'manage_roles',     scope: 'global' },
  { role: 'admin', permission: 'manage_sites',     scope: 'global' },
  { role: 'admin', permission: 'manage_taxonomy',  scope: 'global' },
  { role: 'admin', permission: 'manage_system',    scope: 'global' },
  { role: 'admin', permission: 'view_audit_logs',  scope: 'global' },
  { role: 'admin', permission: 'approve_content',  scope: 'global' },
  { role: 'admin', permission: 'schedule_publish', scope: 'global' },
  { role: 'admin', permission: 'create_content',   scope: 'global' },
  { role: 'admin', permission: 'edit_content',     scope: 'global' },
  { role: 'admin', permission: 'delete_content',   scope: 'global' },
  { role: 'admin', permission: 'submit_review',    scope: 'global' },
  { role: 'admin', permission: 'give_feedback',    scope: 'global' },
  { role: 'admin', permission: 'manage_authors',  scope: 'global' },
  { role: 'admin', permission: 'manage_assets',    scope: 'global' },
  { role: 'admin', permission: 'manage_pipelines', scope: 'global' },
  // site_owner — per-site governance
  { role: 'site_owner', permission: 'manage_sites',     scope: 'per_site' },
  { role: 'site_owner', permission: 'manage_taxonomy',  scope: 'per_site' },
  { role: 'site_owner', permission: 'approve_content',  scope: 'per_site' },
  { role: 'site_owner', permission: 'schedule_publish', scope: 'per_site' },
  { role: 'site_owner', permission: 'create_content',   scope: 'per_site' },
  { role: 'site_owner', permission: 'edit_content',     scope: 'per_site' },
  { role: 'site_owner', permission: 'give_feedback',    scope: 'per_site' },
  { role: 'site_owner', permission: 'view_audit_logs',  scope: 'per_site' },
  { role: 'site_owner', permission: 'manage_assets',    scope: 'per_site' },
  // publisher
  { role: 'publisher', permission: 'approve_content',  scope: 'per_site' },
  { role: 'publisher', permission: 'schedule_publish', scope: 'per_site' },
  { role: 'publisher', permission: 'edit_content',     scope: 'per_site' },
  { role: 'publisher', permission: 'give_feedback',    scope: 'per_site' },
  { role: 'publisher', permission: 'view_audit_logs',  scope: 'per_site' },
  { role: 'publisher', permission: 'manage_assets',    scope: 'per_site' },
  // reviewer
  { role: 'reviewer', permission: 'give_feedback',    scope: 'assigned' },
  { role: 'reviewer', permission: 'edit_content',     scope: 'assigned' },
  { role: 'reviewer', permission: 'view_audit_logs',  scope: 'assigned' },
  { role: 'reviewer', permission: 'approve_content',  scope: 'assigned' },
  { role: 'reviewer', permission: 'manage_assets',    scope: 'assigned' },
  { role: 'reviewer', permission: 'manage_pipelines', scope: 'global' },
  // editor
  { role: 'editor', permission: 'create_content', scope: 'assigned' },
  { role: 'editor', permission: 'edit_content',   scope: 'assigned' },
  { role: 'editor', permission: 'submit_review',  scope: 'assigned' },
  { role: 'editor', permission: 'manage_assets',  scope: 'assigned' },
  // author_operator
  { role: 'author_operator', permission: 'manage_authors', scope: 'global' },
  { role: 'author_operator', permission: 'create_content',  scope: 'assigned' },
  { role: 'author_operator', permission: 'edit_content',    scope: 'assigned' },
  // prompt:manage — admin only
  { role: 'admin',            permission: 'prompt:manage',   scope: 'global'   },
  // automation:view — all back-office roles
  { role: 'admin',            permission: 'automation:view', scope: 'global'   },
  { role: 'site_owner',       permission: 'automation:view', scope: 'per_site' },
  { role: 'publisher',        permission: 'automation:view', scope: 'per_site' },
  { role: 'reviewer',         permission: 'automation:view', scope: 'assigned' },
  { role: 'editor',           permission: 'automation:view', scope: 'assigned' },
  { role: 'author_operator', permission: 'automation:view', scope: 'global'   },
]

// ── Helper ────────────────────────────────────────────────────────────────────

/** Returns true if the given role has the given permission (at any scope). */
export function hasPermission(role: Role, permission: Permission): boolean {
  return PERMISSION_MATRIX.some((p) => p.role === role && p.permission === permission)
}

/** Returns all permissions for a given role. */
export function getPermissions(role: Role): RolePermission[] {
  return PERMISSION_MATRIX.filter((p) => p.role === role)
}
