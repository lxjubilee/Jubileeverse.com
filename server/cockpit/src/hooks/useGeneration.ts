/**
 * hooks/useGeneration.ts — Phase 6 AI generation mutations + log queries
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as api from '../lib/api'
import type { GenerateRequest } from '../types/content-objects'
import { contentKeys } from './useContent'

export const generationKeys = {
  all:  ['generation'] as const,
  logs: (p: api.GenerationLogParams) => [...generationKeys.all, 'logs', p] as const,
}

export function useGenerateContent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: GenerateRequest) => api.generateContent(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: contentKeys.lists() }),
  })
}

export function useGenerationLogs(params: api.GenerationLogParams = {}) {
  return useQuery({
    queryKey: generationKeys.logs(params),
    queryFn:  () => api.getGenerationLogs(params),
    staleTime: 30_000,
  })
}
