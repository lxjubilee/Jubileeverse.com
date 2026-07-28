/**
 * useWebsites.ts — React Query hooks for Websites Module (Part 4 S9–11)
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  listTaxonomyAssignments,
  assignTaxonomy,
  updateTaxonomyAssignment,
  removeTaxonomyAssignment,
  reorderTaxonomyAssignment,
  listWebsitePages,
  createWebsitePage,
  getWebsitePage,
  updateWebsitePage,
  deleteWebsitePage,
  listWebsitePackages,
  generateWebsitePackage,
  getPortalRules,
  updatePortalRules,
  getContentRevisions,
} from '../lib/api'
import type { WebsiteTaxonomyAssignment, WebsitePage, PortalRules } from '../types/content-objects'

// ── Query key factory ────────────────────────────────────────────────────────

const websiteKeys = {
  taxonomy: (siteId: string) => ['websites', siteId, 'taxonomy'] as const,
  pages:    (siteId: string) => ['websites', siteId, 'pages'] as const,
  page:     (siteId: string, id: string) => ['websites', siteId, 'pages', id] as const,
  packages: (siteId: string) => ['websites', siteId, 'packages'] as const,
}

// ── Taxonomy Assignment hooks ─────────────────────────────────────────────────

export function useTaxonomyAssignments(siteId: string | null) {
  return useQuery({
    queryKey: websiteKeys.taxonomy(siteId ?? ''),
    queryFn: () => listTaxonomyAssignments(siteId!),
    enabled: !!siteId,
    staleTime: 30_000,
  })
}

export function useAssignTaxonomy() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ siteId, data }: { siteId: string; data: { taxonomy_node_id: number; nav_position?: string; custom_label?: string; is_featured?: boolean } }) =>
      assignTaxonomy(siteId, data),
    onSuccess: (_res, { siteId }) => {
      qc.invalidateQueries({ queryKey: websiteKeys.taxonomy(siteId) })
    },
  })
}

export function useUpdateTaxonomyAssignment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ siteId, assignmentId, data }: { siteId: string; assignmentId: string; data: Partial<WebsiteTaxonomyAssignment> }) =>
      updateTaxonomyAssignment(siteId, assignmentId, data),
    onSuccess: (_res, { siteId }) => {
      qc.invalidateQueries({ queryKey: websiteKeys.taxonomy(siteId) })
    },
  })
}

export function useRemoveTaxonomyAssignment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ siteId, assignmentId }: { siteId: string; assignmentId: string }) =>
      removeTaxonomyAssignment(siteId, assignmentId),
    onSuccess: (_res, { siteId }) => {
      qc.invalidateQueries({ queryKey: websiteKeys.taxonomy(siteId) })
    },
  })
}

export function useReorderTaxonomyAssignment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ siteId, id, direction }: { siteId: string; id: string; direction: 'up' | 'down' }) =>
      reorderTaxonomyAssignment(siteId, id, direction),
    onSuccess: (_res, { siteId }) => {
      qc.invalidateQueries({ queryKey: websiteKeys.taxonomy(siteId) })
    },
  })
}

// ── Web Pages hooks ───────────────────────────────────────────────────────────

export function useWebsitePages(siteId: string | null) {
  return useQuery({
    queryKey: websiteKeys.pages(siteId ?? ''),
    queryFn: () => listWebsitePages(siteId!),
    enabled: !!siteId,
    staleTime: 30_000,
  })
}

export function useCreateWebsitePage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ siteId, data }: { siteId: string; data: Partial<WebsitePage> }) =>
      createWebsitePage(siteId, data),
    onSuccess: (_res, { siteId }) => {
      qc.invalidateQueries({ queryKey: websiteKeys.pages(siteId) })
    },
  })
}

export function useWebsitePage(siteId: string | null, pageId: string | null) {
  return useQuery({
    queryKey: websiteKeys.page(siteId ?? '', pageId ?? ''),
    queryFn: () => getWebsitePage(siteId!, pageId!),
    enabled: !!siteId && !!pageId,
    staleTime: 30_000,
  })
}

export function useUpdateWebsitePage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ siteId, pageId, data }: { siteId: string; pageId: string; data: Partial<WebsitePage> }) =>
      updateWebsitePage(siteId, pageId, data),
    onSuccess: (_res, { siteId, pageId }) => {
      qc.invalidateQueries({ queryKey: websiteKeys.pages(siteId) })
      qc.invalidateQueries({ queryKey: websiteKeys.page(siteId, pageId) })
    },
  })
}

export function useDeleteWebsitePage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ siteId, pageId }: { siteId: string; pageId: string }) =>
      deleteWebsitePage(siteId, pageId),
    onSuccess: (_res, { siteId }) => {
      qc.invalidateQueries({ queryKey: websiteKeys.pages(siteId) })
    },
  })
}

// ── Package hooks ─────────────────────────────────────────────────────────────

export function useWebsitePackages(siteId: string | null) {
  return useQuery({
    queryKey: websiteKeys.packages(siteId ?? ''),
    queryFn: () => listWebsitePackages(siteId!),
    enabled: !!siteId,
    staleTime: 30_000,
  })
}

export function useGenerateWebsitePackage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ siteId, data }: { siteId: string; data: { version_number: string; release_notes?: string } }) =>
      generateWebsitePackage(siteId, data),
    onSuccess: (_res, { siteId }) => {
      qc.invalidateQueries({ queryKey: websiteKeys.packages(siteId) })
    },
  })
}

// ── Part 4 S12–14 ─────────────────────────────────────────────────────────────

export function usePortalRules(siteId: string | null, taxonomyNodeId?: number) {
  return useQuery({
    queryKey: ['portal', 'rules', siteId, taxonomyNodeId],
    queryFn: () => getPortalRules(siteId!, taxonomyNodeId),
    enabled: !!siteId,
    staleTime: 60_000,
  })
}

export function useUpdatePortalRules() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ siteId, rules, taxonomyNodeId }: { siteId: string; rules: Partial<PortalRules>; taxonomyNodeId?: number }) =>
      updatePortalRules(siteId, rules, taxonomyNodeId),
    onSuccess: (_, { siteId }) => {
      qc.invalidateQueries({ queryKey: ['portal', 'rules', siteId] })
    },
  })
}

export function useContentRevisions(contentId: string | null) {
  return useQuery({
    queryKey: ['content', contentId, 'revisions'],
    queryFn: () => getContentRevisions(contentId!),
    enabled: !!contentId,
    staleTime: 60_000,
  })
}
