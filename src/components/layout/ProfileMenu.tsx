'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth';

/**
 * Auth area in the header: a "Sign In" link when signed out, or a profile
 * avatar with a dropdown (Profile Settings, Back Office, Sign Out) when signed
 * in. Element IDs match the originals so the translation pass still targets them.
 */
export default function ProfileMenu() {
  const { isAuthenticated, isLoading, canAccessCms, initials, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [open]);

  // Avoid a sign-in flash before hydration resolves the stored token.
  if (isLoading) return <span style={{ width: 28 }} aria-hidden />;

  if (!isAuthenticated) {
    return (
      <Link href="/signin" className="btn-sign-in" id="signInBtn">
        Sign In
      </Link>
    );
  }

  return (
    <div className="profile-btn-container" id="profileBtnContainer" ref={containerRef}>
      <button
        className="profile-btn"
        id="profileBtn"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span id="profileInitials">{initials}</span>
      </button>
      <div className={`profile-dropdown${open ? ' open' : ''}`} id="profileDropdown" role="menu">
        <Link href="/settings" className="profile-dropdown-item" id="profileSettingsLink">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
          Profile Settings
        </Link>
        {canAccessCms && (
          <Link href="/admin" className="profile-dropdown-item" id="profileBackOfficeLink">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="7" height="7" />
              <rect x="14" y="3" width="7" height="7" />
              <rect x="14" y="14" width="7" height="7" />
              <rect x="3" y="14" width="7" height="7" />
            </svg>
            Back Office
          </Link>
        )}
        <div className="profile-dropdown-divider" />
        <button
          type="button"
          className="profile-dropdown-item"
          id="profileSignOut"
          onClick={() => {
            setOpen(false);
            signOut();
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          Sign Out
        </button>
      </div>
    </div>
  );
}
