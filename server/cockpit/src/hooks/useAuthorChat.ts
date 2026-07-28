/**
 * hooks/useAuthorChat.ts — Phase 7 author chat session queries and mutations
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as api from '../lib/api'

export const chatKeys = {
  history: (authorId: string, nodeId: number | null) =>
    ['author-chat', authorId, nodeId] as const,
}

export function useAuthorChatHistory(
  authorId: string | null,
  taxonomyNodeId: number | null
) {
  return useQuery({
    queryKey: chatKeys.history(authorId ?? '', taxonomyNodeId),
    queryFn:  () => api.getAuthorChatHistory(authorId!, taxonomyNodeId),
    enabled:  !!authorId,
    staleTime: 0,
  })
}

export function useSendAuthorMessage(
  authorId: string | null,
  taxonomyNodeId: number | null
) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (message: string) =>
      api.sendAuthorChatMessage(authorId!, message, taxonomyNodeId),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: chatKeys.history(authorId ?? '', taxonomyNodeId) }),
  })
}

export function useClearAuthorChat(
  authorId: string | null,
  taxonomyNodeId: number | null
) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.clearAuthorChatHistory(authorId!, taxonomyNodeId),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: chatKeys.history(authorId ?? '', taxonomyNodeId) }),
  })
}
