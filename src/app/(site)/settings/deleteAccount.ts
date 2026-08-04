/**
 * Pure helpers for the Delete Account flow.
 *
 * Deliberately JSX-free and dependency-light so the server-side Jest suite can
 * drive this file through ts.transpileModule + vm, the way
 * server/tests/unit/nav-categories.test.js already does for other src/**\/*.ts
 * files. That pattern handles plain TypeScript but not JSX, which is why the
 * riskiest logic in the dialog lives here rather than in the component.
 */

/** Shape of the only ApiError field this module needs. Avoids importing the class. */
export interface DeletionError {
  status?: number;
  message?: string;
}

export interface ConfirmState {
  password: string;
  typedEmail: string;
  accountEmail: string;
  deleting: boolean;
}

/**
 * May the destructive button be pressed?
 *
 * Both sides are trimmed and lowercased. The cockpit's equivalent
 * (UserEditorPanel.tsx) compares raw strings, which rejects a pasted address
 * carrying a trailing space and an iOS-autocapitalised first letter — the button
 * simply stays dead with no explanation for someone who has already decided. The
 * confirmation's job is to prove deliberateness, not to test typing accuracy, and
 * the backend normalises identically before comparing.
 */
export function canConfirmDeletion({
  password,
  typedEmail,
  accountEmail,
  deleting,
}: ConfirmState): boolean {
  if (deleting) return false;
  if (!password) return false;
  const target = accountEmail.trim().toLowerCase();
  // Guard the degenerate case: if the account email has not loaded yet, an empty
  // input must not satisfy an empty target and arm the button.
  if (!target) return false;
  return typedEmail.trim().toLowerCase() === target;
}

/**
 * Map a failure onto something a person can act on.
 *
 * Every message says or implies that nothing was deleted. In a flow with no undo,
 * that reassurance matters more than describing the fault: the user's first
 * question after an error is always "did it half-happen?".
 */
export function deleteAccountErrorMessage(err: unknown): string {
  const e = err as DeletionError | null;
  const status = e && typeof e.status === 'number' ? e.status : undefined;

  switch (status) {
    case 400:
      return 'The email you typed does not match the email on this account.';
    case 401:
      return "That password doesn't match. Please try again — nothing has been deleted.";
    case 403:
      return "Accounts with editorial access can't be deleted here. Please contact us and we'll help.";
    case 409:
      return 'This account has no password set, so we cannot verify it. Please set a password first.';
    case 429:
      // The server's own message carries the retry window, so prefer it.
      return e?.message || 'Too many attempts. Please wait a few minutes and try again.';
    case 501:
      return 'Account deletion is not available at the moment. Please check back soon.';
    case 503:
      return 'We could not confirm your identity just now. Nothing has been deleted — please try again in a few minutes.';
    default:
      break;
  }
  if (status && status >= 500) {
    return 'Something went wrong on our end and nothing was deleted. Please try again.';
  }
  // Matches the house string used elsewhere on this page for a thrown non-ApiError.
  return 'Network error';
}
