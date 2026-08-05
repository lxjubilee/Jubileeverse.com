'use client';

/**
 * DELETE ACCOUNT — confirmation dialog.
 *
 * A plain yes/no question. There is no password field and no type-your-address
 * field: the only thing asked for is a deliberate answer. What that costs is
 * written down at POST /api/auth/account/delete in server.js — the session alone
 * now authorises an irreversible action — and the decision to accept that cost
 * was a product one, so do not re-add the fields here without changing the
 * endpoint back too.
 *
 * Deletion is immediate and irreversible: there is no grace period and no undo.
 * One sentence therefore has to survive any future trim of this copy — that it
 * cannot be undone. A confirm dialog someone clicks through on reflex is worth
 * nothing if it never said what it was confirming.
 *
 * The dialog deliberately says nothing about the Jubilee ID
 * (sso.jubileeinspire.com), which is a separate family-wide account and is NOT
 * deleted here. That is a product decision about how much a confirm popup should
 * carry, not an oversight: a reader who deletes their JubileeVerse account can
 * still sign in to the other Jubilee sites, and will discover that by doing it.
 *
 * POST /api/auth/account/delete { reason? } -> { success }
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Modal from '@/components/ui/Modal';
import { api } from '@/lib/api';
import { deleteAccountErrorMessage } from './deleteAccount';
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
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  // Two-phase visibility. The parent mounts this component only while the dialog
  // is open, and Modal's closed state is opacity:0 with pointer-events:none —
  // mounting it already closed and flipping it open on the next frame is what
  // keeps the 0.2s fade despite that mount/unmount lifecycle.
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const rootRef = useRef<HTMLDivElement | null>(null);
  // Opening focus goes to No, not Yes. On a dialog whose confirm button is armed
  // from the first frame, a stray Enter or Space arriving with the keystroke that
  // opened it would otherwise land straight on the irreversible action.
  const noRef = useRef<HTMLButtonElement | null>(null);
  // Guards a double-click: onClick fires again before the setDeleting re-render
  // lands, and a second POST would be a second irreversible action.
  const inFlight = useRef(false);

  useDialogA11y(rootRef, {
    labelledBy: TITLE_ID,
    describedBy: DESC_ID,
    initialFocusRef: noRef,
    returnFocusTo,
  });

  const requestClose = useCallback(() => {
    if (deleting) return;
    setVisible(false);
    // Let the fade finish before the parent unmounts us.
    setTimeout(onClose, 200);
  }, [deleting, onClose]);

  const handleDelete = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setDeleting(true);
    setError('');
    try {
      const data = await api.post<DeleteResponse>('/api/auth/account/delete', {});
      onDeleted({ newsletterUnsubscribed: data?.newsletterUnsubscribed });
      // Deliberately no setDeleting(false): the parent replaces this whole view.
    } catch (err) {
      setError(deleteAccountErrorMessage(err));
      inFlight.current = false;
      setDeleting(false);
      // Back to the safe button, which is also where the new error message is
      // announced from — nothing has been deleted and the choice is open again.
      noRef.current?.focus();
    }
  }, [onDeleted]);

  return (
    <Modal
      open={visible}
      // Blocking onClose covers Escape and backdrop click in one place.
      onClose={deleting ? NOOP : requestClose}
      footer={
        <div className={styles.dialogActions}>
          <button
            type="button"
            ref={noRef}
            className={`${styles.btn} ${styles.btnOutline}`}
            onClick={requestClose}
            disabled={deleting}
          >
            No, keep my account
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnDanger}`}
            onClick={() => void handleDelete()}
            disabled={deleting}
            aria-describedby={DESC_ID}
          >
            {deleting ? 'Deleting...' : 'Yes, delete it'}
          </button>
        </div>
      }
    >
      <div ref={rootRef} className={styles.deleteDialogBody}>
        <h2 id={TITLE_ID} className={styles.deleteDialogTitle}>
          Delete this account?
        </h2>

        <p id={DESC_ID} className={styles.deleteLede}>
          Are you sure you want to delete
          {accountEmail ? (
            <>
              {' '}
              <strong className={styles.confirmEmailValue}>{accountEmail}</strong>
            </>
          ) : (
            ' your JubileeVerse account'
          )}
          ? Your profile, your saved stations, your reactions and your reading history all go with
          it, and <strong>this cannot be undone.</strong>
        </p>

        {/* Always rendered so the live region is registered before it has text —
            a region that mounts WITH content is raced by some screen readers. */}
        <div role="alert" aria-live="assertive" className={styles.deleteError}>
          {error}
        </div>
      </div>
    </Modal>
  );
}
