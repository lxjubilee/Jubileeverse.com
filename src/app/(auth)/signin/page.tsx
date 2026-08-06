'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import AuthBackground from '@/components/auth/AuthBackground';
import LegalModals from '@/components/auth/LegalModals';
import { api, ApiError } from '@/lib/api';
import { getStoredAuth, setStoredAuth } from '@/lib/authStorage';
import { hasJubileeId } from '@/lib/identity';
import { safeRedirectTarget } from '@/lib/redirect';
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
  refreshToken?: string;
  expiresAt?: string;
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
 * "Keep me signed in" does two things: it prefills the email on the next visit,
 * and it is sent to the server as `rememberMe`, which selects the long (1 year vs
 * 30 day) refresh-token lifetime. The tokens themselves always live under
 * localStorage["jubileeVerseAuth"] either way.
 */
const REMEMBERED_EMAIL_KEY = 'jubileeVerseRememberedEmail';

/**
 * The login route's "the credential is valid but you have no account here" answer,
 * sent as 404 { needsSignup: true }. Read from the body rather than trusting the
 * status alone: a bare 404 could equally be a mis-routed request, and telling
 * someone to sign up when the API simply moved would be worse than a generic error.
 */
function isNeedsSignup(body: unknown): boolean {
  return typeof body === 'object' && body !== null && (body as { needsSignup?: unknown }).needsSignup === true;
}

function readRememberedEmail(): string {
  try {
    return window.localStorage.getItem(REMEMBERED_EMAIL_KEY) ?? '';
  } catch {
    return '';
  }
}

function writeRememberedEmail(value: string | null): void {
  try {
    if (value) window.localStorage.setItem(REMEMBERED_EMAIL_KEY, value);
    else window.localStorage.removeItem(REMEMBERED_EMAIL_KEY);
  } catch {
    /* storage unavailable (private mode / blocked) — not fatal */
  }
}

export default function SignInPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
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

    // ?email= is set when sign-up discovers the address already has a Jubilee ID
    // and hands the visitor over here; it wins over the remembered address.
    const handedOver = params.get('email');
    if (handedOver) {
      setEmail(handedOver);
      return;
    }
    const remembered = readRememberedEmail();
    if (remembered) {
      setEmail(remembered);
      setRememberMe(true);
    }
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
      const body: {
        email: string;
        password: string;
        rememberMe: boolean;
        totp_code?: string;
      } = {
        email: email.trim(),
        password,
        rememberMe,
      };
      if (mfaRequired && totp.trim()) body.totp_code = totp.trim();

      const data = await api.post<LoginResponse>('/api/auth/login', body, { auth: false });

      if (isMfaRequired(data)) {
        setMfaRequired(true);
        setError(data.message ?? 'Enter the authentication code from your authenticator app.');
        setSubmitting(false);
        return;
      }

      writeRememberedEmail(rememberMe ? email.trim() : null);
      setStoredAuth({
        authenticated: true,
        user: data.user,
        token: data.token,
        refreshToken: data.refreshToken,
        expiresAt: data.expiresAt,
      });

      if (data.force_password_reset) {
        window.location.assign('/forgot-password');
        return;
      }
      // Full-page navigation so the AuthProvider re-hydrates from storage.
      window.location.assign(safeRedirectTarget());
    } catch (err) {
      // 404 + needsSignup is the unambiguous one: the Identity Authority accepted
      // the password, so the credential is RIGHT — there is simply no JubileeVerse
      // account behind it. That is a family member who has never joined, or someone
      // who deleted their account. Never say "incorrect password" here; they typed
      // it correctly and would retype it forever. The "Sign Up" link already sits
      // in this card's footer, so the message points at it rather than redirecting
      // and throwing away what they typed.
      if (err instanceof ApiError && err.status === 404 && isNeedsSignup(err.body)) {
        setError(err.message || 'No JubileeVerse account for this email. Please sign up.');
        setSubmitting(false);
        return;
      }
      // A 401 is ambiguous: wrong password, or no Jubilee ID at all? Ask the
      // lookup so we can point a first-time visitor at sign-up instead of letting
      // them retype a password they never had.
      if (err instanceof ApiError && err.status === 401) {
        setError(
          (await hasJubileeId(email.trim()))
            ? 'Incorrect password. Please try again.'
            : 'No account found for that email. Please sign up first.',
        );
      } else {
        setError(
          err instanceof ApiError
            ? err.message
            : 'Connection error. Please check your internet and try again.',
        );
      }
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className={styles.waveBar} />
      <div className={styles.row}>
        <div className={`${styles.formPanel} ${styles.formPanelStack}`}>
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

            <div className={styles.welcome}>
              <p>
                Don&apos;t have an account? <Link href="/signup">Sign Up</Link>.
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

              <div className={styles.secondaryRow}>
                <label className={styles.rememberMe}>
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                  />
                  <span>Keep me signed in on this device</span>
                </label>
                <Link href="/forgot-password">Forgot password?</Link>
              </div>

              <button
                type="submit"
                className={`${styles.submit} ${styles.submitBold}`}
                disabled={submitting}
              >
                {submitting ? (
                  <>
                    <span className={styles.spinner} /> Signing In...
                  </>
                ) : (
                  'Sign In'
                )}
              </button>
            </form>
          </div>

          <div className={`${styles.footer} ${styles.footerBottom}`}>
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
