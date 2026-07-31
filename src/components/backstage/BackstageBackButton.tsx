'use client';

import { useRouter } from 'next/navigation';

/**
 * Back control over the article hero. Ported from JubiLujah's
 * BackstageBackButton.
 *
 * Uses history only when the reader arrived from this site; a direct hit from
 * search or a shared link has nothing useful behind it, so those go to the
 * Backstage index instead of bouncing the reader off the site.
 */
export default function BackstageBackButton() {
  const router = useRouter();

  const goBack = () => {
    try {
      if (document.referrer && new URL(document.referrer).host === window.location.host) {
        router.back();
        return;
      }
    } catch {
      /* malformed referrer, fall through */
    }
    router.push('/backstage');
  };

  return (
    <button type="button" className="bsa-back" onClick={goBack} aria-label="Go back">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M19 12H5M12 19l-7-7 7-7" />
      </svg>
      <span>Back</span>
    </button>
  );
}
