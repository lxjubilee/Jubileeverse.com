# Article Image Studio (WPF + WebView2)

A small Windows app that hosts a **real browser** (WebView2 / Edge-Chromium) so
you can log in to ChatGPT by hand — the human check passes normally, because it
is a genuine browser, not an automation-flagged one — and then it drives *your
own logged-in session* to generate each job's hero image.

Ported from `JubiLujah.com/tools/ArticleImageStudio`. The browser half is
unchanged; the data half is not — see [Differences from the JubiLujah
original](#differences-from-the-jubilujah-original).

## What it does

- Embeds a real browser. **You** log in to ChatGPT (and pass any Cloudflare
  "verify you are human" check yourself).
- **Saves your cookies / session** in `.webview2/` next to the app, so you stay
  logged in between runs.
- Lists the `image_generation_jobs` still needing an image, pulled from the
  JubileeVerse Express API.
- For each: sends the job's `prompt_context` to ChatGPT, waits for the image,
  and posts the bytes back to the API — which writes the file to
  `server/public/images/generated/` and moves the job to **`in_review`**.

Nothing here approves an image. An ingested image lands in the same `in_review`
queue the MidJourney path leaves one in; you approve or reject it in the cockpit
as usual.

## Where it fits

This repo already has three image paths — this is a fourth, manual one, useful
when the others are unavailable (a stale Cloudflare token, the GPU box down) or
when you want a specific look ChatGPT is better at:

| Path | Where |
|------|-------|
| Local GPU — ComfyUI / FLUX on the RTX 5090s | `scripts/generate-article-images.js` |
| MidJourney → Leonardo → DALL-E 3 cascade | `server.js` reviewer endpoints |
| SDXL / Juggernaut in Docker | `scripts/gen_image_worker.py` |
| **ChatGPT session (this tool)** | `tools/ArticleImageStudio` |

Full infrastructure notes: [`docs/IMAGE-GENERATION-INFRA.md`](../../docs/IMAGE-GENERATION-INFRA.md).

## Build & run

Double-click **`Build-And-Run.cmd`**, or:

```
dotnet build -c Release
bin\Release\net8.0-windows\ImageStudio.exe
```

Requires the **.NET 8 SDK** and the **WebView2 Runtime** (already present with
Edge on Windows 11).

## Use it

1. Make sure the JubileeVerse server is running (`node server.js`, port 3107).
2. Launch. The browser opens to ChatGPT.
3. Paste a **bearer token** for a privileged account holding the
   `image:generate` permission, check the API base URL, and click **Connect**.
   **Save settings** writes `studio.config.json` next to the tool — it is
   git-ignored, because it holds that token.
4. **Log in** to ChatGPT (click into the browser). Solve the human check once —
   your session is then remembered.
5. Click **Refresh list** to see jobs needing an image.
6. **Generate Next**, **Generate all pending**, or tick **Generate All Images**
   for an unattended run. **Stop** halts after the current image.
7. Watch the log. Approve the results in the cockpit's image queue.

## Differences from the JubiLujah original

JubiLujah stores articles as files; JubileeVerse stores them in Postgres. So the
data layer was replaced, not copied:

| | JubiLujah | Here |
|---|---|---|
| Worklist | reads `app/web/public/articles/articles.json` | `GET /api/v1/images/studio/worklist` |
| Image output | writes `app/web/public/articles/images/<random-12>.webp` | `POST /api/v1/images/studio/{jobId}/ingest` → `server/public/images/generated/` |
| Wiring the result | edits `core/articles/<slug>.md` frontmatter + `articles.json` | server updates `image_generation_jobs`, status → `in_review` |
| "Already done" | the article's `image` field | the job's `image_status` |
| Backstage mode | `/backstage` song pieces + `gen-backstage.mjs` | removed — JubiLujah-only |

Two changes worth calling out:

- **No hardcoded repo fallback.** The original defaulted `_root` to
  `W:\JubiLujah.com` when it couldn't find `articles.json`. Left in place, a copy
  in this repo would have found nothing and written images into *that* repo. Here
  an unresolved root disables generation and says so.
- **The desktop app holds no DB credentials.** The file write and the status
  transition happen server-side, so the tool cannot bypass the review gate.

The two endpoints live in `server.js` under the
`── Article Image Studio ──` banner, next to the other image-module routes.

## ⚠ Honest caveat

Automating the ChatGPT web UI (submitting prompts, pulling the generated image)
may conflict with **OpenAI's Terms of Use**. This app does **not** defeat the
bot / human check — *you* pass that yourself in a real browser — but the prompt
submission afterward is automated, against your own session, at your direction.
The fully compliant alternatives are already wired into this repo: the official
**Images API** path (DALL-E 3, keys in `.env`) and the **local ComfyUI/FLUX**
path, both listed above.

## If ChatGPT changes its layout

The DOM selectors live in one place — the `*Script()` methods at the bottom of
`MainWindow.xaml.cs`. If a run stops finding the chat box or the image, adjust
them there.
