/**
 * hooks/useTasks.ts — Phase 5 content task queries + mutations
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import * as api from '../lib/api'
import type { CreateTaskRequest, UpdateTaskRequest } from '../types/content-objects'

const taskKeys = {
  all:    () => ['tasks'] as const,
  object: (objectId: string) => ['tasks', objectId] as const,
}

export function useContentTasks(objectId: string | null) {
  return useQuery({
    queryKey: taskKeys.object(objectId ?? ''),
    queryFn: () => api.getContentTasks(objectId!),
    enabled: !!objectId,
  })
}

export function useCreateTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ objectId, data }: { objectId: string; data: CreateTaskRequest }) =>
      api.createContentTask(objectId, data),
    onSuccess: (_, { objectId }) => {
      qc.invalidateQueries({ queryKey: taskKeys.object(objectId) })
    },
  })
}

export function useUpdateTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; objectId: string; data: UpdateTaskRequest }) =>
      api.updateContentTask(id, data),
    onSuccess: (_, { objectId }) => {
      qc.invalidateQueries({ queryKey: taskKeys.object(objectId) })
    },
  })
}

export function useDeleteTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id }: { id: number; objectId: string }) =>
      api.deleteContentTask(id),
    onSuccess: (_, { objectId }) => {
      qc.invalidateQueries({ queryKey: taskKeys.object(objectId) })
    },
  })
}
