/**
 * hooks/usePromptRecipeAssignments.ts — TanStack Query hooks for prompt-tree node assignments
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import * as api from '../lib/api'

const assignmentKeys = {
  all:       ['prompt-assignments'] as const,
  forPrompt: (id: string) => [...assignmentKeys.all, id] as const,
}

export function usePromptRecipeAssignments(promptId: string | null) {
  return useQuery({
    queryKey: assignmentKeys.forPrompt(promptId ?? ''),
    queryFn:  () => api.getPromptRecipeAssignments(promptId!),
    enabled:  !!promptId && promptId !== 'new',
    staleTime: 30_000,
  })
}

export function useAssignPromptToNode() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: api.assignPromptToNode,
    onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: assignmentKeys.forPrompt(vars.prompt_id) }),
  })
}

export function useRemovePromptAssignment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id }: { id: string; promptId: string }) => api.removePromptAssignment(id),
    onSuccess:  (_, { promptId }) => qc.invalidateQueries({ queryKey: assignmentKeys.forPrompt(promptId) }),
  })
}

export function useSetAssignmentPrimary() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id }: { id: string; promptId: string }) => api.setAssignmentPrimary(id),
    onSuccess:  (_, { promptId }) => qc.invalidateQueries({ queryKey: assignmentKeys.forPrompt(promptId) }),
  })
}
