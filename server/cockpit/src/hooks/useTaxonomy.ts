/**
 * hooks/useTaxonomy.ts — TanStack Query hooks for taxonomy (Phase 4)
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import * as api from '../lib/api'
import type { TaxonomyType } from '../types/taxonomy'

export const taxonomyKeys = {
  all:     ['taxonomy'] as const,
  roots:   () => [...taxonomyKeys.all, 'roots'] as const,
  type:    (t: TaxonomyType) => [...taxonomyKeys.all, 'type', t] as const,
  node:    (t: TaxonomyType, slug: string) => [...taxonomyKeys.all, 'node', t, slug] as const,
  content: (t: TaxonomyType, slug: string, opts: object) => [...taxonomyKeys.node(t, slug), 'content', opts] as const,
}

export function useTaxonomyRoots() {
  return useQuery({
    queryKey: taxonomyKeys.roots(),
    queryFn:  api.getTaxonomyRoots,
    staleTime: 0,
  })
}

export function useTaxonomyType(type: TaxonomyType) {
  return useQuery({
    queryKey: taxonomyKeys.type(type),
    queryFn:  () => api.getTaxonomyType(type),
    staleTime: 0,
  })
}

export function useTaxonomyNode(type: TaxonomyType, slug: string | null) {
  return useQuery({
    queryKey: taxonomyKeys.node(type, slug ?? ''),
    queryFn:  () => api.getTaxonomyNode(type, slug!),
    enabled:  !!slug,
    staleTime: 0,
  })
}

export function useTaxonomyNodeContent(
  type: TaxonomyType,
  slug: string | null,
  opts: { limit?: number; offset?: number; nodeId?: number } = {}
) {
  return useQuery({
    queryKey: taxonomyKeys.content(type, slug ?? '', opts),
    queryFn:  () => api.getTaxonomyNodeContent(type, slug!, opts),
    enabled:  !!slug,
    staleTime: 0,
  })
}

export function useCreateTaxonomyNode() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: api.createTaxonomyNode,
    onSuccess: () => qc.invalidateQueries({ queryKey: taxonomyKeys.all }),
  })
}

export function useUpdateTaxonomyNode() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<api.TaxonomyNode> }) =>
      api.updateTaxonomyNode(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: taxonomyKeys.all }),
  })
}

export function useMoveTaxonomyNode() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, newParentId }: { id: number; newParentId: number | null }) =>
      api.moveTaxonomyNode(id, newParentId),
    onSuccess: () => qc.invalidateQueries({ queryKey: taxonomyKeys.all }),
  })
}

export function useAllTaxonomyNodes(type?: import('../types/taxonomy').TaxonomyType) {
  return useQuery({
    queryKey: ['taxonomy', 'all', type ?? 'all'],
    queryFn: () => api.getAllTaxonomyNodes(type),
    staleTime: 0,
  })
}
