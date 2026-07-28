/**
 * hooks/useAuthors.ts — Phase 7 author profile queries and mutations
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import * as api from '../lib/api'
import type {
  CreateAuthorRequest, UpdateAuthorRequest,
  CreateAuthorBioRequest, UpdateAuthorBioRequest,
} from '../types/content-objects'

export const authorKeys = {
  all:      () => ['authors'] as const,
  lists:    () => [...authorKeys.all(), 'list'] as const,
  detail:   (id: string) => [...authorKeys.all(), id] as const,
  usage:    () => [...authorKeys.all(), 'usage'] as const,
  bios:     (id: string) => [...authorKeys.all(), id, 'bios'] as const,
  channels: () => [...authorKeys.all(), 'bio-channels'] as const,
}

export function useAuthors() {
  return useQuery({
    queryKey: authorKeys.lists(),
    queryFn:  api.listAuthors,
    staleTime: 60_000,
  })
}

export function useAuthor(id: string | null) {
  return useQuery({
    queryKey: authorKeys.detail(id ?? ''),
    queryFn:  () => api.getAuthor(id!),
    enabled:  !!id,
  })
}

export function useCreateAuthor() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateAuthorRequest) => api.createAuthor(data),
    onSuccess:  () => qc.invalidateQueries({ queryKey: authorKeys.lists() }),
  })
}

export function useUpdateAuthor() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateAuthorRequest }) =>
      api.updateAuthor(id, data),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: authorKeys.lists() })
      qc.invalidateQueries({ queryKey: authorKeys.detail(id) })
    },
  })
}

export function useAuthorUsageReport() {
  return useQuery({
    queryKey: authorKeys.usage(),
    queryFn:  api.getAuthorUsageReport,
    staleTime: 60_000,
  })
}

// ── Author Bio hooks (Section 5) ──────────────────────────────────────────────

export function useAuthorBioChannels() {
  return useQuery({
    queryKey: authorKeys.channels(),
    queryFn:  api.getAuthorBioChannels,
    staleTime: Infinity,
  })
}

export function useAuthorBios(authorId: string | null) {
  return useQuery({
    queryKey: authorKeys.bios(authorId ?? ''),
    queryFn:  () => api.listAuthorBios(authorId!),
    enabled:  !!authorId,
  })
}

export function useCreateAuthorBio() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ authorId, data }: { authorId: string; data: CreateAuthorBioRequest }) =>
      api.createAuthorBio(authorId, data),
    onSuccess: (_, { authorId }) =>
      qc.invalidateQueries({ queryKey: authorKeys.bios(authorId) }),
  })
}

export function useUpdateAuthorBio() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ authorId, bioId, data }: { authorId: string; bioId: string; data: UpdateAuthorBioRequest }) =>
      api.updateAuthorBio(authorId, bioId, data),
    onSuccess: (_, { authorId }) =>
      qc.invalidateQueries({ queryKey: authorKeys.bios(authorId) }),
  })
}

export function useDeleteAuthorBio() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ authorId, bioId }: { authorId: string; bioId: string }) =>
      api.deleteAuthorBio(authorId, bioId),
    onSuccess: (_, { authorId }) =>
      qc.invalidateQueries({ queryKey: authorKeys.bios(authorId) }),
  })
}
