/**
 * usePortal.ts — React Query hooks for Portal workspace (Part 4 S7–8)
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchPortalSites,
  fetchPortalTree,
  fetchPortalPages,
  fetchPortalDetail,
  updatePortalItems,
  generatePortal,
  generateSitePortal,
} from '../lib/api'
import type { PortalSite, PortalGridRow, PortalDetail } from '../types/content-objects'

const portalKeys = {
  sites:  ()                                => ['portal', 'sites']                      as const,
  tree:   (siteId: number)                  => ['portal', 'tree', siteId]               as const,
  pages:  (siteId: number, date?: string, type?: string) => ['portal', 'pages', siteId, date, type] as const,
  detail: (id: string | null)               => ['portal', 'detail', id]                 as const,
}

export function usePortalSites() {
  return useQuery<PortalSite[]>({
    queryKey: portalKeys.sites(),
    queryFn:  fetchPortalSites,
    staleTime: 60_000,
  })
}

export function usePortalTree(siteId: number | null) {
  return useQuery<Record<string, Record<string, Record<string, PortalGridRow[]>>>>({
    queryKey: portalKeys.tree(siteId!),
    queryFn:  () => fetchPortalTree(siteId!),
    enabled:  !!siteId,
    staleTime: 30_000,
  })
}

export function usePortalPages(siteId: number | null, portalDate?: string, portalType?: string) {
  return useQuery<PortalGridRow[]>({
    queryKey: portalKeys.pages(siteId!, portalDate, portalType),
    queryFn:  () => fetchPortalPages(siteId!, portalDate, portalType),
    enabled:  !!siteId,
    staleTime: 30_000,
  })
}

export function usePortalDetail(portalId: string | null) {
  return useQuery<PortalDetail>({
    queryKey: portalKeys.detail(portalId),
    queryFn:  () => fetchPortalDetail(portalId!),
    enabled:  !!portalId,
    staleTime: 15_000,
  })
}

export function useRegeneratePortal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (params: Parameters<typeof generatePortal>[0]) => generatePortal(params),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portal'] })
    },
  })
}

export function useGenerateSitePortal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ siteId, portalDate }: { siteId: number; portalDate?: string }) =>
      generateSitePortal(siteId, portalDate),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portal'] })
    },
  })
}

export function useUpdatePortalItems() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ portalId, contentIds }: { portalId: string; contentIds: string[] }) =>
      updatePortalItems(portalId, contentIds),
    onSuccess: (_data, { portalId }) => {
      qc.invalidateQueries({ queryKey: portalKeys.detail(portalId) })
      qc.invalidateQueries({ queryKey: ['portal', 'pages'] })
    },
  })
}
