# JubileeVerse.com — Next.js Frontend

A modern **Next.js (App Router + TypeScript)** frontend for JubileeVerse.com — the
Christian news & content portal — migrated from the original static-HTML site.

The existing **Express.js API is preserved unchanged** in [`server/`](server/) and
remains the single source of truth for all data. The Next.js app is a pure
frontend that talks to it over `/api/*`.

---

## Architecture

```
Browser ──▶ Next.js (port 3000)            Express API (port 3107, UNCHANGED)
            ├─ UI: App Router pages         ├─ 380 REST routes under /api/*
            ├─ Shared chrome + design        ├─ PostgreSQL (via SSH tunnel)
            └─ rewrites /api, /auth, /images, /backoffice, /status, /health,
               /welcome.mp4  ───────────────▶ proxied to the Express origin
```

- **No backend changes.** `server/` is a copy of the original Express app
  (`server.js`, `lib/`, `data/`, `.prompts/`, `.personas/`, `public/`, etc.). It
  still boots with `node server.js`, listens on **3107**, and serves the API.
- **The browser only ever calls the Next.js origin.** `next.config.mjs` rewrites
  API + backend-served asset paths to the Express process, so there is no CORS in
  the browser and content image URLs (`/images/...`) returned by the API just work.
- **Auth is unchanged.** Login still goes through the backend OIDC/local flow at
  `/auth/login` (the `/signin` page redirects there). The backend persists the
  token under `localStorage["jubileeVerseAuth"]`; the frontend reads it via the
  auth context and sends `Authorization: Bearer <token>` on API calls.

## Project structure

```
.
├─ src/
│  ├─ app/
│  │  ├─ layout.tsx              # root: fonts + <AuthProvider>
│  │  ├─ (site)/                 # public pages WITH the shared chrome
│  │  │  ├─ layout.tsx           #   wraps pages in <SiteShell>
│  │  │  ├─ page.tsx             #   home
│  │  │  ├─ article/[id]/        #   article detail
│  │  │  ├─ [topic]/             #   dynamic category portal
│  │  │  ├─ music, radio, prayer, finance, sports, weather,
│  │  │  │  hope-restored, search, settings, chat/ ...
│  │  ├─ (auth)/                 # standalone auth pages (no chrome)
│  │  │  ├─ signin, signup, forgot-password/
│  │  ├─ (admin)/                # back office, gated to CMS users (AdminGate)
│  │  │  ├─ admin/               #   /admin dashboard + articles + article/[id]
│  │  │  ├─ scanner/             #   RSS good-news scanner
│  │  │  └─ reviewer-activity/
│  │  └─ welcome/                # standalone onboarding splash
│  ├─ components/
│  │  ├─ layout/                 # Header, NavBar, Footer, SiteShell, Language, Personalize…
│  │  ├─ content/                # StoryCard, HeroCarousel, ReactionBar
│  │  ├─ admin*/                 # AdminGate + dashboard/articles/scanner sub-components
│  │  ├─ auth/                   # AuthBackground, LegalModals
│  │  └─ ui/                     # Modal
│  ├─ lib/                       # api client, auth context, types, translate, article helpers
│  ├─ hooks/                     # useTaxonomyNav, useDailyVerse
│  └─ styles/globals.css         # design tokens + shared chrome + card/grid system
├─ server/                       # UNCHANGED Express backend (the API)
├─ docs/MIGRATION-CONVENTIONS.md # the page-conversion contract
├─ next.config.mjs               # /api, /auth, /images… → Express proxy
└─ package.json
```

## Prerequisites

- **Node.js ≥ 20** (developed on Node 24).
- For full functionality, the Express backend needs its usual infrastructure:
  PostgreSQL (direct or via SSH tunnel), `JWT_SECRET`, and the AI/image/email keys
  in `server/.env`. See `server/.env` / `server/.env.example` and `server/CLAUDE.md`.

## Install

```bash
# frontend deps (repo root)
npm install

# backend deps (only once; uses legacy peer resolution for its dev tooling)
cd server && npm install --legacy-peer-deps && cd ..
```

## Run (development)

You need **both** processes running. Two terminals, or use the combined script.

```bash
# Terminal 1 — Express API (unchanged), serves /api on :3107
npm run dev:api          # = node server/server.js

# Terminal 2 — Next.js frontend on :3000, proxies /api → :3107
npm run dev
```

Or both at once:

```bash
npm run dev:all          # concurrently runs the API and the web app
```

Then open <http://localhost:3000>.

> The frontend renders fully without the backend, but data sections (stories,
> reactions, auth, etc.) require the API to be up. The proxy target is
> configurable via `BACKEND_URL` in `.env.local` (default `http://localhost:3107`).

## Build (production)

```bash
npm run build            # next build  (all routes compile + prerender)
npm run start            # next start  (serves the built frontend on :3000)
```

In production, run the Express API as its own process and put a reverse proxy in
front that routes `/api`, `/auth`, `/images`, `/backoffice`, `/status`, `/health`
to Express and everything else to the Next.js server (the same split `next.config.mjs`
does in dev).

## Scripts

| Script | What it does |
|--------|--------------|
| `npm run dev` | Next.js dev server (Turbopack) on :3000 |
| `npm run dev:api` | The unchanged Express API on :3107 |
| `npm run dev:all` | Both, via `concurrently` |
| `npm run build` | Production build of the frontend |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint (next/core-web-vitals) |
| `npm run typecheck` | `tsc --noEmit` |

## Migration status

**Public site (feature parity with the original):**
Home, Article, Music, Radio, Prayer, Finance, Sports, Weather, Hope-Restored,
dynamic category portals (`/[topic]`), Search, Settings, Chat, Welcome, and the
auth pages (Sign In / Sign Up / Forgot Password). Shared chrome (header, taxonomy
nav, footer, profile menu, search, language panel + client-side translation,
personalize popup) is implemented as reusable components.

**Back office (CMS):**
`/admin` (dashboard hub: category management, current-events approval queue,
albums, pulse tasks, admin chat), `/admin/articles` (article management + bulk
status), `/admin/article/[id]` (single-article editor), `/scanner` (RSS good-news
scanner), and `/reviewer-activity`. These live in the `(admin)` route group, which
is gated to CMS-capable users. The original back-office SPA (`server/cockpit/dist`)
also remains available via Express at `/backoffice` (proxied).

All 22 routes type-check (`tsc --noEmit`) and compile in `next build`. A few admin
corners are intentionally simplified (documented inline) where the original used
dev stubs or had no backing endpoint.

See [`docs/MIGRATION-CONVENTIONS.md`](docs/MIGRATION-CONVENTIONS.md) for the
conventions every page follows.

## Notes & decisions

- **Styling:** the original inline CSS was ported into a global design-token layer
  (`src/styles/globals.css`) plus per-page **CSS Modules** — closest fidelity to the
  original MSN-style dark theme with good encapsulation.
- **Images:** dynamic/content images use plain `<img>` (their `/images/...` paths
  are proxied to the backend), which is why `next build` emits `no-img-element`
  warnings — these are expected and intentional.
- **Article URLs:** content cards stash the story in `sessionStorage` and navigate
  to `/article/[id]`; the article page renders instantly and refetches fresh
  content from the backend.
```
