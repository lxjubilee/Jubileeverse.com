'use client';

/**
 * DELETE ACCOUNT — confirmation dialog.
 *
 * Deletion is immediate and irreversible: there is no grace period and no undo.
 * The copy therefore has two jobs that pull against each other — be kind about a
 * person leaving, and be completely unambiguous that nothing comes back. Warmth
 * lives in the framing; the facts are stated flat.
 *
 * The user's Jubilee ID (sso.jubileeinspire.com) is a SEPARATE, family-wide
 * account and is deliberately not touched. Saying so is not a legal footnote —
 * without it, "delete my account" reads as "remove me from every Jubilee site",
 * and the user finds out otherwise by still being able to sign in elsewhere.
 *
 * POST /api/auth/account/delete { password, confirmEmail, reason? } -> { success }
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Modal from '@/components/ui/Modal';
import { api } from '@/lib/api';
import { canConfirmDeletion, deleteAccountErrorMessage } from './deleteAccount';
import { useDialogA11y } from '@/hooks/useDialogA11y';
import styles from './settings.module.css';

interface Props {
  /** The SAVED account email — never the unsaved Profile-tab input. */
  accountEmail: string;
  onClose: () => void;
  onDeleted: (result: { newsletterUnsubscribed?: boolean }) => void;
  returnFocusTo: React.RefObject<HTMLButtonElement | null>;
}

interface DeleteResponse {
  success?: boolean;
  deleted?: boolean;
  newsletterUnsubscribed?: boolean;
}

const NOOP = () => {};
const TITLE_ID = 'deleteAccountTitle';
const DESC_ID = 'deleteAccountIrreversible';

export default function DeleteAccountDialog({
  accountEmail,
  onClose,
  onDeleted,
  returnFocusTo,
}: Props) {
  const [password, setPassword] = useState('');
  const [typedEmail, setTypedEmail] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  // Two-phase visibility. The parent mounts this component only while the dialog
  // is open — Modal's closed state is opacity:0 with pointer-events:none, which
  // leaves its children in the DOM, focusable, and inside aria-hidden="true". A
  // password field living there permanently is both an axe violation and
  // something password managers offer to fill on a page with no login form.
  // Mounting Modal already closed and flipping it open on the next frame keeps
  // the 0.2s fade without keeping the form alive.
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const passwordRef = useRef<HTMLInputElement | null>(null);
  // Guards a double-click: onClick fires again before the setDeleting re-render
  // lands, and a second POST would be a second irreversible action.
  const inFlight = useRef(false);

  useDialogA11y(rootRef, {
    labelledBy: TITLE_ID,
    describedBy: DESC_ID,
    initialFocusRef: passwordRef,
    returnFocusTo,
  });

  const requestClose = useCallback(() => {
    if (deleting) return;
    setVisible(false);
    // Let the fade finish before the parent unmounts us.
    setTimeout(onClose, 200);
  }, [deleting, onClose]);

  const canConfirm = canConfirmDeletion({ password, typedEmail, accountEmail, deleting });

  const handleDelete = useCallback(async () => {
    if (inFlight.current || !canConfirm) return;
    inFlight.current = true;
    setDeleting(true);
    setError('');
    try {
      const data = await api.post<DeleteResponse>('/api/auth/account/delete', {
        password,
        confirmEmail: typedEmail.trim(),
      });
      onDeleted({ newsletterUnsubscribed: data?.newsletterUnsubscribed });
      // Deliberately no setDeleting(false): the parent replaces this whole view.
    } catch (err) {
      setError(deleteAccountErrorMessage(err));
      setPassword('');
      passwordRef.current?.focus();
      inFlight.current = false;
      setDeleting(false);
    }
  }, [canConfirm, password, typedEmail, onDeleted]);

  return (
    <Modal
      open={visible}
      // Blocking onClose covers Escape and backdrop click in one place.
      onClose={deleting ? NOOP : requestClose}
      footer={
        <div className={styles.dialogActions}>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnOutline}`}
            onClick={requestClose}
            disabled={deleting}
          >
            Keep my account
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnDanger}`}
            onClick={() => void handleDelete()}
            disabled={!canConfirm}
            aria-describedby={DESC_ID}
          >
            {deleting ? 'Deleting...' : 'Delete my account permanently'}
          </button>
        </div>
      }
    >
      <div ref={rootRef} className={styles.deleteDialogBody}>
        <h2 id={TITLE_ID} className={styles.deleteDialogTitle}>
          Delete your JubileeVerse account
        </h2>

        <p id={DESC_ID} className={styles.deleteLede}>
          We&rsquo;re sorry to see you go, and we&rsquo;re grateful for the time you spent here.
          Please read this before you continue — <strong>this cannot be undone.</strong>
        </p>

        <div className={styles.deleteWarning}>
          <p className={styles.deleteListTitle}>What we delete, immediately and permanently</p>
          <ul className={styles.deleteList}>
            <li>Your profile — your name, your email address, and your role</li>
            <li>Your saved radio stations and the stations you follow</li>
            <li>Your reactions and your reading history</li>
            <li>Your newsletter subscription</li>
            <li>Every device you are currently signed in on</li>
          </ul>
          <p className={styles.deleteLede}>
            There is no waiting period and no way to bring it back. We do not keep a copy for you.
          </p>
        </div>

        <div className={styles.jubileeIdNote}>
          <p className={styles.deleteListTitle}>What this does not do</p>
          <ul className={styles.keepsList}>
            <li>
              <strong>Your Jubilee ID stays.</strong> Your sign-in for the wider Jubilee family is a
              separate account, so you will still be able to sign in to other Jubilee sites with the
              same email and password.
            </li>
            <li>
              If you ever want to come back, you can create a new JubileeVerse account with the same
              Jubilee ID — it will simply start over from nothing.
            </li>
          </ul>
        </div>

        {/* Bare label/input: settings.module.css styles them via the descendant
            selectors `.formGroup label` and `.formGroup input`, and `input[readonly]`
            already carries the muted treatment used while a request is in flight. */}
        <div className={styles.formGroup}>
          <label htmlFor="deleteConfirmPassword">Your password</label>
          <input
            id="deleteConfirmPassword"
            ref={passwordRef}
            type="password"
            autoComplete="current-password"
            value={password}
            readOnly={deleting}
            onChange={(e) => setPassword(e.target.value)}
          />
          <p className={styles.hint}>The password you use to sign in.</p>
        </div>

        <div className={styles.formGroup}>
          <label htmlFor="deleteConfirmEmail">Type your email address to confirm</label>
          <input
            id="deleteConfirmEmail"
            // Not type="email": a browser validation bubble on a confirmation field
            // is noise, and iOS autocapitalise/autocorrect would break the match.
            type="text"
            inputMode="email"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            value={typedEmail}
            readOnly={deleting}
            onChange={(e) => setTypedEmail(e.target.value)}
            aria-describedby="deleteConfirmEmailHint"
          />
          <p id="deleteConfirmEmailHint" className={styles.hint}>
            Type <strong className={styles.confirmEmailValue}>{accountEmail}</strong> to enable the
            button below.
          </p>
        </div>

        {/* Always rendered so the live region is registered before it has text —
            a region that mounts WITH content is raced by some screen readers. */}
        <div role="alert" aria-live="assertive" className={styles.deleteError}>
          {error}
        </div>
      </div>
    </Modal>
  );
}
