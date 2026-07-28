import type { Metadata, Viewport } from 'next';
import { Orbitron, Playfair_Display } from 'next/font/google';
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
  title: 'JubileeVerse - Inspiring Faith, Sharing Hope',
  description: 'JubileeVerse - Uplifting Christian news, devotionals, and inspiration',
  icons: { icon: '/images/jubilee-profile.png' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${orbitron.variable} ${playfair.variable}`}>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
