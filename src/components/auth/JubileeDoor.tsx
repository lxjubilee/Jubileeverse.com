'use client';

import Link from 'next/link';
import Script from 'next/script';
import { useCallback, useEffect, useRef, useState } from 'react';
import AuthBackground from '@/components/auth/AuthBackground';
import LegalModals from '@/components/auth/LegalModals';
import { api, ApiError } from '@/lib/api';
import { getStoredAuth, setStoredAuth } from '@/lib/authStorage';
import { safeRedirectTarget } from '@/lib/redirect';
import type { AuthUser } from '@/lib/types';
import styles from '@/app/(auth)/auth.module.css';

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || '';

declare global {
  // eslint-disable-next-line no-var
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      remove: (id: string) => void;
    };
  }
}

const BACKGROUNDS = [
  'https://images.unsplash.com/photo-1504052434569-70ad5836ab65?w=1920&q=80',
  'https://images.unsplash.com/photo-1473186505569-9c61870c11f9?w=1920&q=80',
  'https://images.unsplash.com/photo-1506157786151-b8491531f063?w=1920&q=80',
  'https://images.unsplash.com/photo-1499002238440-d264edd596ec?w=1920&q=80',
  'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=1920&q=80',
];

const SITE_NAME = 'JubileeVerse';
const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

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

const CalendarIcon = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="5" width="18" height="16" rx="3" />
    <line x1="3" y1="10" x2="21" y2="10" />
    <line x1="8" y1="3" x2="8" y2="6" />
    <line x1="16" y1="3" x2="16" y2="6" />
  </svg>
);

interface AuthSuccessResponse {
  success: true;
  token: string;
  refreshToken?: string;
  expiresAt?: string;
  force_password_reset?: boolean;
  user: AuthUser;
}
interface MfaRequiredResponse {
  mfa_required: true;
  message?: string;
}
interface NeedsProfileResponse {
  success: false;
  needsProfile: true;
  profile?: { first_name?: string; last_name?: string; date_of_birth?: string };
}
interface RedirectSignupResponse {
  success: false;
  redirect: 'signup';
}
type LoginResponse =
  | AuthSuccessResponse
  | MfaRequiredResponse
  | NeedsProfileResponse
  | RedirectSignupResponse;
interface LookupResponse {
  exists?: boolean;
  existsInSso?: boolean;
  existsLocally?: boolean;
  available?: boolean;
}

const isMfaRequired = (r: LoginResponse): r is MfaRequiredResponse =>
  'mfa_required' in r && r.mfa_required === true;
const isNeedsProfile = (r: LoginResponse): r is NeedsProfileResponse =>
  'needsProfile' in r && r.needsProfile === true;
const isAuthSuccess = (r: LoginResponse): r is AuthSuccessResponse =>
  'token' in r && typeof (r as AuthSuccessResponse).token === 'string';

const REMEMBERED_EMAIL_KEY = 'jubileeVerseRememberedEmail';
function readRememberedEmail(): string {
  try { return window.localStorage.getItem(REMEMBERED_EMAIL_KEY) ?? ''; } catch { return ''; }
}
function writeRememberedEmail(value: string | null): void {
  try {
    if (value) window.localStorage.setItem(REMEMBERED_EMAIL_KEY, value);
    else window.localStorage.removeItem(REMEMBERED_EMAIL_KEY);
  } catch { /* storage unavailable */ }
}

/**
 * The "one door" (Jubilee ID Sign-in guidelines): /signin and /signup render this
 * same email-first flow. Screen 1 asks for the EMAIL only, looks it up at the
 * Jubilee ID authority, then routes —
 *   welcome     : returning JubileeVerse member → password → sign in
 *   confirm     : has a Jubilee ID, new here → confirm password …
 *   createlinked: … then a Create-account screen (First/Last/DOB, no password)
 *   form        : no Jubilee ID → create one (name/DOB/password) → account created
 * TOTP MFA is honored on any /api/auth/login leg (welcome / confirm / createlinked).
 */
type Step = 'email' | 'welcome' | 'confirm' | 'createlinked' | 'form';

export default function JubileeDoor() {
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');       // Jubilee ID pw (welcome/confirm) OR create pw (form)
  const [confirm, setConfirm] = useState('');         // Outcome C only
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dob, setDob] = useState('');
  const [maxDob, setMaxDob] = useState('');
  const [terms, setTerms] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  // TOTP MFA (privileged accounts) — surfaced on whichever login leg demands it.
  const [mfaRequired, setMfaRequired] = useState(false);
  const [totp, setTotp] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorField, setErrorField] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [registered, setRegistered] = useState(false);
  const [legal, setLegal] = useState<'privacy' | 'terms' | null>(null);

  // Already signed in → home. Read ?email= / ?registered= hand-offs.
  useEffect(() => {
    if (getStoredAuth()?.authenticated) {
      window.location.assign('/');
      return;
    }
    const params = new URLSearchParams(window.location.search);
    if (params.get('registered') === 'true') setRegistered(true);
    const handedOver = params.get('email');
    if (handedOver) { setEmail(handedOver); return; }
    const remembered = readRememberedEmail();
    if (remembered) { setEmail(remembered); setRememberMe(true); }
  }, []);

  useEffect(() => { setMaxDob(new Date().toISOString().slice(0, 10)); }, []);

  // ── Cloudflare Turnstile (Screen 1, human verification) ──────────────────
  // Client-side gate only; fail-safe (error-callback + 8s timeout release it) so a
  // widget that can't render never blocks sign-in. The 'normal' 300px widget is
  // CSS-scaled to the wrapper width so it matches the email box.
  const [tnToken, setTnToken] = useState('');
  const [tnFailed, setTnFailed] = useState(false);
  const tnRef = useRef<HTMLDivElement>(null);       // inner 300px render target (scaled)
  const tnBoxRef = useRef<HTMLDivElement>(null);    // outer full-width wrapper (measured)
  const tnWidgetId = useRef<string | null>(null);
  const renderTurnstile = useCallback(() => {
    if (!TURNSTILE_SITE_KEY || !tnRef.current || !window.turnstile || tnWidgetId.current) return;
    tnWidgetId.current = window.turnstile.render(tnRef.current, {
      sitekey: TURNSTILE_SITE_KEY,
      theme: 'dark',
      size: 'normal',
      callback: (t: string) => { setTnToken(t); setTnFailed(false); },
      'error-callback': () => { setTnToken(''); setTnFailed(true); },
      'expired-callback': () => setTnToken(''),
    });
  }, []);
  useEffect(() => {
    if (step === 'email') {
      renderTurnstile();
      const t = setTimeout(() => setTnFailed(true), 8000);
      return () => clearTimeout(t);
    }
    if (TURNSTILE_SITE_KEY && window.turnstile && tnWidgetId.current) {
      try { window.turnstile.remove(tnWidgetId.current); } catch { /* widget gone */ }
    }
    tnWidgetId.current = null;
    setTnToken(''); setTnFailed(false);
  }, [step, renderTurnstile]);
  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || step !== 'email') return;
    const box = tnBoxRef.current, inner = tnRef.current;
    if (!box || !inner) return;
    const TN_W = 300, TN_H = 65;
    const apply = () => {
      const s = box.clientWidth / TN_W;
      inner.style.transform = `scale(${s})`;
      box.style.height = `${TN_H * s}px`;
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(box);
    return () => ro.disconnect();
  }, [step]);

  const resetMessages = () => { setError(null); setErrorField(null); };

  const finish = (data: AuthSuccessResponse) => {
    writeRememberedEmail(rememberMe ? email.trim() : null);
    setStoredAuth({
      authenticated: true,
      user: data.user,
      token: data.token,
      refreshToken: data.refreshToken,
      expiresAt: data.expiresAt,
    });
    window.location.assign(data.force_password_reset ? '/forgot-password' : safeRedirectTarget());
  };

  const failed = (err: unknown, fallback: string) => {
    if (err instanceof ApiError && err.status === 401) setErrorField('password');
    setError(
      err instanceof ApiError
        ? err.status === 401
          ? "That password doesn't match. Please try again."
          : err.message
        : fallback,
    );
    setSubmitting(false);
  };

  const useDifferentEmail = () => {
    setStep('email'); resetMessages(); setNotice(null);
    setMfaRequired(false); setTotp('');
    setPassword(''); setConfirm(''); setFirstName(''); setLastName(''); setDob('');
  };

  const loginBody = (extra: Record<string, unknown>) => {
    const body: Record<string, unknown> = { email: email.trim(), password, rememberMe, ...extra };
    if (mfaRequired && totp.trim()) body.totp_code = totp.trim();
    return body;
  };

  const applyProfile = (p?: { first_name?: string; last_name?: string; date_of_birth?: string }) => {
    setFirstName(p?.first_name || '');
    setLastName(p?.last_name || '');
    setDob((p?.date_of_birth || '').slice(0, 10));
  };

  // ── Screen 1: email → look up the Jubilee ID, then route ──────────────────
  const submitEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    resetMessages(); setNotice(null);
    const addr = email.trim();
    if (!addr) { setErrorField('email'); setError('Email is required.'); return; }
    if (!isValidEmail(addr)) { setErrorField('email'); setError('Please enter a valid email.'); return; }
    if (TURNSTILE_SITE_KEY && !tnToken && !tnFailed) { setError('Please complete the human verification.'); return; }
    setSubmitting(true);
    try {
      const look = await api.get<LookupResponse>(`/api/auth/lookup?email=${encodeURIComponent(addr)}`, { auth: false });
      if (look?.existsLocally) setStep('welcome');        // returning member
      else if (look?.existsInSso) setStep('confirm');     // existing Jubilee ID, new here
      else setStep('form');                               // brand new
    } catch {
      // Fail open to the create form; register re-checks both stores before creating.
      setStep('form');
    } finally { setSubmitting(false); }
  };

  // ── Screen 2A: returning member → verify password → sign in ───────────────
  const submitWelcome = async (e: React.FormEvent) => {
    e.preventDefault();
    resetMessages();
    if (!password) { setErrorField('password'); setError('Password is required.'); return; }
    if (mfaRequired && !totp.trim()) { setError('Please enter your authentication code.'); return; }
    setSubmitting(true);
    try {
      const data = await api.post<LoginResponse>('/api/auth/login', loginBody({}), { auth: false });
      if (isMfaRequired(data)) { setMfaRequired(true); setError(data.message ?? 'Enter the authentication code from your authenticator app.'); setSubmitting(false); return; }
      if (isAuthSuccess(data)) { finish(data); return; }
      if (isNeedsProfile(data)) { applyProfile(data.profile); setNotice(null); setStep('createlinked'); setSubmitting(false); return; }
      setError('We could not sign you in. Please try again.'); setSubmitting(false);
    } catch (err) { failed(err, 'Connection error. Please check your internet and try again.'); }
  };

  // ── Screen 2B-1: existing Jubilee ID, new here → confirm password ─────────
  const submitConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    resetMessages();
    if (!password) { setErrorField('password'); setError('Please enter your Jubilee ID password.'); return; }
    if (mfaRequired && !totp.trim()) { setError('Please enter your authentication code.'); return; }
    setSubmitting(true);
    try {
      const data = await api.post<LoginResponse>('/api/auth/login', loginBody({ preview: true }), { auth: false });
      if (isMfaRequired(data)) { setMfaRequired(true); setError(data.message ?? 'Enter the authentication code from your authenticator app.'); setSubmitting(false); return; }
      if (isAuthSuccess(data)) { finish(data); return; }   // edge: already a member
      if (isNeedsProfile(data)) { applyProfile(data.profile); setNotice(null); setStep('createlinked'); setSubmitting(false); return; }
      setStep('form'); setSubmitting(false);   // no Jubilee ID after all
    } catch (err) { failed(err, 'Connection error. Please check your internet and try again.'); }
  };

  // ── Screen 2B-2: create the linked account (no password; edits sync to SSO) ─
  const submitCreateLinked = async (e: React.FormEvent) => {
    e.preventDefault();
    resetMessages();
    let msg: string | null = null; let field: string | null = null;
    if (!firstName.trim()) (msg = 'First name is required.'), (field = 'firstName');
    else if (!lastName.trim()) (msg = 'Last name is required.'), (field = 'lastName');
    else if (dob && dob > new Date().toISOString().slice(0, 10)) (msg = 'Date of birth cannot be in the future.'), (field = 'dob');
    else if (!terms) msg = 'You must agree to the Terms of Use and Privacy Policy.';
    if (msg) { setErrorField(field); setError(msg); return; }
    if (mfaRequired && !totp.trim()) { setError('Please enter your authentication code.'); return; }
    setSubmitting(true);
    try {
      const data = await api.post<LoginResponse>('/api/auth/login', loginBody({
        provision: true,
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        date_of_birth: dob || undefined,
      }), { auth: false });
      if (isMfaRequired(data)) { setMfaRequired(true); setNotice(null); setError(data.message ?? 'Enter the authentication code from your authenticator app.'); setSubmitting(false); return; }
      if (isAuthSuccess(data)) { finish(data); return; }
      setError('We could not finish creating your account. Please try again.'); setSubmitting(false);
    } catch (err) { failed(err, 'Connection error. Please check your internet and try again.'); }
  };

  // ── Screen 2C: no identity anywhere → create a new Jubilee ID ─────────────
  const submitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    resetMessages();
    let msg: string | null = null; let field: string | null = null;
    if (!firstName.trim()) (msg = 'First name is required.'), (field = 'firstName');
    else if (!lastName.trim()) (msg = 'Last name is required.'), (field = 'lastName');
    else if (!dob) (msg = 'Date of birth is required.'), (field = 'dob');
    else if (Number.isNaN(Date.parse(dob))) (msg = 'Please enter a valid date of birth.'), (field = 'dob');
    else if (dob > new Date().toISOString().slice(0, 10)) (msg = 'Date of birth cannot be in the future.'), (field = 'dob');
    else if (!password) (msg = 'Password is required.'), (field = 'password');
    else if (password.length < 6) (msg = 'Password must be at least 6 characters.'), (field = 'password');
    else if (password !== confirm) (msg = 'Passwords do not match.'), (field = 'confirm');
    else if (!terms) msg = 'You must agree to the Terms of Use and Privacy Policy.';
    if (msg) { setErrorField(field); setError(msg); return; }
    setSubmitting(true);
    try {
      const data = await api.post<AuthSuccessResponse>('/api/auth/register', {
        name: `${firstName.trim()} ${lastName.trim()}`,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        dateOfBirth: dob,
        email: email.trim(),
        password,
      }, { auth: false });
      finish(data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) { setStep('email'); setNotice(null); setError('You already have an account — press Continue to sign in.'); setSubmitting(false); return; }
      setError(err instanceof ApiError ? err.message : 'Connection error. Please check your internet and try again.');
      setSubmitting(false);
    }
  };

  const fieldClass = (name: string) => `${styles.control}${errorField === name ? ` ${styles.error}` : ''}`;

  const totpField = mfaRequired ? (
    <>
      <div className={styles.floatingGroup}>
        <input type="text" className={styles.control} placeholder=" " autoComplete="one-time-code" inputMode="numeric" value={totp} onChange={(e) => setTotp(e.target.value)} autoFocus />
        <label className={styles.floatingLabel}>Authentication Code</label>
      </div>
      <p className={styles.fieldHint}>Enter the 6-digit code from your authenticator app.</p>
    </>
  ) : null;

  const accountRow = (
    <div className={styles.floatingGroup}>
      <input type="email" className={styles.control} placeholder=" " value={email} readOnly style={{ opacity: 0.7 }} />
      <label className={styles.floatingLabel}>Email Address</label>
    </div>
  );

  const rememberRow = (
    <div className={styles.secondaryRow}>
      <label className={styles.rememberMe}>
        <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} />
        <span>Keep me signed in on this device</span>
      </label>
    </div>
  );

  const termsRow = (
    <div className={styles.termsRow}>
      <label className={styles.checkboxWrapper}>
        <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} />
        <span className={styles.checkboxLabel}>
          I agree to the{' '}
          <a href="#" onClick={(e) => (e.preventDefault(), setLegal('terms'))}>Terms of Use</a>{' '}
          and <a href="#" onClick={(e) => (e.preventDefault(), setLegal('privacy'))}>Privacy Policy</a>
        </span>
      </label>
    </div>
  );

  return (
    <>
      {TURNSTILE_SITE_KEY ? (
        <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" strategy="afterInteractive" onLoad={renderTurnstile} />
      ) : null}
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

            {registered ? (
              <div className={`${styles.alert} ${styles.alertSuccess}`} role="status">Account created — please sign in.</div>
            ) : null}
            {notice ? (
              <div className={`${styles.alert} ${styles.alertSuccess}`} role="status">{notice}</div>
            ) : null}
            {error ? (
              <div className={`${styles.alert} ${styles.alertError}`} role="alert">{error}</div>
            ) : null}

            {/* ── Screen 1: the one door — email only ── */}
            {step === 'email' ? (
              <form onSubmit={submitEmail} noValidate>
                <h1 className={styles.title}>Sign in with your Jubilee ID</h1>
                <p className={styles.subtitle}>One Jubilee ID works across all our sites</p>
                <div className={styles.floatingGroup}>
                  <input type="email" className={fieldClass('email')} placeholder=" " autoComplete="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
                  <label className={styles.floatingLabel}>Email Address</label>
                </div>
                {TURNSTILE_SITE_KEY ? (
                  <div ref={tnBoxRef} style={{ width: '100%', margin: '6px 0 14px', overflow: 'hidden' }}>
                    <div ref={tnRef} style={{ width: 300, transformOrigin: 'top left' }} />
                  </div>
                ) : null}
                <button type="submit" className={`${styles.submit} ${styles.submitBold}`} disabled={submitting}>
                  {submitting ? (<><span className={styles.spinner} /> Checking...</>) : 'Continue'}
                </button>
                <p className={styles.fieldHint} style={{ textAlign: 'center' }}>No account yet? We&apos;ll set one up for you.</p>
              </form>
            ) : null}

            {/* ── Screen 2A: Welcome back ── */}
            {step === 'welcome' ? (
              <form onSubmit={submitWelcome} noValidate>
                <h1 className={styles.title}>Welcome back</h1>
                {accountRow}
                <div className={styles.floatingGroup}>
                  <div className={styles.passwordWrapper}>
                    <input type={showPw ? 'text' : 'password'} className={fieldClass('password')} placeholder=" " autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} disabled={mfaRequired} />
                    <label className={styles.floatingLabel}>Password</label>
                    <button type="button" className={styles.btnEye} onClick={() => setShowPw((v) => !v)} aria-label="Toggle password visibility"><EyeIcon open={!showPw} /></button>
                  </div>
                </div>
                {totpField}
                <div className={styles.secondaryRow}>
                  <label className={styles.rememberMe}>
                    <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} />
                    <span>Keep me signed in on this device</span>
                  </label>
                  <Link href={`/forgot-password?email=${encodeURIComponent(email.trim())}`}>Forgot your password?</Link>
                </div>
                <button type="submit" className={`${styles.submit} ${styles.submitBold}`} disabled={submitting}>
                  {submitting ? (<><span className={styles.spinner} /> Signing In...</>) : 'Continue'}
                </button>
                <div className={styles.backLink}>
                  <button type="button" className={styles.linkBtn} onClick={useDifferentEmail}>Use a different email</button>
                </div>
              </form>
            ) : null}

            {/* ── Screen 2B-1: Confirm it's you ── */}
            {step === 'confirm' ? (
              <form onSubmit={submitConfirm} noValidate>
                <h1 className={styles.title}>Confirm it&apos;s you</h1>
                <p className={styles.subtitle}>This email already has a Jubilee ID. Enter your password to continue and create your account on {SITE_NAME}.</p>
                {accountRow}
                <div className={styles.floatingGroup}>
                  <div className={styles.passwordWrapper}>
                    <input type={showPw ? 'text' : 'password'} className={fieldClass('password')} placeholder=" " autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} disabled={mfaRequired} />
                    <label className={styles.floatingLabel}>Jubilee ID Password</label>
                    <button type="button" className={styles.btnEye} onClick={() => setShowPw((v) => !v)} aria-label="Toggle password visibility"><EyeIcon open={!showPw} /></button>
                  </div>
                </div>
                {totpField}
                <div className={styles.secondaryRow}>
                  <span />
                  <Link href={`/forgot-password?email=${encodeURIComponent(email.trim())}`}>Forgot your password?</Link>
                </div>
                <button type="submit" className={`${styles.submit} ${styles.submitBold}`} disabled={submitting}>
                  {submitting ? (<><span className={styles.spinner} /> Checking...</>) : 'Continue'}
                </button>
                <div className={styles.backLink}>
                  <button type="button" className={styles.linkBtn} onClick={useDifferentEmail}>Use a different email</button>
                </div>
              </form>
            ) : null}

            {/* ── Screen 2B-2: Create your JubileeVerse account (no password) ── */}
            {step === 'createlinked' ? (
              <form onSubmit={submitCreateLinked} noValidate>
                <h1 className={styles.title}>Create your {SITE_NAME} account</h1>
                <p className={styles.subtitle}>Your Jubilee ID is confirmed. Add a few details to finish creating your account here.</p>
                <div className={styles.fieldRow}>
                  <div className={styles.floatingGroup}>
                    <input type="text" className={fieldClass('firstName')} placeholder=" " autoComplete="given-name" autoFocus value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                    <label className={styles.floatingLabel}>First Name</label>
                  </div>
                  <div className={styles.floatingGroup}>
                    <input type="text" className={fieldClass('lastName')} placeholder=" " autoComplete="family-name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
                    <label className={styles.floatingLabel}>Last Name</label>
                  </div>
                </div>
                <div className={styles.floatingGroup}>
                  <div className={styles.dateWrapper}>
                    <input type="date" className={`${styles.control} ${styles.dateControl}${errorField === 'dob' ? ` ${styles.error}` : ''}`} autoComplete="bday" value={dob} max={maxDob || undefined} onChange={(e) => setDob(e.target.value)} />
                    <label className={styles.floatingLabel}>Date of Birth</label>
                    <span className={styles.dateIcon} aria-hidden="true"><CalendarIcon /></span>
                  </div>
                </div>
                {totpField}
                {rememberRow}
                {termsRow}
                <button type="submit" className={styles.submit} disabled={submitting}>
                  {submitting ? (<><span className={styles.spinner} /> Creating Account...</>) : 'Create Account'}
                </button>
                <div className={styles.backLink}>
                  <button type="button" className={styles.linkBtn} onClick={useDifferentEmail}>Use a different email</button>
                </div>
              </form>
            ) : null}

            {/* ── Screen 2C: Let's create your Jubilee ID ── */}
            {step === 'form' ? (
              <form onSubmit={submitForm} noValidate>
                <h1 className={styles.title}>Let&apos;s create your Jubilee ID</h1>
                <p className={styles.subtitle}>One account gives you access to {SITE_NAME} and everything else across Jubilee. It only takes a moment.</p>
                <div className={styles.fieldRow}>
                  <div className={styles.floatingGroup}>
                    <input type="text" className={fieldClass('firstName')} placeholder=" " autoComplete="given-name" autoFocus value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                    <label className={styles.floatingLabel}>First Name</label>
                  </div>
                  <div className={styles.floatingGroup}>
                    <input type="text" className={fieldClass('lastName')} placeholder=" " autoComplete="family-name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
                    <label className={styles.floatingLabel}>Last Name</label>
                  </div>
                </div>
                <div className={styles.floatingGroup}>
                  <div className={styles.dateWrapper}>
                    <input type="date" className={`${styles.control} ${styles.dateControl}${errorField === 'dob' ? ` ${styles.error}` : ''}`} autoComplete="bday" value={dob} max={maxDob || undefined} onChange={(e) => setDob(e.target.value)} />
                    <label className={styles.floatingLabel}>Date of Birth</label>
                    <span className={styles.dateIcon} aria-hidden="true"><CalendarIcon /></span>
                  </div>
                </div>
                {accountRow}
                <div className={styles.floatingGroup}>
                  <div className={styles.passwordWrapper}>
                    <input type={showPw ? 'text' : 'password'} className={fieldClass('password')} placeholder=" " autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                    <label className={styles.floatingLabel}>Password</label>
                    <button type="button" className={styles.btnEye} onClick={() => setShowPw((v) => !v)} aria-label="Toggle password visibility"><EyeIcon open={!showPw} /></button>
                  </div>
                </div>
                <div className={styles.floatingGroup}>
                  <div className={styles.passwordWrapper}>
                    <input type={showConfirm ? 'text' : 'password'} className={fieldClass('confirm')} placeholder=" " autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
                    <label className={styles.floatingLabel}>Confirm Password</label>
                    <button type="button" className={styles.btnEye} onClick={() => setShowConfirm((v) => !v)} aria-label="Toggle password visibility"><EyeIcon open={!showConfirm} /></button>
                  </div>
                </div>
                {confirm ? (
                  <p className={styles.fieldHint} style={{ color: password === confirm ? '#4ade80' : '#f87171' }} role="status">
                    {password === confirm ? 'Passwords matched' : "Passwords don't match"}
                  </p>
                ) : null}
                {rememberRow}
                {termsRow}
                <button type="submit" className={styles.submit} disabled={submitting}>
                  {submitting ? (<><span className={styles.spinner} /> Creating Account...</>) : 'Create my Jubilee ID'}
                </button>
                <div className={styles.backLink}>
                  <button type="button" className={styles.linkBtn} onClick={useDifferentEmail}>Use a different email</button>
                </div>
              </form>
            ) : null}
          </div>

          <div className={`${styles.footer} ${styles.footerBottom}`}>
            <p className={styles.copyright}>
              &copy; {new Date().getFullYear()} JubileeVerse.com |{' '}
              <a href="#" onClick={(e) => (e.preventDefault(), setLegal('terms'))}>Terms of Use</a>{' '}
              | <a href="#" onClick={(e) => (e.preventDefault(), setLegal('privacy'))}>Privacy Policy</a>
            </p>
          </div>
        </div>

        <AuthBackground
          images={BACKGROUNDS}
          quote={'"The Lord is my light and my salvation — whom shall I fear?"'}
          cite="Psalm 27:1"
        />
      </div>

      <LegalModals privacyOpen={legal === 'privacy'} termsOpen={legal === 'terms'} onClose={() => setLegal(null)} />
    </>
  );
}
