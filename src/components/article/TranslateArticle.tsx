'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { getAuthToken } from '@/lib/authStorage';
import { csrfHeaders } from '@/lib/csrf';
import { LANGUAGES, getLangName } from '@/lib/languages';
import { getSiteLang } from '@/lib/translate';
import styles from './widgets.module.css';

interface Props {
  articleId: string | number;
  fallbackTitle: string;
  fallbackContent: string;
  /** Called as translated text streams in (title, content). */
  onTranslated: (title: string, content: string) => void;
  /** Restore the original English title/content. */
  onRestore: () => void;
  /**
   * The language the article body is currently in ('en-US' when untranslated).
   * Read Aloud needs it: the spoken locale has to match the text on screen. An
   * English voice given a translated story reads it in an English accent at
   * best, and for a non-Latin script returns no audio at all.
   */
  onLanguageChange?: (code: string) => void;
}

interface SsePayload {
  type: 'cached' | 'chunk' | 'metadata' | 'done' | 'error';
  title?: string;
  content?: string;
  text?: string;
  message?: string;
}

/**
 * The envelope the endpoint asks the model for: `TITLE:` and its optional
 * `SOURCE:` / `CATEGORY:` companions, then a blank line, then the body — which
 * a model that was shown a `CONTENT:` marker on the way in tends to label on the
 * way out.
 */
const ENVELOPE_LABEL = /^(?:TITLE|SOURCE|CATEGORY|CONTENT)[ \t]*:/i;
const CONTENT_LABEL = /^\**[ \t]*CONTENT[ \t]*:\**[ \t]*\r?\n?/i;

/**
 * The body as it should read mid-stream.
 *
 * `done` carries content the server has already parsed and cleaned, but the
 * chunks before it are the model's raw answer, and they are rendered as they
 * arrive. So a reader watching a translation appear watched the envelope appear
 * first — `TITLE:…` on the opening chunk, then `CONTENT:` sitting where the
 * first sentence belongs. Stripped here as well as on the server, because the
 * server never sees this intermediate state.
 *
 * While the header is still arriving there is no body to show yet, so nothing is
 * shown: better a moment of empty than a moment of `TITLE:`. A response that
 * opens straight into prose is passed through untouched.
 */
function streamedBody(raw: string): string {
  if (!ENVELOPE_LABEL.test(raw.trimStart())) return raw.replace(CONTENT_LABEL, '');
  const blank = raw.indexOf('\n\n');
  if (blank === -1) return '';
  return raw.slice(blank + 2).replace(CONTENT_LABEL, '');
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
  onLanguageChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [current, setCurrent] = useState<string>('en-US');
  const [status, setStatus] = useState<'idle' | 'loading' | 'streaming' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const titleRef = useRef(fallbackTitle);
  const didAdoptSiteLang = useRef(false);

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
          // Signed-in readers carry a session cookie, and the backend's CSRF
          // guard 403s any /api/ POST that does not echo the jv-csrf cookie.
          ...csrfHeaders(),
        },
        body: JSON.stringify({
          language_code: code,
          language_name: langName,
          fallback_title: fallbackTitle,
          fallback_content: fallbackContent,
        }),
      });
      // The status is worth keeping: a bare "unavailable" gave no way to tell a
      // rejected request from a translation the model could not produce.
      if (!res.ok || !res.body) {
        throw new Error(`Translation unavailable (${res.status})`);
      }

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
            onTranslated(titleRef.current, streamedBody(acc));
          } else if (payload.type === 'chunk' && payload.text) {
            acc += payload.text;
            onTranslated(titleRef.current, streamedBody(acc));
          } else if (payload.type === 'cached' || payload.type === 'done') {
            onTranslated(payload.title || titleRef.current, payload.content || streamedBody(acc));
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

  // The header's language picker translates the chrome but not the story, so a
  // reader on Spanish used to land on an English article and have to ask for the
  // same language a second time, on every article. Adopt their site choice here.
  // Once only: after a Restore English, or a different pick in this widget, the
  // reader's choice for THIS article stands. The ref (not a state flag) is also
  // what makes StrictMode's double-invoked effect a single translation.
  useEffect(() => {
    if (didAdoptSiteLang.current) return;
    const siteLang = getSiteLang();
    if (!siteLang || siteLang.startsWith('en')) return;
    didAdoptSiteLang.current = true;
    void translate(siteLang);
    // translate() closes over the parent's inline callbacks, which change identity
    // every render; the ref guard is what keeps this to a single pass.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Report the article's language from one place rather than at each site that
  // sets it: an explicit pick, the site-language adoption above, the reset to
  // English when a translation fails, and Restore English all move `current`.
  useEffect(() => {
    onLanguageChange?.(current);
  }, [current, onLanguageChange]);

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
