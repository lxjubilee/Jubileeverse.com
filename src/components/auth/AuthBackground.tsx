'use client';

import { useEffect, useState } from 'react';
import styles from '@/app/(auth)/auth.module.css';

interface Props {
  images: string[];
  quote: string;
  cite: string;
}

/** Right-hand scripture panel with a rotating background image + bubbles. */
export default function AuthBackground({ images, quote, cite }: Props) {
  const [bg, setBg] = useState<string>(images[0] ?? '');

  useEffect(() => {
    const pick = () => setBg(images[Math.floor(Math.random() * images.length)] ?? '');
    pick();
    const t = setInterval(pick, 4000);
    return () => clearInterval(t);
  }, [images]);

  return (
    <div className={styles.bgPanel} style={{ backgroundImage: bg ? `url('${bg}')` : undefined }}>
      <div className={styles.bgOverlay} />
      <ul className={styles.bubbles}>
        {Array.from({ length: 10 }).map((_, i) => (
          <li key={i} />
        ))}
      </ul>
      <div className={styles.bgContent}>
        <blockquote>{quote}</blockquote>
        <cite>{cite}</cite>
      </div>
    </div>
  );
}
