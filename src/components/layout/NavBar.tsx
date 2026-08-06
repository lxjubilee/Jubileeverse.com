'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { getLangFlag } from '@/lib/languages';
import type { NavCategory } from '@/lib/cdn';

interface Props {
  /** Five-fold categories from the CDN catalog, resolved server-side. */
  categories: NavCategory[];
  mobileMenuOpen: boolean;
  currentLang: string;
  onToggleMobileMenu: () => void;
  onOpenLang: () => void;
  onOpenPersonalize: () => void;
}

const MEDIA_LINKS = [
  { href: 'https://jubilujah.com', label: 'MUSIC', external: true },
  { href: 'https://www.jubileeinspire.com', label: 'AI BIBLE CHAT', external: true },
];

/** Secondary nav bar: taxonomy links, mobile menu, personalize + language. */
export default function NavBar({
  categories,
  mobileMenuOpen,
  currentLang,
  onToggleMobileMenu,
  onOpenLang,
  onOpenPersonalize,
}: Props) {
  const pathname = usePathname();

  /**
   * Active on the link's own page and on anything nested beneath it, so a
   * category stays highlighted while the reader drills into its subcategories
   * (/covenant-identity/who-you-are-in-yeshua/sealed-by-the-ruach-hakodesh/…).
   * Compared per path segment, so /prayer never lights up for /prayer-requests.
   */
  const isActive = (href: string) => {
    const base = href.replace(/\/+$/, '');
    return pathname === base || pathname.startsWith(`${base}/`);
  };

  return (
    <div className="nav-bar">
      <div className="nav-bar-inner">
        <nav className={`nav-menu${mobileMenuOpen ? ' mobile-open' : ''}`} id="navMenu">
          <button className="hamburger-btn" onClick={onToggleMobileMenu} aria-label="Menu">
            <span className="hamburger-line" />
            <span className="hamburger-line" />
            <span className="hamburger-line" />
          </button>

          <Link href="/" className={`nav-link${pathname === '/' ? ' active' : ''}`} id="homeNavLink">
            HOME
          </Link>

          {categories.map((link) => (
            <Link
              key={link.slug}
              href={`/${link.slug}`}
              className={`nav-link${isActive(`/${link.slug}`) ? ' active' : ''}`}
              data-taxonomy-slug={link.slug}
            >
              {link.label}
            </Link>
          ))}

          {MEDIA_LINKS.map((link) =>
            link.external ? (
              <a
                key={link.label}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className="nav-link mobile-media-link"
              >
                {link.label}
              </a>
            ) : (
              <Link
                key={link.label}
                href={link.href}
                className={`nav-link mobile-media-link${isActive(link.href) ? ' active' : ''}`}
              >
                {link.label}
              </Link>
            ),
          )}

          <button className="mobile-close-btn" onClick={onToggleMobileMenu} aria-label="Close menu">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6L6 18" />
              <path d="M6 6l12 12" />
            </svg>
          </button>
        </nav>

        <div className="nav-right">
          <button className="btn-personalize" onClick={onOpenPersonalize} title="Personalize your feed">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            <span>PERSONALIZE</span>
          </button>
          <button className="btn-lang" onClick={onOpenLang} title="Language">
            <img
              className="btn-lang-flag"
              src={`https://flagcdn.com/w80/${getLangFlag(currentLang)}.png`}
              alt={currentLang}
            />
          </button>
        </div>
      </div>
    </div>
  );
}
