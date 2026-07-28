/**
 * useAgents - Cockpit hooks for agent management
 *
 * Provides TanStack Query hooks for listing, fetching, and invoking agents
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export interface AgentDefinition {
  id: string;
  name: string;
  role: string;
  description: string;
  models: {
    primary: string;
    secondary: string;
  };
}

export interface AgentStatus {
  agentId: string;
  role: string;
  status: 'idle' | 'executing' | 'ready';
  trustScore: number;
  autonomyLevel: 'high' | 'standard' | 'low';
  skillCount: number;
  pendingMessages: number;
  tasksCompleted: number;
  lastTask: string | null;
}

export interface Agent extends AgentDefinition {
  trustScore: number;
  autonomyLevel: 'high' | 'standard' | 'low';
  status: string;
}

export interface AgentDetail {
  agentId: string;
  definition: AgentDefinition;
  status: AgentStatus;
  context: any;
}

/**
 * Get list of all agents with status and trust scores
 */
export function useAgents() {
  return useQuery({
    queryKey: ['agents'],
    queryFn: async () => {
      const response = await fetch('/api/v1/agents', {
        headers: {
          'X-CSRF-Token': document.cookie
            .split('; ')
            .find(row => row.startsWith('jv-csrf='))
            ?.split('=')[1] || ''
        }
      });
      if (!response.ok) throw new Error('Failed to fetch agents');
      const data = await response.json();
      return data.agents as Agent[];
    },
    refetchInterval: 30_000 // Refresh every 30s
  });
}

/**
 * Get single agent details
 */
export function useAgent(agentId: string) {
  return useQuery({
    queryKey: ['agents', agentId],
    queryFn: async () => {
      const response = await fetch(`/api/v1/agents/${agentId}`, {
        headers: {
          'X-CSRF-Token': document.cookie
            .split('; ')
            .find(row => row.startsWith('jv-csrf='))
            ?.split('=')[1] || ''
        }
      });
      if (!response.ok) throw new Error(`Failed to fetch agent ${agentId}`);
      return (await response.json()) as AgentDetail;
    }
  });
}

/**
 * Invoke agent task
 */
export function useInvokeAgent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (variables: {
      agentId: string;
      description: string;
      input?: any;
    }) => {
      const response = await fetch(`/api/v1/agents/${variables.agentId}/invoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': document.cookie
            .split('; ')
            .find(row => row.startsWith('jv-csrf='))
            ?.split('=')[1] || ''
        },
        body: JSON.stringify({
          description: variables.description,
          input: variables.input
        })
      });
      if (!response.ok) throw new Error('Failed to invoke agent');
      return await response.json();
    },
    onSuccess: (_data, variables) => {
      // Invalidate agent queries to refresh status
      queryClient.invalidateQueries({ queryKey: ['agents', variables.agentId] });
      queryClient.invalidateQueries({ queryKey: ['agents'] });
    }
  });
}
