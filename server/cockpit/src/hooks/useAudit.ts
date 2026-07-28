/**
 * useAudit.ts — TanStack Query hooks for the Audit Module (Part 6 S11-S17)
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getAuditQueue, getAuditResults, rerunAudit, rewriteForAudit,
  listAuditRubrics, createAuditRubric, updateAuditRubric,
  getSelfTestResults, runSelfTests,
  getPendingReview, approveContent, rejectContent, publishContent,
  getReviewContent,
} from '../lib/api'
import type { AuditRubric } from '../types/content-objects'

const auditKeys = {
  queue:       (status?: string) => ['audit', 'queue', status] as const,
  results:     (objectId: string) => ['audit', 'results', objectId] as const,
  rubrics:     () => ['audit', 'rubrics'] as const,
  selfTest:    () => ['audit', 'self-test'] as const,
  pending:     (type?: string) => ['audit', 'pending-review', type] as const,
  reviewItem:  (id: string) => ['audit', 'review', id] as const,
}

export function useAuditQueue(status?: string, auditType?: string) {
  return useQuery({
    queryKey: auditKeys.queue(status),
    queryFn: () => getAuditQueue({ status, audit_type: auditType, limit: 100 }),
    staleTime: 15_000,
    refetchInterval: 30_000,
  })
}

export function useAuditResults(objectId: string | null) {
  return useQuery({
    queryKey: auditKeys.results(objectId ?? ''),
    queryFn: () => getAuditResults(objectId!),
    enabled: !!objectId,
    staleTime: 30_000,
  })
}

export function useRerunAudit() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (objectId: string) => rerunAudit(objectId),
    onSuccess: (_, objectId) => {
      qc.invalidateQueries({ queryKey: auditKeys.results(objectId) })
      qc.invalidateQueries({ queryKey: auditKeys.queue() })
      qc.invalidateQueries({ queryKey: auditKeys.pending() })
    },
  })
}

export function useRewriteForAudit() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (objectId: string) => rewriteForAudit(objectId),
    onSuccess: (_, objectId) => {
      qc.invalidateQueries({ queryKey: auditKeys.results(objectId) })
      qc.invalidateQueries({ queryKey: auditKeys.queue() })
    },
  })
}

export function useAuditRubrics() {
  return useQuery({
    queryKey: auditKeys.rubrics(),
    queryFn: listAuditRubrics,
    staleTime: 60_000,
    select: d => d.rubrics,
  })
}

export function useCreateAuditRubric() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Partial<AuditRubric>) => createAuditRubric(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: auditKeys.rubrics() }),
  })
}

export function useUpdateAuditRubric() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<AuditRubric> }) => updateAuditRubric(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: auditKeys.rubrics() }),
  })
}

export function useSelfTestResults() {
  return useQuery({
    queryKey: auditKeys.selfTest(),
    queryFn: getSelfTestResults,
    staleTime: 30_000,
  })
}

export function useRunSelfTests() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => runSelfTests(),
    onSuccess: () => setTimeout(() => qc.invalidateQueries({ queryKey: auditKeys.selfTest() }), 3000),
  })
}

// ── Publishing Workflow ────────────────────────────────────────────────────────

export function usePendingReview(objectType?: string) {
  return useQuery({
    queryKey: auditKeys.pending(objectType),
    queryFn: () => getPendingReview({ object_type: objectType, limit: 100 }),
    staleTime: 10_000,
    refetchInterval: 15_000,
  })
}

export function useApproveContent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (objectId: string) => approveContent(objectId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: auditKeys.pending() })
      qc.invalidateQueries({ queryKey: auditKeys.queue() })
    },
  })
}

export function useRejectContent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ objectId, reason }: { objectId: string; reason: string }) => rejectContent(objectId, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: auditKeys.pending() })
      qc.invalidateQueries({ queryKey: auditKeys.queue() })
    },
  })
}

export function usePublishContent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (objectId: string) => publishContent(objectId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: auditKeys.pending() })
      qc.invalidateQueries({ queryKey: auditKeys.queue() })
    },
  })
}

export function useReviewContent(objectId: string | null) {
  return useQuery({
    queryKey: auditKeys.reviewItem(objectId ?? ''),
    queryFn: () => getReviewContent(objectId!),
    enabled: !!objectId,
    staleTime: 30_000,
  })
}
