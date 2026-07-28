/**
 * useServers.ts — TanStack Query hooks for the Servers Module (Part 6 S3)
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  listServerNodes, registerServerNode, getServerNode,
  updateServerNode, disableServerNode, triggerNodeSync,
} from '../lib/api'
import type { ServerNode } from '../types/content-objects'

const serverKeys = {
  all:  () => ['servers'] as const,
  node: (id: string) => ['servers', id] as const,
}

export function useServerNodes() {
  return useQuery({
    queryKey: serverKeys.all(),
    queryFn: listServerNodes,
    refetchInterval: 60_000,
    staleTime: 30_000,
    select: d => d.nodes,
  })
}

export function useServerNode(nodeId: string | null) {
  return useQuery({
    queryKey: serverKeys.node(nodeId ?? ''),
    queryFn: () => getServerNode(nodeId!),
    enabled: !!nodeId,
    refetchInterval: 30_000,
    staleTime: 15_000,
  })
}

export function useRegisterServerNode() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Partial<ServerNode>) => registerServerNode(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: serverKeys.all() }),
  })
}

export function useUpdateServerNode() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ nodeId, data }: { nodeId: string; data: Partial<ServerNode> }) =>
      updateServerNode(nodeId, data),
    onSuccess: (_, { nodeId }) => {
      qc.invalidateQueries({ queryKey: serverKeys.all() })
      qc.invalidateQueries({ queryKey: serverKeys.node(nodeId) })
    },
  })
}

export function useDisableServerNode() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (nodeId: string) => disableServerNode(nodeId),
    onSuccess: () => qc.invalidateQueries({ queryKey: serverKeys.all() }),
  })
}

export function useTriggerNodeSync() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (nodeId: string) => triggerNodeSync(nodeId),
    onSuccess: (_, nodeId) => qc.invalidateQueries({ queryKey: serverKeys.node(nodeId) }),
  })
}
