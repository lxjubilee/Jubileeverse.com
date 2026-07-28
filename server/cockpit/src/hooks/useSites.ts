/**
 * useSites.ts — Phase 8 site registry React Query hooks
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import * as api from '../lib/api'
import type { CreateSiteRequest, UpdateSiteRequest, SitePublishTarget } from '../types/content-objects'

export const siteKeys = {
  all:    () => ['sites'] as const,
  lists:  () => [...siteKeys.all(), 'list'] as const,
  detail: (id: string) => [...siteKeys.all(), id] as const,
  report: () => [...siteKeys.all(), 'report'] as const,
}

export function useSites() {
  return useQuery({ queryKey: siteKeys.lists(), queryFn: api.listSites, staleTime: 60_000 })
}

export function useSite(id: string | null) {
  return useQuery({
    queryKey: siteKeys.detail(id ?? ''),
    queryFn:  () => api.getSite(id!),
    enabled:  !!id,
  })
}

export function useCreateSite() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateSiteRequest) => api.createSite(data),
    onSuccess:  () => qc.invalidateQueries({ queryKey: siteKeys.lists() }),
  })
}

export function useUpdateSite() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateSiteRequest }) => api.updateSite(id, data),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: siteKeys.lists() })
      qc.invalidateQueries({ queryKey: siteKeys.detail(id) })
    },
  })
}

export function useUpdatePublishTargets() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, targets }: { id: string; targets: SitePublishTarget[] }) =>
      api.updatePublishTargets(id, targets),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['content'] }),
  })
}

export function useSitePublish() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.sitePublish(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['content'] }),
  })
}

export function useSitePublishingReport() {
  return useQuery({
    queryKey: siteKeys.report(),
    queryFn:  api.getSitePublishingReport,
    staleTime: 60_000,
  })
}
