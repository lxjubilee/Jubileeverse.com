'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

interface IndexItem {
  id?: string | number;
  title?: string;
  headline?: string;
  category?: string;
  taxonomySlug?: string;
  slug?: string;
  image?: string;
  cached_image_path?: string;
  image_url?: string;
}

/**
 * Header search. The SEARCH button (and Enter) navigate to /search?q=…; while
 * typing, a dropdown previews matches from the homepage-built search index
 * (sessionStorage["jubileeSearchIndex"]), matching the original behavior.
 */
export default function SearchBox() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<IndexItem[]>([]);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  const runLocalSearch = (term: string) => {
    const q = term.trim().toLowerCase();
    if (!q) {
      setResults([]);
      setOpen(false);
      return;
    }
    let index: IndexItem[] = [];
    try {
      index = JSON.parse(sessionStorage.getItem('jubileeSearchIndex') || '[]');
    } catch {
      index = [];
    }
    const matches = index
      .filter((it) => `${it.title || it.headline || ''}`.toLowerCase().includes(q))
      .slice(0, 8);
    setResults(matches);
    setOpen(true);
  };

  const navigateToSearch = () => {
    const q = query.trim();
    router.push(q ? `/search?q=${encodeURIComponent(q)}` : '/search');
    setOpen(false);
  };

  const openItem = (item: IndexItem) => {
    setOpen(false);
    if (item.id != null) router.push(`/article/${item.id}`);
    else navigateToSearch();
  };

  return (
    <div className="search-box header-search-box" id="searchBox" ref={boxRef}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="11" cy="11" r="8" />
        <path d="M21 21l-4.35-4.35" />
      </svg>
      <input
        type="text"
        id="searchInput"
        placeholder="Search..."
        autoComplete="off"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          runLocalSearch(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') navigateToSearch();
        }}
      />
      <button className="search-btn" id="searchBtn" onClick={navigateToSearch} title="Search">
        SEARCH
      </button>
      <div className={`search-results${open && results.length ? ' active' : ''}`} id="searchResults">
        {results.map((item, i) => {
          const img = item.image || item.cached_image_path || item.image_url || '';
          return (
            <div className="search-result-item" key={`${item.id ?? i}`} onClick={() => openItem(item)}>
              {img ? <img className="search-result-img" src={img} alt="" /> : null}
              <div className="search-result-info">
                <div className="search-result-title">{item.title || item.headline}</div>
                {item.category ? <div className="search-result-category">{item.category}</div> : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
