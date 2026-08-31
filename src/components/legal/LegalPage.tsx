import Link from 'next/link';
import styles from './legal.module.css';

/**
 * A boxed aside for the clauses a reader should not skim past — the AI
 * disclaimer, the crisis line, the liability cap.
 */
export function Callout({ children }: { children: React.ReactNode }) {
  return <div className={styles.callout}>{children}</div>;
}

/** The "who to write to" card that closes each document. */
export function ContactCard({ children }: { children: React.ReactNode }) {
  return <div className={styles.contact}>{children}</div>;
}

export interface LegalSection {
  /** Anchor id — also the fragment the contents rail links to. */
  id: string;
  /** Heading text, shown in the rail and as the section's <h2>. */
  title: string;
  body: React.ReactNode;
}

interface Props {
  eyebrow: string;
  /** Rendered as "<title> <accent>" so the second half picks up the accent azure. */
  title: string;
  accent: string;
  summary: string;
  effective: string;
  updated: string;
  /** Intro paragraphs, above the first numbered section. */
  lead: React.ReactNode;
  sections: LegalSection[];
  /** "The other document" link at the foot of the page. */
  crossLink: { href: string; label: string; blurb: string };
}

/**
 * Shell for the two standalone legal pages, /terms and /privacy.
 *
 * These replaced a pair of modals that opened over the auth screens: the text
 * was unlinkable, unprintable and invisible to crawlers, and a reader who
 * closed one lost their place. Each page is now a plain server-rendered
 * document with a stable URL and an anchor per section, so a clause can be
 * cited directly (/terms#ai-generated-content).
 */
export default function LegalPage({
  eyebrow,
  title,
  accent,
  summary,
  effective,
  updated,
  lead,
  sections,
  crossLink,
}: Props) {
  return (
    <>
      <section className={styles.hero}>
        <div className={styles.heroEyebrow}>{eyebrow}</div>
        <h1 className={styles.heroTitle}>
          {title} <span className={styles.accent}>{accent}</span>
        </h1>
        <p className={styles.heroSub}>{summary}</p>
        <div className={styles.heroMeta}>
          <span className={styles.metaChip}>
            <strong>Effective</strong> {effective}
          </span>
          <span className={styles.metaChip}>
            <strong>Last updated</strong> {updated}
          </span>
        </div>
      </section>

      <div className={styles.layout}>
        <nav className={styles.toc} aria-label="On this page">
          <div className={styles.tocTitle}>On this page</div>
          <ol className={styles.tocList}>
            {sections.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`}>{s.title}</a>
              </li>
            ))}
          </ol>
        </nav>

        <main className={styles.body}>
          <div className={styles.lead}>{lead}</div>

          {sections.map((s) => (
            <section key={s.id} id={s.id}>
              <h2>{s.title}</h2>
              {s.body}
            </section>
          ))}

          <p className={styles.crossLink}>
            {crossLink.blurb} <Link href={crossLink.href}>{crossLink.label}</Link>
          </p>
        </main>
      </div>
    </>
  );
}
