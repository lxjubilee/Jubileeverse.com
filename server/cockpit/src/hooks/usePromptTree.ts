/**
 * hooks/usePromptTree.ts — TanStack Query hooks for prompt navigation tree CRUD
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import * as api from '../lib/api'

const promptTreeKeys = {
  all:  ['prompt-tree'] as const,
  full: () => [...promptTreeKeys.all, 'full'] as const,
  node: (id: string) => [...promptTreeKeys.all, 'node', id] as const,
}

export function usePromptTree() {
  return useQuery({ queryKey: promptTreeKeys.full(), queryFn: api.getPromptTree, staleTime: 5 * 60_000 })
}

export function useCreatePromptTreeNode() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: api.createPromptTreeNode,
    onSuccess: () => qc.invalidateQueries({ queryKey: promptTreeKeys.all }),
  })
}

export function useUpdatePromptTreeNode() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof api.updatePromptTreeNode>[1] }) =>
      api.updatePromptTreeNode(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: promptTreeKeys.all }),
  })
}

export function useMovePromptTreeNode() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, parent_id }: { id: string; parent_id: string | null }) =>
      api.movePromptTreeNode(id, parent_id),
    onSuccess: () => qc.invalidateQueries({ queryKey: promptTreeKeys.all }),
  })
}

export function useDeletePromptTreeNode() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: api.deletePromptTreeNode,
    onSuccess: () => qc.invalidateQueries({ queryKey: promptTreeKeys.all }),
  })
}
