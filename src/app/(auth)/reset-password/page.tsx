'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import AuthBackground from '@/components/auth/AuthBackground';
import { api, ApiError } from '@/lib/api';
import styles from '../auth.module.css';

const BACKGROUNDS = [
  'https://images.unsplash.com/photo-1490730141103-6cac27aaab94?w=1920&q=80',
  'https://images.unsplash.com/photo-1475924156734-496f6cac6ec1?w=1920&q=80',
  'https://images.unsplash.com/photo-1433086966358-54859d0ed716?w=1920&q=80',
  'https://images.unsplash.com/photo-1470252649378-9c29740c9fa8?w=1920&q=80',
  'https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?w=1920&q=80',
];

const EyeIcon = ({ open }: { open: boolean }) =>
  open ? (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );

interface ValidateResponse {
  valid: boolean;
}

interface ResetResponse {
  success: true;
  message?: string;
}

type Phase = 'checking' | 'invalid' | 'ready' | 'done';

function ResetPasswordInner() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [phase, setPhase] = useState<Phase>('checking');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Validate the reset token on mount.
  useEffect(() => {
    if (!token) {
      setPhase('invalid');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const data = await api.get<ValidateResponse>(
          `/api/auth/validate-reset-token?token=${encodeURIComponent(token)}`,
          { auth: false },
        );
        if (cancelled) return;
        setPhase(data.valid ? 'ready' : 'invalid');
      } catch {
        if (!cancelled) setPhase('invalid');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!password) {
      setError('Please enter a new password.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      await api.post<ResetResponse>(
        '/api/auth/reset-password',
        { token, newPassword: password },
        { auth: false },
      );
      setPhase('done');
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Connection error. Please check your internet and try again.',
      );
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className={styles.waveBar} />
      <div className={styles.row}>
        <div className={styles.formPanel}>
          <div className={styles.formContent}>
            <div className={styles.logo}>
              <Link href="/">
                <img src="/brand/brand-logo.png" alt="JubileeVerse" className={styles.logoImg} />
                <div className={styles.logoText}>
                  Jubilee<span className={styles.verse}>Verse</span>
                  <span>.com</span>
                </div>
              </Link>
            </div>

            {phase === 'checking' ? (
              <div className={styles.stateContent}>
                <span className={styles.spinner} />
                <p>Verifying your reset link...</p>
              </div>
            ) : null}

            {phase === 'invalid' ? (
              <div className={styles.stateContent}>
                <svg viewBox="0 0 24 24" width="80" height="80" fill="none" stroke="#f87171" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="15" y1="9" x2="9" y2="15" />
                  <line x1="9" y1="9" x2="15" y2="15" />
                </svg>
                <h2>Invalid or Expired Link</h2>
                <p>
                  This password reset link is no longer valid. Reset links expire for your security —
                  please request a new one.
                </p>
                <Link href="/forgot-password" className={styles.submit} style={{ display: 'inline-block', textDecoration: 'none' }}>
                  Request a New Link
                </Link>
              </div>
            ) : null}

            {phase === 'ready' ? (
              <>
                <h2 className={styles.title}>Reset your password</h2>
                <p className={styles.subtitle}>Choose a new password for your account.</p>

                {error ? (
                  <div className={`${styles.alert} ${styles.alertError}`} role="alert">
                    {error}
                  </div>
                ) : null}

                <form onSubmit={submit} noValidate>
                  <div className={styles.floatingGroup}>
                    <div className={styles.passwordWrapper}>
                      <input
                        type={showPw ? 'text' : 'password'}
                        className={styles.control}
                        placeholder=" "
                        autoComplete="new-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                      />
                      <label className={styles.floatingLabel}>New Password</label>
                      <button
                        type="button"
                        className={styles.btnEye}
                        onClick={() => setShowPw((v) => !v)}
                        aria-label="Toggle password visibility"
                      >
                        <EyeIcon open={!showPw} />
                      </button>
                    </div>
                  </div>

                  <div className={styles.floatingGroup}>
                    <div className={styles.passwordWrapper}>
                      <input
                        type={showConfirm ? 'text' : 'password'}
                        className={styles.control}
                        placeholder=" "
                        autoComplete="new-password"
                        value={confirm}
                        onChange={(e) => setConfirm(e.target.value)}
                      />
                      <label className={styles.floatingLabel}>Confirm Password</label>
                      <button
                        type="button"
                        className={styles.btnEye}
                        onClick={() => setShowConfirm((v) => !v)}
                        aria-label="Toggle password visibility"
                      >
                        <EyeIcon open={!showConfirm} />
                      </button>
                    </div>
                  </div>

                  <button type="submit" className={styles.submit} disabled={submitting}>
                    {submitting ? (
                      <>
                        <span className={styles.spinner} /> Resetting...
                      </>
                    ) : (
                      'Reset Password'
                    )}
                  </button>
                </form>

                <div className={styles.backLink}>
                  <Link href="/signin">Back to Sign In</Link>
                </div>
              </>
            ) : null}

            {phase === 'done' ? (
              <div className={styles.stateContent}>
                <svg viewBox="0 0 24 24" width="80" height="80" fill="none" stroke="#4ade80" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M9 12l2 2 4-4" />
                </svg>
                <h2>Password Reset</h2>
                <p>Your password has been updated. You can now sign in with your new password.</p>
                <Link href="/signin" className={styles.submit} style={{ display: 'inline-block', textDecoration: 'none' }}>
                  Go to Sign In
                </Link>
              </div>
            ) : null}

            <div className={styles.footer}>
              <p className={styles.copyright}>
                &copy; {new Date().getFullYear()} JubileeVerse.com |{' '}
                <Link href="/terms" target="_blank" rel="noopener noreferrer">
                  Terms of Use
                </Link>{' '}
                |{' '}
                <Link href="/privacy" target="_blank" rel="noopener noreferrer">
                  Privacy Policy
                </Link>
              </p>
            </div>
          </div>
        </div>

        <AuthBackground
          images={BACKGROUNDS}
          quote={'"Create in me a pure heart, O God, and renew a steadfast spirit within me."'}
          cite="Psalm 51:10"
        />
      </div>
    </>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className={styles.waveBar} />}>
      <ResetPasswordInner />
    </Suspense>
  );
}
