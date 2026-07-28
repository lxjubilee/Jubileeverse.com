/**
 * hooks/useComments.ts — TanStack Query hooks for inline comments (Phase 4)
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import * as api from '../lib/api'

export const commentKeys = {
  all:    ['comments'] as const,
  object: (objectType: string, objectId: string) => [...commentKeys.all, objectType, objectId] as const,
}

export function useComments(objectType: string, objectId: string | null) {
  return useQuery({
    queryKey: commentKeys.object(objectType, objectId ?? ''),
    queryFn:  () => api.getComments(objectType, objectId!),
    enabled:  !!objectId,
  })
}

export function useCreateComment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: api.createComment,
    onSuccess: (_data, vars) => {
      const ot = vars.object_type ?? 'jv_content_objects'
      qc.invalidateQueries({ queryKey: commentKeys.object(ot, vars.object_id) })
    },
  })
}

export function useUpdateComment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; objectType: string; objectId: string; data: { body?: string; resolved?: boolean } }) =>
      api.updateComment(id, data),
    onSuccess: (_data, { objectType, objectId }) => {
      qc.invalidateQueries({ queryKey: commentKeys.object(objectType, objectId) })
    },
  })
}

export function useDeleteComment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id }: { id: number; objectType: string; objectId: string }) =>
      api.deleteComment(id),
    onSuccess: (_data, { objectType, objectId }) => {
      qc.invalidateQueries({ queryKey: commentKeys.object(objectType, objectId) })
    },
  })
}
