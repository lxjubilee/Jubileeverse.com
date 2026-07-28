/**
 * hooks/useAutomationDashboard.ts — Dashboard data hook (Section 10)
 *
 * Auto-refreshes every 30 seconds to keep summary cards current.
 */

import { useQuery } from '@tanstack/react-query'
import * as api from '../lib/api'

const DASHBOARD_KEY = ['automation-dashboard'] as const

export function useAutomationDashboard(params: Parameters<typeof api.getAutomationDashboard>[0] = {}) {
  return useQuery({
    queryKey: [...DASHBOARD_KEY, params],
    queryFn: () => api.getAutomationDashboard(params),
    staleTime:       25_000,
    refetchInterval: 30_000,
  })
}
