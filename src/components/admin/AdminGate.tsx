'use client';

import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useAuth } from '@/lib/auth';

/**
 * Gates the back-office routes. Shows a spinner while auth resolves, then
 * requires CMS access (same rule as the original "Back Office" link). Users
 * without access are redirected to /signin.
 */
export default function AdminGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { isLoading, isAuthenticated, canAccessCms } = useAuth();

  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated) {
      router.replace('/signin?redirect=/admin');
    } else if (!canAccessCms) {
      router.replace('/');
    }
  }, [isLoading, isAuthenticated, canAccessCms, router]);

  if (isLoading || !isAuthenticated || !canAccessCms) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div className="spinner" />
      </div>
    );
  }

  return <>{children}</>;
}
