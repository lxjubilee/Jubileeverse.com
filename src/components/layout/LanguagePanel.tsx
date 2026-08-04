'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useDialogA11y } from '@/hooks/useDialogA11y';
import { LANGUAGES } from '@/lib/languages';

interface Props {
  open: boolean;
  currentLang: string;
  onClose: () => void;
  onSelect: (code: string) => void;
}

const TITLE_ID = 'langPanelTitle';

/** Slide-out language picker (drives client-side translation). */
export default function LanguagePanel({ open, currentLang, onClose, onSelect }: Props) {
  const [filter, setFilter] = useState('');
  const panelRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  // The panel never unmounts — it animates in place — so the a11y hook is gated
  // on `open` rather than on a mount, and role="dialog" sits on the ref'd node.
  useDialogA11y(panelRef, {
    labelledBy: TITLE_ID,
    initialFocusRef: searchRef,
    active: open,
  });

  // A stale filter from the last visit would otherwise greet the next one with a
  // near-empty list and no obvious cause.
  useEffect(() => {
    if (!open) setFilter('');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return LANGUAGES;
    return LANGUAGES.filter(
      (l) => l.name.toLowerCase().includes(q) || l.code.toLowerCase().includes(q),
    );
  }, [filter]);

  return (
    <>
      <div className={`lang-panel-overlay${open ? ' open' : ''}`} onClick={onClose} />
      {/* Hidden from assistive tech and from the tab order by visibility:hidden in
          the closed state — aria-hidden alone left the search field and close
          button reachable by Tab, focusable inside an aria-hidden subtree. */}
      <div
        ref={panelRef}
        className={`lang-panel${open ? ' open' : ''}`}
        role="dialog"
        aria-modal="true"
      >
        <div className="lang-panel-header">
          <h3 id={TITLE_ID}>Languages</h3>
          <button className="lang-panel-close" onClick={onClose} title="Close" aria-label="Close">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="lang-search-wrap">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            ref={searchRef}
            className="lang-search"
            placeholder="Search languages..."
            aria-label="Search languages"
            autoComplete="off"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        <div className="lang-options">
          {filtered.length === 0 ? (
            <div className="lang-no-results">No languages found</div>
          ) : (
            filtered.map((lang) => (
              <button
                key={lang.code}
                type="button"
                className={`lang-option${lang.code === currentLang ? ' active' : ''}`}
                aria-current={lang.code === currentLang ? 'true' : undefined}
                onClick={() => onSelect(lang.code)}
              >
                <img
                  className="lang-option-flag"
                  src={`https://flagcdn.com/w80/${lang.flag}.png`}
                  alt=""
                  loading="lazy"
                />
                <span>{lang.name}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </>
  );
}
