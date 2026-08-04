'use client';

import { useEffect, type RefObject } from 'react';

/**
 * Supplies the accessibility behaviour a dialog needs and its container does not:
 * an accessible name, initial focus, a Tab trap, and focus restore on close.
 *
 * Two shapes of caller are supported.
 *
 * Mount/unmount dialogs (`@/components/ui/Modal`): Modal gives us role="dialog",
 * aria-modal, Escape-to-close and a body scroll lock, but not an accessible name
 * (its <h3> is not wired up via aria-labelledby) and no focus management at all.
 * Rather than edit that shared component — which docs/MIGRATION-CONVENTIONS.md
 * puts off limits — this hook adopts the dialog node from the outside, reaching
 * it with closest() from a ref on the caller's own first child. That also gets us
 * the `footer` node, which is a SIBLING of Modal's children, so a trap scoped to
 * the caller's subtree would leave the Cancel and Delete buttons outside it.
 *
 * Always-mounted panels (the language slide-out): the panel stays in the DOM and
 * animates open, so there is no mount to hang the effect on. Those pass `active`
 * and put role="dialog" on the ref'd node itself — closest() matches the element
 * it starts from, so the same lookup resolves.
 */
interface Options {
  /** id of the element naming the dialog. */
  labelledBy: string;
  /** id of the element describing it — point this at the irreversibility line. */
  describedBy?: string;
  /** Focused on open. */
  initialFocusRef: RefObject<HTMLElement | null>;
  /** Focused again on close, so keyboard users land back where they started. */
  returnFocusTo?: RefObject<HTMLElement | null>;
  /**
   * Whether the dialog is currently open. Omit for dialogs that unmount when
   * they close — their mount IS the open, so the default of true is correct.
   * Always-mounted panels pass their open flag, and the naming, focus and trap
   * apply only while it holds.
   */
  active?: boolean;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useDialogA11y(
  rootRef: RefObject<HTMLElement | null>,
  { labelledBy, describedBy, initialFocusRef, returnFocusTo, active = true }: Options,
): void {
  useEffect(() => {
    if (!active) return;
    const dialog = rootRef.current?.closest<HTMLElement>('[role="dialog"]');
    if (!dialog) return;

    // Naming the dialog. Without this a screen reader announces an unnamed
    // dialog, which is exactly the moment a user most needs to know what it is.
    dialog.setAttribute('aria-labelledby', labelledBy);
    if (describedBy) dialog.setAttribute('aria-describedby', describedBy);

    // Captured now rather than read during cleanup: by teardown the ref may have
    // been nulled by React, which would silently skip the focus restore.
    const restoreTo = returnFocusTo?.current || (document.activeElement as HTMLElement | null);
    // rAF because the caller mounts Modal closed and flips it open on the next
    // frame to preserve the fade; focusing before that lands on a hidden overlay.
    const raf = requestAnimationFrame(() => initialFocusRef.current?.focus());

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      // Re-queried on every keypress rather than cached: the destructive button
      // flips between disabled and enabled as the user types, so a list captured
      // on mount goes stale and the trap starts skipping or catching on it.
      const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE))
        .filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const activeEl = document.activeElement;

      if (e.shiftKey && (activeEl === first || !dialog.contains(activeEl))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (activeEl === last || !dialog.contains(activeEl))) {
        e.preventDefault();
        first.focus();
      }
    };

    dialog.addEventListener('keydown', onKeyDown);
    return () => {
      cancelAnimationFrame(raf);
      dialog.removeEventListener('keydown', onKeyDown);
      restoreTo?.focus?.();
    };
  }, [rootRef, labelledBy, describedBy, initialFocusRef, returnFocusTo, active]);
}
