/**
 * hooks/useWorkflow.ts — Phase 5 workflow transition mutations
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import * as api from '../lib/api'
import type { WorkflowTransitionRequest } from '../types/content-objects'
import { contentKeys } from './useContent'

export function useTransitionContent() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: WorkflowTransitionRequest }) =>
      api.transitionContent(id, body),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: contentKeys.detail(id) })
      queryClient.invalidateQueries({ queryKey: contentKeys.lists() })
    },
  })
}
