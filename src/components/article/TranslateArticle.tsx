'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { getAuthToken } from '@/lib/authStorage';
import { csrfHeaders } from '@/lib/csrf';
import { LANGUAGES, getLangName } from '@/lib/languages';
import { getSiteLang } from '@/lib/translate';
import styles from './widgets.module.css';

/**
 * Where a CDN news article is stored, so the backend can find the translation it
 * filed there last time.
 *
 * Only news needs this. A published bundle is addressed as `<category>__<slug>`,
 * which the backend can turn into a storage path on its own; a news article
 * arrives as `reactionIdForSlug(slug)`, a one-way hash, so its day and slug have
 * to travel separately.
 */
export interface NewsCdnOrigin {
  /** The PST day the article is filed under (`YYYY-MM-DD`). */
  date: string;
  slug: string;
}

interface Props {
  articleId: string | number;
  fallbackTitle: string;
  fallbackContent: string;
  /** CDN coordinates for news; omitted for every other source. */
  cdnOrigin?: NewsCdnOrigin;
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
 * Characters of translation per character of English, by language subtag.
 *
 * The stream carries no length of its own — the model is answering one open
 * request, and neither it nor the endpoint knows how long the answer runs until
 * it ends. So progress is measured against what the translation is expected to
 * weigh, and that expectation has to account for the script: the same story is
 * about half as many characters in Chinese and a quarter longer in German, and
 * a flat comparison against the English body would park Chinese at 100% halfway
 * through and German at 99% with three paragraphs still to come.
 *
 * These are approximations of typical prose, not measurements, which is why the
 * bar below is clamped and never allowed to walk backwards.
 */
const EXPANSION: Record<string, number> = {
  // zh and hi are measured off the translations already in the cache
  // (zh-CN 0.38 over a complete story; hi-IN 1.03–1.12 across four). The rest
  // are the usual figures for the script and will drift as real ones land.
  zh: 0.4, ja: 0.65, ko: 0.7, th: 0.85,
  ar: 0.95, he: 0.95, fa: 0.95, ur: 0.95, hi: 1.1, bn: 1,
  de: 1.25, nl: 1.2, fr: 1.15, es: 1.15, pt: 1.15, it: 1.1, ro: 1.15,
  ru: 1.1, uk: 1.1, pl: 1.1, el: 1.15, fi: 1.05, tr: 1.05, vi: 1.05,
};
/**
 * For a language with no entry above. Kept a little high on purpose: an estimate
 * that runs long ends with the bar jumping the last few percent, which reads as
 * finishing early, while one that runs short parks at 99% and reads as stuck.
 * Measured stored translations cluster around 1.0–1.05 (ro 1.02, af 1.04,
 * es 1.04–1.08, et 0.97, fr 1.18).
 */
const DEFAULT_EXPANSION = 1.05;

/**
 * How many characters the translated body should run to.
 *
 * Tags are excluded from the scaling because the prompt asks for them back
 * exactly as they arrived: an article that is half markup would otherwise be
 * measured as if the markup shrank along with the prose.
 *
 * Returns 0 when there is nothing to measure against, which the caller reads as
 * "no estimate" and renders as a plain spinner — a made-up percentage is worse
 * than none.
 */
function expectedChars(source: string, code: string): number {
  if (!source.trim()) return 0;
  const ratio = EXPANSION[code.split('-')[0]] ?? DEFAULT_EXPANSION;
  const markup = (source.match(/<[^>]*>/g) || []).join('').length;
  return Math.round(markup + (source.length - markup) * ratio);
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
  cdnOrigin,
  onTranslated,
  onRestore,
  onLanguageChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [current, setCurrent] = useState<string>('en-US');
  const [status, setStatus] = useState<'idle' | 'loading' | 'streaming' | 'error'>('idle');
  /** Percent of the translation that has arrived, or null when it cannot be estimated. */
  const [progress, setProgress] = useState<number | null>(null);
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
    setProgress(null);
    setErrorMsg('');
    const langName = getLangName(code);

    // 1) cache hit? Carrying the CDN coordinates here rather than only on the
    // POST is what makes this the cheap path: the backend can answer from stored
    // bytes for the price of this request, instead of the reader uploading the
    // whole article body below just to be told it was already translated.
    const originQuery = cdnOrigin
      ? `?news_date=${encodeURIComponent(cdnOrigin.date)}&news_slug=${encodeURIComponent(cdnOrigin.slug)}`
      : '';
    try {
      const r = await fetch(`/api/articles/${articleId}/translation/${code}${originQuery}`);
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
          ...(cdnOrigin ? { news_date: cdnOrigin.date, news_slug: cdnOrigin.slug } : {}),
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

      // Measured against the English the server was asked to translate, so the
      // count is known before the first chunk lands. Clamped to 99 while the
      // stream is open and never allowed to fall: the target is an estimate, and
      // a bar that reads 80% and then 60% looks broken in a way that a bar
      // resting a moment at 99% does not.
      const target = expectedChars(fallbackContent, code);
      const advance = (bodySoFar: string) => {
        if (!target) return;
        const pct = Math.min(99, Math.round((bodySoFar.length / target) * 100));
        setProgress((prev) => Math.max(prev ?? 0, pct));
      };
      if (target) setProgress(0);

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
            const body = streamedBody(acc);
            advance(body);
            onTranslated(titleRef.current, body);
          } else if (payload.type === 'cached' || payload.type === 'done') {
            onTranslated(payload.title || titleRef.current, payload.content || streamedBody(acc));
            // The whole article is on screen now, whatever the estimate said.
            if (target) setProgress(100);
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
    setProgress(null);
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
        <>
          <div className={styles.status}>
            <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
            <span>{status === 'loading' ? 'Preparing translation…' : 'Translating…'}</span>
            {status === 'streaming' && progress !== null ? (
              <span className={styles.statusPct}>{progress}%</span>
            ) : null}
          </div>
          {status === 'streaming' && progress !== null ? (
            <div
              className={styles.translateProgress}
              role="progressbar"
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Translating into ${currentLabel}`}
            >
              <div className={styles.progressFill} style={{ width: `${progress}%` }} />
            </div>
          ) : null}
        </>
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
