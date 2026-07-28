'use client';

/**
 * PROFILE SETTINGS — faithful conversion of the original static settings.html.
 *
 * Protected page: requires an authenticated session. If the auth context has
 * finished loading and the visitor is not signed in we redirect to /signin and
 * render nothing; while auth is still hydrating we show a spinner.
 *
 * Three tabs mirror the original:
 *  - Profile : edit display name + email (role / member-since are read-only),
 *              Save Changes / Discard.
 *  - Security: change password (current / new / confirm) with a live strength
 *              meter, plus a "Request Password Reset" link.
 *  - Account : Back to Home, Sign Out (with confirm), and a Danger Zone whose
 *              Delete Account is intentionally a no-op toast (as in the original).
 *
 * API (exact methods/paths/bodies from the original + the unchanged backend):
 *   GET  /api/auth/me                -> { success, user }
 *   PUT  /api/auth/profile           { name, email }            -> { success, user, token? }
 *   PUT  /api/auth/change-password   { currentPassword, newPassword } -> { success, message }
 *
 * `api` auto-attaches the Authorization: Bearer <token> header. After a profile
 * save we call useAuth().refresh() so the shared header avatar/initials and the
 * stored user stay in sync (the original wrote localStorage directly; refresh()
 * does the equivalent through the auth context).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { setStoredAuth } from '@/lib/authStorage';
import type { AuthUser } from '@/lib/types';
import styles from './settings.module.css';

type TabName = 'profile' | 'security' | 'account';
type ToastType = 'success' | 'error';

interface MeResponse {
  success?: boolean;
  user?: AuthUser;
}

interface ProfileSaveResponse {
  success?: boolean;
  user?: AuthUser;
  token?: string;
  error?: string;
}

interface PasswordResponse {
  success?: boolean;
  message?: string;
  error?: string;
}

/** Title-case the first letter (matches the original `capitalize`). */
function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

/** Two-letter initials from a name, else first letter of email, else '?'. */
function deriveInitials(name: string, email: string): string {
  if (name) {
    const parts = name.trim().split(/\s+/);
    return parts.length > 1
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : parts[0][0].toUpperCase();
  }
  if (email) return email[0].toUpperCase();
  return '?';
}

/** Format an ISO date the same way the original did. */
function formatMemberSince(createdAt: string | undefined): string {
  if (!createdAt) return 'N/A';
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return 'N/A';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

const STRENGTH_LEVELS = [
  { width: '20%', color: '#d13438', label: 'Very weak' },
  { width: '40%', color: '#f0ad4e', label: 'Weak' },
  { width: '60%', color: '#f0ad4e', label: 'Fair' },
  { width: '80%', color: '#107c10', label: 'Strong' },
  { width: '100%', color: '#107c10', label: 'Very strong' },
] as const;

export default function SettingsPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading, refresh, signOut } = useAuth();

  const [tab, setTab] = useState<TabName>('profile');

  // Profile fetch state.
  const [profileLoaded, setProfileLoaded] = useState(false);

  // Header card (display) state.
  const [headerName, setHeaderName] = useState('Loading...');
  const [headerEmail, setHeaderEmail] = useState('');
  const [headerRole, setHeaderRole] = useState('User');
  const [headerDate, setHeaderDate] = useState('');
  const [avatarInitials, setAvatarInitials] = useState('?');

  // Profile form fields.
  const [inputName, setInputName] = useState('');
  const [inputEmail, setInputEmail] = useState('');
  const [inputRole, setInputRole] = useState('');
  const [inputMemberSince, setInputMemberSince] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  // Password form fields.
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);

  // Toast.
  const [toast, setToast] = useState<{ msg: string; type: ToastType } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string, type: ToastType = 'success') => {
    setToast({ msg, type });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  // --- Auth guard -----------------------------------------------------------
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace('/signin?redirect=/settings');
    }
  }, [isLoading, isAuthenticated, router]);

  // Apply a user record to both the header card and the editable form fields.
  const applyUser = useCallback((user: AuthUser) => {
    const name = user.name || '';
    const email = user.email || '';
    const role = user.role || 'user';
    const memberDate = formatMemberSince(
      typeof user.created_at === 'string' ? user.created_at : undefined,
    );

    setInputName(name);
    setInputEmail(email);
    setInputRole(capitalize(role));
    setInputMemberSince(memberDate);

    setHeaderName(name || 'No name set');
    setHeaderEmail(email);
    setHeaderRole(capitalize(role));
    setHeaderDate(`Joined ${memberDate}`);
    setAvatarInitials(deriveInitials(name, email));
  }, []);

  // --- Load profile (GET /api/auth/me) -------------------------------------
  const loadProfile = useCallback(async () => {
    try {
      const data = await api.get<MeResponse>('/api/auth/me');
      if (data.success && data.user) {
        applyUser(data.user);
      } else {
        showToast('Failed to load profile', 'error');
      }
    } catch {
      showToast('Network error', 'error');
    } finally {
      setProfileLoaded(true);
    }
  }, [applyUser, showToast]);

  useEffect(() => {
    if (!isLoading && isAuthenticated && !profileLoaded) {
      void loadProfile();
    }
  }, [isLoading, isAuthenticated, profileLoaded, loadProfile]);

  // --- Save profile (PUT /api/auth/profile) --------------------------------
  const saveProfile = useCallback(async () => {
    const name = inputName.trim();
    const email = inputEmail.trim();
    if (!email) {
      showToast('Email is required', 'error');
      return;
    }

    setSavingProfile(true);
    try {
      const data = await api.put<ProfileSaveResponse>('/api/auth/profile', { name, email });
      if (data.success) {
        // Update header card + avatar from the just-saved values.
        setHeaderName(name || 'No name set');
        setHeaderEmail(email);
        setAvatarInitials(deriveInitials(name, email));
        // Token rotation: if the backend issued a new token, persist it so the
        // stored bearer stays valid before we re-read /api/auth/me.
        if (data.token && data.user) {
          setStoredAuth({ authenticated: true, user: data.user, token: data.token });
        }
        // Re-read /api/auth/me to keep the shared header + stored user in sync.
        await refresh();
        showToast('Profile updated successfully', 'success');
      } else {
        showToast(data.error || 'Failed to update', 'error');
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Network error';
      showToast(msg, 'error');
    } finally {
      setSavingProfile(false);
    }
  }, [inputName, inputEmail, refresh, showToast]);

  // --- Change password (PUT /api/auth/change-password) ---------------------
  const changePassword = useCallback(async () => {
    if (!currentPassword) {
      showToast('Enter your current password', 'error');
      return;
    }
    if (!newPassword) {
      showToast('Enter a new password', 'error');
      return;
    }
    if (newPassword.length < 6) {
      showToast('Password must be at least 6 characters', 'error');
      return;
    }
    if (newPassword !== confirmPassword) {
      showToast('New passwords do not match', 'error');
      return;
    }

    setChangingPassword(true);
    try {
      const data = await api.put<PasswordResponse>('/api/auth/change-password', {
        currentPassword,
        newPassword,
      });
      if (data.success) {
        showToast('Password updated successfully', 'success');
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      } else {
        showToast(data.error || 'Failed to update password', 'error');
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Network error';
      showToast(msg, 'error');
    } finally {
      setChangingPassword(false);
    }
  }, [currentPassword, newPassword, confirmPassword, showToast]);

  // --- Sign out -------------------------------------------------------------
  const signOutAndRedirect = useCallback(() => {
    // Route through the auth context so it also calls the backend logout and
    // resets the shared header state, then return to sign-in.
    signOut();
    router.replace('/signin');
  }, [signOut, router]);

  const confirmSignOut = useCallback(() => {
    if (window.confirm('Are you sure you want to sign out?')) {
      signOutAndRedirect();
    }
  }, [signOutAndRedirect]);

  // --- Password strength meter ---------------------------------------------
  const strengthScore = (() => {
    const pwd = newPassword;
    if (!pwd) return -1;
    let score = 0;
    if (pwd.length >= 6) score++;
    if (pwd.length >= 10) score++;
    if (/[A-Z]/.test(pwd)) score++;
    if (/[0-9]/.test(pwd)) score++;
    if (/[^A-Za-z0-9]/.test(pwd)) score++;
    return Math.min(score, 4);
  })();
  const strength = strengthScore >= 0 ? STRENGTH_LEVELS[strengthScore] : null;

  // Enter-key submission (mirrors the original keydown handler).
  const onProfileKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') void saveProfile();
  };
  const onPasswordKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') void changePassword();
  };

  // --- Render guards --------------------------------------------------------
  if (isLoading || (!isAuthenticated && !isLoading) || !profileLoaded) {
    // While auth hydrates, or before the profile fetch resolves, show a spinner.
    // (If not authenticated, the effect above is redirecting to /signin.)
    if (!isAuthenticated && !isLoading) return null;
    return (
      <main className={styles.loadingWrap}>
        <div className="spinner" aria-label="Loading" />
      </main>
    );
  }

  return (
    <main className={styles.settingsPage}>
      {/* Breadcrumb */}
      <div className={styles.breadcrumb}>
        <Link href="/">Home</Link>
        <span className={styles.sep}>/</span>
        <span className={styles.current}>Profile Settings</span>
      </div>

      {/* Profile Header Card */}
      <div className={styles.profileHeaderCard}>
        <div className={styles.profileAvatar}>{avatarInitials}</div>
        <div className={styles.profileHeaderInfo}>
          <div className={styles.profileHeaderName}>{headerName}</div>
          <div className={styles.profileHeaderEmail}>{headerEmail || ' '}</div>
          <div className={styles.profileHeaderMeta}>
            <span className={styles.profileMetaBadge}>{headerRole}</span>
            <span className={styles.profileMetaDate}>{headerDate}</span>
          </div>
        </div>
      </div>

      {/* Settings Tabs */}
      <div className={styles.settingsTabs}>
        <button
          className={`${styles.settingsTab} ${tab === 'profile' ? styles.active : ''}`}
          onClick={() => setTab('profile')}
        >
          Profile
        </button>
        <button
          className={`${styles.settingsTab} ${tab === 'security' ? styles.active : ''}`}
          onClick={() => setTab('security')}
        >
          Security
        </button>
        <button
          className={`${styles.settingsTab} ${tab === 'account' ? styles.active : ''}`}
          onClick={() => setTab('account')}
        >
          Account
        </button>
      </div>

      {/* Tab: Profile */}
      {tab === 'profile' && (
        <div className={styles.settingsCard}>
          <div className={styles.settingsCardTitle}>Personal Information</div>
          <div className={styles.settingsCardDesc}>Update your name and contact details.</div>

          <div className={styles.formRow}>
            <div className={styles.formGroup}>
              <label htmlFor="inputName">Display Name</label>
              <input
                id="inputName"
                type="text"
                placeholder="Your name"
                value={inputName}
                onChange={(e) => setInputName(e.target.value)}
                onKeyDown={onProfileKeyDown}
              />
            </div>
            <div className={styles.formGroup}>
              <label htmlFor="inputEmail">Email Address</label>
              <input
                id="inputEmail"
                type="email"
                placeholder="your@email.com"
                value={inputEmail}
                onChange={(e) => setInputEmail(e.target.value)}
                onKeyDown={onProfileKeyDown}
              />
            </div>
          </div>

          <div className={styles.formRow}>
            <div className={styles.formGroup}>
              <label htmlFor="inputRole">Role</label>
              <input id="inputRole" type="text" value={inputRole} readOnly />
            </div>
            <div className={styles.formGroup}>
              <label htmlFor="inputMemberSince">Member Since</label>
              <input id="inputMemberSince" type="text" value={inputMemberSince} readOnly />
            </div>
          </div>

          <div className={styles.btnGroup}>
            <button
              className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={() => void saveProfile()}
              disabled={savingProfile}
            >
              {savingProfile ? 'Saving...' : 'Save Changes'}
            </button>
            <button
              className={`${styles.btn} ${styles.btnOutline}`}
              onClick={() => void loadProfile()}
            >
              Discard
            </button>
          </div>
        </div>
      )}

      {/* Tab: Security */}
      {tab === 'security' && (
        <>
          <div className={styles.settingsCard}>
            <div className={styles.settingsCardTitle}>Change Password</div>
            <div className={styles.settingsCardDesc}>
              Ensure your account stays secure by using a strong password.
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="inputCurrentPassword">Current Password</label>
              <input
                id="inputCurrentPassword"
                type="password"
                placeholder="Enter current password"
                autoComplete="new-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                onKeyDown={onPasswordKeyDown}
              />
            </div>

            <div className={styles.formRow}>
              <div className={styles.formGroup}>
                <label htmlFor="inputNewPassword">New Password</label>
                <input
                  id="inputNewPassword"
                  type="password"
                  placeholder="Enter new password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  onKeyDown={onPasswordKeyDown}
                />
                <div className={styles.passwordStrength}>
                  <div
                    className={styles.passwordStrengthBar}
                    style={{
                      width: strength ? strength.width : '0',
                      background: strength ? strength.color : undefined,
                    }}
                  />
                </div>
                <div
                  className={styles.strengthText}
                  style={strength ? { color: strength.color } : undefined}
                >
                  {strength ? strength.label : ''}
                </div>
              </div>
              <div className={styles.formGroup}>
                <label htmlFor="inputConfirmPassword">Confirm New Password</label>
                <input
                  id="inputConfirmPassword"
                  type="password"
                  placeholder="Confirm new password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  onKeyDown={onPasswordKeyDown}
                />
              </div>
            </div>

            <div className={styles.formGroup} style={{ marginBottom: 0 }}>
              <span className={styles.hint}>
                Password must be at least 6 characters. Use a mix of letters, numbers, and symbols
                for a stronger password.
              </span>
            </div>

            <div className={styles.btnGroup}>
              <button
                className={`${styles.btn} ${styles.btnPrimary}`}
                onClick={() => void changePassword()}
                disabled={changingPassword}
              >
                {changingPassword ? 'Updating...' : 'Update Password'}
              </button>
            </div>
          </div>

          <div className={styles.settingsCard} style={{ marginTop: 20 }}>
            <div className={styles.settingsCardTitle}>Forgot Password</div>
            <div className={styles.settingsCardDesc}>
              If you&apos;ve forgotten your password, you can request a reset link.
            </div>
            <div className={`${styles.btnGroup} ${styles.btnGroupTight}`}>
              <Link href="/forgot-password" className={`${styles.btn} ${styles.btnOutline}`}>
                Request Password Reset
              </Link>
            </div>
          </div>
        </>
      )}

      {/* Tab: Account */}
      {tab === 'account' && (
        <>
          <div className={styles.settingsCard}>
            <div className={styles.settingsCardTitle}>Session</div>
            <div className={styles.settingsCardDesc}>Manage your current session.</div>
            <div className={`${styles.btnGroup} ${styles.btnGroupTight}`}>
              <button
                className={`${styles.btn} ${styles.btnOutline}`}
                onClick={() => router.push('/')}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                  <polyline points="9 22 9 12 15 12 15 22" />
                </svg>
                Back to Home
              </button>
              <button
                className={`${styles.btn} ${styles.btnDangerOutline}`}
                onClick={confirmSignOut}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
                Sign Out
              </button>
            </div>
          </div>

          <div className={`${styles.settingsCard} ${styles.dangerZone}`}>
            <div className={styles.settingsCardTitle}>Danger Zone</div>
            <div className={styles.settingsCardDesc}>
              Irreversible actions. Please be certain before proceeding.
            </div>
            <div className={`${styles.btnGroup} ${styles.btnGroupTight}`}>
              <button
                className={`${styles.btn} ${styles.btnDangerOutline}`}
                onClick={() =>
                  showToast('Account deletion is not available at this time.', 'error')
                }
              >
                Delete Account
              </button>
            </div>
          </div>
        </>
      )}

      {/* Toast */}
      <div className={`${styles.toast} ${toast ? `${styles[toast.type]} ${styles.show}` : ''}`}>
        {toast?.msg}
      </div>
    </main>
  );
}
