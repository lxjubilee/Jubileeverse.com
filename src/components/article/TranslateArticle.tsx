'use client';

import { useMemo, useRef, useState } from 'react';
import { getAuthToken } from '@/lib/authStorage';
import { LANGUAGES, getLangName } from '@/lib/languages';
import styles from './widgets.module.css';

interface Props {
  articleId: string | number;
  fallbackTitle: string;
  fallbackContent: string;
  /** Called as translated text streams in (title, content). */
  onTranslated: (title: string, content: string) => void;
  /** Restore the original English title/content. */
  onRestore: () => void;
}

interface SsePayload {
  type: 'cached' | 'chunk' | 'metadata' | 'done' | 'error';
  title?: string;
  content?: string;
  text?: string;
  message?: string;
}

/**
 * Translate Article widget. Tries the translation cache
 * (`GET /api/articles/:id/translation/:lang`) then streams a fresh translation
 * (`POST /api/articles/:id/translate`, SSE: cached|chunk|metadata|done|error).
 */
export default function TranslateArticle({
  articleId,
  fallbackTitle,
  fallbackContent,
  onTranslated,
  onRestore,
}: Props) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [current, setCurrent] = useState<string>('en-US');
  const [status, setStatus] = useState<'idle' | 'loading' | 'streaming' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const titleRef = useRef(fallbackTitle);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = LANGUAGES.filter((l) => !l.code.startsWith('en'));
    if (!q) return list;
    return list.filter((l) => l.name.toLowerCase().includes(q) || l.code.toLowerCase().includes(q));
  }, [filter]);

  const translate = async (code: string) => {
    setOpen(false);
    setCurrent(code);
    setStatus('loading');
    setErrorMsg('');
    const langName = getLangName(code);

    // 1) cache hit?
    try {
      const r = await fetch(`/api/articles/${articleId}/translation/${code}`);
      if (r.ok) {
        const d = (await r.json()) as { found?: boolean; title?: string; content?: string };
        if (d.found && d.content) {
          onTranslated(d.title || fallbackTitle, d.content);
          setStatus('idle');
          return;
        }
      }
    } catch {
      /* fall through to streaming */
    }

    // 2) stream a fresh translation
    try {
      const token = getAuthToken();
      const res = await fetch(`/api/articles/${articleId}/translate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          language_code: code,
          language_name: langName,
          fallback_title: fallbackTitle,
          fallback_content: fallbackContent,
        }),
      });
      if (!res.ok || !res.body) throw new Error('Translation unavailable');

      setStatus('streaming');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let acc = '';

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split('\n\n');
        buffer = frames.pop() || '';
        for (const frame of frames) {
          const line = frame.split('\n').find((l) => l.startsWith('data:'));
          if (!line) continue;
          let payload: SsePayload;
          try {
            payload = JSON.parse(line.slice(5).trim());
          } catch {
            continue;
          }
          if (payload.type === 'error') {
            throw new Error(payload.message || 'Translation error');
          } else if (payload.type === 'metadata' && payload.title) {
            titleRef.current = payload.title;
            onTranslated(titleRef.current, acc);
          } else if (payload.type === 'chunk' && payload.text) {
            acc += payload.text;
            onTranslated(titleRef.current, acc);
          } else if (payload.type === 'cached' || payload.type === 'done') {
            onTranslated(payload.title || titleRef.current, payload.content || acc);
          }
        }
      }
      setStatus('idle');
    } catch (e) {
      setStatus('error');
      setErrorMsg(e instanceof Error ? e.message : 'Translation failed');
      setCurrent('en-US');
    }
  };

  const restore = () => {
    setCurrent('en-US');
    setStatus('idle');
    titleRef.current = fallbackTitle;
    onRestore();
  };

  const currentLabel = current.startsWith('en') ? 'English' : getLangName(current);

  return (
    <section className={styles.widget}>
      <div className={styles.widgetTitle}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M5 8l6 6M4 14l6-6 2-3M2 5h12M7 2h1M22 22l-5-10-5 10M14 18h6" />
        </svg>
        Translate Article
      </div>

      <div className={styles.selectWrap}>
        <button className={styles.selectBtn} onClick={() => setOpen((v) => !v)}>
          <span>{currentLabel}</span>
          <span>▾</span>
        </button>
        {open ? (
          <div className={styles.dropdown}>
            <input
              className={styles.search}
              placeholder="Search languages…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              autoFocus
            />
            {filtered.map((l) => (
              <div key={l.code} className={styles.langOption} onClick={() => translate(l.code)}>
                <img src={`https://flagcdn.com/w80/${l.flag}.png`} alt="" loading="lazy" />
                <span>{l.name}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {status === 'loading' || status === 'streaming' ? (
        <div className={styles.status}>
          <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
          {status === 'loading' ? 'Preparing translation…' : 'Translating…'}
        </div>
      ) : null}
      {status === 'error' ? <div className={styles.error} style={{ marginTop: 10 }}>{errorMsg}</div> : null}

      {!current.startsWith('en') && status === 'idle' ? (
        <button className={styles.restoreBtn} onClick={restore}>
          Restore English
        </button>
      ) : null}
    </section>
  );
}
