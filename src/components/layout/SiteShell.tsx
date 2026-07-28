'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import LanguagePanel from './LanguagePanel';
import NavBar from './NavBar';
import PersonalizePopup from './PersonalizePopup';
import SiteFooter from './SiteFooter';
import SiteHeader from './SiteHeader';
import { getSiteLang, observeContentTranslation, setSiteLang, translatePage } from '@/lib/translate';
import type { NavCategory } from '@/lib/cdn';

interface Props {
  children: ReactNode;
  /** Five-fold nav categories, read from the CDN catalog by the (site) layout. */
  navCategories: NavCategory[];
}

/**
 * The public-site chrome: header + nav + footer plus the global language panel,
 * personalize popup, and the client-side translation pass. Wraps every page in
 * the (site) route group.
 */
export default function SiteShell({ children, navCategories }: Props) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const [personalizeOpen, setPersonalizeOpen] = useState(false);
  const [lang, setLang] = useState('en-US');
  const [translating, setTranslating] = useState(false);
  const didTranslate = useRef(false);

  // Hydrate the saved language, run the initial translation pass, then keep
  // translating as content loads (feed/hero render async).
  useEffect(() => {
    const saved = getSiteLang();
    setLang(saved);
    if (!saved || saved.startsWith('en') || didTranslate.current) return;
    didTranslate.current = true;
    setTranslating(true);
    translatePage(saved).finally(() => setTranslating(false));
    const stop = observeContentTranslation(saved);
    return stop;
  }, []);

  const toggleMobileMenu = useCallback(() => setMobileMenuOpen((v) => !v), []);

  const handleSelectLang = useCallback((code: string) => {
    setSiteLang(code);
    setLang(code);
    setLangOpen(false);
    // Reload so the page renders fresh English DOM, then the mount effect
    // re-translates into the chosen language (matches the original behavior).
    window.location.reload();
  }, []);

  return (
    <div className="app-shell">
      <div className={`translate-bar${translating ? ' active' : ''}`} />

      <SiteHeader />
      <NavBar
        categories={navCategories}
        mobileMenuOpen={mobileMenuOpen}
        currentLang={lang}
        onToggleMobileMenu={toggleMobileMenu}
        onOpenLang={() => setLangOpen(true)}
        onOpenPersonalize={() => setPersonalizeOpen(true)}
      />

      <div
        className={`nav-overlay${mobileMenuOpen ? ' active' : ''}`}
        onClick={() => setMobileMenuOpen(false)}
      />

      {children}

      <SiteFooter />

      <LanguagePanel
        open={langOpen}
        currentLang={lang}
        onClose={() => setLangOpen(false)}
        onSelect={handleSelectLang}
      />
      <PersonalizePopup open={personalizeOpen} onClose={() => setPersonalizeOpen(false)} />
    </div>
  );
}
