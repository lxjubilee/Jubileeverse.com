'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from './welcome.module.css';

/**
 * Standalone onboarding / splash page.
 *
 * Faithful port of the original static `/welcome/index.html`: a full-screen
 * intro video (`/welcome.mp4`, proxied to the backend by next.config) that, when
 * it finishes — or when the user clicks "Skip to Chat" — animates a progress bar
 * and redirects to the chat page. Lives OUTSIDE the (site) route group, so it has
 * no header / nav / footer chrome.
 */
export default function WelcomePage() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const redirectingRef = useRef(false);

  const [redirecting, setRedirecting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('Preparing your experience...');

  // Mirror the original goToChat(): show the loading message + progress bar,
  // animate the bar to 100%, then navigate to the chat page.
  const goToChat = useCallback(() => {
    if (redirectingRef.current) return;
    redirectingRef.current = true;
    setRedirecting(true);

    let value = 0;
    intervalRef.current = setInterval(() => {
      value += 2;
      setProgress(value);
      if (value >= 100) {
        if (intervalRef.current) clearInterval(intervalRef.current);
        intervalRef.current = null;
        router.push('/chat');
      }
    }, 20);
  }, [router]);

  // Clean up the progress interval if the component unmounts mid-animation.
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const handleEnded = () => {
    goToChat();
  };

  const handleSkip = () => {
    videoRef.current?.pause();
    goToChat();
  };

  const handleError = () => {
    const video = videoRef.current;
    if (video?.error) {
      // Keep the original console diagnostics for parity.
      console.error('Video error:', video.error);
      console.error('Error code:', video.error.code);
      console.error('Error message:', video.error.message);
    } else {
      console.error('Video error: unknown');
    }
    setMessage('Video unavailable. Redirecting to chat...');
    setRedirecting(true);
    setTimeout(goToChat, 2000);
  };

  const handleCanPlay = () => {
    console.log('Video ready to play');
  };

  const handlePlay = () => {
    console.log('Video started playing');
  };

  const handleLoadedMetadata = () => {
    console.log('Video metadata loaded. Duration:', videoRef.current?.duration);
  };

  // Attempt to play with sound; browsers may block autoplay until the user
  // interacts. The visible controls let them start it manually if so.
  const handleLoadedData = () => {
    videoRef.current?.play().catch(() => {
      console.log('Autoplay with sound blocked. User interaction required.');
    });
  };

  return (
    <div className={styles.welcomeContainer}>
      <div className={styles.videoWrapper}>
        <video
          ref={videoRef}
          id="welcomeVideo"
          className={styles.video}
          autoPlay
          playsInline
          controls
          onEnded={handleEnded}
          onError={handleError}
          onCanPlay={handleCanPlay}
          onPlay={handlePlay}
          onLoadedMetadata={handleLoadedMetadata}
          onLoadedData={handleLoadedData}
        >
          <source src="/welcome.mp4" type="video/mp4" />
          Your browser does not support the video tag.
        </video>
        <button type="button" className={styles.skipButton} onClick={handleSkip}>
          Skip to Chat →
        </button>
      </div>
      <div className={`${styles.loadingMessage} ${redirecting ? styles.show : ''}`}>{message}</div>
      <div className={`${styles.progressBar} ${redirecting ? styles.show : ''}`}>
        <div className={styles.progressFill} style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
}
