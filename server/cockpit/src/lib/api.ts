'use strict'
/**
 * lib/api.ts — PubOS Cockpit API Client (Phase 4 + Sections 10-11)
 *
 * Typed fetch wrapper using HttpOnly session cookies (Sections 10-11).
 * CSRF token injected from jv-csrf cookie for state-changing requests.
 * All requests go to /api/* which Vite proxies to localhost:3107.
 */

import type {
  AuthorChatResponse, AuthorUsageEntry,
  CreateAuthorRequest, UpdateAuthorRequest,
  AuthorChatMessage,
  AuthorBio, CreateAuthorBioRequest, UpdateAuthorBioRequest,
  ContentAuthorAttribution, ContentAuthorRole,
  SitePublishTarget, CreateSiteRequest, UpdateSiteRequest, SitePublishingReportEntry,
  ApiKey, WebhookRecord, WebhookDelivery,
  ContentObject,
  ContentListResponse,
  ContentSearchResponse,
  ContentDiffResponse,
  ContentRevision,
  AuditLogResponse,
  CreateContentObjectRequest,
  UpdateContentObjectRequest,
  AssetUploadUrlRequest,
  AssetUploadUrlResponse,
  AssetConfirmRequest,
  WorkflowTransitionRequest,
  Notification,
  ContentTask,
  CreateTaskRequest,
  UpdateTaskRequest,
  GenerateRequest,
  GenerateResponse,
  PromptRecipeSummary,
  GenerationLogResponse,
  CmsUser,
  CmsUserListResponse,
  UserSessionsResponse,
  UserActivitySummary,
  CmsUserRole,
  DirectoryUser,
  GrantCmsAccessRequest,
  WebsiteTaxonomyAssignment,
  WebsitePage,
  WebsitePackage,
  PortalRules,
  ContentRevisionSummary,
  SatelliteUpdate,
  SatelliteSyncStatus,
  ImageGenerationJob,
  ServerNode,
  AuditReport,
  AuditRubric,
  SelfTestResult,
} from '../types/content-objects'
import type { TaxonomyType } from '../types/taxonomy'

// ── CSRF token (read from jv-csrf cookie — not HttpOnly, JS-readable) ────────

function _getCsrfToken(): string | null {
  if (typeof document === 'undefined') return null
  const m = document.cookie.match(/(?:^|;\s*)jv-csrf=([^;]*)/)
  return m ? decodeURIComponent(m[1]) : null
}

// ── Base fetch ────────────────────────────────────────────────────────────────

async function apiFetch<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string>),
  }
  // Inject CSRF token for state-changing requests when session cookie is active
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const csrf = _getCsrfToken()
    if (csrf) headers['X-CSRF-Token'] = csrf
  }

  const res = await fetch(path, { ...init, headers, credentials: 'include' })
  if (res.status === 401) {
    // Throw — let TanStack Query surface the error; BackOfficeShell handles session
    // (Do NOT auto-redirect here — that causes redirect loops when individual endpoints
    //  return 401 for permission reasons while the session itself is valid)
    throw new Error('Unauthorized')
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(body.error ?? `HTTP ${res.status}`)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export interface LoginResponse {
  token: string
  user: { id: string; email: string; role: string }
}

export function loginReviewer(email: string, password: string): Promise<LoginResponse> {
  return apiFetch('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
}

// ── Taxonomy ──────────────────────────────────────────────────────────────────

export interface TaxonomyRootsResponse {
  taxonomy_type: TaxonomyType
  nodes: TaxonomyNode[]
}

export interface TaxonomyNode {
  id: number
  taxonomy_type: TaxonomyType
  parent_id: number | null
  slug: string
  name: string
  title: string | null
  description: string | null
  depth: number
  sort_order: number
  materialized_path: string
  config: Record<string, unknown>
  is_active: boolean
  created_at: string
  updated_at: string
  children?: TaxonomyNode[]
  content_count?: number
}

export interface TaxonomyNodeDetail extends TaxonomyNode {
  children: TaxonomyNode[]
  ancestors: TaxonomyNode[]
}

export interface TaxonomyContentResult {
  items: ContentObject[]
  total: number
  limit: number
  offset: number
}

export interface ContentTaxonomyMap {
  id: number
  object_table: string
  object_id: string
  taxonomy_node_id: number
  is_primary: boolean
  assigned_by: string | null
  assigned_at: string
}

export function getTaxonomyRoots(): Promise<TaxonomyRootsResponse[]> {
  return apiFetch('/api/taxonomy')
}

export function getTaxonomyType(type: TaxonomyType): Promise<{ taxonomy_type: TaxonomyType; nodes: TaxonomyNode[] }> {
  return apiFetch(`/api/taxonomy/${type}`)
}

export function getAllTaxonomyNodes(type?: TaxonomyType): Promise<{ nodes: TaxonomyNode[] }> {
  const qs = type ? `?type=${encodeURIComponent(type)}` : ''
  return apiFetch(`/api/taxonomy/all${qs}`)
}

export function getTaxonomyNode(type: TaxonomyType, slug: string): Promise<TaxonomyNodeDetail> {
  return apiFetch(`/api/taxonomy/${type}/${slug}`)
}

export function getTaxonomyNodeContent(
  type: TaxonomyType,
  slug: string,
  opts: { limit?: number; offset?: number; nodeId?: number } = {}
): Promise<TaxonomyContentResult> {
  const { nodeId, ...rest } = opts
  const params: Record<string, string> = {}
  if (rest.limit  != null) params.limit  = String(rest.limit)
  if (rest.offset != null) params.offset = String(rest.offset)
  if (nodeId      != null) params.node_id = String(nodeId)
  const q = new URLSearchParams(params).toString()
  return apiFetch(`/api/taxonomy/${type}/${slug}/content${q ? `?${q}` : ''}`)
}

export function createTaxonomyNode(data: Partial<TaxonomyNode>): Promise<TaxonomyNode> {
  return apiFetch('/api/taxonomy/nodes', { method: 'POST', body: JSON.stringify(data) })
}

export function updateTaxonomyNode(id: number, data: Partial<TaxonomyNode>): Promise<TaxonomyNode> {
  return apiFetch(`/api/taxonomy/nodes/${id}`, { method: 'PUT', body: JSON.stringify(data) })
}

export function moveTaxonomyNode(id: number, newParentId: number | null): Promise<TaxonomyNode> {
  return apiFetch(`/api/taxonomy/nodes/${id}/move`, { method: 'POST', body: JSON.stringify({ new_parent_id: newParentId }) })
}

// ── Content Objects ───────────────────────────────────────────────────────────

export interface ContentFilters {
  type?: string
  status?: string
  language?: string
  author_id?: string
  q?: string
  limit?: number
  offset?: number
  sortBy?: string
  sortDir?: 'asc' | 'desc'
}

export function createContent(data: CreateContentObjectRequest): Promise<ContentObject> {
  return apiFetch('/api/content', { method: 'POST', body: JSON.stringify(data) })
}

export function getContent(id: string): Promise<ContentObject> {
  return apiFetch(`/api/content/${id}`)
}

export function listContent(filters: ContentFilters = {}): Promise<ContentListResponse> {
  const q = new URLSearchParams(
    Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]))
  ).toString()
  return apiFetch(`/api/content${q ? `?${q}` : ''}`)
}

export function updateContent(id: string, data: UpdateContentObjectRequest): Promise<ContentObject> {
  return apiFetch(`/api/content/${id}`, { method: 'PUT', body: JSON.stringify(data) })
}

export function archiveContent(id: string): Promise<ContentObject> {
  return apiFetch(`/api/content/${id}/archive`, { method: 'POST' })
}

export function getRevisions(id: string): Promise<ContentRevision[]> {
  return apiFetch(`/api/content/${id}/revisions`)
}

export function getRevision(id: string, version: number): Promise<ContentRevision> {
  return apiFetch(`/api/content/${id}/revisions/${version}`)
}

export function rollbackContent(id: string, version: number): Promise<ContentObject> {
  return apiFetch(`/api/content/${id}/rollback/${version}`, { method: 'POST' })
}

export function diffContent(id: string, from: number, to: number): Promise<ContentDiffResponse> {
  return apiFetch(`/api/content/${id}/diff?from=${from}&to=${to}`)
}

// ── Taxonomy Mapping ──────────────────────────────────────────────────────────

export function assignContentToTaxonomy(data: {
  object_table: string
  object_id: string
  taxonomy_node_id: number
  is_primary?: boolean
}): Promise<ContentTaxonomyMap> {
  return apiFetch('/api/taxonomy/map', { method: 'POST', body: JSON.stringify(data) })
}

export function removeContentFromTaxonomy(mapId: number): Promise<void> {
  return apiFetch(`/api/taxonomy/map/${mapId}`, { method: 'DELETE' })
}

export function getContentTaxonomyAssignments(
  objectTable: string,
  objectId: string
): Promise<ContentTaxonomyMap[]> {
  return apiFetch(`/api/taxonomy/map?object_table=${objectTable}&object_id=${objectId}`)
}

// ── Search & Audit ────────────────────────────────────────────────────────────

export interface SearchParams {
  q?: string
  type?: string
  status?: string
  language?: string
  taxonomy_node_id?: number
  limit?: number
  offset?: number
}

export function search(params: SearchParams = {}): Promise<ContentSearchResponse> {
  const q = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]))
  ).toString()
  return apiFetch(`/api/search${q ? `?${q}` : ''}`)
}

export interface AuditLogParams {
  target_type?: string
  target_id?: string
  actor_id?: string
  event_type?: string
  limit?: number
  offset?: number
}

export function getAuditLog(params: AuditLogParams = {}): Promise<AuditLogResponse> {
  const q = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]))
  ).toString()
  return apiFetch(`/api/audit-log${q ? `?${q}` : ''}`)
}

// ── Assets ────────────────────────────────────────────────────────────────────

export function getUploadUrl(data: AssetUploadUrlRequest): Promise<AssetUploadUrlResponse> {
  return apiFetch('/api/assets/upload-url', { method: 'POST', body: JSON.stringify(data) })
}

export function confirmAsset(data: AssetConfirmRequest): Promise<ContentObject> {
  return apiFetch('/api/assets/confirm', { method: 'POST', body: JSON.stringify(data) })
}

// ── Comments ──────────────────────────────────────────────────────────────────

export interface Comment {
  id: number
  object_type: string
  object_id: string
  parent_id: number | null
  author_id: string
  body: string
  anchor_text: string | null
  range_start_offset: number | null
  range_end_offset: number | null
  resolved: boolean
  created_at: string
  updated_at: string
}

export function getComments(objectType: string, objectId: string): Promise<Comment[]> {
  return apiFetch(`/api/comments?object_type=${objectType}&object_id=${objectId}`)
}

export function createComment(data: {
  object_type?: string
  object_id: string
  body: string
  parent_id?: number
  anchor_text?: string
  range_start_offset?: number
  range_end_offset?: number
}): Promise<Comment> {
  return apiFetch('/api/comments', { method: 'POST', body: JSON.stringify(data) })
}

export function updateComment(id: number, data: { body?: string; resolved?: boolean }): Promise<Comment> {
  return apiFetch(`/api/comments/${id}`, { method: 'PUT', body: JSON.stringify(data) })
}

export function deleteComment(id: number): Promise<void> {
  return apiFetch(`/api/comments/${id}`, { method: 'DELETE' })
}

// ── Phase 5: Workflow transitions ─────────────────────────────────────────────
export function transitionContent(id: string, body: WorkflowTransitionRequest): Promise<ContentObject> {
  return apiFetch(`/api/content/${id}/transition`, { method: 'POST', body: JSON.stringify(body) })
}

// ── Phase 5: Notifications ────────────────────────────────────────────────────
export function getNotifications(): Promise<Notification[]> {
  return apiFetch('/api/notifications')
}
export function getUnreadCount(): Promise<{ count: number }> {
  return apiFetch('/api/notifications/unread-count')
}
export function markNotificationRead(id: number): Promise<{ ok: boolean }> {
  return apiFetch(`/api/notifications/${id}/read`, { method: 'PUT' })
}
export function markAllNotificationsRead(): Promise<{ ok: boolean }> {
  return apiFetch('/api/notifications/read-all', { method: 'PUT' })
}

// ── Phase 5: Tasks ────────────────────────────────────────────────────────────
export function getContentTasks(objectId: string): Promise<ContentTask[]> {
  return apiFetch(`/api/content/${objectId}/tasks`)
}
export function createContentTask(objectId: string, data: CreateTaskRequest): Promise<ContentTask> {
  return apiFetch(`/api/content/${objectId}/tasks`, { method: 'POST', body: JSON.stringify(data) })
}
export function updateContentTask(id: number, data: UpdateTaskRequest): Promise<ContentTask> {
  return apiFetch(`/api/tasks/${id}`, { method: 'PUT', body: JSON.stringify(data) })
}
export function deleteContentTask(id: number): Promise<void> {
  return apiFetch(`/api/tasks/${id}`, { method: 'DELETE' })
}

// ── Phase 6: AI Generation ────────────────────────────────────────────────────

export interface GenerationLogParams {
  status?: string
  limit?:  number
  offset?: number
}

export function generateContent(data: GenerateRequest): Promise<GenerateResponse> {
  return apiFetch('/api/generate', { method: 'POST', body: JSON.stringify(data) })
}
export function listRecipes(): Promise<{ recipes: PromptRecipeSummary[] }> {
  return apiFetch('/api/generate/recipes')
}
export function getRecipeBySlug(slug: string): Promise<ContentObject> {
  return apiFetch(`/api/generate/recipes/${slug}`)
}
export function getGenerationLogs(params: GenerationLogParams = {}): Promise<GenerationLogResponse> {
  const q = new URLSearchParams(
    Object.fromEntries(
      Object.entries(params)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, String(v)])
    )
  ).toString()
  return apiFetch(`/api/generate/logs${q ? `?${q}` : ''}`)
}

// ── Phase 7: Authors ──────────────────────────────────────────────────────────
export function listAuthors(): Promise<{ authors: ContentObject[] }> {
  return apiFetch('/api/authors')
}
export function getAuthor(id: string): Promise<ContentObject> {
  return apiFetch(`/api/authors/${id}`)
}
export function createAuthor(data: CreateAuthorRequest): Promise<ContentObject> {
  return apiFetch('/api/authors', { method: 'POST', body: JSON.stringify(data) })
}
export function updateAuthor(id: string, data: UpdateAuthorRequest): Promise<ContentObject> {
  return apiFetch(`/api/authors/${id}`, { method: 'PUT', body: JSON.stringify(data) })
}
export function sendAuthorChatMessage(
  authorId: string, message: string, taxonomyNodeId?: number | null
): Promise<AuthorChatResponse> {
  return apiFetch('/api/author/chat', {
    method: 'POST',
    body: JSON.stringify({ author_id: authorId, taxonomy_node_id: taxonomyNodeId ?? null, message }),
  })
}
export function getAuthorChatHistory(
  authorId: string, taxonomyNodeId?: number | null
): Promise<{ messages: AuthorChatMessage[] }> {
  const q = new URLSearchParams({ author_id: authorId })
  if (taxonomyNodeId != null) q.set('taxonomy_node_id', String(taxonomyNodeId))
  return apiFetch(`/api/author/chat/history?${q}`)
}
export function clearAuthorChatHistory(
  authorId: string, taxonomyNodeId?: number | null
): Promise<{ ok: boolean }> {
  return apiFetch('/api/author/chat/history', {
    method: 'DELETE',
    body: JSON.stringify({ author_id: authorId, taxonomy_node_id: taxonomyNodeId ?? null }),
  })
}
export function getAuthorUsageReport(): Promise<{ report: AuthorUsageEntry[] }> {
  return apiFetch('/api/authors/usage')
}

// ── Phase 8: Sites ────────────────────────────────────────────────────────────
export function listSites(): Promise<{ sites: ContentObject[] }> {
  return apiFetch('/api/sites')
}
export function getSite(id: string): Promise<ContentObject> {
  return apiFetch(`/api/sites/${id}`)
}
export function createSite(data: CreateSiteRequest): Promise<ContentObject> {
  return apiFetch('/api/sites', { method: 'POST', body: JSON.stringify(data) })
}
export function updateSite(id: string, data: UpdateSiteRequest): Promise<ContentObject> {
  return apiFetch(`/api/sites/${id}`, { method: 'PUT', body: JSON.stringify(data) })
}
export function updatePublishTargets(
  id: string, targets: SitePublishTarget[]
): Promise<ContentObject> {
  return apiFetch(`/api/content/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ publish_targets: targets }),
  })
}
export function sitePublish(
  id: string
): Promise<{ ok: boolean; publish_targets: SitePublishTarget[] }> {
  return apiFetch(`/api/content/${id}/site-publish`, { method: 'POST' })
}
export function getSitePublishingReport(): Promise<{ report: SitePublishingReportEntry[] }> {
  return apiFetch('/api/sites/publishing-report')
}

// ── Phase 9: API key management ───────────────────────────────────────────────
export function listApiKeys(): Promise<{ keys: ApiKey[] }> {
  return apiFetch('/api/api-keys')
}
export function createApiKey(data: {
  name: string; scopes?: string[]; rate_limit_rph?: number; expires_at?: string
}): Promise<ApiKey> {
  return apiFetch('/api/api-keys', { method: 'POST', body: JSON.stringify(data) })
}
export function deleteApiKey(id: number): Promise<{ ok: boolean }> {
  return apiFetch(`/api/api-keys/${id}`, { method: 'DELETE' })
}

// ── Phase 9: Webhook management ───────────────────────────────────────────────
export function listWebhooks(): Promise<{ webhooks: WebhookRecord[] }> {
  return apiFetch('/api/webhooks')
}
export function createWebhook(data: {
  name: string; url: string; events?: string[]; active?: boolean
}): Promise<WebhookRecord> {
  return apiFetch('/api/webhooks', { method: 'POST', body: JSON.stringify(data) })
}
export function updateWebhook(id: number, data: Partial<WebhookRecord>): Promise<WebhookRecord> {
  return apiFetch(`/api/webhooks/${id}`, { method: 'PUT', body: JSON.stringify(data) })
}
export function deleteWebhook(id: number): Promise<{ ok: boolean }> {
  return apiFetch(`/api/webhooks/${id}`, { method: 'DELETE' })
}
export function listWebhookDeliveries(id: number): Promise<{ deliveries: WebhookDelivery[] }> {
  return apiFetch(`/api/webhooks/${id}/deliveries`)
}

// ── Prompt Navigation Tree ────────────────────────────────────────────────────

export interface PromptNavNode {
  id: string
  parent_id: string | null
  slug: string
  title: string
  description: string | null
  icon: string | null
  depth: number
  sort_order: number
  materialized_path: string
  config: Record<string, unknown>
  is_active: boolean
  created_at: string
  updated_at: string
  children?: PromptNavNode[]
}

export interface PromptTreeResponse { nodes: PromptNavNode[] }

export function getPromptTree(): Promise<PromptTreeResponse> {
  return apiFetch('/api/v1/prompt-tree')
}
export function getPromptTreeNode(id: string): Promise<{ node: PromptNavNode }> {
  return apiFetch(`/api/v1/prompt-tree/${id}`)
}
export function createPromptTreeNode(data: {
  parent_id?: string | null; slug: string; title: string
  description?: string; icon?: string; sort_order?: number; config?: object
}): Promise<{ node: PromptNavNode }> {
  return apiFetch('/api/v1/prompt-tree', { method: 'POST', body: JSON.stringify(data) })
}
export function updatePromptTreeNode(id: string, data: {
  title?: string; description?: string; icon?: string; sort_order?: number; config?: object
}): Promise<{ node: PromptNavNode }> {
  return apiFetch(`/api/v1/prompt-tree/${id}`, { method: 'PUT', body: JSON.stringify(data) })
}
export function movePromptTreeNode(id: string, parent_id: string | null): Promise<{ node: PromptNavNode }> {
  return apiFetch(`/api/v1/prompt-tree/${id}/move`, { method: 'PATCH', body: JSON.stringify({ parent_id }) })
}
export function deletePromptTreeNode(id: string): Promise<{ success: boolean; id: string }> {
  return apiFetch(`/api/v1/prompt-tree/${id}`, { method: 'DELETE' })
}

// ── Prompt Recipe Assignments ─────────────────────────────────────────────────

export interface PromptAssignment {
  id:                 string
  prompt_nav_node_id: string
  is_primary:         boolean
  assigned_at:        string
  node_title:         string
  materialized_path:  string
}

export function getPromptRecipeAssignments(promptId: string): Promise<{ assignments: PromptAssignment[] }> {
  return apiFetch(`/api/v1/prompt-tree/assignments?prompt_id=${encodeURIComponent(promptId)}`)
}
export function assignPromptToNode(data: {
  prompt_id: string; node_id: string; is_primary?: boolean
}): Promise<{ assignment: PromptAssignment }> {
  return apiFetch('/api/v1/prompt-tree/assignments', { method: 'POST', body: JSON.stringify(data) })
}
export function removePromptAssignment(id: string): Promise<{ success: boolean; id: string }> {
  return apiFetch(`/api/v1/prompt-tree/assignments/${id}`, { method: 'DELETE' })
}
export function setAssignmentPrimary(id: string): Promise<{ assignment: PromptAssignment }> {
  return apiFetch(`/api/v1/prompt-tree/assignments/${id}/primary`, { method: 'PATCH' })
}
export function testGeneratePrompt(data: {
  system_prompt: string
  user_template: string
  variables?: Record<string, string>
  model?: string
  max_tokens?: number
}): Promise<{
  output: string; model: string; input_tokens: number; output_tokens: number; duration_ms: number
}> {
  return apiFetch('/api/v1/prompt-recipes/test', { method: 'POST', body: JSON.stringify(data) })
}

// ── Automation Tree (Part 2 Section 6) ───────────────────────────────────────

export interface AutomationNavNode {
  id:                    string
  parent_id:             string | null
  slug:                  string
  title:                 string
  description:           string | null
  icon:                  string | null
  depth:                 number
  sort_order:            number
  materialized_path:     string
  linked_prompt_node_id: string | null
  config:                Record<string, unknown>
  is_active:             boolean
  created_at:            string
  updated_at:            string
  children?:             AutomationNavNode[]
}

export interface AutomationTreeResponse { nodes: AutomationNavNode[] }

export function getAutomationTree(): Promise<AutomationTreeResponse> {
  return apiFetch('/api/v1/automation-tree')
}
export function getAutomationTreeNode(id: string): Promise<{ node: AutomationNavNode }> {
  return apiFetch(`/api/v1/automation-tree/${id}`)
}
export function createAutomationTreeNode(data: {
  parent_id?: string; slug: string; title: string; description?: string
  icon?: string; sort_order?: number; config?: Record<string, unknown>
  linked_prompt_node_id?: string
}): Promise<{ node: AutomationNavNode }> {
  return apiFetch('/api/v1/automation-tree', { method: 'POST', body: JSON.stringify(data) })
}
export function updateAutomationTreeNode(id: string, data: {
  title?: string; description?: string; icon?: string; sort_order?: number
  config?: Record<string, unknown>; linked_prompt_node_id?: string | null
}): Promise<{ node: AutomationNavNode }> {
  return apiFetch(`/api/v1/automation-tree/${id}`, { method: 'PUT', body: JSON.stringify(data) })
}
export function moveAutomationTreeNode(id: string, parent_id: string | null): Promise<{ node: AutomationNavNode }> {
  return apiFetch(`/api/v1/automation-tree/${id}/move`, { method: 'PATCH', body: JSON.stringify({ parent_id }) })
}
export function deleteAutomationTreeNode(id: string): Promise<{ success: boolean; id: string }> {
  return apiFetch(`/api/v1/automation-tree/${id}`, { method: 'DELETE' })
}

// ── Automation Jobs (Part 2 Section 7) ───────────────────────────────────────

export interface AutomationJob {
  id:                       string
  name:                     string
  automation_node_id:       string | null
  automation_node_title:    string | null
  target_taxonomy_node_id:  number | null
  target_content_type:      string
  prompt_recipe_id:         string | null
  prompt_name:              string | null
  quantity:                 number
  priority:                 number
  requested_by:             string
  identity_type:            'system' | 'user'
  identity_id:              string | null
  status:                   'queued' | 'running' | 'paused' | 'retrying' | 'completed' | 'failed' | 'cancelled'
  retry_count:              number
  max_retries:              number
  parameters:               Record<string, unknown>
  output_object_ids:        string[]
  execution_log:            string | null
  execution_log_entries:    Array<{ ts: string; level: string; message: string }> | null
  input_tokens:             number | null
  output_tokens:            number | null
  duration_ms:              number | null
  token_usage:              { input_tokens: number; output_tokens: number; total_tokens: number } | null
  error_message:            string | null
  error_details:            Record<string, unknown> | null
  next_attempt_at:          string | null
  started_at:               string | null
  completed_at:             string | null
  created_at:               string
  updated_at:               string
}

export interface AutomationJobsResponse {
  jobs: AutomationJob[]
  total: number
  limit: number
  offset: number
}

export function listAutomationJobs(params: {
  node_id?: string
  status_group?: 'pending' | 'completed'
  limit?: number
  offset?: number
}): Promise<AutomationJobsResponse> {
  const q = new URLSearchParams(
    Object.fromEntries(
      Object.entries(params)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, String(v)])
    )
  ).toString()
  return apiFetch(`/api/v1/automation-jobs${q ? `?${q}` : ''}`)
}
export function getAutomationJob(id: string): Promise<{ job: AutomationJob }> {
  return apiFetch(`/api/v1/automation-jobs/${id}`)
}
export function createAutomationJob(data: Partial<AutomationJob> & { name: string }): Promise<{ job: AutomationJob }> {
  return apiFetch('/api/v1/automation-jobs', { method: 'POST', body: JSON.stringify(data) })
}
export function updateAutomationJob(id: string, data: Partial<AutomationJob>): Promise<{ job: AutomationJob }> {
  return apiFetch(`/api/v1/automation-jobs/${id}`, { method: 'PUT', body: JSON.stringify(data) })
}
export function runAutomationJob(id: string): Promise<{ job: AutomationJob }> {
  return apiFetch(`/api/v1/automation-jobs/${id}/run`, { method: 'POST' })
}
export function pauseAutomationJob(id: string): Promise<{ job: AutomationJob }> {
  return apiFetch(`/api/v1/automation-jobs/${id}/pause`, { method: 'POST' })
}
export function cancelAutomationJob(id: string): Promise<{ job: AutomationJob }> {
  return apiFetch(`/api/v1/automation-jobs/${id}/cancel`, { method: 'POST' })
}
export function retryAutomationJob(id: string): Promise<{ job: AutomationJob }> {
  return apiFetch(`/api/v1/automation-jobs/${id}/retry`, { method: 'POST' })
}

// ── Automation Job Templates (Part 2 Section 9) ───────────────────────────────

export interface AutomationJobTemplate {
  id:                      string
  template_name:           string
  automation_nav_node_id:  string | null
  node_title:              string | null    // join from server
  target_content_type:     string
  prompt_id:               string | null
  prompt_name:             string | null    // join from server
  default_parameters:      Record<string, unknown>
  default_quantity:        number
  default_priority:        number
  description:             string | null
  is_active:               boolean
  created_by:              string
  updated_by:              string
  created_at:              string
  updated_at:              string
}

export interface AutomationJobTemplatesResponse {
  templates: AutomationJobTemplate[]
  total:     number
  limit:     number
  offset:    number
}

export function listAutomationJobTemplates(params: {
  node_id?: string
  active_only?: boolean
  limit?: number
  offset?: number
} = {}): Promise<AutomationJobTemplatesResponse> {
  const q = new URLSearchParams(
    Object.fromEntries(
      Object.entries(params)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, String(v)])
    )
  ).toString()
  return apiFetch(`/api/v1/automation-job-templates${q ? `?${q}` : ''}`)
}
export function getAutomationJobTemplate(id: string): Promise<{ template: AutomationJobTemplate }> {
  return apiFetch(`/api/v1/automation-job-templates/${id}`)
}
export function createAutomationJobTemplate(
  data: Partial<AutomationJobTemplate> & { template_name: string }
): Promise<{ template: AutomationJobTemplate }> {
  return apiFetch('/api/v1/automation-job-templates', { method: 'POST', body: JSON.stringify(data) })
}
export function updateAutomationJobTemplate(
  id: string,
  data: Partial<AutomationJobTemplate>
): Promise<{ template: AutomationJobTemplate }> {
  return apiFetch(`/api/v1/automation-job-templates/${id}`, { method: 'PUT', body: JSON.stringify(data) })
}
export function deleteAutomationJobTemplate(id: string): Promise<{ deleted: boolean }> {
  return apiFetch(`/api/v1/automation-job-templates/${id}`, { method: 'DELETE' })
}
export function applyAutomationJobTemplate(
  id: string,
  data: { taxonomy_node_ids?: number[]; overrides?: Partial<AutomationJob>; job_name?: string }
): Promise<{ jobs: AutomationJob[]; count: number }> {
  return apiFetch(`/api/v1/automation-job-templates/${id}/apply`, { method: 'POST', body: JSON.stringify(data) })
}

// ── Automation Dashboard (Part 2 Section 10) ─────────────────────────────────

export type DashboardTimeWindow = '24h' | '7d' | '30d'

export interface AutomationDashboardSummary {
  pending:          number
  running:          number
  failed_period:    number
  completed_period: number
  time_window:      DashboardTimeWindow
}

export interface AutomationActivityEntry {
  id:                  number
  event_type:          string
  actor_id:            string | null
  target_id:           string | null
  details:             Record<string, unknown>
  created_at:          string
  job_name:            string | null
  target_content_type: string | null
  identity_type:       string | null
  identity_id:         string | null
}

export interface AutomationDashboardData {
  summary:        AutomationDashboardSummary
  activity:       AutomationActivityEntry[]
  total:          number
  filter_options: {
    users:         string[]
    content_types: string[]
  }
}

export function getAutomationDashboard(params: {
  time_window?:     DashboardTimeWindow
  user_filter?:     string
  content_type?:    string
  taxonomy_node_id?: number
  identity_filter?: string
  activity_offset?: number
} = {}): Promise<AutomationDashboardData> {
  const q = new URLSearchParams(
    Object.fromEntries(
      Object.entries(params)
        .filter(([, v]) => v !== undefined && v !== '')
        .map(([k, v]) => [k, String(v)])
    )
  ).toString()
  return apiFetch(`/api/v1/automation-dashboard${q ? `?${q}` : ''}`)
}

// ── OAuth / API-key Execution Identity (Section 11) ──────────────────────────

export type OAuthProvider = 'anthropic' | 'openai'

export interface OAuthToken {
  id:                  string
  user_email:          string
  provider:            OAuthProvider | string
  token_type:          'api_key' | 'oauth'
  expires_at:          string | null
  scopes:              string[]
  is_active:           boolean
  last_used_at:        string | null
  created_at:          string
  updated_at:          string
  /** true when the server masked the token; access_token is never returned */
  access_token_masked: true
}

export interface OAuthProviderInfo {
  id:             string
  name:           string
  token_type:     'api_key' | 'oauth'
  supports_oauth: boolean
}

export interface OAuthProvidersResponse {
  providers: OAuthProviderInfo[]
}

export interface OAuthTokensResponse {
  tokens: OAuthToken[]
}

export function listOAuthTokens(): Promise<OAuthTokensResponse> {
  return apiFetch('/api/v1/oauth-tokens')
}

export function getOAuthProviders(): Promise<OAuthProvidersResponse> {
  return apiFetch('/api/v1/oauth-tokens/providers')
}

export function validateApiKey(
  provider: string,
  api_key: string
): Promise<{ token: OAuthToken; masked: string }> {
  return apiFetch('/api/v1/oauth-tokens/validate-api-key', {
    method: 'POST',
    body:   JSON.stringify({ provider, api_key }),
  })
}

export function revokeOAuthToken(id: string): Promise<{ success: boolean }> {
  return apiFetch(`/api/v1/oauth-tokens/${id}`, { method: 'DELETE' })
}

export function refreshOAuthToken(id: string): Promise<{ message?: string; token_id?: string }> {
  return apiFetch(`/api/v1/oauth-tokens/${id}/refresh`)
}

export function getOAuthAuthorizeUrl(provider: string): Promise<{
  auth_url: string
  state: string
  code_verifier: string
}> {
  return apiFetch(`/api/v1/oauth/authorize/${provider}`)
}

// ── Part 3 Section 5: Author Bios ─────────────────────────────────────────────

export function getAuthorBioChannels(): Promise<{ channels: { slug: string; label: string }[] }> {
  return apiFetch('/api/author-bio-channels')
}
export function listAuthorBios(authorId: string): Promise<{ bios: AuthorBio[] }> {
  return apiFetch(`/api/authors/${authorId}/bios`)
}
export function createAuthorBio(authorId: string, data: CreateAuthorBioRequest): Promise<{ bio: AuthorBio }> {
  return apiFetch(`/api/authors/${authorId}/bios`, { method: 'POST', body: JSON.stringify(data) })
}
export function updateAuthorBio(authorId: string, bioId: string, data: UpdateAuthorBioRequest): Promise<{ bio: AuthorBio }> {
  return apiFetch(`/api/authors/${authorId}/bios/${bioId}`, { method: 'PUT', body: JSON.stringify(data) })
}
export function deleteAuthorBio(authorId: string, bioId: string): Promise<void> {
  return apiFetch(`/api/authors/${authorId}/bios/${bioId}`, { method: 'DELETE' })
}
export function listAuthorBioRevisions(authorId: string, bioId: string): Promise<{ revisions: unknown[] }> {
  return apiFetch(`/api/authors/${authorId}/bios/${bioId}/revisions`)
}
export function getAuthorBioRevision(authorId: string, bioId: string, version: number): Promise<unknown> {
  return apiFetch(`/api/authors/${authorId}/bios/${bioId}/revisions/${version}`)
}

// ── Part 3 Section 6: Content Author Map ──────────────────────────────────────

export function listContentAuthors(contentId: string): Promise<{ authors: ContentAuthorAttribution[] }> {
  return apiFetch(`/api/content/${contentId}/authors`)
}
export function addContentAuthor(
  contentId: string,
  data: { author_id: string; role: ContentAuthorRole; display_order?: number }
): Promise<{ attribution: ContentAuthorAttribution }> {
  return apiFetch(`/api/content/${contentId}/authors`, { method: 'POST', body: JSON.stringify(data) })
}
export function updateContentAuthor(
  contentId: string,
  authorId: string,
  data: { role?: ContentAuthorRole; display_order?: number }
): Promise<{ attribution: ContentAuthorAttribution }> {
  return apiFetch(`/api/content/${contentId}/authors/${authorId}`, { method: 'PUT', body: JSON.stringify(data) })
}
export function removeContentAuthor(contentId: string, authorId: string): Promise<void> {
  return apiFetch(`/api/content/${contentId}/authors/${authorId}`, { method: 'DELETE' })
}
export function bulkReassignAuthors(
  contentIds: string[],
  authorId: string,
  role: ContentAuthorRole = 'primary_author'
): Promise<{ updated: number }> {
  return apiFetch('/api/content/bulk-author', {
    method: 'POST',
    body: JSON.stringify({ content_ids: contentIds, author_id: authorId, role }),
  })
}

// ── User Accounts Admin API (Sections 7-9) ───────────────────────────────────

export function listCmsUsers(params?: { limit?: number; offset?: number }): Promise<CmsUserListResponse> {
  const q = params ? '?' + new URLSearchParams(params as Record<string, string>).toString() : ''
  return apiFetch(`/api/admin/users${q}`)
}

export function getCmsUser(id: number): Promise<{ user: CmsUser }> {
  return apiFetch(`/api/admin/users/${id}`)
}

export function updateCmsUser(id: number, data: { name?: string; role?: string }): Promise<{ user: CmsUser }> {
  return apiFetch(`/api/admin/users/${id}`, { method: 'PUT', body: JSON.stringify(data) })
}

export function enableCmsUser(id: number): Promise<{ success: boolean }> {
  return apiFetch(`/api/admin/users/${id}/enable`, { method: 'POST' })
}

export function disableCmsUser(id: number): Promise<{ success: boolean }> {
  return apiFetch(`/api/admin/users/${id}/disable`, { method: 'POST' })
}

export function lockCmsUser(id: number): Promise<{ success: boolean }> {
  return apiFetch(`/api/admin/users/${id}/lock`, { method: 'POST' })
}

export function unlockCmsUser(id: number): Promise<{ success: boolean }> {
  return apiFetch(`/api/admin/users/${id}/unlock`, { method: 'POST' })
}

export function forcePasswordReset(id: number): Promise<{ success: boolean }> {
  return apiFetch(`/api/admin/users/${id}/force-password-reset`, { method: 'POST' })
}

export function resetUserMfa(id: number): Promise<{ success: boolean }> {
  return apiFetch(`/api/admin/users/${id}/reset-mfa`, { method: 'POST' })
}

export function revokeAllUserSessions(id: number): Promise<{ success: boolean }> {
  return apiFetch(`/api/admin/users/${id}/revoke-sessions`, { method: 'POST' })
}

export function listUserSessions(
  id: number,
  params?: { limit?: number; offset?: number }
): Promise<UserSessionsResponse> {
  const q = params ? '?' + new URLSearchParams(params as Record<string, string>).toString() : ''
  return apiFetch(`/api/admin/users/${id}/sessions${q}`)
}

export function revokeUserSession(userId: number, sessionId: number): Promise<void> {
  return apiFetch(`/api/admin/users/${userId}/sessions/${sessionId}`, { method: 'DELETE' })
}

export function getUserActivity(
  id: number,
  filters?: Record<string, string | number>
): Promise<AuditLogResponse> {
  const q = filters ? '?' + new URLSearchParams(filters as Record<string, string>).toString() : ''
  return apiFetch(`/api/admin/users/${id}/activity${q}`)
}

export function getUserActivitySummary(id: number, time_range?: string): Promise<UserActivitySummary> {
  const q = time_range ? `?time_range=${time_range}` : ''
  return apiFetch(`/api/admin/users/${id}/activity/summary${q}`)
}

export function getUserAccountAudit(id: number): Promise<AuditLogResponse> {
  return apiFetch(`/api/admin/users/${id}/account-audit`)
}

// ── User Permission Grants (Sections 10-11 G5) ────────────────────────────────

export interface UserPermissionGrant {
  id: number
  taxonomy_node_id: number | null
  permission: string
  granted_by: string | null
  granted_at: string
}

export function getUserPermissions(userId: number): Promise<UserPermissionGrant[]> {
  return apiFetch(`/api/admin/users/${userId}/permissions`)
}

export function addUserPermission(
  userId: number,
  data: { taxonomy_node_id?: number; permission: string }
): Promise<UserPermissionGrant> {
  return apiFetch(`/api/admin/users/${userId}/permissions`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export function removeUserPermission(userId: number, grantId: number): Promise<void> {
  return apiFetch(`/api/admin/users/${userId}/permissions/${grantId}`, { method: 'DELETE' })
}

// ── Part 3 Section 12: Directory & Entitlement Management ─────────────────────

export function searchDirectory(q: string): Promise<{ users: DirectoryUser[] }> {
  return apiFetch(`/api/admin/directory/search?q=${encodeURIComponent(q)}`)
}

export function grantCmsAccess(data: GrantCmsAccessRequest): Promise<{ success: boolean; user: CmsUser }> {
  return apiFetch('/api/admin/directory/grant-access', { method: 'POST', body: JSON.stringify(data) })
}

export function revokeEntitlement(userId: number): Promise<{ success: boolean }> {
  return apiFetch(`/api/admin/users/${userId}/revoke-entitlement`, { method: 'DELETE' })
}

export function getUserCmsRoles(userId: number): Promise<{ cms_roles: CmsUserRole[] }> {
  return apiFetch(`/api/admin/users/${userId}/cms-roles`)
}

export function updateCmsRoles(userId: number, cms_roles: CmsUserRole[]): Promise<{ success: boolean }> {
  return apiFetch(`/api/admin/users/${userId}/cms-roles`, { method: 'PUT', body: JSON.stringify({ cms_roles }) })
}

// ── Part 4 Section 4: Portal Generation ───────────────────────────────────────

export function generatePortal(params: {
  site_id: number
  portal_type?: string
  taxonomy_node_id?: number | null
  portal_date: string
}): Promise<{ success: boolean; portal_type: string; content_ids: string[]; item_count: number; status: string }> {
  return apiFetch('/api/v1/portal/generate', {
    method: 'POST',
    body: JSON.stringify(params),
  })
}

export function generateSitePortal(site_id: number, portal_date?: string): Promise<{
  success: boolean; site_id: number; domain: string; portal_date: string
  generated: number; errors: number; pages: Array<{ portal_type: string; taxonomy_node_id: number | null; item_count: number }>
}> {
  return apiFetch('/api/v1/portal/generate-site', {
    method: 'POST',
    body: JSON.stringify({ site_id, portal_date }),
  })
}

// ── Part 4 S7–8: Portal Workspace API ─────────────────────────────────────────

export function fetchPortalSites(): Promise<import('../types/content-objects').PortalSite[]> {
  return apiFetch('/api/v1/portal/sites')
}

export function fetchPortalTree(siteId: number): Promise<Record<string, Record<string, Record<string, import('../types/content-objects').PortalGridRow[]>>>> {
  return apiFetch(`/api/v1/portal/tree?site_id=${siteId}`)
}

export function fetchPortalPages(siteId: number, portalDate?: string, portalType?: string): Promise<import('../types/content-objects').PortalGridRow[]> {
  const params = new URLSearchParams({ site_id: String(siteId) })
  if (portalDate) params.set('portal_date', portalDate)
  if (portalType) params.set('portal_type', portalType)
  return apiFetch(`/api/v1/portal/pages?${params}`)
}

export function fetchPortalDetail(portalId: string): Promise<import('../types/content-objects').PortalDetail> {
  return apiFetch(`/api/v1/portal/pages/${portalId}`)
}

export function updatePortalItems(portalId: string, contentIds: string[]): Promise<{ ok: boolean; item_count: number }> {
  return apiFetch(`/api/v1/portal/pages/${portalId}/items`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content_ids: contentIds }),
  })
}

// ── Part 4 S9–11: Websites Module ─────────────────────────────────────────────

// Taxonomy assignments
export function listTaxonomyAssignments(siteId: string): Promise<WebsiteTaxonomyAssignment[]> {
  return apiFetch(`/api/v1/websites/${siteId}/taxonomy`)
}
export function assignTaxonomy(siteId: string, data: { taxonomy_node_id: number; nav_position?: string; custom_label?: string; is_featured?: boolean }): Promise<WebsiteTaxonomyAssignment> {
  return apiFetch(`/api/v1/websites/${siteId}/taxonomy`, { method: 'POST', body: JSON.stringify(data) })
}
export function updateTaxonomyAssignment(siteId: string, assignmentId: string, data: Partial<WebsiteTaxonomyAssignment>): Promise<WebsiteTaxonomyAssignment> {
  return apiFetch(`/api/v1/websites/${siteId}/taxonomy/${assignmentId}`, { method: 'PATCH', body: JSON.stringify(data) })
}
export function removeTaxonomyAssignment(siteId: string, assignmentId: string): Promise<void> {
  return apiFetch(`/api/v1/websites/${siteId}/taxonomy/${assignmentId}`, { method: 'DELETE' })
}
export function reorderTaxonomyAssignment(siteId: string, id: string, direction: 'up' | 'down'): Promise<void> {
  return apiFetch(`/api/v1/websites/${siteId}/taxonomy/reorder`, { method: 'POST', body: JSON.stringify({ id, direction }) })
}

// Web pages
export function listWebsitePages(siteId: string): Promise<WebsitePage[]> {
  return apiFetch(`/api/v1/websites/${siteId}/pages`)
}
export function createWebsitePage(siteId: string, data: Partial<WebsitePage>): Promise<WebsitePage> {
  return apiFetch(`/api/v1/websites/${siteId}/pages`, { method: 'POST', body: JSON.stringify(data) })
}
export function getWebsitePage(siteId: string, pageId: string): Promise<WebsitePage> {
  return apiFetch(`/api/v1/websites/${siteId}/pages/${pageId}`)
}
export function updateWebsitePage(siteId: string, pageId: string, data: Partial<WebsitePage>): Promise<WebsitePage> {
  return apiFetch(`/api/v1/websites/${siteId}/pages/${pageId}`, { method: 'PUT', body: JSON.stringify(data) })
}
export function deleteWebsitePage(siteId: string, pageId: string): Promise<void> {
  return apiFetch(`/api/v1/websites/${siteId}/pages/${pageId}`, { method: 'DELETE' })
}

// Packages
export function listWebsitePackages(siteId: string): Promise<WebsitePackage[]> {
  return apiFetch(`/api/v1/websites/${siteId}/packages`)
}
export function generateWebsitePackage(siteId: string, data: { version_number: string; release_notes?: string }): Promise<WebsitePackage> {
  return apiFetch(`/api/v1/websites/${siteId}/packages`, { method: 'POST', body: JSON.stringify(data) })
}

// ── Part 4 S12–14 ─────────────────────────────────────────────────────────────
export function getPortalRules(siteId: string, taxonomyNodeId?: number): Promise<PortalRules> {
  const qs = new URLSearchParams({ site_id: siteId, ...(taxonomyNodeId ? { taxonomy_node_id: String(taxonomyNodeId) } : {}) })
  return apiFetch(`/api/v1/admin/portal/rules?${qs}`)
}
export function updatePortalRules(siteId: string, rules: Partial<PortalRules>, taxonomyNodeId?: number): Promise<PortalRules> {
  const qs = new URLSearchParams({ site_id: siteId, ...(taxonomyNodeId ? { taxonomy_node_id: String(taxonomyNodeId) } : {}) })
  return apiFetch(`/api/v1/admin/portal/rules?${qs}`, { method: 'PUT', body: JSON.stringify(rules) })
}
export function getContentRevisions(contentId: string): Promise<ContentRevisionSummary[]> {
  return apiFetch(`/api/content/${contentId}/revisions`)
}

// ── Part 5: Satellite Management ──────────────────────────────────────────────
export function getSatelliteUpdates(siteId: string, since?: string): Promise<SatelliteUpdate[]> {
  const qs = since ? `?since=${encodeURIComponent(since)}` : ''
  return apiFetch(`/api/v1/sites/${siteId}/updates${qs}`)
}
export function generateSatelliteUpdate(siteId: string, data: { version_number: string; release_notes?: string; update_type?: string }): Promise<SatelliteUpdate> {
  return apiFetch('/api/v1/admin/satellite/updates', { method: 'POST', body: JSON.stringify({ site_id: siteId, ...data }) })
}
export function getSatelliteSyncStatus(siteId: string): Promise<SatelliteSyncStatus> {
  return apiFetch(`/api/v1/admin/satellite/sync-status/${siteId}`)
}

// ── Part 5: Image Module ──────────────────────────────────────────────────────
export function getImageCounts(): Promise<Record<string, number>> {
  return apiFetch('/api/v1/images/counts')
}
export function getImageQueue(status: string, myItems?: boolean): Promise<ImageGenerationJob[]> {
  const qs = myItems ? '?my_items=true' : ''
  return apiFetch(`/api/v1/images/queue/${status}${qs}`)
}
export function generateImages(contentObjectIds: string[], options?: { aspect_ratio?: string; site_id?: string }): Promise<{ created: number; jobs: ImageGenerationJob[] }> {
  return apiFetch('/api/v1/images/generate', { method: 'POST', body: JSON.stringify({ content_object_ids: contentObjectIds, ...options }) })
}
export function checkoutImages(): Promise<{ assigned: number; job_ids: string[]; jobs: ImageGenerationJob[] }> {
  return apiFetch('/api/v1/images/checkout', { method: 'POST', body: JSON.stringify({}) })
}
export function approveImage(jobId: string): Promise<ImageGenerationJob> {
  return apiFetch(`/api/v1/images/${jobId}/approve`, { method: 'POST', body: JSON.stringify({}) })
}
export function approveAllImages(): Promise<{ approved: number; errors: Array<{ id: string; error: string }> }> {
  return apiFetch('/api/v1/images/approve-all', { method: 'POST', body: JSON.stringify({}) })
}
export function rejectImage(jobId: string, reason: string): Promise<ImageGenerationJob> {
  return apiFetch(`/api/v1/images/${jobId}/reject`, { method: 'POST', body: JSON.stringify({ reason }) })
}
export function requeueImage(jobId: string): Promise<ImageGenerationJob> {
  return apiFetch(`/api/v1/images/${jobId}/requeue`, { method: 'POST', body: JSON.stringify({}) })
}
export function editImagePrompt(jobId: string, data: { prompt_context?: string; style_constraints?: Record<string, unknown>; aspect_ratio?: string }): Promise<ImageGenerationJob> {
  return apiFetch(`/api/v1/images/${jobId}/prompt`, { method: 'PATCH', body: JSON.stringify(data) })
}
export function archiveImage(jobId: string): Promise<ImageGenerationJob> {
  return apiFetch(`/api/v1/images/${jobId}/archive`, { method: 'POST', body: JSON.stringify({}) })
}

export function regenerateImage(jobId: string): Promise<ImageGenerationJob> {
  return apiFetch(`/api/v1/images/${jobId}/regenerate`, { method: 'POST', body: JSON.stringify({}) })
}

// ── Part 6: Servers Module ─────────────────────────────────────────────────────
export function listServerNodes(): Promise<{ nodes: ServerNode[] }> {
  return apiFetch('/api/v1/admin/servers')
}
export function registerServerNode(data: Partial<ServerNode>): Promise<ServerNode> {
  return apiFetch('/api/v1/admin/servers', { method: 'POST', body: JSON.stringify(data) })
}
export function getServerNode(nodeId: string): Promise<{ node: ServerNode; sync_history: unknown[] }> {
  return apiFetch(`/api/v1/admin/servers/${nodeId}`)
}
export function updateServerNode(nodeId: string, data: Partial<ServerNode>): Promise<ServerNode> {
  return apiFetch(`/api/v1/admin/servers/${nodeId}`, { method: 'PUT', body: JSON.stringify(data) })
}
export function disableServerNode(nodeId: string): Promise<{ success: boolean }> {
  return apiFetch(`/api/v1/admin/servers/${nodeId}`, { method: 'DELETE' })
}
export function triggerNodeSync(nodeId: string): Promise<{ success: boolean; message: string }> {
  return apiFetch(`/api/v1/admin/servers/${nodeId}/sync`, { method: 'POST', body: JSON.stringify({}) })
}

// ── Part 6: Cache ──────────────────────────────────────────────────────────────
export function refreshCache(data: { object_id: string; object_type?: string; site_id?: string }): Promise<{ status: string; changes_detected: boolean; duration_ms: number }> {
  return apiFetch('/api/v1/cache/refresh', { method: 'POST', body: JSON.stringify(data) })
}

// ── Part 6: Audit Module ───────────────────────────────────────────────────────
export function getAuditQueue(params?: { status?: string; audit_type?: string; limit?: number; offset?: number }): Promise<{ items: AuditReport[]; total: number }> {
  const qs = params ? '?' + new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]))).toString() : ''
  return apiFetch(`/api/v1/audit/queue${qs}`)
}
export function getAuditResults(objectId: string): Promise<{ reports: AuditReport[] }> {
  return apiFetch(`/api/v1/audit/results/${objectId}`)
}
export function rerunAudit(objectId: string): Promise<{ success: boolean; message: string }> {
  return apiFetch(`/api/v1/audit/rerun/${objectId}`, { method: 'POST', body: JSON.stringify({}) })
}
export function rewriteForAudit(objectId: string): Promise<{ success: boolean; object_id: string }> {
  return apiFetch(`/api/v1/audit/rewrite/${objectId}`, { method: 'POST', body: JSON.stringify({}) })
}
export function listAuditRubrics(): Promise<{ rubrics: AuditRubric[] }> {
  return apiFetch('/api/v1/audit/rubrics')
}
export function createAuditRubric(data: Partial<AuditRubric>): Promise<AuditRubric> {
  return apiFetch('/api/v1/audit/rubrics', { method: 'POST', body: JSON.stringify(data) })
}
export function updateAuditRubric(rubricId: string, data: Partial<AuditRubric>): Promise<AuditRubric> {
  return apiFetch(`/api/v1/audit/rubrics/${rubricId}`, { method: 'PUT', body: JSON.stringify(data) })
}
export function getSelfTestResults(): Promise<{ latest: unknown; results: SelfTestResult[]; summary: { total: number; passed: number; failed: number } | null }> {
  return apiFetch('/api/v1/audit/self-test')
}
export function runSelfTests(): Promise<{ run_id: string; message: string }> {
  return apiFetch('/api/v1/audit/self-test/run', { method: 'POST', body: JSON.stringify({}) })
}

// ── Part 6: Publishing Workflow ────────────────────────────────────────────────
export function getPendingReview(params?: { object_type?: string; limit?: number; offset?: number }): Promise<{ items: AuditReport[]; total: number }> {
  const qs = params ? '?' + new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]))).toString() : ''
  return apiFetch(`/api/v1/content/pending-review${qs}`)
}
export function approveContent(objectId: string): Promise<{ success: boolean }> {
  return apiFetch(`/api/v1/content/${objectId}/approve`, { method: 'POST', body: JSON.stringify({}) })
}
export function rejectContent(objectId: string, reason: string): Promise<{ success: boolean }> {
  return apiFetch(`/api/v1/content/${objectId}/reject`, { method: 'POST', body: JSON.stringify({ reason }) })
}
export function publishContent(objectId: string): Promise<{ success: boolean }> {
  return apiFetch(`/api/v1/content/${objectId}/publish`, { method: 'POST', body: JSON.stringify({}) })
}
export function bulkPublish(taxonomyNodeId: number): Promise<{ published: number; objects: unknown[] }> {
  return apiFetch('/api/v1/content/bulk-publish', { method: 'POST', body: JSON.stringify({ taxonomy_node_id: taxonomyNodeId, confirmation: 'PUBLISH ALL' }) })
}
export function getReviewContent(objectId: string): Promise<Record<string, unknown>> {
  return apiFetch(`/api/v1/review/${objectId}`)
}

export function regenerateJVArticleImage(articleId: string): Promise<{ success: boolean; jobId?: string; imagePath?: string }> {
  return apiFetch(`/api/jv-articles/${articleId}/regenerate-image`, { method: 'POST' })
}

export interface JVBatchGenerateJob {
  articleId: string
  title: string
  jobId: string
  imagePath: string
}
export function batchGenerateJVImages(taxonomyNodeId: number, limit: number): Promise<{ success: boolean; queued: number; jobs: JVBatchGenerateJob[] }> {
  return apiFetch('/api/jv-articles/batch-generate', { method: 'POST', body: JSON.stringify({ taxonomy_node_id: taxonomyNodeId, limit }) })
}

export function getImageJobStatus(jobId: string): Promise<{ status: 'pending' | 'completed' | 'failed' | 'not_found'; imagePath?: string; error?: string }> {
  return apiFetch(`/api/image-job-status/${jobId}`)
}
