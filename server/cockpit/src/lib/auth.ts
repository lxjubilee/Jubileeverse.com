/// <reference types="vite/client" />

/**
 * Supabase Auth Client — Phase 1 Stub
 *
 * This module is intentionally minimal in Phase 1. Supabase credentials are not
 * yet configured. The auth client is exported as a typed stub so the cockpit
 * compiles cleanly and auth-gated routes can be wired in Phase 3.
 *
 * See ADR 007 (docs/adr/007-authentication.md) for the migration plan.
 */

import { createClient, type SupabaseClient, type User, type Session } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''

/** Supabase client instance. In Phase 1, URL and key are empty — client will not make real requests. */
export const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// ── Auth helpers ──────────────────────────────────────────────────────────────

export async function getSession(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession()
  return data.session
}

export async function getUser(): Promise<User | null> {
  const { data } = await supabase.auth.getUser()
  return data.user
}

export async function signInWithEmail(email: string, password: string) {
  return supabase.auth.signInWithPassword({ email, password })
}

export async function signOut() {
  return supabase.auth.signOut()
}

export function onAuthStateChange(callback: (user: User | null) => void) {
  return supabase.auth.onAuthStateChange((_event, session) => {
    callback(session?.user ?? null)
  })
}
