'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { recordInAppNavigation } from '@/lib/navigation';

/**
 * Records client-side route changes so Back controls know whether history holds
 * one of our own pages. Renders nothing; mounted once by the root layout so it
 * covers every route group, not just the public site.
 */
export default function NavigationTracker() {
  const pathname = usePathname();
  const firstRender = useRef(true);

  useEffect(() => {
    // The first pass is this document's own load, not a move from another page.
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    recordInAppNavigation();
  }, [pathname]);

  return null;
}
