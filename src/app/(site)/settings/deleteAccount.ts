/**
 * Pure helpers for the Delete Account flow.
 *
 * Deliberately JSX-free and dependency-light so the server-side Jest suite can
 * drive this file through ts.transpileModule + vm, the way
 * server/tests/unit/nav-categories.test.js already does for other src/**\/*.ts
 * files. That pattern handles plain TypeScript but not JSX, which is why the
 * riskiest logic in the dialog lives here rather than in the component.
 *
 * The confirmation itself is now a yes/no question with nothing to validate, so
 * what used to live here — the typed-address match that armed the destructive
 * button — is gone along with the field it guarded.
 */

/** Shape of the only ApiError field this module needs. Avoids importing the class. */
export interface DeletionError {
  status?: number;
  message?: string;
}

/**
 * Map a failure onto something a person can act on.
 *
 * Every message says or implies that nothing was deleted. In a flow with no undo,
 * that reassurance matters more than describing the fault: the user's first
 * question after an error is always "did it half-happen?". That is also why the
 * unmapped-status branch is not a shrug — an unrecognised code still has to
 * answer the only question being asked.
 */
export function deleteAccountErrorMessage(err: unknown): string {
  const e = err as DeletionError | null;
  const status = e && typeof e.status === 'number' ? e.status : undefined;

  switch (status) {
    case 401:
      // No longer a wrong password — there is no password field. The session is
      // stale or was revoked elsewhere, and signing in again is the way out.
      return 'Your session has expired. Please sign in again — nothing has been deleted.';
    case 403:
      return "Accounts with editorial access can't be deleted here. Please contact us and we'll help.";
    case 429:
      // The server's own message carries the retry window, so prefer it.
      return e?.message || 'Too many attempts. Please wait a few minutes and try again.';
    case 503:
      // An unavailable tombstone table or an unreachable Identity Authority.
      // Listed ahead of the 5xx branch below deliberately: this one is transient
      // and waiting genuinely fixes it, which "something went wrong on our end"
      // does not tell anybody.
      return 'We could not complete this just now. Nothing has been deleted — please try again in a few minutes.';
    default:
      break;
  }
  if (status && status >= 500) {
    return 'Something went wrong on our end and nothing was deleted. Please try again.';
  }
  if (status) {
    // Anything the endpoint grows later. Nothing was touched, which is the part
    // the user needs to hear even when we cannot say why.
    return 'We could not complete this just now. Nothing has been deleted — please try again in a few minutes.';
  }
  // Matches the house string used elsewhere on this page for a thrown non-ApiError.
  return 'Network error';
}
