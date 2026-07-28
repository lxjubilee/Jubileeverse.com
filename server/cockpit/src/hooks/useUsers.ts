/**
 * hooks/useUsers.ts — CMS user account management queries and mutations (Sections 7-9)
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import * as api from '../lib/api'

export const userKeys = {
  all:      ['users'] as const,
  lists:    () => [...userKeys.all, 'list'] as const,
  list:     (f?: object) => [...userKeys.lists(), f] as const,
  detail:   (id: number) => [...userKeys.all, 'detail', id] as const,
  sessions: (id: number) => [...userKeys.detail(id), 'sessions'] as const,
  activity: (id: number, f?: object) => [...userKeys.detail(id), 'activity', f] as const,
  summary:  (id: number, tr?: string) => [...userKeys.detail(id), 'summary', tr] as const,
  audit:    (id: number) => [...userKeys.detail(id), 'account-audit'] as const,
}

// ── Query hooks ───────────────────────────────────────────────────────────────

export function useUsers(params?: { limit?: number; offset?: number }) {
  return useQuery({
    queryKey: userKeys.list(params),
    queryFn:  () => api.listCmsUsers(params),
    staleTime: 30_000,
  })
}

export function useCmsUser(id: number | null) {
  return useQuery({
    queryKey: userKeys.detail(id ?? 0),
    queryFn:  () => api.getCmsUser(id!),
    enabled:  !!id,
  })
}

export function useUserSessions(id: number | null, params?: { limit?: number; offset?: number }) {
  return useQuery({
    queryKey: userKeys.sessions(id ?? 0),
    queryFn:  () => api.listUserSessions(id!, params),
    enabled:  !!id,
  })
}

export function useUserActivity(id: number | null, filters?: Record<string, string | number>) {
  return useQuery({
    queryKey: userKeys.activity(id ?? 0, filters),
    queryFn:  () => api.getUserActivity(id!, filters),
    enabled:  !!id,
  })
}

export function useUserActivitySummary(id: number | null, time_range?: string) {
  return useQuery({
    queryKey: userKeys.summary(id ?? 0, time_range),
    queryFn:  () => api.getUserActivitySummary(id!, time_range),
    enabled:  !!id,
  })
}

export function useUserAccountAudit(id: number | null) {
  return useQuery({
    queryKey: userKeys.audit(id ?? 0),
    queryFn:  () => api.getUserAccountAudit(id!),
    enabled:  !!id,
  })
}

// ── Mutation hooks ────────────────────────────────────────────────────────────

export function useUpdateCmsUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: { name?: string; role?: string } }) =>
      api.updateCmsUser(id, data),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: userKeys.detail(id) })
      qc.invalidateQueries({ queryKey: userKeys.lists() })
    },
  })
}

export function useEnableCmsUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.enableCmsUser(id),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: userKeys.detail(id) })
      qc.invalidateQueries({ queryKey: userKeys.lists() })
    },
  })
}

export function useDisableCmsUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.disableCmsUser(id),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: userKeys.detail(id) })
      qc.invalidateQueries({ queryKey: userKeys.lists() })
    },
  })
}

export function useLockCmsUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.lockCmsUser(id),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: userKeys.detail(id) })
      qc.invalidateQueries({ queryKey: userKeys.lists() })
    },
  })
}

export function useUnlockCmsUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.unlockCmsUser(id),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: userKeys.detail(id) })
      qc.invalidateQueries({ queryKey: userKeys.lists() })
    },
  })
}

export function useForcePasswordReset() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.forcePasswordReset(id),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: userKeys.detail(id) })
    },
  })
}

export function useResetUserMfa() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.resetUserMfa(id),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: userKeys.detail(id) })
    },
  })
}

export function useRevokeAllUserSessions() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.revokeAllUserSessions(id),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: userKeys.sessions(id) })
      qc.invalidateQueries({ queryKey: userKeys.detail(id) })
      qc.invalidateQueries({ queryKey: userKeys.lists() })
    },
  })
}

export function useRevokeUserSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ userId, sessionId }: { userId: number; sessionId: number }) =>
      api.revokeUserSession(userId, sessionId),
    onSuccess: (_, { userId }) => {
      qc.invalidateQueries({ queryKey: userKeys.sessions(userId) })
    },
  })
}

// ── Part 3 Section 12: Directory & Entitlement hooks ─────────────────────────

import type { CmsUserRole } from '../types/content-objects'

export function useDirectorySearch(q: string) {
  return useQuery({
    queryKey: [...userKeys.all, 'directory', q] as const,
    queryFn:  () => api.searchDirectory(q),
    enabled:  q.length >= 2,
    staleTime: 10_000,
  })
}

export function useGrantCmsAccess() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: api.grantCmsAccess,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: userKeys.all })
    },
  })
}

export function useRevokeEntitlement() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.revokeEntitlement(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: userKeys.all })
    },
  })
}

export function useUpdateCmsRoles() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, cms_roles }: { id: number; cms_roles: CmsUserRole[] }) =>
      api.updateCmsRoles(id, cms_roles),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: userKeys.all })
    },
  })
}
