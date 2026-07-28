/**
 * hooks/useNotifications.ts — Phase 5 notification queries + mutations
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import * as api from '../lib/api'

const notifKeys = {
  all:         () => ['notifications'] as const,
  unreadCount: () => ['notifications', 'unread-count'] as const,
}

export function useNotifications() {
  return useQuery({
    queryKey: notifKeys.all(),
    queryFn: () => api.getNotifications(),
    refetchInterval: 30_000,
  })
}

export function useUnreadCount() {
  return useQuery({
    queryKey: notifKeys.unreadCount(),
    queryFn: () => api.getUnreadCount(),
    refetchInterval: 15_000,
  })
}

export function useMarkNotificationRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.markNotificationRead(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: notifKeys.all() })
      qc.invalidateQueries({ queryKey: notifKeys.unreadCount() })
    },
  })
}

export function useMarkAllRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.markAllNotificationsRead(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: notifKeys.all() })
      qc.invalidateQueries({ queryKey: notifKeys.unreadCount() })
    },
  })
}
