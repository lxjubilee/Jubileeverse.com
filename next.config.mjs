/** @type {import('next').NextConfig} */

// The Express API (server/server.js) is kept UNCHANGED and runs on its own port.
// In development we proxy API + backend-served asset paths to it so the browser
// only ever talks to the Next.js origin. In production, put a reverse proxy in
// front that routes the same paths to the Express process.
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3107';

const nextConfig = {
  reactStrictMode: true,

  // Build output directory. Defaults to .next, so production builds are
  // unaffected. Override with NEXT_DIST_DIR when .next itself is unusable —
  // this repo lives on an SMB share, where a crashed dev server can leave
  // .next/trace held open by the file server and nothing local can clear it.
  distDir: process.env.NEXT_DIST_DIR || '.next',

  // Content images (cached_image_path, image_url, etc.) are produced and served
  // by the Express backend under /images. We render them with plain <img>, so no
  // optimizer round-trip is needed.
  images: {
    unoptimized: true,
  },

  async redirects() {
    return [
      // Articles moved from /news/<slug> to the root, /<slug>. 301 rather than
      // Next's default 308 so the permanence is the one search engines have
      // indexed against for years, and so old links keep their ranking.
      // `/news` itself still lists the day's coverage and is not matched here.
      { source: '/news/:slug', destination: '/:slug', statusCode: 301 },
    ];
  },

  async rewrites() {
    return [
      // Express REST API — the single source of truth for all data.
      { source: '/api/:path*', destination: `${BACKEND_URL}/api/:path*` },
      // OIDC / local auth flow handled by the backend (/auth/login, /auth/callback, /auth/logout).
      { source: '/auth/:path*', destination: `${BACKEND_URL}/auth/:path*` },
      // Backend-generated + content images live under /images on the Express public dir.
      { source: '/images/:path*', destination: `${BACKEND_URL}/images/:path*` },
      // Existing back-office SPA (cockpit/dist) served by Express at /backoffice.
      { source: '/backoffice/:path*', destination: `${BACKEND_URL}/backoffice/:path*` },
      // Health / connection status endpoints.
      { source: '/health', destination: `${BACKEND_URL}/health` },
      { source: '/status/:path*', destination: `${BACKEND_URL}/status/:path*` },
      // Onboarding video lives in the backend public dir.
      { source: '/welcome.mp4', destination: `${BACKEND_URL}/welcome.mp4` },
    ];
  },
};

export default nextConfig;
