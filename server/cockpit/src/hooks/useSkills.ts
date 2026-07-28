/**
 * useSkills - Cockpit hooks for skills management
 *
 * Provides TanStack Query hooks for listing, executing, and monitoring skills
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export interface SkillDefinition {
  id: string;
  name: string;
  category: string;
  description: string;
}

export interface SkillMetrics {
  totalExecutions: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  avgExecutionTime: number;
}

export interface SkillMetadata {
  skillId: string;
  name: string;
  category: string;
  description: string;
  metrics: SkillMetrics;
}

export interface SkillExecutionRecord {
  timestamp: string;
  duration: number;
  status: 'success' | 'failed';
  success: boolean;
  error: string | null;
}

export interface SkillDetail {
  skillId: string;
  definition: SkillDefinition;
  metadata: SkillMetadata;
  executionHistory: SkillExecutionRecord[];
}

export interface SkillRegistryReport {
  totalSkills: number;
  categories: number;
  skillsByCategory: Record<string, number>;
  skills: SkillDefinition[];
}

/**
 * Get list of all skills
 */
export function useSkills() {
  return useQuery({
    queryKey: ['skills'],
    queryFn: async () => {
      const response = await fetch('/api/v1/skills', {
        headers: {
          'X-CSRF-Token': document.cookie
            .split('; ')
            .find(row => row.startsWith('jv-csrf='))
            ?.split('=')[1] || ''
        }
      });
      if (!response.ok) throw new Error('Failed to fetch skills');
      const data = await response.json();
      return data.skills as SkillDefinition[];
    },
    refetchInterval: 60_000 // Refresh every 60s
  });
}

/**
 * Get single skill details
 */
export function useSkill(skillId: string) {
  return useQuery({
    queryKey: ['skills', skillId],
    queryFn: async () => {
      const response = await fetch(`/api/v1/skills/${skillId}`, {
        headers: {
          'X-CSRF-Token': document.cookie
            .split('; ')
            .find(row => row.startsWith('jv-csrf='))
            ?.split('=')[1] || ''
        }
      });
      if (!response.ok) throw new Error(`Failed to fetch skill ${skillId}`);
      return (await response.json()) as SkillDetail;
    }
  });
}

/**
 * Execute a skill
 */
export function useExecuteSkill() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (variables: {
      skillId: string;
      input: any;
    }) => {
      const response = await fetch(`/api/v1/skills/${variables.skillId}/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': document.cookie
            .split('; ')
            .find(row => row.startsWith('jv-csrf='))
            ?.split('=')[1] || ''
        },
        body: JSON.stringify({
          input: variables.input
        })
      });
      if (!response.ok) throw new Error('Failed to execute skill');
      return await response.json();
    },
    onSuccess: (_data, variables) => {
      // Invalidate skill queries to refresh
      queryClient.invalidateQueries({ queryKey: ['skills', variables.skillId] });
      queryClient.invalidateQueries({ queryKey: ['skills'] });
    }
  });
}

/**
 * Get skills registry report
 */
export function useSkillsRegistry() {
  return useQuery({
    queryKey: ['skills-registry-report'],
    queryFn: async () => {
      const response = await fetch('/api/v1/skills/registry/report', {
        headers: {
          'X-CSRF-Token': document.cookie
            .split('; ')
            .find(row => row.startsWith('jv-csrf='))
            ?.split('=')[1] || ''
        }
      });
      if (!response.ok) throw new Error('Failed to fetch skills registry');
      return (await response.json()) as SkillRegistryReport;
    },
    refetchInterval: 120_000 // Refresh every 2 minutes
  });
}

/**
 * Get skills by category
 */
export function useSkillsByCategory(category: string) {
  const { data: skills } = useSkills();

  return {
    data: skills?.filter(s => s.category === category) || [],
    isLoading: !skills
  };
}
