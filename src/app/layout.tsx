import type { Metadata, Viewport } from 'next';
import { Orbitron, Playfair_Display } from 'next/font/google';
import NavigationTracker from '@/components/layout/NavigationTracker';
import { AuthProvider } from '@/lib/auth';
import '@/styles/globals.css';

const orbitron = Orbitron({
  subsets: ['latin'],
  weight: ['700'],
  variable: '--font-orbitron',
  display: 'swap',
});

const playfair = Playfair_Display({
  subsets: ['latin'],
  weight: ['700'],
  variable: '--font-playfair',
  display: 'swap',
});

export const metadata: Metadata = {
  // Without this, the per-page canonical links resolve relative to the document
  // instead of the live origin.
  metadataBase: new URL('https://jubileeverse.com'),
  title: 'JubileeVerse - Inspiring Faith, Sharing Hope',
  description: 'JubileeVerse - Uplifting Christian news, devotionals, and inspiration',
  // Next's own public/, not /images — that path rewrites to Express, and the
  // original there is a 1200px, 967 KB PNG for a 16px tab icon.
  icons: { icon: '/brand/brand-logo.png', apple: '/brand/brand-logo.png' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${orbitron.variable} ${playfair.variable}`}>
      <body>
        <NavigationTracker />
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
