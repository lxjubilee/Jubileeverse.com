/**
 * useImages.ts — Part 5 S12–15: Image module React Query hooks
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getImageCounts, getImageQueue, generateImages, checkoutImages,
  approveImage, approveAllImages, rejectImage, requeueImage,
  editImagePrompt, archiveImage, regenerateImage,
  getSatelliteUpdates, generateSatelliteUpdate, getSatelliteSyncStatus,
} from '../lib/api'
import type { ImageGenerationJob, SatelliteUpdate, SatelliteSyncStatus } from '../types/content-objects'

// ── Image queue keys ──────────────────────────────────────────────────────────

const imageKeys = {
  counts: () => ['images', 'counts'] as const,
  queue: (status: string, myItems?: boolean) => ['images', 'queue', status, myItems] as const,
}

// ── Image hooks ───────────────────────────────────────────────────────────────

export function useImageCounts(refetchInterval: number | false = 15_000) {
  return useQuery({
    queryKey: imageKeys.counts(),
    queryFn: getImageCounts,
    staleTime: 10_000,
    refetchInterval,
  })
}

export function useImageQueue(status: string, myItems?: boolean) {
  return useQuery<ImageGenerationJob[]>({
    queryKey: imageKeys.queue(status, myItems),
    queryFn: () => getImageQueue(status, myItems),
    staleTime: 1_000,  // Data fresh for 1 second only
    refetchInterval: 2_000,  // Auto-refetch every 2 seconds (fast polling for regeneration visibility)
    enabled: !!status,
  })
}

function invalidateImages(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['images'] })
}

export function useGenerateImages() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ ids, options }: { ids: string[]; options?: { aspect_ratio?: string; site_id?: string } }) =>
      generateImages(ids, options),
    onSuccess: () => {
      invalidateImages(qc)
      // Also set up aggressive polling for 2 minutes to catch generated images immediately
      const pollInterval = setInterval(() => {
        qc.invalidateQueries({ queryKey: ['images'] })
      }, 3000)  // Refetch every 3 seconds while waiting for images
      setTimeout(() => clearInterval(pollInterval), 120000)  // Stop polling after 2 minutes
    },
  })
}

export function useCheckoutImages() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: checkoutImages,
    onSuccess: () => invalidateImages(qc),
  })
}

export function useApproveImage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (jobId: string) => approveImage(jobId),
    onSuccess: () => invalidateImages(qc),
  })
}

export function useApproveAllImages() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: approveAllImages,
    onSuccess: () => invalidateImages(qc),
  })
}

export function useRejectImage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ jobId, reason }: { jobId: string; reason: string }) => rejectImage(jobId, reason),
    onSuccess: () => invalidateImages(qc),
  })
}

export function useRequeueImage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (jobId: string) => requeueImage(jobId),
    onSuccess: () => invalidateImages(qc),
  })
}

export function useEditImagePrompt() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ jobId, data }: { jobId: string; data: { prompt_context?: string; style_constraints?: Record<string, unknown>; aspect_ratio?: string } }) =>
      editImagePrompt(jobId, data),
    onSuccess: () => invalidateImages(qc),
  })
}

export function useArchiveImage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (jobId: string) => archiveImage(jobId),
    onSuccess: () => invalidateImages(qc),
  })
}

export function useRegenerateImage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (jobId: string) => {
      console.log(`[regenerateImage] Starting regeneration for job: ${jobId}`)
      try {
        const result = await regenerateImage(jobId)
        console.log(`[regenerateImage] Success, got response:`, result)
        return result
      } catch (err) {
        console.error(`[regenerateImage] API call failed:`, err)
        throw err
      }
    },
    onSuccess: (data) => {
      console.log(`[useRegenerateImage] Regeneration started for job:`, data?.id)
      invalidateImages(qc)
      // Aggressive polling for 5 minutes to catch regenerated images immediately
      let pollCount = 0
      const maxPolls = 150 // 5 minutes at 2-second intervals
      const pollInterval = setInterval(() => {
        pollCount++
        console.log(`[useRegenerateImage] Poll ${pollCount}/${maxPolls}`)
        qc.invalidateQueries({ queryKey: ['images'] })
        if (pollCount >= maxPolls) {
          clearInterval(pollInterval)
          console.log(`[useRegenerateImage] Polling complete`)
        }
      }, 2000)
    },
    onError: (error) => {
      console.error(`[useRegenerateImage] Mutation failed:`, error instanceof Error ? error.message : error)
    }
  })
}

// ── Satellite hooks ───────────────────────────────────────────────────────────

export function useSatelliteUpdates(siteId: string | null, since?: string) {
  return useQuery<SatelliteUpdate[]>({
    queryKey: ['satellite', 'updates', siteId, since],
    queryFn: () => getSatelliteUpdates(siteId!, since),
    enabled: !!siteId,
    staleTime: 30_000,
  })
}

export function useGenerateSatelliteUpdate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ siteId, data }: { siteId: string; data: { version_number: string; release_notes?: string; update_type?: string } }) =>
      generateSatelliteUpdate(siteId, data),
    onSuccess: (_, { siteId }) => {
      qc.invalidateQueries({ queryKey: ['satellite', 'updates', siteId] })
    },
  })
}

export function useSatelliteSyncStatus(siteId: string | null) {
  return useQuery<SatelliteSyncStatus>({
    queryKey: ['satellite', 'sync-status', siteId],
    queryFn: () => getSatelliteSyncStatus(siteId!),
    enabled: !!siteId,
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}
