/**
 * hooks/useAutomationJobTemplates.ts — TanStack Query hooks for automation job templates (Section 9)
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import * as api from '../lib/api'

const templateKeys = {
  all:    ['automation-job-templates'] as const,
  lists:  () => [...templateKeys.all, 'list'] as const,
  list:   (p: object) => [...templateKeys.lists(), p] as const,
  detail: (id: string) => [...templateKeys.all, 'detail', id] as const,
}

export function useAutomationJobTemplates(params: {
  node_id?: string
  active_only?: boolean
} = {}) {
  return useQuery({
    queryKey: templateKeys.list(params),
    queryFn: () => api.listAutomationJobTemplates({ ...params, limit: 200 }),
    staleTime: 60_000,
  })
}

export function useAutomationJobTemplate(id: string | null) {
  return useQuery({
    queryKey: templateKeys.detail(id ?? ''),
    queryFn: () => api.getAutomationJobTemplate(id!),
    enabled: !!id,
    staleTime: 30_000,
  })
}

export function useCreateAutomationJobTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Parameters<typeof api.createAutomationJobTemplate>[0]) =>
      api.createAutomationJobTemplate(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: templateKeys.lists() })
    },
  })
}

export function useUpdateAutomationJobTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<api.AutomationJobTemplate> }) =>
      api.updateAutomationJobTemplate(id, data),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: templateKeys.detail(id) })
      qc.invalidateQueries({ queryKey: templateKeys.lists() })
    },
  })
}

export function useDeleteAutomationJobTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.deleteAutomationJobTemplate(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: templateKeys.lists() })
    },
  })
}

export function useApplyAutomationJobTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string
      data: Parameters<typeof api.applyAutomationJobTemplate>[1]
    }) => api.applyAutomationJobTemplate(id, data),
    onSuccess: () => {
      // Refresh the automation-jobs list
      qc.invalidateQueries({ queryKey: ['automation-jobs', 'list'] })
    },
  })
}
