'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import AuthBackground from '@/components/auth/AuthBackground';
import LegalModals from '@/components/auth/LegalModals';
import { api, ApiError } from '@/lib/api';
import { getStoredAuth, setStoredAuth } from '@/lib/authStorage';
import { readSignupPrefill } from '@/lib/identity';
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

const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

/**
 * Sign-up, entered with an email AND a password.
 *
 *   'email'   → both, together. One POST to /api/auth/login with `preview: true`
 *               answers what kind of visitor this is, without committing anything.
 *   'confirm' → they already hold a Jubilee ID but have no account here. Their
 *               name and date of birth arrive already filled in from the shared
 *               identity, editable, and creating the account is one more click.
 *   'form'    → no identity anywhere: the full registration form, carrying over
 *               the password they just chose.
 *
 * Asking for the password up front is what makes the middle case possible. The
 * old email-only entry could only offer a bare password box to someone the family
 * already knew, which read as a sign-in bolted onto a sign-up page and told them
 * nothing about the details being reused.
 *
 * The routing decision is the server's, which is what keeps it honest under an
 * Identity Authority outage: it fails open to the registration form, and the
 * register endpoint re-checks both stores before it creates anything.
 */
type Step = 'email' | 'confirm' | 'form';

/** Shape returned by POST /api/auth/login and POST /api/auth/register. */
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
/** Valid Jubilee ID, no JubileeVerse account yet — the pre-filled create form. */
interface NeedsProfileResponse {
  success: false;
  needsProfile: true;
  profile?: { first_name?: string; last_name?: string; date_of_birth?: string };
}
/** No identity in either store — a brand new visitor. */
interface RedirectSignupResponse {
  success: false;
  redirect: 'signup';
}
type LoginResponse =
  | AuthSuccessResponse
  | MfaRequiredResponse
  | NeedsProfileResponse
  | RedirectSignupResponse;

const isMfaRequired = (r: LoginResponse): r is MfaRequiredResponse =>
  'mfa_required' in r && r.mfa_required === true;
const isNeedsProfile = (r: LoginResponse): r is NeedsProfileResponse =>
  'needsProfile' in r && r.needsProfile === true;
const isAuthSuccess = (r: LoginResponse): r is AuthSuccessResponse =>
  'token' in r && typeof r.token === 'string';

export default function SignUpPage() {
  const router = useRouter();

  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');

  // The password typed at the entry step. For an existing Jubilee ID it is the
  // credential the authority already verified; for a new account it becomes the
  // password being chosen, which is why the form step pre-fills confirm with it.
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [totp, setTotp] = useState('');

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dob, setDob] = useState('');
  const [maxDob, setMaxDob] = useState('');
  const [confirm, setConfirm] = useState('');
  const [terms, setTerms] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);

  const [submitting, setSubmitting] = useState(false);
  const [errorField, setErrorField] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [legal, setLegal] = useState<'privacy' | 'terms' | null>(null);

  // Already signed in → home.
  useEffect(() => {
    if (getStoredAuth()?.authenticated) router.replace('/');
  }, [router]);

  // Cap the date picker at today. Set client-side so SSR and hydration agree.
  useEffect(() => {
    setMaxDob(new Date().toISOString().slice(0, 10));
  }, []);

  // Handed over from the sign-in screen, which found a valid Jubilee ID with no
  // account here. The password came with it, already verified, so this lands
  // straight on the pre-filled form instead of asking for it a second time.
  useEffect(() => {
    const handover = readSignupPrefill();
    if (!handover) return;
    setEmail(handover.email);
    setPassword(handover.password);
    setFirstName(handover.first_name || '');
    setLastName(handover.last_name || '');
    setDob(handover.date_of_birth || '');
    setNotice('You already have a Jubilee ID. Check your details and create your JubileeVerse account.');
    setStep('confirm');
  }, []);

  const resetMessages = () => {
    setError(null);
    setErrorField(null);
  };

  /** Persist the session and hand over with a full page load so AuthProvider re-hydrates. */
  const finish = (data: AuthSuccessResponse) => {
    setStoredAuth({
      authenticated: true,
      user: data.user,
      token: data.token,
      refreshToken: data.refreshToken,
      expiresAt: data.expiresAt,
    });
    window.location.assign(data.force_password_reset ? '/forgot-password' : safeRedirectTarget());
  };

  const backToEmail = () => {
    setStep('email');
    setMfaRequired(false);
    setTotp('');
    resetMessages();
    setNotice(null);
  };

  /** Both submits below post to the same route; only the extra fields differ. */
  const loginBody = (extra: Record<string, unknown>) => {
    const body: Record<string, unknown> = { email: email.trim(), password, rememberMe, ...extra };
    if (mfaRequired && totp.trim()) body.totp_code = totp.trim();
    return body;
  };

  const failed = (err: unknown, fallback: string) => {
    // Point at the field the message is about, on both steps that can raise it —
    // a bare "that password doesn't match" leaves the eye scanning the form.
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

  // ── Step 1: email + password → let the server route us ────────────────────
  const submitEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    resetMessages();
    setNotice(null);
    const addr = email.trim();
    if (!addr) {
      setErrorField('email');
      setError('Email is required.');
      return;
    }
    if (!isValidEmail(addr)) {
      setErrorField('email');
      setError('Please enter a valid email.');
      return;
    }
    if (!password) {
      setErrorField('password');
      setError('Password is required.');
      return;
    }
    if (mfaRequired && !totp.trim()) {
      setError('Please enter your authentication code.');
      return;
    }

    setSubmitting(true);
    try {
      const data = await api.post<LoginResponse>('/api/auth/login', loginBody({ preview: true }), {
        auth: false,
      });

      // Already a member here, and privileged enough to need a second factor.
      if (isMfaRequired(data)) {
        setMfaRequired(true);
        setError(data.message ?? 'Enter the authentication code from your authenticator app.');
        setSubmitting(false);
        return;
      }
      // Already a member — the password was right, so this was a sign-in.
      if (isAuthSuccess(data)) {
        finish(data);
        return;
      }
      // Known to the family, new to JubileeVerse: their details, ready to confirm.
      if (isNeedsProfile(data)) {
        setFirstName(data.profile?.first_name || '');
        setLastName(data.profile?.last_name || '');
        setDob((data.profile?.date_of_birth || '').slice(0, 10));
        setNotice('You already have a Jubilee ID. Check your details and create your JubileeVerse account.');
        setStep('confirm');
        setSubmitting(false);
        return;
      }
      // Nobody knows this address — register from scratch, keeping the password.
      setConfirm(password);
      setStep('form');
      setSubmitting(false);
    } catch (err) {
      failed(err, 'Connection error. Please check your internet and try again.');
    }
  };

  // ── Step 2A: existing Jubilee ID → confirm the details and join ───────────
  const submitConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    resetMessages();

    let msg: string | null = null;
    let field: string | null = null;
    if (!firstName.trim()) (msg = 'First name is required.'), (field = 'firstName');
    else if (!lastName.trim()) (msg = 'Last name is required.'), (field = 'lastName');
    else if (dob && Number.isNaN(Date.parse(dob)))
      (msg = 'Please enter a valid date of birth.'), (field = 'dob');
    else if (dob && dob > new Date().toISOString().slice(0, 10))
      (msg = 'Date of birth cannot be in the future.'), (field = 'dob');
    else if (!password) (msg = 'Please enter your Jubilee ID password.'), (field = 'password');
    else if (!terms) msg = 'You must agree to the Terms of Use and Privacy Policy.';
    if (msg) {
      setErrorField(field);
      setError(msg);
      return;
    }

    setSubmitting(true);
    try {
      // `provision: true` is what creates the local account, and it is only ever
      // sent from here — a deliberate act of joining. Edited details go to the
      // shared Jubilee ID server-side, so the whole family sees the correction.
      const data = await api.post<LoginResponse>(
        '/api/auth/login',
        loginBody({
          provision: true,
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          date_of_birth: dob || undefined,
        }),
        { auth: false },
      );

      if (isMfaRequired(data)) {
        setMfaRequired(true);
        setNotice(null);
        setError(data.message ?? 'Enter the authentication code from your authenticator app.');
        setSubmitting(false);
        return;
      }
      if (isAuthSuccess(data)) {
        finish(data);
        return;
      }
      // Neither a session nor a second-factor prompt: nothing sensible is left to
      // do here, and silently doing nothing would look like a dead button.
      setError('We could not finish creating your account. Please try again.');
      setSubmitting(false);
    } catch (err) {
      failed(err, 'Connection error. Please check your internet and try again.');
    }
  };

  // ── Step 2B: no identity anywhere → create one ────────────────────────────
  const submitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    resetMessages();

    let msg: string | null = null;
    let field: string | null = null;
    if (!firstName.trim()) (msg = 'First name is required.'), (field = 'firstName');
    else if (!lastName.trim()) (msg = 'Last name is required.'), (field = 'lastName');
    else if (!dob) (msg = 'Date of birth is required.'), (field = 'dob');
    else if (Number.isNaN(Date.parse(dob)))
      (msg = 'Please enter a valid date of birth.'), (field = 'dob');
    else if (dob > new Date().toISOString().slice(0, 10))
      (msg = 'Date of birth cannot be in the future.'), (field = 'dob');
    else if (!password) (msg = 'Password is required.'), (field = 'password');
    else if (password.length < 6)
      (msg = 'Password must be at least 6 characters.'), (field = 'password');
    else if (password !== confirm) (msg = 'Passwords do not match.'), (field = 'confirm');
    else if (!terms) msg = 'You must agree to the Terms of Use and Privacy Policy.';

    if (msg) {
      setErrorField(field);
      setError(msg);
      return;
    }

    setSubmitting(true);
    try {
      const data = await api.post<AuthSuccessResponse>(
        '/api/auth/register',
        {
          name: `${firstName.trim()} ${lastName.trim()}`,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          dateOfBirth: dob,
          email: email.trim(),
          password,
        },
        { auth: false },
      );
      finish(data);
    } catch (err) {
      // The address was claimed between the routing call and here (a race, or a
      // lookup that failed open). The server is the authority — send them back to
      // the entry step, where the password they already typed is waiting.
      if (err instanceof ApiError && err.status === 409) {
        setStep('email');
        setNotice(null);
        setError('You already have an account — press Continue to sign in.');
        setSubmitting(false);
        return;
      }
      setError(
        err instanceof ApiError
          ? err.message
          : 'Connection error. Please check your internet and try again.',
      );
      setSubmitting(false);
    }
  };

  const fieldClass = (name: string) =>
    `${styles.control}${errorField === name ? ` ${styles.error}` : ''}`;

  /** Shared by the entry and confirm steps — only privileged accounts ever see it. */
  const totpField = mfaRequired ? (
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
      <p className={styles.fieldHint}>Enter the 6-digit code from your authenticator app.</p>
    </>
  ) : null;

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
                Already have an account? <Link href="/signin">Sign In</Link>.
              </p>
            </div>

            {notice ? (
              <div className={`${styles.alert} ${styles.alertSuccess}`} role="status">
                {notice}
              </div>
            ) : null}

            {error ? (
              <div className={`${styles.alert} ${styles.alertError}`} role="alert">
                {error}
              </div>
            ) : null}

            {/* ── Step 1: email + password ── */}
            {step === 'email' ? (
              <form onSubmit={submitEntry} noValidate>
                <p className={styles.subtitle}>Enter your email and password to get started.</p>
                <div className={styles.floatingGroup}>
                  <input
                    type="email"
                    className={fieldClass('email')}
                    placeholder=" "
                    autoComplete="email"
                    autoFocus
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
                      className={fieldClass('password')}
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
                <p className={styles.fieldHint}>
                  One Jubilee ID signs you in across the whole family. If you already have one,
                  use that password.
                </p>

                {totpField}

                <div className={styles.secondaryRow}>
                  <label className={styles.rememberMe}>
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                    />
                    <span>Keep me signed in on this device</span>
                  </label>
                  <Link href={`/forgot-password?email=${encodeURIComponent(email.trim())}`}>
                    Forgot password?
                  </Link>
                </div>

                <button
                  type="submit"
                  className={`${styles.submit} ${styles.submitBold}`}
                  disabled={submitting}
                >
                  {submitting ? (
                    <>
                      <span className={styles.spinner} /> Checking...
                    </>
                  ) : (
                    'Continue'
                  )}
                </button>
              </form>
            ) : null}

            {/* ── Step 2A: existing Jubilee ID → confirm pre-filled details ── */}
            {step === 'confirm' ? (
              <form onSubmit={submitConfirm} noValidate>
                <p className={styles.subtitle}>
                  These came from your Jubilee ID. Change anything that is out of date — the
                  correction reaches the rest of the family too.
                </p>

                <div className={styles.fieldRow}>
                  <div className={styles.floatingGroup}>
                    <input
                      type="text"
                      className={fieldClass('firstName')}
                      placeholder=" "
                      autoComplete="given-name"
                      autoFocus
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                    />
                    <label className={styles.floatingLabel}>First Name</label>
                  </div>

                  <div className={styles.floatingGroup}>
                    <input
                      type="text"
                      className={fieldClass('lastName')}
                      placeholder=" "
                      autoComplete="family-name"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                    />
                    <label className={styles.floatingLabel}>Last Name</label>
                  </div>
                </div>

                <div className={styles.floatingGroup}>
                  <div className={styles.dateWrapper}>
                    <input
                      type="date"
                      className={`${styles.control} ${styles.dateControl}${errorField === 'dob' ? ` ${styles.error}` : ''}`}
                      autoComplete="bday"
                      value={dob}
                      max={maxDob || undefined}
                      onChange={(e) => setDob(e.target.value)}
                    />
                    <label className={styles.floatingLabel}>Date of Birth</label>
                    <span className={styles.dateIcon} aria-hidden="true">
                      <CalendarIcon />
                    </span>
                  </div>
                </div>

                <div className={styles.floatingGroup}>
                  <input
                    type="email"
                    className={styles.control}
                    placeholder=" "
                    value={email}
                    readOnly
                    style={{ opacity: 0.7 }}
                  />
                  <label className={styles.floatingLabel}>Email Address</label>
                </div>

                {/* Already verified before this step renders, so it arrives filled in.
                    It stays EDITABLE on purpose: the provision call is a second sign-in
                    at the authority, and the few things that can turn it down — a
                    password changed on another family site a moment ago, a lockout
                    counter, a transient refusal — all report "that password doesn't
                    match". Without a field to correct, that message would point at a
                    control that does not exist, which is the dead end this whole screen
                    was built to remove. It also gives password managers something to
                    save. */}
                <div className={styles.floatingGroup}>
                  <div className={styles.passwordWrapper}>
                    <input
                      type={showPw ? 'text' : 'password'}
                      className={fieldClass('password')}
                      placeholder=" "
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    <label className={styles.floatingLabel}>Jubilee ID Password</label>
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

                {totpField}

                <div className={styles.secondaryRow}>
                  <label className={styles.rememberMe}>
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                    />
                    <span>Keep me signed in on this device</span>
                  </label>
                </div>

                <div className={styles.termsRow}>
                  <label className={styles.checkboxWrapper}>
                    <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} />
                    <span className={styles.checkboxLabel}>
                      I agree to the{' '}
                      <a href="#" onClick={(e) => (e.preventDefault(), setLegal('terms'))}>
                        Terms of Use
                      </a>{' '}
                      and{' '}
                      <a href="#" onClick={(e) => (e.preventDefault(), setLegal('privacy'))}>
                        Privacy Policy
                      </a>
                    </span>
                  </label>
                </div>

                <button type="submit" className={styles.submit} disabled={submitting}>
                  {submitting ? (
                    <>
                      <span className={styles.spinner} /> Creating Account...
                    </>
                  ) : (
                    'Create Account'
                  )}
                </button>

                <div className={styles.backLink}>
                  <button type="button" className={styles.linkBtn} onClick={backToEmail}>
                    Use a different email
                  </button>
                </div>
              </form>
            ) : null}

            {/* ── Step 2B: new account → full form ── */}
            {step === 'form' ? (
              <form onSubmit={submitForm} noValidate>
                <div className={styles.fieldRow}>
                  <div className={styles.floatingGroup}>
                    <input
                      type="text"
                      className={fieldClass('firstName')}
                      placeholder=" "
                      autoComplete="given-name"
                      autoFocus
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                    />
                    <label className={styles.floatingLabel}>First Name</label>
                  </div>

                  <div className={styles.floatingGroup}>
                    <input
                      type="text"
                      className={fieldClass('lastName')}
                      placeholder=" "
                      autoComplete="family-name"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                    />
                    <label className={styles.floatingLabel}>Last Name</label>
                  </div>
                </div>

                <div className={styles.floatingGroup}>
                  <div className={styles.dateWrapper}>
                    <input
                      type="date"
                      className={`${styles.control} ${styles.dateControl}${errorField === 'dob' ? ` ${styles.error}` : ''}`}
                      autoComplete="bday"
                      value={dob}
                      max={maxDob || undefined}
                      onChange={(e) => setDob(e.target.value)}
                    />
                    <label className={styles.floatingLabel}>Date of Birth</label>
                    <span className={styles.dateIcon} aria-hidden="true">
                      <CalendarIcon />
                    </span>
                  </div>
                </div>

                <div className={styles.floatingGroup}>
                  <input
                    type="email"
                    className={styles.control}
                    placeholder=" "
                    value={email}
                    readOnly
                    style={{ opacity: 0.7 }}
                  />
                  <label className={styles.floatingLabel}>Email Address</label>
                </div>

                <div className={styles.floatingGroup}>
                  <div className={styles.passwordWrapper}>
                    <input
                      type={showPw ? 'text' : 'password'}
                      className={fieldClass('password')}
                      placeholder=" "
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
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

                <div className={styles.floatingGroup}>
                  <div className={styles.passwordWrapper}>
                    <input
                      type={showConfirm ? 'text' : 'password'}
                      className={fieldClass('confirm')}
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

                {confirm ? (
                  <p
                    className={styles.fieldHint}
                    style={{ color: password === confirm ? '#4ade80' : '#f87171' }}
                    role="status"
                  >
                    {password === confirm ? 'Passwords matched' : "Passwords don't match"}
                  </p>
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
                </div>

                <div className={styles.termsRow}>
                  <label className={styles.checkboxWrapper}>
                    <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} />
                    <span className={styles.checkboxLabel}>
                      I agree to the{' '}
                      <a href="#" onClick={(e) => (e.preventDefault(), setLegal('terms'))}>
                        Terms of Use
                      </a>{' '}
                      and{' '}
                      <a href="#" onClick={(e) => (e.preventDefault(), setLegal('privacy'))}>
                        Privacy Policy
                      </a>
                    </span>
                  </label>
                </div>

                <button type="submit" className={styles.submit} disabled={submitting}>
                  {submitting ? (
                    <>
                      <span className={styles.spinner} /> Creating Account...
                    </>
                  ) : (
                    'Create Account'
                  )}
                </button>

                <div className={styles.backLink}>
                  <button type="button" className={styles.linkBtn} onClick={backToEmail}>
                    Use a different email
                  </button>
                </div>
              </form>
            ) : null}
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
          quote={'"Therefore, if anyone is in Christ, the new creation has come: The old has gone, the new is here!"'}
          cite="2 Corinthians 5:17"
        />
      </div>

      <LegalModals privacyOpen={legal === 'privacy'} termsOpen={legal === 'terms'} onClose={() => setLegal(null)} />
    </>
  );
}
