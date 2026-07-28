/**
 * hooks/useOAuthTokens.ts — OAuth / API-key token management (Section 11)
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import * as api from '../lib/api'

const TOKEN_KEY = ['oauth-tokens'] as const

export function useOAuthTokens() {
  return useQuery({
    queryKey: TOKEN_KEY,
    queryFn:  api.listOAuthTokens,
    staleTime: 60_000,
  })
}

export function useOAuthProviders() {
  return useQuery({
    queryKey: ['oauth-providers'],
    queryFn:  api.getOAuthProviders,
    staleTime: Infinity,   // providers list is static
  })
}

export function useValidateApiKey() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ provider, api_key }: { provider: string; api_key: string }) =>
      api.validateApiKey(provider, api_key),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: TOKEN_KEY })
    },
  })
}

export function useRevokeOAuthToken() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.revokeOAuthToken(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: TOKEN_KEY })
    },
  })
}
