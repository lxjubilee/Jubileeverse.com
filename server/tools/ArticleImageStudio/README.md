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
- Carries **one tab per JubileeVerse category**, each listing the articles in
  that category's folder that still have no image.
- For each: sends the article's own `image_prompt` to ChatGPT, waits for the
  image, writes it to `<category>/images/<slug>.jpg`, and records the filename
  in the article's `image_file` frontmatter field.

It reads and writes the article drive directly. No database, no server, no API
token.

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

## The five category tabs

The panel carries one tab per JubileeVerse channel, and each tab is just that
category's folder on the article drive:

| Tab | Folder |
|---|---|
| Covenant | `covenant-identity` |
| Teshuvah | `teshuvah-restoration` |
| Shalom | `shalom-salvation` |
| Celebration | `celebration-mishpakhah` |
| Torah | `torah-hebraic` |

Those slugs are the **live directory names** and are not guessable:
`celebration-mishpakhah` carries **kh**, and `torah-hebraic` does **not** carry
the word *insights*. They are defined once, in the `Categories` array at the top
of `MainWindow.xaml.cs`.

A tab lists every article in its folder whose `image_file` frontmatter field is
still empty. Generating one sends that article's own `image_prompt` to ChatGPT,
writes the result to `<category>/images/<slug>.jpg`, and fills `image_file` in.
Nothing else in the article is touched.

Both drive layouts are handled. A flat `covenant-identity/your-slug.md` takes its
slug from the filename; a nested taxonomy article, whose `_meta.json` declares
`"fileName": "article.md"`, takes its slug from the containing folder — otherwise
every nested article would generate an image called `article.jpg` and collide.

## Use it

1. Launch. The browser opens to ChatGPT. No server and no database are needed.
2. Check the **Articles root** (defaults to `J:\jubileeverse.com\articles`) and
   click **Scan categories**. **Save settings** writes `studio.config.json` next
   to the tool; it is git-ignored.
3. **Log in** to ChatGPT (click into the browser). Solve the human check once —
   your session is then remembered.
4. Pick a **category tab**. It shows that category's articles still missing an
   image; tick **Show articles that already have an image** to see the rest.
5. **Generate Next** (the selected article, or the next pending one),
   **Generate this category**, or **Generate all five categories**. Tick
   **Generate All Images** for an unattended run of the selected tab.
   **Stop** halts after the current image.
6. Watch the log, then look at the images before the articles publish.

> **The review gate moved.** The previous build posted images through the API
> into the cockpit's `in_review` queue, so nothing it produced went live
> unreviewed. This build writes straight to the article drive, so **you** are the
> review step now.

## Differences from the JubiLujah original

The browser half is unchanged from JubiLujah. The data half has now moved twice:

| | JubiLujah | Previously here | Now |
|---|---|---|---|
| Worklist | `app/web/public/articles/articles.json` | `GET /api/v1/images/studio/worklist` | the five category folders, one per tab |
| Image output | `app/web/public/articles/images/<random-12>.webp` | `POST .../ingest` → `server/public/images/generated/` | `<category>/images/<slug>.jpg` |
| Wiring the result | edits frontmatter + `articles.json` | server updates `image_generation_jobs` → `in_review` | writes `image_file` into the article's frontmatter |
| "Already done" | the article's `image` field | the job's `image_status` | a non-empty `image_file` |
| Credentials | none | bearer token in `studio.config.json` | none |
| Backstage mode | `/backstage` song pieces | removed | removed |

The two API endpoints are **still in `server.js`** under the
`── Article Image Studio ──` banner and are untouched. This tool simply no longer
calls them; the earlier API build is in git history if the queue path is wanted
back.

One inherited safeguard worth calling out: the JubiLujah original defaulted its
repo root to `W:\JubiLujah.com` when it could not find `articles.json`, so a
stray copy would have written into *that* repo. There is no such fallback here.
A missing articles root refuses to run and says which path it looked at.

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
