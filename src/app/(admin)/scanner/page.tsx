'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import ArticlePanel from '@/components/scanner/ArticlePanel';
import StoryCard from '@/components/scanner/StoryCard';
import { runScan, type ScanProgress } from '@/components/scanner/scanEngine';
import type { ScannerStory } from '@/components/scanner/scannerData';
import styles from './scanner.module.css';

type ScanState = 'ready' | 'scanning' | 'error';

interface Toast {
  id: number;
  message: string;
  type: 'success' | 'info';
  hiding: boolean;
}

let toastIdCounter = 0;

/**
 * News Scanner (back-office). Faithful port of /public/scanner.html.
 *
 * Scans the top story from five RSS sources, scores them by prominence, selects
 * the top 3, acquires an image via a cascading fallback, and rewrites each with
 * a hopeful, faith-inspired perspective. Auth is handled by the (admin) layout's
 * AdminGate, so this page does not re-check it.
 */
export default function ScannerPage() {
  const [topStories, setTopStories] = useState<ScannerStory[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  const [isScanning, setIsScanning] = useState(false);
  const isScanningRef = useRef(false);

  const [status, setStatus] = useState<{ state: ScanState; text: string }>({
    state: 'ready',
    text: 'Ready',
  });

  const [overlay, setOverlay] = useState({
    text: 'Scanning news sources...',
    subtext: 'Analyzing prominence and relevance across 5 major news outlets',
  });

  const [toasts, setToasts] = useState<Toast[]>([]);

  const showNotification = useCallback((message: string, type: 'success' | 'info' = 'info') => {
    toastIdCounter += 1;
    const id = toastIdCounter;
    setToasts((prev) => [...prev, { id, message, type, hiding: false }]);
    // Start fade after 2.5s, then remove (matches original timing).
    setTimeout(() => {
      setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, hiding: true } : t)));
      setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 300);
    }, 2500);
  }, []);

  const closePanel = useCallback(() => {
    setPanelOpen(false);
  }, []);

  const handleRunScan = useCallback(async () => {
    if (isScanningRef.current) return;
    isScanningRef.current = true;
    setIsScanning(true);
    setStatus({ state: 'scanning', text: 'Scanning...' });
    setOverlay({
      text: 'Scanning news sources...',
      subtext: 'Analyzing prominence and relevance across 5 major news outlets',
    });

    const onProgress: ScanProgress = (text, subtext) => setOverlay({ text, subtext });

    try {
      const { topStories: results } = await runScan(onProgress);
      setTopStories(results);
      setStatus({ state: 'ready', text: `Scan complete - ${results.length} stories found` });
    } catch (error) {
      console.error('Scan error:', error);
      setStatus({ state: 'error', text: 'Scan failed' });
    } finally {
      isScanningRef.current = false;
      setIsScanning(false);
    }
  }, []);

  const clearTopStories = useCallback(() => {
    if (topStories.length > 0 && window.confirm('Are you sure you want to clear all stories?')) {
      setTopStories([]);
      setSelectedIndex(null);
      setPanelOpen(false);
    }
  }, [topStories.length]);

  const openArticleDetail = useCallback((index: number) => {
    setSelectedIndex(index);
    setPanelOpen(true);
  }, []);

  const approveStory = useCallback(() => {
    if (selectedIndex === null) return;
    setTopStories((prev) =>
      prev.map((s, i) => (i === selectedIndex ? { ...s, status: 'approved' } : s)),
    );
    showNotification('Article approved and published!', 'success');
    setPanelOpen(false);
  }, [selectedIndex, showNotification]);

  const rejectStory = useCallback(() => {
    if (selectedIndex === null) return;
    setTopStories((prev) =>
      prev.map((s, i) => (i === selectedIndex ? { ...s, status: 'rejected' } : s)),
    );
    showNotification('Article rejected.', 'info');
    setPanelOpen(false);
  }, [selectedIndex, showNotification]);

  // Keyboard shortcuts: ESC closes the panel, Ctrl/Cmd+S triggers a scan.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closePanel();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        void handleRunScan();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [closePanel, handleRunScan]);

  const selectedStory = selectedIndex !== null ? (topStories[selectedIndex] ?? null) : null;
  const hasStories = topStories.length > 0;

  return (
    <div className={styles.scanner}>
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link href="/" className={styles.logo}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/jubilee-logo.png" alt="JubileeVerse" className={styles.logoIcon} />
            <div className={styles.logoText}>
              Jubilee<span>Verse</span> <span>Scanner</span>
            </div>
          </Link>

          <div className={styles.headerActions}>
            <div className={styles.scanStatus}>
              <span
                className={`${styles.statusDot} ${status.state === 'scanning' ? styles.scanning : ''}`}
                style={{
                  background:
                    status.state === 'scanning'
                      ? 'var(--accent-orange)'
                      : status.state === 'error'
                        ? 'var(--accent-red)'
                        : 'var(--accent-green)',
                }}
              />
              <span>{status.text}</span>
            </div>
            <button className={`${styles.btn} ${styles.btnSecondary}`} onClick={clearTopStories}>
              <svg className={styles.btnIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
              </svg>
              Clear
            </button>
            <button
              className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={() => void handleRunScan()}
              disabled={isScanning}
            >
              <svg className={styles.btnIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 6v6l4 2" />
              </svg>
              Scan for Top 3 Stories
            </button>
          </div>
        </div>
      </header>

      {/* Scanning Overlay */}
      <div className={`${styles.scanningOverlay} ${isScanning ? styles.active : ''}`}>
        <div className={`${styles.loadingSpinner} ${styles.loadingSpinnerLarge}`} />
        <div className={styles.scanningText}>{overlay.text}</div>
        <div className={styles.scanningSubtext}>{overlay.subtext}</div>
      </div>

      {/* Main Container */}
      <div className={styles.mainContainer}>
        <div className={`${styles.scannerContent} ${panelOpen ? styles.panelOpen : ''}`}>
          {!hasStories ? (
            <div className={styles.emptyState}>
              <div className={styles.emptyStateIcon}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <circle cx="11" cy="11" r="8" />
                  <path d="M21 21l-4.35-4.35" />
                  <path d="M11 8v6M8 11h6" />
                </svg>
              </div>
              <h3 className={styles.emptyStateTitle}>Find Today&apos;s Top 3 Most Prominent Stories</h3>
              <p className={styles.emptyStateText}>
                Click &quot;Scan for Top 3 Stories&quot; to analyze headlines from Yahoo, NY Times, MSN,
                CNN, and Fox News. The scanner will identify the three most prominent articles and
                transform them with hopeful, faith-inspired perspectives.
              </p>
              <button
                className={`${styles.btn} ${styles.btnPrimary}`}
                onClick={() => void handleRunScan()}
                disabled={isScanning}
              >
                <svg className={styles.btnIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 6v6l4 2" />
                </svg>
                Start Scanning
              </button>
            </div>
          ) : (
            <div className={styles.topStoriesContainer}>
              <div className={styles.topStoriesHeader}>
                <h2>Today&apos;s Top Stories</h2>
                <p>The 3 most prominent news stories, transformed with hope</p>
              </div>
              <div className={styles.topStoriesGrid}>
                {topStories.map((story, index) => (
                  <StoryCard
                    key={story.id}
                    story={story}
                    rank={index + 1}
                    onOpen={() => openArticleDetail(index)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Slide-over Panel */}
      <ArticlePanel
        story={selectedStory}
        open={panelOpen}
        onClose={closePanel}
        onApprove={approveStory}
        onReject={rejectStory}
      />

      {/* Toast notifications */}
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`${styles.notification} ${styles[toast.type]} ${toast.hiding ? styles.hiding : ''}`}
        >
          {toast.message}
        </div>
      ))}
    </div>
  );
}
