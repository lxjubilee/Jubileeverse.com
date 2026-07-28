'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import AuthBackground from '@/components/auth/AuthBackground';
import LegalModals from '@/components/auth/LegalModals';
import Modal from '@/components/ui/Modal';
import { api, ApiError } from '@/lib/api';
import { getStoredAuth } from '@/lib/authStorage';
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

export default function SignUpPage() {
  const router = useRouter();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dob, setDob] = useState('');
  const [maxDob, setMaxDob] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [terms, setTerms] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorField, setErrorField] = useState<string | null>(null);
  const [validationMsg, setValidationMsg] = useState<string | null>(null);
  const [legal, setLegal] = useState<'privacy' | 'terms' | null>(null);

  // Already signed in → home.
  useEffect(() => {
    if (getStoredAuth()?.authenticated) router.replace('/');
  }, [router]);

  // Cap the date picker at today. Set client-side so SSR and hydration agree.
  useEffect(() => {
    setMaxDob(new Date().toISOString().slice(0, 10));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorField(null);

    let msg: string | null = null;
    let field: string | null = null;
    if (!firstName.trim()) (msg = 'First name is required.'), (field = 'firstName');
    else if (!lastName.trim()) (msg = 'Last name is required.'), (field = 'lastName');
    else if (!dob) (msg = 'Date of birth is required.'), (field = 'dob');
    else if (Number.isNaN(Date.parse(dob)))
      (msg = 'Please enter a valid date of birth.'), (field = 'dob');
    else if (dob > new Date().toISOString().slice(0, 10))
      (msg = 'Date of birth cannot be in the future.'), (field = 'dob');
    else if (!email.trim()) (msg = 'Email is required.'), (field = 'email');
    else if (!isValidEmail(email)) (msg = 'Please enter a valid email.'), (field = 'email');
    else if (!password) (msg = 'Password is required.'), (field = 'password');
    else if (password.length < 6)
      (msg = 'Password must be at least 6 characters.'), (field = 'password');
    else if (password !== confirm) (msg = 'Passwords do not match.'), (field = 'confirm');
    else if (!terms) msg = 'You must agree to the Terms of Use and Privacy Policy.';

    if (msg) {
      setErrorField(field);
      setValidationMsg(msg);
      return;
    }

    setSubmitting(true);
    try {
      await api.post(
        '/api/auth/register',
        {
          // The backend register route reads `name`; firstName/lastName/dateOfBirth
          // are sent for forward compatibility and ignored until it stores them.
          name: `${firstName.trim()} ${lastName.trim()}`,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          dateOfBirth: dob,
          email: email.trim(),
          password,
        },
        { auth: false },
      );
      router.push('/signin?registered=true');
    } catch (err) {
      const m =
        err instanceof ApiError
          ? err.message
          : 'Connection error. Please check your internet and try again.';
      setValidationMsg(m);
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
                <img src="/images/JubileeLogo.png" alt="JubileeInspire" className={styles.logoImg} />
                <div className={styles.logoText}>
                  Jubilee<span className={styles.verse}>Inspire</span>
                  <span>.com</span>
                </div>
              </Link>
            </div>

            <div className={styles.welcome}>
              <p>
                Already have an account? <Link href="/signin">Sign In</Link>.
              </p>
            </div>

            <form onSubmit={submit} noValidate>
              <div className={styles.fieldRow}>
                <div className={styles.floatingGroup}>
                  <input
                    type="text"
                    className={`${styles.control}${errorField === 'firstName' ? ` ${styles.error}` : ''}`}
                    placeholder=" "
                    autoComplete="given-name"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                  />
                  <label className={styles.floatingLabel}>First Name</label>
                </div>

                <div className={styles.floatingGroup}>
                  <input
                    type="text"
                    className={`${styles.control}${errorField === 'lastName' ? ` ${styles.error}` : ''}`}
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
                  className={`${styles.control}${errorField === 'email' ? ` ${styles.error}` : ''}`}
                  placeholder=" "
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <label className={styles.floatingLabel}>Email Address</label>
              </div>

              <div className={styles.floatingGroup}>
                <div className={styles.passwordWrapper}>
                  <input
                    type={showPw ? 'text' : 'password'}
                    className={`${styles.control}${errorField === 'password' ? ` ${styles.error}` : ''}`}
                    placeholder=" "
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <label className={styles.floatingLabel}>Password</label>
                  <button type="button" className={styles.btnEye} onClick={() => setShowPw((v) => !v)} aria-label="Toggle password visibility">
                    <EyeIcon open={!showPw} />
                  </button>
                </div>
              </div>

              <div className={styles.floatingGroup}>
                <div className={styles.passwordWrapper}>
                  <input
                    type={showConfirm ? 'text' : 'password'}
                    className={`${styles.control}${errorField === 'confirm' ? ` ${styles.error}` : ''}`}
                    placeholder=" "
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                  />
                  <label className={styles.floatingLabel}>Confirm Password</label>
                  <button type="button" className={styles.btnEye} onClick={() => setShowConfirm((v) => !v)} aria-label="Toggle password visibility">
                    <EyeIcon open={!showConfirm} />
                  </button>
                </div>
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
          quote={'"Therefore, if anyone is in Christ, the new creation has come: The old has gone, the new is here!"'}
          cite="2 Corinthians 5:17"
        />
      </div>

      <Modal open={!!validationMsg} onClose={() => setValidationMsg(null)}>
        <p style={{ textAlign: 'center', fontSize: 16, color: '#fff' }}>{validationMsg}</p>
      </Modal>
      <LegalModals privacyOpen={legal === 'privacy'} termsOpen={legal === 'terms'} onClose={() => setLegal(null)} />
    </>
  );
}
