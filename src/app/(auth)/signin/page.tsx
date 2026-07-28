'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import AuthBackground from '@/components/auth/AuthBackground';
import LegalModals from '@/components/auth/LegalModals';
import { api, ApiError } from '@/lib/api';
import { getStoredAuth, setStoredAuth } from '@/lib/authStorage';
import type { AuthUser } from '@/lib/types';
import styles from '../auth.module.css';

const BACKGROUNDS = [
  'https://images.unsplash.com/photo-1504052434569-70ad5836ab65?w=1920&q=80',
  'https://images.unsplash.com/photo-1473186505569-9c61870c11f9?w=1920&q=80',
  'https://images.unsplash.com/photo-1506157786151-b8491531f063?w=1920&q=80',
  'https://images.unsplash.com/photo-1499002238440-d264edd596ec?w=1920&q=80',
  'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=1920&q=80',
];

/** Shape returned by POST /api/auth/login. */
interface MfaRequiredResponse {
  mfa_required: true;
  message?: string;
}

interface LoginSuccessResponse {
  success: true;
  token: string;
  force_password_reset: boolean;
  user: AuthUser;
}

type LoginResponse = MfaRequiredResponse | LoginSuccessResponse;

const isMfaRequired = (r: LoginResponse): r is MfaRequiredResponse =>
  'mfa_required' in r && r.mfa_required === true;

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

const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

/**
 * Resolve a safe post-login destination from ?redirect= / ?next=. Only same-site
 * relative paths are honored (must start with a single "/" and not "//"), to
 * avoid open-redirect to an external origin. Falls back to "/".
 */
function safeRedirectTarget(): string {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('redirect') || params.get('next') || '';
  if (raw.startsWith('/') && !raw.startsWith('//')) return raw;
  return '/';
}

export default function SignInPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [registered, setRegistered] = useState(false);
  const [legal, setLegal] = useState<'privacy' | 'terms' | null>(null);

  // Already signed in → home. Also read the ?registered=true banner flag.
  useEffect(() => {
    if (getStoredAuth()?.authenticated) {
      window.location.assign('/');
      return;
    }
    const params = new URLSearchParams(window.location.search);
    if (params.get('registered') === 'true') setRegistered(true);
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!email.trim()) {
      setError('Email is required.');
      return;
    }
    if (!isValidEmail(email)) {
      setError('Please enter a valid email.');
      return;
    }
    if (!password) {
      setError('Password is required.');
      return;
    }
    if (mfaRequired && !totp.trim()) {
      setError('Please enter your authentication code.');
      return;
    }

    setSubmitting(true);
    try {
      const body: { email: string; password: string; totp_code?: string } = {
        email: email.trim(),
        password,
      };
      if (mfaRequired && totp.trim()) body.totp_code = totp.trim();

      const data = await api.post<LoginResponse>('/api/auth/login', body, { auth: false });

      if (isMfaRequired(data)) {
        setMfaRequired(true);
        setError(data.message ?? 'Enter the authentication code from your authenticator app.');
        setSubmitting(false);
        return;
      }

      setStoredAuth({ authenticated: true, user: data.user, token: data.token });

      if (data.force_password_reset) {
        window.location.assign('/forgot-password');
        return;
      }
      // Full-page navigation so the AuthProvider re-hydrates from storage.
      window.location.assign(safeRedirectTarget());
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
                <img src="/images/JubileeLogo.png" alt="JubileeVerse" className={styles.logoImg} />
                <div className={styles.logoText}>
                  Jubilee<span className={styles.verse}>Verse</span>
                  <span>.com</span>
                </div>
              </Link>
            </div>

            <div className={styles.welcome}>
              <p>
                New here? <Link href="/signup">Create account</Link>.
              </p>
            </div>

            {registered ? (
              <div className={`${styles.alert} ${styles.alertSuccess}`} role="status">
                Account created — please sign in.
              </div>
            ) : null}

            {error ? (
              <div className={`${styles.alert} ${styles.alertError}`} role="alert">
                {error}
              </div>
            ) : null}

            <form onSubmit={submit} noValidate>
              <div className={styles.floatingGroup}>
                <input
                  type="email"
                  className={styles.control}
                  placeholder=" "
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={mfaRequired}
                />
                <label className={styles.floatingLabel}>Email Address</label>
              </div>

              <div className={styles.floatingGroup}>
                <div className={styles.passwordWrapper}>
                  <input
                    type={showPw ? 'text' : 'password'}
                    className={styles.control}
                    placeholder=" "
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={mfaRequired}
                  />
                  <label className={styles.floatingLabel}>Password</label>
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

              {mfaRequired ? (
                <>
                  <div className={styles.floatingGroup}>
                    <input
                      type="text"
                      className={styles.control}
                      placeholder=" "
                      autoComplete="one-time-code"
                      inputMode="numeric"
                      value={totp}
                      onChange={(e) => setTotp(e.target.value)}
                      autoFocus
                    />
                    <label className={styles.floatingLabel}>Authentication Code</label>
                  </div>
                  <p className={styles.fieldHint}>
                    Enter the 6-digit code from your authenticator app.
                  </p>
                </>
              ) : null}

              <button type="submit" className={styles.submit} disabled={submitting}>
                {submitting ? (
                  <>
                    <span className={styles.spinner} /> Signing In...
                  </>
                ) : (
                  'Sign In'
                )}
              </button>
            </form>

            <div className={styles.secondaryRow}>
              <Link href="/forgot-password">Forgot password?</Link>
              <Link href="/signup">Create account</Link>
            </div>

            <div className={styles.ssoLink}>
              {/* Full navigation: /auth/login is a backend OIDC route (proxied), not a Next page. */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a href="/auth/login">Use single sign-on instead</a>
            </div>

            <div className={styles.footer}>
              <p className={styles.copyright}>
                &copy; {new Date().getFullYear()} JubileeVerse.com |{' '}
                <a href="#" onClick={(e) => (e.preventDefault(), setLegal('terms'))}>
                  Terms of Use
                </a>{' '}
                |{' '}
                <a href="#" onClick={(e) => (e.preventDefault(), setLegal('privacy'))}>
                  Privacy Policy
                </a>
              </p>
            </div>
          </div>
        </div>

        <AuthBackground
          images={BACKGROUNDS}
          quote={'"The Lord is my light and my salvation — whom shall I fear?"'}
          cite="Psalm 27:1"
        />
      </div>

      <LegalModals
        privacyOpen={legal === 'privacy'}
        termsOpen={legal === 'terms'}
        onClose={() => setLegal(null)}
      />
    </>
  );
}
