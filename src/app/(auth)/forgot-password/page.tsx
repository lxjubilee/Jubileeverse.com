'use client';

import Link from 'next/link';
import { useState } from 'react';
import AuthBackground from '@/components/auth/AuthBackground';
import LegalModals from '@/components/auth/LegalModals';
import Modal from '@/components/ui/Modal';
import { api, ApiError } from '@/lib/api';
import styles from '../auth.module.css';

const BACKGROUNDS = [
  'https://images.unsplash.com/photo-1490730141103-6cac27aaab94?w=1920&q=80',
  'https://images.unsplash.com/photo-1475924156734-496f6cac6ec1?w=1920&q=80',
  'https://images.unsplash.com/photo-1433086966358-54859d0ed716?w=1920&q=80',
  'https://images.unsplash.com/photo-1470252649378-9c29740c9fa8?w=1920&q=80',
  'https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?w=1920&q=80',
];

const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorField, setErrorField] = useState(false);
  const [validationMsg, setValidationMsg] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [sentEmail, setSentEmail] = useState('');
  const [legal, setLegal] = useState<'privacy' | 'terms' | null>(null);

  const sendReset = async () => {
    setSubmitting(true);
    try {
      await api.post('/api/auth/forgot-password', { email }, { auth: false });
      setSentEmail(email);
      setSent(true);
    } catch (err) {
      setValidationMsg(
        err instanceof ApiError ? err.message : 'Connection error. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorField(false);
    if (!email.trim() || !isValidEmail(email)) {
      setErrorField(true);
      setValidationMsg(!email.trim() ? 'Email is required.' : 'Please enter a valid email.');
      return;
    }
    void sendReset();
  };

  return (
    <>
      <div className={styles.waveBar} />
      <div className={styles.row}>
        <div className={`${styles.formPanel} ${styles.formPanelStack}`}>
          <div className={styles.formContent}>
            <div className={styles.logo}>
              <Link href="/">
                <img src="/brand/jubilee-logo.png" alt="JubileeVerse" className={styles.logoImg} />
                <div className={styles.logoText}>
                  Jubilee<span className={styles.verse}>Verse</span>
                  <span>.com</span>
                </div>
              </Link>
            </div>

            {!sent ? (
              <>
                <h2 className={styles.title}>Forgot your password?</h2>
                <p className={styles.subtitle}>
                  Enter your email and we&apos;ll send you a link to reset it.
                </p>
                <form onSubmit={submit} noValidate>
                  <div className={styles.floatingGroup}>
                    <input
                      type="email"
                      className={`${styles.control}${errorField ? ` ${styles.error}` : ''}`}
                      placeholder=" "
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                    <label className={styles.floatingLabel}>Email Address</label>
                  </div>
                  <button type="submit" className={styles.submit} disabled={submitting}>
                    {submitting ? (
                      <>
                        <span className={styles.spinner} /> Sending...
                      </>
                    ) : (
                      'Send Reset Link'
                    )}
                  </button>
                </form>
                <div className={styles.backLink}>
                  <Link href="/signin">Back to Sign In</Link>
                </div>
              </>
            ) : (
              <div className={styles.successContent}>
                <svg viewBox="0 0 24 24" width="80" height="80" fill="none" stroke="#4ade80" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M9 12l2 2 4-4" />
                </svg>
                <h2>Check Your Email</h2>
                <p>
                  We&apos;ve sent password reset instructions to <strong>{sentEmail}</strong>. Please
                  check your inbox and follow the link to reset your password.
                </p>
                <button className={styles.submit} disabled={submitting} onClick={() => void sendReset()}>
                  {submitting ? (
                    <>
                      <span className={styles.spinner} /> Sending...
                    </>
                  ) : (
                    'Resend Email'
                  )}
                </button>
                <div className={styles.backLink}>
                  <Link href="/signin">Back to Sign In</Link>
                </div>
              </div>
            )}

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
          quote={'"Come to me, all you who are weary and burdened, and I will give you rest."'}
          cite="Matthew 11:28"
        />
      </div>

      <Modal open={!!validationMsg} onClose={() => setValidationMsg(null)}>
        <p style={{ textAlign: 'center', fontSize: 16, color: '#fff' }}>{validationMsg}</p>
      </Modal>
      <LegalModals privacyOpen={legal === 'privacy'} termsOpen={legal === 'terms'} onClose={() => setLegal(null)} />
    </>
  );
}
