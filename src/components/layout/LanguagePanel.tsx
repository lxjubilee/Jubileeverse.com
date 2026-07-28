'use client';

import { useMemo, useState } from 'react';
import { LANGUAGES } from '@/lib/languages';

interface Props {
  open: boolean;
  currentLang: string;
  onClose: () => void;
  onSelect: (code: string) => void;
}

/** Slide-out language picker (drives client-side translation). */
export default function LanguagePanel({ open, currentLang, onClose, onSelect }: Props) {
  const [filter, setFilter] = useState('');

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
      <div className={`lang-panel${open ? ' open' : ''}`} aria-hidden={!open}>
        <div className="lang-panel-header">
          <h3>Languages</h3>
          <button className="lang-panel-close" onClick={onClose} title="Close">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="lang-search-wrap">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            className="lang-search"
            placeholder="Search languages..."
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
              <div
                key={lang.code}
                className={`lang-option${lang.code === currentLang ? ' active' : ''}`}
                onClick={() => onSelect(lang.code)}
              >
                <img
                  className="lang-option-flag"
                  src={`https://flagcdn.com/w80/${lang.flag}.png`}
                  alt={lang.name}
                  loading="lazy"
                />
                <span>{lang.name}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
