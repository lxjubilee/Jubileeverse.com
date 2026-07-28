/**
 * hooks/useAutomationTree.ts — TanStack Query hooks for the automation navigation tree
 *
 * Read access: all back-office roles (automation:view)
 * Write access: admin only (prompt:manage)
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import * as api from '../lib/api'

const automationTreeKeys = {
  all:  ['automation-tree'] as const,
  full: () => [...automationTreeKeys.all, 'full'] as const,
  node: (id: string) => [...automationTreeKeys.all, 'node', id] as const,
}

export function useAutomationTree() {
  return useQuery({
    queryKey: automationTreeKeys.full(),
    queryFn:  api.getAutomationTree,
    staleTime: 5 * 60_000,
  })
}

export function useCreateAutomationTreeNode() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: api.createAutomationTreeNode,
    onSuccess:  () => qc.invalidateQueries({ queryKey: automationTreeKeys.all }),
  })
}

export function useUpdateAutomationTreeNode() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof api.updateAutomationTreeNode>[1] }) =>
      api.updateAutomationTreeNode(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: automationTreeKeys.all }),
  })
}

export function useMoveAutomationTreeNode() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, parent_id }: { id: string; parent_id: string | null }) =>
      api.moveAutomationTreeNode(id, parent_id),
    onSuccess: () => qc.invalidateQueries({ queryKey: automationTreeKeys.all }),
  })
}

export function useDeleteAutomationTreeNode() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: api.deleteAutomationTreeNode,
    onSuccess:  () => qc.invalidateQueries({ queryKey: automationTreeKeys.all }),
  })
}
