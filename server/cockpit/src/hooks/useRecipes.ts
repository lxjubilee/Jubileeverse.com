/**
 * hooks/useRecipes.ts — Phase 6 prompt recipe queries
 */
import { useQuery } from '@tanstack/react-query'
import * as api from '../lib/api'

export const recipeKeys = {
  list: () => ['recipes', 'list'] as const,
  slug: (s: string) => ['recipes', s] as const,
}

export function useRecipes() {
  return useQuery({
    queryKey: recipeKeys.list(),
    queryFn:  api.listRecipes,
    staleTime: 10 * 60_000,
  })
}

export function useRecipeBySlug(slug: string | null) {
  return useQuery({
    queryKey: recipeKeys.slug(slug ?? ''),
    queryFn:  () => api.getRecipeBySlug(slug!),
    enabled:  !!slug,
    staleTime: 10 * 60_000,
  })
}
