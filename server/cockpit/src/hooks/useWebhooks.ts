/**
 * hooks/useWebhooks.ts — Phase 9 webhook management hooks
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import * as api from '../lib/api'
import type { WebhookRecord } from '../types/content-objects'

const webhookKeys = {
  all:        () => ['webhooks'] as const,
  lists:      () => [...webhookKeys.all(), 'list'] as const,
  deliveries: (id: number) => [...webhookKeys.all(), id, 'deliveries'] as const,
}

export function useWebhooks() {
  return useQuery({ queryKey: webhookKeys.lists(), queryFn: api.listWebhooks, staleTime: 30_000 })
}

export function useCreateWebhook() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Parameters<typeof api.createWebhook>[0]) => api.createWebhook(data),
    onSuccess:  () => qc.invalidateQueries({ queryKey: webhookKeys.lists() }),
  })
}

export function useUpdateWebhook() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<WebhookRecord> }) =>
      api.updateWebhook(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: webhookKeys.lists() }),
  })
}

export function useDeleteWebhook() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.deleteWebhook(id),
    onSuccess:  () => qc.invalidateQueries({ queryKey: webhookKeys.lists() }),
  })
}

export function useWebhookDeliveries(id: number | null) {
  return useQuery({
    queryKey: webhookKeys.deliveries(id ?? 0),
    queryFn:  () => api.listWebhookDeliveries(id!),
    enabled:  !!id,
    staleTime: 10_000,
  })
}
