/**
 * useGovernance - Cockpit hooks for governance and deployment management
 *
 * Provides TanStack Query hooks for snapshots, gates, and compliance tracking
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export interface GateCheck {
  passed: boolean;
  message: string;
  [key: string]: any;
}

export interface GateResult {
  gate: string;
  status: 'passed' | 'failed' | 'approved' | 'rejected';
  version?: string;
  startedAt: string;
  completedAt: string;
  checks?: Record<string, GateCheck>;
  snapshot?: Snapshot;
  autoRollback?: RollbackResult;
  autoRolledBack?: boolean;
}

export interface Snapshot {
  id: string;
  version: string;
  reason: string;
  created_by: string;
  created_at: string;
  data_hash?: string;
  snapshotId?: string;
  timestamp?: string;
}

export interface RollbackResult {
  success: boolean;
  snapshotId: string;
  version: string;
  rolledBackAt: string;
}

export interface GovernanceReport {
  gateExecutions: Array<{
    event_type: string;
    count: number;
    passed: number;
  }>;
  recentSnapshots: Snapshot[];
  reportedAt: string;
}

/**
 * Get governance report
 */
export function useGovernanceReport() {
  return useQuery({
    queryKey: ['governance-report'],
    queryFn: async () => {
      const response = await fetch('/api/v1/governance/report', {
        headers: {
          'X-CSRF-Token': document.cookie
            .split('; ')
            .find(row => row.startsWith('jv-csrf='))
            ?.split('=')[1] || ''
        }
      });
      if (!response.ok) throw new Error('Failed to fetch governance report');
      return (await response.json()) as GovernanceReport;
    },
    refetchInterval: 60_000 // Refresh every 60s
  });
}

/**
 * Get list of snapshots
 */
export function useSnapshots(limit = 20) {
  return useQuery({
    queryKey: ['snapshots', limit],
    queryFn: async () => {
      const response = await fetch(`/api/v1/governance/snapshots?limit=${limit}`, {
        headers: {
          'X-CSRF-Token': document.cookie
            .split('; ')
            .find(row => row.startsWith('jv-csrf='))
            ?.split('=')[1] || ''
        }
      });
      if (!response.ok) throw new Error('Failed to fetch snapshots');
      const data = await response.json();
      return data.snapshots as Snapshot[];
    },
    refetchInterval: 30_000 // Refresh every 30s
  });
}

/**
 * Create a deployment snapshot
 */
export function useCreateSnapshot() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (variables: { version: string; reason?: string }) => {
      const response = await fetch('/api/v1/governance/snapshot', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': document.cookie
            .split('; ')
            .find(row => row.startsWith('jv-csrf='))
            ?.split('=')[1] || ''
        },
        body: JSON.stringify({
          version: variables.version,
          reason: variables.reason || 'manual-snapshot'
        })
      });
      if (!response.ok) throw new Error('Failed to create snapshot');
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['snapshots'] });
      queryClient.invalidateQueries({ queryKey: ['governance-report'] });
    }
  });
}

/**
 * Rollback to a snapshot
 */
export function useRollback() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (variables: { snapshotId: string; reason?: string }) => {
      const response = await fetch(
        `/api/v1/governance/snapshot/${variables.snapshotId}/rollback`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': document.cookie
              .split('; ')
              .find(row => row.startsWith('jv-csrf='))
              ?.split('=')[1] || ''
          },
          body: JSON.stringify({
            reason: variables.reason || 'manual-rollback'
          })
        }
      );
      if (!response.ok) throw new Error('Failed to rollback');
      return (await response.json()).rollback as RollbackResult;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['governance-report'] });
    }
  });
}

/**
 * Execute pre-deploy gate (creates snapshot)
 */
export function usePreDeployGate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (version: string) => {
      const response = await fetch('/api/v1/governance/gates/pre-deploy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': document.cookie
            .split('; ')
            .find(row => row.startsWith('jv-csrf='))
            ?.split('=')[1] || ''
        },
        body: JSON.stringify({ version })
      });
      if (!response.ok) throw new Error('Pre-deploy gate failed');
      return (await response.json()).result as GateResult;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['snapshots'] });
      queryClient.invalidateQueries({ queryKey: ['governance-report'] });
    }
  });
}

/**
 * Execute canary tests (with auto-rollback)
 */
export function useCanaryGate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (variables: { version: string; snapshotId?: string }) => {
      const response = await fetch('/api/v1/governance/gates/canary', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': document.cookie
            .split('; ')
            .find(row => row.startsWith('jv-csrf='))
            ?.split('=')[1] || ''
        },
        body: JSON.stringify({
          version: variables.version,
          snapshotId: variables.snapshotId
        })
      });
      if (!response.ok) throw new Error('Canary gate failed');
      return (await response.json()).result as GateResult;
    },
    onSuccess: (result) => {
      if (result.autoRolledBack) {
        // Alert user that auto-rollback occurred
        console.warn('⚠️ Canary test failed — automatic rollback executed');
      }
      queryClient.invalidateQueries({ queryKey: ['governance-report'] });
    }
  });
}
