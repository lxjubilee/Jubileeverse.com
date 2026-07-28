/**
 * hooks/useAutomationJobs.ts — TanStack Query hooks for automation jobs
 *
 * All back-office roles can read and write jobs (automation:view scope).
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import * as api from '../lib/api'

const jobKeys = {
  all:    ['automation-jobs'] as const,
  lists:  () => [...jobKeys.all, 'list'] as const,
  list:   (p: object) => [...jobKeys.lists(), p] as const,
  detail: (id: string) => [...jobKeys.all, 'detail', id] as const,
}

export function useAutomationJobs(
  nodeId: string | null,
  statusGroup: 'pending' | 'completed',
) {
  return useQuery({
    queryKey: jobKeys.list({ nodeId, statusGroup }),
    queryFn: () =>
      api.listAutomationJobs({
        node_id: nodeId ?? undefined,
        status_group: statusGroup,
        limit: 100,
      }),
    staleTime: 30_000,
  })
}

export function useAutomationJob(id: string | null) {
  return useQuery({
    queryKey: jobKeys.detail(id ?? ''),
    queryFn: () => api.getAutomationJob(id!),
    enabled: !!id,
    staleTime: 15_000,
  })
}

export function useCreateAutomationJob() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: api.createAutomationJob,
    onSuccess: () => qc.invalidateQueries({ queryKey: jobKeys.lists() }),
  })
}

export function useUpdateAutomationJob() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<api.AutomationJob> }) =>
      api.updateAutomationJob(id, data),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: jobKeys.detail(id) })
      qc.invalidateQueries({ queryKey: jobKeys.lists() })
    },
  })
}

export function useRunAutomationJob() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.runAutomationJob(id),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: jobKeys.detail(id) })
      qc.invalidateQueries({ queryKey: jobKeys.lists() })
    },
  })
}

export function usePauseAutomationJob() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.pauseAutomationJob(id),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: jobKeys.detail(id) })
      qc.invalidateQueries({ queryKey: jobKeys.lists() })
    },
  })
}

export function useCancelAutomationJob() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.cancelAutomationJob(id),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: jobKeys.detail(id) })
      qc.invalidateQueries({ queryKey: jobKeys.lists() })
    },
  })
}

export function useRetryAutomationJob() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.retryAutomationJob(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: jobKeys.lists() }),
  })
}
