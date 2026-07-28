# JubileeVerse Next.js — Migration Conventions

This document is the contract every page conversion follows. The goal is faithful
feature/visual parity with the original static HTML, expressed as clean, typed,
reusable Next.js (App Router + TypeScript) code.

## Architecture at a glance

- **Frontend** = this Next.js app (`src/`). **Backend** = the UNCHANGED Express API
  in `server/` (port 3107). `next.config.mjs` proxies `/api`, `/auth`, `/images`,
  `/backoffice`, `/status`, `/health`, `/welcome.mp4` to the backend.
- All data comes from the Express API via **relative `/api/...` paths** — never
  hardcode `http://localhost:3107` or `https://inspirecodex.com`.

## Where files go

- A public page lives at `src/app/(site)/<route>/page.tsx`. The `(site)` group
  applies the shared chrome (header, nav, footer, language, personalize) — do NOT
  re-render those in a page.
- Page-specific styles: a co-located `*.module.css` (CSS Modules). Reference with
  `import styles from './x.module.css'` and `className={styles.foo}`.
- Truly global, reused classes (cards, grid, section headers, buttons, chrome)
  already exist in `src/styles/globals.css` — reuse them via plain string
  classNames (e.g. `className="content-grid"`, `className="content-card"`).
- Shared, cross-page components go in `src/components/...`. Page-only components
  may live next to the page or under `src/components/<feature>/`.

## Hard rules (so parallel work never conflicts)

1. **Do NOT modify** these shared files: `src/styles/globals.css`, anything in
   `src/lib/`, `src/components/layout/`, `src/components/ui/Modal.*`, the root or
   group layouts, `next.config.mjs`, `package.json`. If you think you need to,
   stop and note it instead.
2. Only create files under your page's own folder (and, if needed, a clearly
   page-named component file under `src/components/<feature>/`).
3. Every interactive page/component starts with `'use client';`.

## Building blocks to reuse

- `import { api, ApiError, resolveImageUrl } from '@/lib/api'` — `api.get/post/put/
  patch/delete`. `api` auto-attaches the `Authorization: Bearer <token>` header from
  the stored auth; pass `{ auth: false }` for public calls.
- `import { useAuth } from '@/lib/auth'` — `{ user, token, isAuthenticated,
  isLoading, canAccessCms, initials, refresh, signOut }`.
- `import StoryCard from '@/components/content/StoryCard'` — standard content card
  that navigates to `/article/[id]`.
- `import { storeSelectedArticle, trackView } from '@/lib/article'` — stash a story
  + navigate to its article; `trackView(id)` for click tracking.
- `import Modal from '@/components/ui/Modal'` — generic dialog.
- Types: `import type { Story } from '@/lib/types'`.

## Visual fidelity

- Match the original layout, colors, spacing, and copy. Reuse the design tokens
  (`var(--bg-primary)`, `var(--accent-gold)`, `var(--space-md)`, etc.) — they are
  defined globally; do not redefine them.
- Port the original page's inline CSS into the page's `*.module.css`, renaming
  class references to `styles.*`. Keep animations and responsive breakpoints.
- Backend/content images use their existing paths (`/images/...`) — render with a
  plain `<img>`. External demo images (Unsplash) can stay as-is.

## Auth & navigation

- Protected pages: read `useAuth()`. If `!isLoading && !isAuthenticated`,
  redirect with `useRouter().replace('/signin')`.
- Article links: `storeSelectedArticle(story)` then `router.push('/article/' + id)`.
- Internal links use `next/link`; external links use `<a target="_blank" rel="noopener noreferrer">`.

## Quality bar

- Strict TypeScript (no `any` where avoidable; the repo runs `tsc --noEmit`).
- No dead buttons: wire every control to its original behavior or a sensible no-op
  with a comment.
- Keep components reasonably small; extract sub-components when a page is large.
