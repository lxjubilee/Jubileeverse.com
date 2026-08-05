/**
 * Jubilee ID lookup — "does an identity already exist for this email?"
 *
 * Backed by GET /api/auth/lookup, which checks our own users table first and, in
 * SSO mode, asks the shared Identity Authority when we hold no row of our own.
 * Either store is enough to answer "yes". Used to make the auth screens honest:
 * send a first-time visitor to sign-up instead of letting them guess at a
 * password, and send an existing account to sign-in instead of a registration
 * form that would only 409.
 */
import { api } from './api';

export interface JubileeIdLookup {
  /** True when an identity is known for this address. */
  exists: boolean;
  /**
   * False when the authority could not be reached, so `exists` is a guess rather
   * than an answer. Callers decide which way to lean — the two auth screens lean
   * in opposite directions, see below.
   */
  available: boolean;
}

/**
 * Ask whether a Jubilee ID exists for `email`. Never throws; an unreachable
 * authority comes back as `{ exists: false, available: false }`.
 */
export async function lookupJubileeId(email: string): Promise<JubileeIdLookup> {
  if (!email) return { exists: false, available: false };
  try {
    const res = await api.get<Partial<JubileeIdLookup>>(
      `/api/auth/lookup?email=${encodeURIComponent(email)}`,
      { auth: false },
    );
    return { exists: res?.exists === true, available: res?.available !== false };
  } catch {
    return { exists: false, available: false };
  }
}

/**
 * Resolves true when a Jubilee ID exists for `email`.
 *
 * Used by the sign-in screen to disambiguate a 401, where the safe answer on an
 * unavailable lookup is `true` — better to say "incorrect password" than to
 * wrongly tell an existing user they have no account. (Sign-up leans the other
 * way: it fails open to the registration form so an outage cannot block signup.)
 */
export async function hasJubileeId(email: string): Promise<boolean> {
  const { exists, available } = await lookupJubileeId(email);
  return available ? exists : true;
}
