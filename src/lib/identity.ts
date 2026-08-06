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

/** What sign-in hands to sign-up when the visitor holds a Jubilee ID but no account here. */
export interface SignupPrefill {
  email: string;
  /** Already verified by the Identity Authority — see the one-shot note below. */
  password: string;
  first_name?: string;
  last_name?: string;
  date_of_birth?: string;
}

const SIGNUP_PREFILL_KEY = 'jubileeVerseSignupPrefill';

/**
 * Hand a verified sign-in attempt over to the sign-up screen.
 *
 * Sign-in has just learned that the password is RIGHT and there is simply no
 * JubileeVerse account behind it. Sending them to a bare sign-up page would throw
 * that away and ask for everything again, so the verified password and the profile
 * the authority returned travel with them and land on a filled-in create form.
 *
 * sessionStorage, not a query string: a password must never reach the URL bar,
 * browser history, or a referrer header. It is scoped to this tab and read exactly
 * once — see readSignupPrefill.
 */
export function writeSignupPrefill(data: SignupPrefill): void {
  try {
    window.sessionStorage.setItem(SIGNUP_PREFILL_KEY, JSON.stringify(data));
  } catch {
    /* storage blocked — sign-up will ask for the password again, which still works */
  }
}

/**
 * Drain the hand-off. Removed on read whether or not it parses, so a verified
 * password never survives the navigation that consumed it — a reload afterwards
 * gets the ordinary entry step instead of a form still holding a live credential.
 */
export function readSignupPrefill(): SignupPrefill | null {
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(SIGNUP_PREFILL_KEY);
    if (raw) window.sessionStorage.removeItem(SIGNUP_PREFILL_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SignupPrefill>;
    if (!parsed?.email || !parsed?.password) return null;
    return {
      email: parsed.email,
      password: parsed.password,
      first_name: parsed.first_name || '',
      last_name: parsed.last_name || '',
      date_of_birth: (parsed.date_of_birth || '').slice(0, 10),
    };
  } catch {
    return null;
  }
}
