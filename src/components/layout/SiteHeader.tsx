'use client';

import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import ProfileMenu from './ProfileMenu';
import SearchBox from './SearchBox';

/** Sticky top header: branding, quick media links, search, and the auth area. */
export default function SiteHeader() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  return (
    <header className="header">
      <div className="header-inner">
        <Link href="/" className="logo">
          {/*
            Served from Next's own public/ — deliberately NOT under /images, which
            rewrites to Express. The original there is a 1091px, 801 KB PNG for a
            32px icon, and streaming it through the dev proxy reset often enough to
            leave the header logo broken. This copy is 256px and needs no proxy hop.
          */}
          <img src="/brand/brand-logo.png" alt="Jubilee" className="logo-icon" />
          <div className="logo-text">
            Jubilee<span className="logo-verse">Verse</span>
            <span className="logo-dotcom">.com</span>
          </div>
        </Link>

        <div className="header-actions">
          <div className="header-media-links">
            <Link href="/prayer">Prayer</Link>
            <span className="divider">|</span>
            <Link href="/music">Music</Link>
            <span className="divider">|</span>
            <Link href="/radio">Radio</Link>
            <span className="divider">|</span>
            <a href="https://www.jubileeinspire.com" target="_blank" rel="noopener noreferrer">
              AI Bible Chat
            </a>
            {isAdmin && (
              <>
                <span className="divider">|</span>
                <Link href="/admin" className="header-admin-link">
                  Admin
                </Link>
              </>
            )}
          </div>

          <SearchBox />
          <ProfileMenu />
        </div>
      </div>
    </header>
  );
}
