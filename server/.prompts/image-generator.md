# Image Generator — JubileeVerse.com Article Imagery (InspireCortex GPU Pipeline)

> **Scope:** This instruction governs turning the three `image-prompt01/02/03`
> blocks inside a finished article `.md` (produced by `article-generator.md`) into
> three rendered, **MidJourney-grade professional images**, saving them with the
> required naming convention, and writing the resulting image-set ID back into
> both the article `.md` and `articles_catalog.json`.
>
> **Render backend:** InspireCortex local GPU infrastructure (Juggernaut XL v9 +
> ESRGAN 4× upscale + Mistral prompt enhancement) via the **`/v1/midjourney`**
> API — *not* cloud Leonardo. This is the same path the `*_mj.js` regen scripts use.

---

## 1. Inputs

Read the target article `.md` file and extract the three prompt blocks verbatim:

```
**image-prompt01:** <full prompt text>
**image-prompt02:** <full prompt text>
**image-prompt03:** <full prompt text>
```

Each block is already a complete, scene-level prompt written by `article-generator.md`
(modest, reverent, family-safe). Do **not** rewrite the creative intent. You may
**append** the standard quality/style suffix and the standard negative prompt
(Sections 5–6) so the render matches the house "MidJourney professional" look.

---

## 1.1 Prompt content standards — relatable, people-first, emotion-matched

Whoever writes the three `image-prompt0N` blocks (the article author, or a refiner)
must follow these so the imagery actually connects with the audience:

- **Relatable to U.S. faith-based Christian believers.** Favor contemporary American
  settings and people a believer here recognizes — homes, kitchens and dinner tables,
  front porches, neighborhoods, churches, small groups, workplaces, schools, the
  American outdoors. Reflect the real diversity of the U.S. church (varied ethnicities,
  ages, family shapes). For an explicitly biblical-narrative article a faithful biblical
  setting is still right — but render the **human emotion** so a modern American reader
  feels it. When a teaching is applied to everyday life, prefer the everyday American scene.
- **Show people whenever the article allows.** Prefer real human subjects over objects
  or symbols — people carry emotion a still life cannot. Use object-only imagery only
  when the article is genuinely about a thing.
- **Match the people's emotion to the article's tone.** Faces and body language must
  carry the article's dominant feeling: a fun/exciting article → joyful, energized,
  celebrating people; a tender/relieved article → relief, warmth, happy tears; a
  grieving/convicting article → honest sorrow or weight on the face, resolving toward
  hope (never hopeless despair on a faith platform). Read the emotional arc and depict
  its strongest human beat.
- Keep every §6 family-safe rule (modest, reverent, no sensuality, no face of God, no minors).

---

## 2. Output Location & Naming Convention — MANDATORY

All three images for one article share **one random 12-character set ID** and are
numbered `1`, `2`, `3`:

```
/<category-root-slug>/images/<ID>-N.png
```

- `<category-root-slug>` — the article's **root (L1) category folder** on the J:
  drive (e.g. `celebration-mishpakhah`). Images live in an `images/` subfolder
  **at the L1 root**, never nested deeper.
- `<ID>` — exactly **12 characters**, each randomly drawn from `[0-9a-zA-Z]`
  (alphabet of 62; see Section 9). The **same ID** is used for all three images
  of the article.
- `N` — the image number matching the prompt: `1` ↔ image-prompt01, `2` ↔
  image-prompt02, `3` ↔ image-prompt03.
- Extension is always `.png`.

**Example** (for `celebration-mishpakhah`):

```
/celebration-mishpakhah/images/k2duBs29c7Ds-1.png
/celebration-mishpakhah/images/k2duBs29c7Ds-2.png
/celebration-mishpakhah/images/k2duBs29c7Ds-3.png
```

(Absolute on this host: `J:\articles\celebration-mishpakhah\images\<ID>-N.png`.)

One article → one ID → three files. Create the `images/` folder if missing.

---

## 3. Style Target — "MidJourney Professional"

Render through the InspireCortex **MidJourney model** path, which produces the
polished, painterly/cinematic look the prompts call for:

- **Model:** Juggernaut XL v9 (`juggernautXL_ragnarokBy.safetensors`).
- **Enhancement:** Mistral-7B prompt expansion + **ESRGAN 4× upscale** (the
  step that gives the crisp, gallery-grade MidJourney finish).
- **Request preset:** `style_preset: "cinematic"`, `steps: 30`,
  `guidance_scale: 7.0`, `num_variations: 1` (exactly one image per prompt).
- **Aspect:** honor the prompt's stated framing; default to **16:9 landscape**
  for hero imagery unless the prompt specifies otherwise.
- Append a style suffix to each prompt, e.g.:
  `", professional MidJourney-style render, painterly cinematic lighting, rich
  color depth, fine detail, gallery quality, 4k, highly detailed"`.

---

## 4. GPU Server Topology & Job Routing

> **Primary path = direct LAN ComfyUI (no Cloudflare).** Full topology, model
> install, and the FLUX pipeline are in **`docs/IMAGE-GENERATION-INFRA.md`**.
> The cloud `/v1/midjourney` path (§5) is a fallback and is often blocked by a
> stale Cloudflare Access token (HTTP 302).

Three render jobs are distributed across the GPU lanes for **parallel** generation:

| Lane | Server | GPU | Image endpoint |
|------|--------|-----|----------------|
| `lane-a` | HDC-INSPIRESERVER (10.0.0.52) | **RTX 5090 #0 (32 GB)** | ComfyUI `http://10.0.0.52:8188` ✅ LAN |
| `lane-b` | HDC-INSPIRESERVER (10.0.0.52) | **RTX 5090 #1 (32 GB)** | ComfyUI `http://10.0.0.52:8189` ✅ LAN |
| `lane-c` | HPC-FLYWHEEL (10.0.0.43) | **RTX PRO 6000 (96 GB)** | via farm gateway `:8300` only (ComfyUI is 127.0.0.1-bound) |

Route image 1 → `:8188`, image 2 → `:8189`, image 3 → `:8188`; both 5090s render
in parallel (~5–15 s/image at 24 steps). Model: **FLUX.1-dev fp8** (MidJourney-grade;
see infra doc §3). Failover: retry a failed job on the other 5090 port.

Routing rules:

1. **Round-robin** the three jobs across the three lanes — image 1 → `lane-a`,
   image 2 → `lane-b`, image 3 → `lane-c` — so each GPU renders exactly one image.
2. Each lane is reached through the InspireCortex API. If a second physical
   endpoint is configured (`INSPIRECORTEX_API_URL_2`), send `lane-b`/`lane-c`
   there and `lane-a` to `INSPIRECORTEX_API_URL`; otherwise send all three to the
   single endpoint and let the scheduler spread them across its GPUs. A request
   MAY include a `worker`/`gpu` hint field naming the target lane.
3. **Failover:** if a lane errors or times out, retry the job on the next healthy
   lane (up to 3 total attempts) before marking it failed.
4. Throttle ≥3 s between sequential submissions to the *same* GPU to avoid
   VRAM thrash.

---

## 5. Authentication & Endpoints

Configuration comes from `.env` (never hard-code or print secret values):

| Variable | Purpose |
|----------|---------|
| `INSPIRECORTEX_API_URL` | Base URL — `https://api.inspirecortex.com` (Cloudflare Access protected) **or** `http://localhost:8080` via the PM2 SSH tunnel (`scripts/ic-tunnel.js`, prod:8081 → local:8080). |
| `INSPIRECORTEX_API_URL_2` | *(optional)* second GPU server base URL for lane-b/lane-c. |
| `INSPIRECORTEX_JWT` | Bearer token → `Authorization: Bearer <JWT>`. |
| `INSPIRECORTEX_CF_CLIENT_ID` | `CF-Access-Client-Id` header (required when calling `api.inspirecortex.com`). |
| `INSPIRECORTEX_CF_CLIENT_SECRET` | `CF-Access-Client-Secret` header (same). |
| `INSPIRECORTEX_API_KEY` | secondary API key if the deployment requires it. |
| `IMAGE_REGEN_MOCK` | `true` → skip the network and write placeholder PNGs (offline/dev/testing). |

Every request to `api.inspirecortex.com` MUST carry **both** the `Authorization:
Bearer` header **and** the two `CF-Access-Client-Id` / `CF-Access-Client-Secret`
headers, or Cloudflare Access returns a login redirect (HTML) instead of JSON.

### API contract

**Generate (synchronous, ~17–20 s):**

```
POST {INSPIRECORTEX_API_URL}/v1/midjourney/generate
Headers: Authorization: Bearer <JWT>
         CF-Access-Client-Id: <id>          # api.inspirecortex.com only
         CF-Access-Client-Secret: <secret>  # api.inspirecortex.com only
         Content-Type: application/json
Body: { "prompt": "<text + style suffix>",
        "style_preset": "cinematic",
        "steps": 30,
        "guidance_scale": 7.0,
        "num_variations": 1 }
→ 200 { "variations": [ { "minio_key": "...", "gpu_time_ms": 18234 } ] }
```

**Download the rendered image:**

```
GET {INSPIRECORTEX_API_URL}/v1/midjourney/image/{minio_key}
Headers: Authorization + CF-Access headers
→ 200 image bytes  (write to <ID>-N.png)
```

Validate each downloaded file is a real image (≥ 10 KB); a tiny file or an HTML
body means an auth/redirect failure — retry per Section 4.

---

## 6. Family-Safe & Quality Enforcement

JubileeVerse is a Christian, family-values publication. Every image MUST be
modest and reverent (see `article-generator.md` §8). Append this standard
negative prompt to every generation:

```
nsfw, nude, naked, bare skin, topless, suggestive, revealing clothing, underwear,
cleavage, sexual content, ugly, deformed, noisy, blurry, low quality, jpeg
artifacts, bad anatomy, extra limbs, missing limbs, malformed fingers, extra
fingers, fused digits, distorted hands, mutated anatomy, text, watermark, logo,
signature, lettering, gore, violence, dark/ominous mood
```

Additional rules:
- Never depict the face of God / Yahuah — use symbolic light or quiet reverence.
- No subjects under 13 years of age.
- No on-image text, captions, logos, or watermarks.
- Reverent, dignified composition; avoid entertainment-industry/glamour aesthetics.
- **Hands.** Diffusion models botch hands most when a hand is large in the **extreme
  foreground**, is the close-up focal subject, or is **splayed/gripping across another
  person's back in a tight embrace seen from behind** (occluded, atypical — fails even with a
  detailer). Avoid those. In prompts: keep hands **relaxed and naturally positioned**, at a
  normal distance, not jutting forward; no close-ups *of* hands. For affection, prefer the
  **moment arms are opening / reaching** (open hands, in motion — renders cleanly) or a
  **side / face-forward angle where the emotion reads through faces**, with hands lowered,
  at the side, or naturally out of view — not two hands clamped on a back. Always state
  *"anatomically correct hands, exactly five fingers and one thumb"* in the positive and keep
  the malformed-hand terms in the negative. The ComfyUI **HandDetailer** pass
  (`docs/IMAGE-GENERATION-INFRA.md` §6.1.B) then re-renders any hand it detects.

---

## 7. Writing the ID Back — MANDATORY

After all three files are saved, record the set ID in **two** places.

**(a) The article `.md`** — insert an image-set block immediately after the
`image-prompt03` block (before the `---` divider that precedes the Introduction):

```
**Image Set ID:** <ID>

**image01:** <category-root-slug>/images/<ID>-1.png
**image02:** <category-root-slug>/images/<ID>-2.png
**image03:** <category-root-slug>/images/<ID>-3.png
```

**(b) `articles_catalog.json`** — on the article's `article` object (and the
matching top-level `articles[]` entry), add:

```json
"image_set_id": "<ID>",
"images": [
  "<category-root-slug>/images/<ID>-1.png",
  "<category-root-slug>/images/<ID>-2.png",
  "<category-root-slug>/images/<ID>-3.png"
],
"image_status": "generated"   // or "mock" if IMAGE_REGEN_MOCK was used
```

> Note: the project's article registry file is **`articles_catalog.json`** (the
> same file referred to loosely as "article_writer.json" / "article_catalog").

---

## 8. Post-Processing

- Save the downloaded bytes as `.png`.
- Optionally web-optimize (strip metadata; cap longest edge ~1920 px) while
  keeping PNG. Do not over-compress — these are hero-quality images.
- Verify file integrity (valid PNG header, ≥ 10 KB) before recording status.

---

## 9. The 12-Character ID Algorithm

```
alphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"  // 62 chars
ID = 12 characters, each chosen uniformly at random from alphabet
   (use a CSPRNG, e.g. crypto.randomInt, not a weak RNG)
```

- One ID per article, reused for all three images.
- Treat as opaque; the only guarantee is `^[0-9A-Za-z]{12}$`.
- Re-roll on the rare collision with an existing `images/` filename.

---

## 10. Runner

`scripts/generate-article-images.js` implements this spec end-to-end:

```
node scripts/generate-article-images.js \
  --article "J:/articles/celebration-mishpakhah/<slug>.md" \
  --root celebration-mishpakhah
# IMAGE_REGEN_MOCK=true node scripts/generate-article-images.js ...   # offline placeholders
```

It: reads the three prompts → mints the 12-char ID → routes the three jobs across
the GPU lanes → downloads `<ID>-1/2/3.png` into `<root>/images/` → writes the ID
block into the `.md` and the `image_set_id`/`images`/`image_status` fields into
`articles_catalog.json`.

---

## 11. Validation Checklist

- [ ] Exactly three PNGs written, sharing one 12-char `[0-9a-zA-Z]` ID, suffixed `-1/-2/-3`.
- [ ] Saved under `<category-root-slug>/images/` at the **L1 root** (not nested).
- [ ] Each file is a valid PNG ≥ 10 KB (or a clearly-marked placeholder in mock mode).
- [ ] Family-safe: modest, reverent, no text/watermark, no face of God, no minors.
- [ ] MidJourney-grade style applied (Juggernaut XL + cinematic preset + upscale).
- [ ] Jobs distributed across RTX 6000 + 2× RTX 5090 lanes with failover.
- [ ] `Image Set ID` + three `imageNN` lines written into the article `.md`.
- [ ] `image_set_id` + `images[]` + `image_status` written into `articles_catalog.json`.
