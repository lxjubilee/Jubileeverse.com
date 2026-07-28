'use client';

import { useEffect, useState } from 'react';

export interface DailyVerse {
  text: string;
  reference: string;
}

/** Fetches the daily verse (/api/daily-verse, falling back to /api/verse). */
export function useDailyVerse(): DailyVerse | null {
  const [verse, setVerse] = useState<DailyVerse | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const url of ['/api/daily-verse', '/api/verse']) {
        try {
          const r = await fetch(url);
          if (!r.ok) continue;
          const d = await r.json();
          const text = d.text || d.verse || d.content || d.verse_text;
          const reference = d.reference || d.ref || d.citation || '';
          if (text && !cancelled) {
            setVerse({ text, reference });
            return;
          }
        } catch {
          /* try next */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return verse;
}
