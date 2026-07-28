/**
 * hooks/useContent.ts — TanStack Query hooks for content objects (Phase 4)
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import * as api from '../lib/api'
import type {
  CreateContentObjectRequest,
  UpdateContentObjectRequest,
  ContentAuthorRole,
} from '../types/content-objects'

export const contentKeys = {
  all:       ['content'] as const,
  lists:     () => [...contentKeys.all, 'list'] as const,
  list:      (f: api.ContentFilters) => [...contentKeys.lists(), f] as const,
  details:   () => [...contentKeys.all, 'detail'] as const,
  detail:    (id: string) => [...contentKeys.details(), id] as const,
  revisions: (id: string) => [...contentKeys.detail(id), 'revisions'] as const,
  revision:  (id: string, v: number) => [...contentKeys.revisions(id), v] as const,
  search:    (p: api.SearchParams) => [...contentKeys.all, 'search', p] as const,
  audit:     (p: api.AuditLogParams) => ['audit', p] as const,
  authors:   (id: string) => [...contentKeys.detail(id), 'authors'] as const,
}

export function useContentList(filters: api.ContentFilters = {}) {
  return useQuery({
    queryKey: contentKeys.list(filters),
    queryFn:  () => api.listContent(filters),
  })
}

export function useContentObject(id: string | null) {
  return useQuery({
    queryKey: contentKeys.detail(id ?? ''),
    queryFn:  () => api.getContent(id!),
    enabled:  !!id,
  })
}

export function useRevisions(id: string | null) {
  return useQuery({
    queryKey: contentKeys.revisions(id ?? ''),
    queryFn:  () => api.getRevisions(id!),
    enabled:  !!id,
  })
}

export function useRevision(id: string | null, version: number | null) {
  return useQuery({
    queryKey: contentKeys.revision(id ?? '', version ?? 0),
    queryFn:  () => api.getRevision(id!, version!),
    enabled:  !!id && version != null,
  })
}

export function useContentSearch(params: api.SearchParams) {
  return useQuery({
    queryKey: contentKeys.search(params),
    queryFn:  () => api.search(params),
    enabled:  Object.keys(params).length > 0,
  })
}

export function useAuditLog(params: api.AuditLogParams = {}) {
  return useQuery({
    queryKey: contentKeys.audit(params),
    queryFn:  () => api.getAuditLog(params),
  })
}

export function useCreateContent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateContentObjectRequest) => api.createContent(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: contentKeys.lists() }),
  })
}

export function useUpdateContent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateContentObjectRequest }) =>
      api.updateContent(id, data),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: contentKeys.detail(id) })
      qc.invalidateQueries({ queryKey: contentKeys.lists() })
    },
  })
}

export function usePublishContent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.publishContent(id),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: contentKeys.detail(id) })
      qc.invalidateQueries({ queryKey: contentKeys.lists() })
    },
  })
}

export function useArchiveContent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.archiveContent(id),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: contentKeys.detail(id) })
      qc.invalidateQueries({ queryKey: contentKeys.lists() })
    },
  })
}

export function useRollbackContent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, version }: { id: string; version: number }) =>
      api.rollbackContent(id, version),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: contentKeys.detail(id) })
      qc.invalidateQueries({ queryKey: contentKeys.revisions(id) })
    },
  })
}

// ── Content Author Attribution hooks (Section 6) ──────────────────────────────

export function useContentAuthors(contentId: string | null) {
  return useQuery({
    queryKey: contentKeys.authors(contentId ?? ''),
    queryFn:  () => api.listContentAuthors(contentId!),
    enabled:  !!contentId,
  })
}

export function useAddContentAuthor() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      contentId, authorId, role = 'primary_author', displayOrder = 1,
    }: { contentId: string; authorId: string; role?: ContentAuthorRole; displayOrder?: number }) =>
      api.addContentAuthor(contentId, { author_id: authorId, role, display_order: displayOrder }),
    onSuccess: (_, { contentId }) =>
      qc.invalidateQueries({ queryKey: contentKeys.authors(contentId) }),
  })
}

export function useUpdateContentAuthor() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      contentId, authorId, role, displayOrder,
    }: { contentId: string; authorId: string; role?: ContentAuthorRole; displayOrder?: number }) =>
      api.updateContentAuthor(contentId, authorId, { role, display_order: displayOrder }),
    onSuccess: (_, { contentId }) =>
      qc.invalidateQueries({ queryKey: contentKeys.authors(contentId) }),
  })
}

export function useRemoveContentAuthor() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ contentId, authorId }: { contentId: string; authorId: string }) =>
      api.removeContentAuthor(contentId, authorId),
    onSuccess: (_, { contentId }) =>
      qc.invalidateQueries({ queryKey: contentKeys.authors(contentId) }),
  })
}

export function useBulkReassignAuthors() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      contentIds, authorId, role = 'primary_author',
    }: { contentIds: string[]; authorId: string; role?: ContentAuthorRole }) =>
      api.bulkReassignAuthors(contentIds, authorId, role),
    onSuccess: () => qc.invalidateQueries({ queryKey: contentKeys.lists() }),
  })
}
