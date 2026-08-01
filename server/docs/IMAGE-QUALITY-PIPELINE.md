# Image quality pipeline — plan of record

Why the generated article images carry AI artifacts (six fingers, two heads,
distorted faces, scenes unrelated to the story), and the six-step programme to
fix it. Steps 1-3 are done; **Steps 4-6 are the outstanding work.**

## Root causes found (verified in code, not assumed)

1. **The negative prompt was inert.** `fluxGraph` ran the sampler at `cfg: 1.0`.
   Classifier-free guidance only subtracts the negative branch when CFG > 1, so
   "six fingers, malformed hands, extra limbs" had no effect on any image while
   looking like a control. FLUX.1-schnell is guidance-distilled, so this is
   inherent to it — not a misconfiguration.
2. **The weakest FLUX variant.** `flux1-schnell-fp8` at 4 steps.
3. **The only automated gate checks nudity.** `image-safety.js` runs NudeNet.
   Nothing checks anatomy, realism, or whether the image matches the article.
   `MIN_PNG_BYTES` only proves the file is not truncated.
4. **Hand repair cannot see the worst hands.** The Impact Pack detailer fires
   only where YOLO finds a hand at ≥0.3 confidence; a badly malformed hand often
   is not recognisable as a hand, so it is skipped — the exact case it exists
   for. It does nothing for faces, extra heads or proportions.

Also: when the composer returns short or missing `image_prompts`,
`deriveImagePrompts()` substitutes one of three canned scenes with the headline
appended. That is the direct cause of "scene does not represent the article".

## Constraints that do not change

- **Do not flip `DEFAULT_PROFILE`** until scored results justify it. Owner's
  decision, pending the Step 3-4 metrics.
- **`flux-dev` must never be the default.** FLUX.1-dev is non-commercially
  licensed; JubileeVerse is a commercial site. It stays opt-in unless a
  commercial licence is bought. A unit test enforces this.
- **Do not add torch to `D:\inspire-imgsafe`.** That venv is deliberately
  torch-free so the Wan video venv is unaffected (see `CLAUDE.md`). Run
  detection inside ComfyUI instead, where YOLO is already loaded.

## Done — Steps 1-2 (`lib/comfy-client.js`)

Three profiles selected by `COMFY_PROFILE`:

| Profile | Model | Licence | Negative prompt |
|---|---|---|---|
| `sdxl` | Juggernaut-XI | OpenRAIL++-M, commercial OK | **Works** (CFG 5.5, dpmpp_2m/karras) |
| `schnell` | FLUX.1-schnell fp8 | Apache-2.0 | Inert — sent empty |
| `flux-dev` | FLUX.1-dev fp8 | **Non-commercial** | Opt-in, not installed |

`buildGraph()` branches on family: SDXL gets `EmptyLatentImage` + real CFG and
no FLUX realism LoRA (it would not load); FLUX keeps `EmptySD3LatentImage` +
`FluxGuidance` + cfg 1.0 + LoRA 0.7. The hand-repair pass conditions the same
way the sampler did in each case. Anatomy constraints moved into `STYLE_SUFFIX`
(positive), since that is the only channel a distilled model hears.

Bake-off round one (timings only): steady state ~10 s for both profiles; a
one-time ~53 s checkpoint load for Juggernaut. Quality metrics need Step 3.

## Done — Step 3 (`lib/image-score.js`)

Deterministic, no LLM. `screen(images)` returns a verdict per image shaped like
the safety gate's — `{ok, score, flags, fatal, partial, metrics, counts}` — so
the publish path consumes it the same way. Verified end to end against both
lanes: ~1 s per image, 5 images in 4.5 s.

**Getting numbers out of ComfyUI.** `ImpactSEGSToMaskList` declares
`output_is_list`, so N detections drive `MaskToImage` N times and `PreviewImage`
returns N full-canvas masks — one detection each. Reading the white extent back
gives exact boxes. `SegsToCombinedMask` was rejected: it unions detections, so
adjacent faces merge and the count is lost. `labels: 'all'` is a **required**
input on the `*DetectorSEGS` nodes; omitting it fails validation.

**Rules.** Counting is per-person (two face centres inside one body box = extra
head), so a crowd with one undetected body is not read as a defect. Fatal flags
— `extra-heads`, `duplicate-person`, `cloned-face` — score 0 rather than merely
failing, so Step 4's best-of-3 can never rank one first. Duplicate people are
caught by dHash over the detected regions.

**Thresholds were measured, and the measurement mattered** (see
`scripts/calibrate-image-score.js`, which re-derives them; re-run it when the
profile changes):

- The first guessed blur limit (2.2) sat **above every good render** (1.05-1.39).
  In enforce mode it would have withheld the entire image feed. Measured limit:
  0.6.
- **Exposure cannot be gated deterministically.** A candle-lit chapel clips 74.9%
  of its pixels to black by design; good daylight renders clip up to 4.4% of
  highlights. Mean luma fails the same way — that chapel (18.5) is darker than a
  bright scene crushed to a quarter brightness (24.9-31.0). Entropy likewise
  ranks the chapel (3.02) below flattened daylight scenes (5.37-5.77). All three
  are reported in `metrics` but **do not gate**; telling a dark scene from a
  broken one needs to know what the scene is, which is Step 4's job. Degenerate
  frames are still caught by `flat` (channel spread).
- Surviving local rules: `blurry` (sharpness < 0.6) and `flat` (contrast < 25).
  16/16 gated cases classify correctly.

**A live catch.** A render prompted for "an empty small-town main street", with
no person requested, came back as a single malformed hand across 22.5% of the
frame. It exposed a real gap: at the original weighting it scored 90 and passed.
Hand size is now graduated — `hand-closeup` (>12%, 15 pts) vs `hand-dominates`
(>20%, 40 pts, fails on its own). Working renders measured 1.2-10.1%.

**Still outstanding for this step — needs a hand on the render host:**

- `bbox/face_yolov8n.pt` and a person detector (`segm/person_yolov8m-seg.pt`)
  are **not installed**; only `bbox/hand_yolov8s.pt` is. Every rule needing them
  (extra heads, extra hands per body, cropped/distorted faces, duplicate people)
  is written and unit-tested but **inert**, and `partial: true` records that in
  the verdict rather than scoring as though the check had passed. Installing the
  two models activates them with no code change — but note the model list is read
  from `UltralyticsDetectorProvider`'s enum, so ComfyUI needs the documented
  one-lane-at-a-time restart before they appear.
- The hand threshold stays at 0.3 on evidence: swept 0.3-0.7, detections held
  flat until 0.7, where a real hand dropped out.
- ComfyUI's input directory grows by one file per distinct image scored (uploads
  are content-addressed, so retries do not add more). It has no delete endpoint;
  periodic pruning is unhandled.

## Done — Steps 4-6 (`lib/image-judge.js`, and its two callers)

Steps 4, 5 and 6 landed as one module plus two call sites, because they are one
mechanism seen from three angles. `Judge.produceImage()` is the whole ladder:

    for each round      render N candidates on an escalating prompt
                        score every candidate structurally  (Step 3)
                        judge the survivors as a set        (Step 4)
                        select a winner, or escalate        (Step 5)

The nightly run and the admin button both call it, which is Step 6 — the button
previously rendered one shot with no gate at all, so a manual "regenerate" could
replace a defective hero with a worse one and no one could tell.

**Ordering.** Structural first, judge second, safety last. A two-headed
candidate is not worth a vision call; the NudeNet scan stays batched per wave
because each invocation cold-starts Python over WinRM.

**Every image is gated; only the hero gets a choice.** All three roles run
through both gates. What differs is candidate count — three for the hero, one
for supporting and symbolic — and retry depth (`NEWS_HERO_ROUNDS`, default 3, vs
`NEWS_SUPPORTING_ROUNDS`, default 2).

**Selection is arithmetic, not the model's opinion.** The judge returns marks
per dimension; the weighted 0-100 score and the ranking are computed in code, so
a bake-off compares images rather than the judge's mood. The model's own
`best_candidate` only breaks a genuine tie. Weights: anatomy 0.28, artifacts
0.20, relevance 0.20, realism 0.14, composition 0.10, editorial suitability 0.08.

**Escalation changes something real.** Re-rolling the seed is the weakest
possible retry — if a prompt reliably puts a hand in the foreground, three more
seeds produce three more hands. Round 1 changes camera angle and pushes hands
out of the foreground; round 2 removes people from the scene entirely, because
the cheapest fix for bad anatomy is not rendering anatomy.

**Draft fallback.** An article whose hero never clears the gates publishes as a
`draft` — reusing the mechanism that holds back thin-sourced stories, so nothing
new appears on the reader's side. Its text is still written and uploaded, so a
later run can promote it without recomposing. Drafted articles are skipped in
waves 2-3: a draft is out of the feed, so its supporting images would never be
seen.

**Degradation is deliberate at every layer.** No lane → local metrics only. No
detector models → `partial: true`. Judge unreachable, rate-limited, or refusing
→ fall back to the structural ranking and record why. The gates exist to catch
bad images, never to become a way to lose good ones.

**Credential rotation was not optional.** The first live judge call returned 429
on the first credential in the chain. `createRotator()` in `anthropic-client.js`
walks the chain — transient failures rotate, auth failures retire the credential
for the run. (`article-composer.js` still carries its own older copy of this
logic; unifying them is a change to the working composition path, not to image
quality, so it was left alone.)

**Verified live.** A two-image judge call on the Step 3 calibration set scored
the "two volunteers" render 49/100, not publishable — *"left volunteer's hand is
distorted with malformed, oddly-jointed fingers … faces are cropped away"* — and
the giant-hand render 15/100. The first of those passed the structural gate at
100/100, which is precisely the gap the judge exists to close: with no face or
person detector installed, the structural gate cannot see a cropped face or a
subtly wrong hand.

### Then — final bake-off and recommendation

Re-run schnell vs Juggernaut over a representative article set with the scoring
gate in place. Report quality scores, pass/fail rates and generation time, plus
qualitative examples, then recommend a default. Switch only on the owner's
approval.

## Prompt construction (applies throughout)

**Status: half done, deliberately.** The people-free half shipped with Step 5 —
it is escalation round 2, and it is the strongest single lever the ladder has.
The structured scene object did **not** ship. It changes `composeSchema()`, the
frozen `IMAGE_CONTRACT`, and therefore the output of every article composed from
that point on; that is a change to the *writing* path, validated by a different
set of tests, and folding it into an image-quality change would mean one commit
that can regress both. It is the natural next piece of work, on its own.

The original note follows.

Have the compose step return a **structured scene object**
(`{subject, people_count, setting, time_of_day, mood, camera, avoid[]}`) and
build the prompt deterministically in code, so quality stops depending on how
Claude phrased a sentence. Prefer people-free or back-turned compositions when
the story does not need faces — the cheapest anatomy fix is not rendering hands
and faces at all.
