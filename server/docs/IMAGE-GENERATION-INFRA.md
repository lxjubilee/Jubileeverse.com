# Image Generation Infrastructure — JubileeVerse (LAN GPU / ComfyUI)

> How to generate MidJourney-grade article images on the local InspireCortex GPU
> fleet, **directly over the LAN** (no Cloudflare). Companion to
> `.prompts/image-generator.md` (the per-article contract) and
> `scripts/generate-article-images.js` (the runner). Written 2026-06-22.

---

## 1. Why this doc exists

The cloud path `https://api.inspirecortex.com/v1/midjourney/...` is gated by
**Cloudflare Access**. From the workstation it returns **HTTP 302** (login
redirect) unless a valid CF service-token secret is present — and that secret is
frequently stale. The GPU servers are on the **same LAN**, so the reliable path
is to talk to their **ComfyUI HTTP APIs directly** by IP/hostname. This is the
same approach the `inspirecortex-avatars` project uses for video.

---

## 2. LAN Topology (discovered 2026-06-22)

| Role | Host | LAN IP | GPU | Image API |
|------|------|--------|-----|-----------|
| Workstation (this box) | **HPC-GABRIEL** | 10.0.0.144 | none capable | n/a (orchestrator) |
| Brain / render gateway | **HPC-FLYWHEEL** | **10.0.0.43** | **1× RTX PRO 6000 (Blackwell, 96 GB, bf16)** | ComfyUI bound to `127.0.0.1:8188` (NOT LAN-exposed); reachable only via the farm gateway `HPC-FLYWHEEL:8300` |
| Sprinter / render workers | **HDC-INSPIRESERVER** (`HDC-INSPIRESERVER.JubileeIntelligence.com`) | **10.0.0.52** | **2× RTX 5090 (32 GB, fp8-only)** | **ComfyUI `10.0.0.52:8188` (GPU0) and `10.0.0.52:8189` (GPU1)** — LAN-reachable ✅ |

Reachability from HPC-GABRIEL (verified):
- `10.0.0.52:8188` ✅ ComfyUI (RTX 5090) — `/system_stats` OK
- `10.0.0.52:8189` ✅ ComfyUI (RTX 5090) — `/system_stats` OK
- `HPC-FLYWHEEL:8300` ✅ farm gateway (S2V video API) — TCP open
- `HPC-FLYWHEEL:8188` ❌ ComfyUI not LAN-exposed (127.0.0.1 only on FLYWHEEL)

**Practical conclusion:** drive still-image generation against the **two RTX 5090
ComfyUI instances** (`10.0.0.52:8188` and `:8189`) — one job per GPU, in parallel.
The RTX PRO 6000 is reserved for the avatar/video pipeline and is only reachable
through `farm_service.py` on `:8300`; using it for stills would require adding an
image route there (future option, §8).

### Server management (HDC-INSPIRESERVER / 10.0.0.52)
- Windows. ComfyUI root: **`D:\ComfyUI`**, venv `D:\ComfyUI\venv\Scripts\python.exe`.
- Models live under **`D:\ComfyUI\models\<type>\`** (`checkpoints`, `diffusion_models`, `clip`/`text_encoders`, `vae`, `loras`).
- Each card = its own ComfyUI via SYSTEM scheduled tasks `InspireComfyUI_8188` / `InspireComfyUI_8189`, launch scripts `run-comfy-8188.ps1` / `8189.ps1` (must set `PYTHONUTF8=1`).
- Managed remotely with `Invoke-Command -ComputerName HDC-INSPIRESERVER.JubileeIntelligence.com` (WinRM/Kerberos — **use the FQDN**, short name fails Kerberos). Reference: `inspirecortex-avatars/avatar-service/tools/video-bank/restore_5090.ps1`.

### Currently installed models (5090s, as of 2026-06-22)
**Video only** — no still-image checkpoint is installed:
- diffusion_models: `Wan2_1-I2V-14B-480P_fp8`, `wan2.1_flf2v_720p_14B_fp8`, `wan2.2_s2v_14B_fp8_scaled`
- text encoder: `umt5_xxl_fp16` · vae: `wan_2.1_vae` · loras: Wan T2V/I2V lightx2v
- `CheckpointLoaderSimple` → **empty** (no SDXL/Juggernaut), no FLUX weights present.

→ To produce MidJourney-grade stills, an image model must be installed (§4).

---

## 3. Model research — what reaches "MidJourney quality"

Ranked for this hardware (5090 = 32 GB, fp8-native; PRO 6000 = 96 GB, bf16):

| Option | Quality vs MJ | VRAM | License | Verdict |
|--------|---------------|------|---------|---------|
| **FLUX.1-dev (fp8)** | **Closest open match** — aesthetics, prompt adherence, coherent hands/text | ~12 GB (fp8) | **Non-commercial** (BFL) — needs a commercial license for a publication | **Recommended** for quality; resolve licensing (§3.1) |
| **FLUX.1-schnell (fp8)** | Near-dev, slightly less refined; 4-step turbo | ~12 GB | **Apache-2.0 (commercial-OK)** | **Recommended commercial-safe** fast option |
| SDXL + **Juggernaut XL v9** | Strong, a notch below FLUX; already referenced by jubileeverse | ~7 GB | permissive (verify Juggernaut terms) | Good lightweight fallback |
| Wan2.x (installed) | Video model, not a stills model | — | — | not applicable to article images |

**Recommendation:** standardize on **FLUX.1-dev (fp8)** for hero/article images,
with **FLUX.1-schnell** as the commercial-safe / fast lane, and **Juggernaut XL**
as a low-VRAM fallback. FLUX runs natively on the 5090s in fp8.

### 3.1 Licensing — read before publishing
FLUX.1-**dev** is released under a **non-commercial** license. JubileeVerse is a
public publication, so for published images either (a) obtain a Black Forest Labs
commercial license for FLUX.1-dev, or (b) use **FLUX.1-schnell** (Apache-2.0) or
**Juggernaut XL** for anything published. Use FLUX.1-dev freely for internal
drafts/comps. Record the chosen license decision alongside the model files.

### 3.2 FLUX file set (ComfyUI)
Install into `D:\ComfyUI\models\`:
- `diffusion_models\flux1-dev-fp8.safetensors` (~12 GB) — fp8 for the 5090s
  (full bf16 `flux1-dev.safetensors` ~24 GB only if running on the PRO 6000).
- `text_encoders\t5xxl_fp8_e4m3fn.safetensors` (~4.9 GB) + `text_encoders\clip_l.safetensors` (~246 MB)
  (repo: `comfyanonymous/flux_text_encoders`).
- `vae\ae.safetensors` (~335 MB) — the FLUX autoencoder.
- (optional) a MidJourney-style aesthetic LoRA in `loras\` for an even closer MJ look.

FLUX sampling defaults: **CFG = 1.0**, **FluxGuidance ≈ 3.5**, **20–28 steps**,
sampler **euler**, scheduler **simple**; resolutions 1024×1024 or 16:9
(1344×768 / 1216×832). FLUX uses an empty negative prompt (guidance-distilled).

---

## 4. Installing the model (the one step that needs authorization)

The download runs **on HDC-INSPIRESERVER** (it has the disk + GPU). From this
workstation it is launched via `Invoke-Command` (WinRM) — which the safety
classifier blocks unless the host is explicitly authorized. Run this yourself, or
authorize it, then re-run the generator (§5).

### 4.1 Install record — what was actually done (2026-06-22)
Installed **FLUX.1-schnell fp8** (Apache-2.0, commercial-safe). The all-in-one fp8
checkpoint loads via ComfyUI's `CheckpointLoaderSimple` (no separate clip/vae needed).

Gotchas hit and the fixes (so this is repeatable):
- **`huggingface-cli` is deprecated** in `huggingface_hub` 1.x → use **`hf`**
  (`D:\ComfyUI\venv\Scripts\hf.exe`). The old name just prints help and exits.
- **cp1252 console crash**: `hf` prints a `✓` and Windows' default codec dies with
  `'charmap' codec can't encode character '✓'`, exiting **0 bytes** silently.
  **FIX: set `PYTHONUTF8=1`** (the same trap `restore_5090.ps1` documents).
- schnell is **ungated/public** → no HF token needed; the "unauthenticated" warning is harmless.

Launched as a detached **SYSTEM scheduled task** so it survives the WinRM session
(`Invoke-Command -ComputerName HDC-INSPIRESERVER.JubileeIntelligence.com` — FQDN required for Kerberos):

```powershell
$cmd = 'set PYTHONUTF8=1&& set PYTHONIOENCODING=utf-8&& set HF_HUB_DISABLE_XET=1&& ' +
       'D:\ComfyUI\venv\Scripts\hf.exe download Comfy-Org/flux1-schnell flux1-schnell-fp8.safetensors ' +
       '--local-dir D:\ComfyUI\models\checkpoints > D:\ComfyUI\logs\dl_flux.log 2>&1'
$a = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument ('/c ' + $cmd)
$p = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -RunLevel Highest
Register-ScheduledTask -TaskName 'FluxSchnellDownload' -Action $a -Principal $p -Force
Start-ScheduledTask -TaskName 'FluxSchnellDownload'
# -> ~16 GB to D:\ComfyUI\models\checkpoints\flux1-schnell-fp8.safetensors
```

Confirm (ComfyUI rescans on the next `/object_info` — no restart needed):
```powershell
(Invoke-RestMethod http://10.0.0.52:8188/object_info/CheckpointLoaderSimple).CheckpointLoaderSimple.input.required.ckpt_name[0]
(Invoke-RestMethod http://10.0.0.52:8189/object_info/CheckpointLoaderSimple).CheckpointLoaderSimple.input.required.ckpt_name[0]
# -> both list flux1-schnell-fp8.safetensors  (16.05 GB)
```

Workspace backup (git-ignored under `models/`), copied over the LAN admin share:
```powershell
robocopy "\\HDC-INSPIRESERVER.JubileeIntelligence.com\D$\ComfyUI\models\checkpoints" `
         "W:\jubileeverse.com\models\flux" flux1-schnell-fp8.safetensors /J /NP
```

> **Alternative models.** FLUX.1-**dev** fp8 (`Comfy-Org/flux1-dev` →
> `flux1-dev-fp8.safetensors`) is top quality but **non-commercial + gated**
> (`hf auth login` first; use ~24 steps, FluxGuidance 3.5). Juggernaut XL → drop
> `juggernautXL_*.safetensors` into `models\checkpoints\` and use an SDXL graph.

---

## 5. The generation pipeline (ComfyUI HTTP API)

ComfyUI is driven entirely over HTTP — no remote shell needed for generation:

1. `POST http://<host:port>/prompt` with `{ "prompt": <workflow-graph>, "client_id": <uuid> }`.
   The graph is the FLUX txt2img node set — for the all-in-one fp8 checkpoint:
   `CheckpointLoaderSimple → CLIPTextEncode → FluxGuidance → EmptySD3LatentImage →
   KSampler (euler/simple, cfg 1.0, schnell=4 steps) → VAEDecode → SaveImage`.
   Returns `{ prompt_id }`.
2. Poll `GET /history/<prompt_id>` until the node outputs appear.
3. Read the `SaveImage` output `{ filename, subfolder, type }` and fetch the bytes:
   `GET /view?filename=<f>&subfolder=<s>&type=output` → write the `.png`.

**Routing:** image 1 → `10.0.0.52:8188` (5090 #0), image 2 → `10.0.0.52:8189`
(5090 #1), image 3 → back to `:8188`. Both render in parallel. **Verified run
2026-06-22:** 3/3 images at 1344×768 in ~22 s total (set ID `r8x7nlwGxKPD`,
`celebration-mishpakhah`). Failover: retry a failed job on the other port.

`scripts/generate-article-images.js` implements this as the **`comfy`** provider
(default for LAN use), with the CF `/v1/midjourney` path kept as a fallback and a
placeholder-PNG mode for offline runs:

```bash
# direct LAN ComfyUI (FLUX) — once the model is installed:
node scripts/generate-article-images.js \
  --provider comfy \
  --comfy "http://10.0.0.52:8188,http://10.0.0.52:8189" \
  --article "J:/articles/celebration-mishpakhah/<slug>.md" \
  --root celebration-mishpakhah
```

It mints the shared 12-char `[0-9a-zA-Z]` set ID, writes
`<root>/images/<ID>-N.png`, and records the ID into the article `.md` and
`articles_catalog.json` (see `.prompts/image-generator.md` §2, §7).

---

## 6. Family-safe & quality enforcement
Same as `.prompts/image-generator.md` §6 — modest/reverent, no text/watermark, no
face of God, no minors. With FLUX, put quality cues in the positive prompt and use
a short negative via a second CLIPTextEncode if desired (FLUX largely ignores CFG;
prefer prompt-side control + FluxGuidance).

---

## 6.1 Quality & safety layers (added 2026-06-22)

Three enhancements layer on top of the base FLUX pipeline.

**A. Photorealism / cinematic — FLUX RealismLoRA.**
`XLabs-AI/flux-RealismLora` → `D:\ComfyUI\models\loras\flux-realism.safetensors` (21 MB,
also backed up to `models\flux\`). The generator inserts a `LoraLoaderModelOnly` on the
model path; control with `--realism <0..1>` (default 0.7; `0` = off → base painterly look).
This turns the base schnell render into a photoreal cinematic film-still. *(Alternative:
install Juggernaut XL / RealVisXL as a dedicated SDXL photoreal checkpoint.)*

**B. Realistic hands / anatomy.**
Two layers. (1) **Prompt-side** (always on): RealismLoRA + positive directive *"anatomically
correct hands with exactly five fingers and one thumb"* + expanded negative + **keep hands out
of the extreme foreground / no hand close-ups** (the #1 cause of mangled hands). This reduces
failures but does **not** guarantee them.
(2) **HandDetailer (the guarantee)** — a ComfyUI **Impact-Pack** pass that detects each hand
(`UltralyticsDetectorProvider` + `hand_yolov8s.pt`) and re-renders just that region with correct
anatomy.

*Install record (2026-06-22):* installed into the existing ComfyUI on 10.0.0.52 (the only
LAN-reachable FLUX ComfyUI) with the production video pipeline protected:
- `D:\ComfyUI\custom_nodes\ComfyUI-Impact-Pack` + `ComfyUI-Impact-Subpack` (git), `ultralytics` 8.4.75,
  `hand_yolov8s.pt` → `D:\ComfyUI\models\ultralytics\bbox\`.
- Deps installed with a **`--constraint`** file pinning `numpy/torch/torchvision/opencv/pillow/scipy`
  to their current versions; verified unchanged afterward (numpy 2.4.4, torch 2.11.0+cu128).
  (SAM2's optional source build is unused and irrelevant.)
- `PIP_CONSTRAINT=D:\ComfyUI\impact_constraints.txt` added to `run-comfy-8188.ps1` / `8189.ps1` so any
  Impact-Pack startup pip cannot bump pinned deps.

**ACTIVE (restarted + verified 2026-06-22).** Both ComfyUI instances were restarted one at a time;
each came back with FaceDetailer + UltralyticsDetectorProvider **and** the Wan video nodes loaded, and
numpy/torch unchanged. The generator now adds the HandDetailer by default (`--fix-hands 1`,
`--hand-denoise 0.45`, `--hand-steps 12`): after `VAEDecode` it runs `UltralyticsDetectorProvider`
(hand bbox) → `FaceDetailer` (FLUX model/clip/vae, cfg 1.0, euler/simple, guide_size 512) and saves the
hand-corrected image. Verified on the celebration-mishpakhah set (group shot with many hands + raised
glasses). To restart later (e.g. after updates), do **one instance at a time** so the other keeps serving video:
```powershell
# on HDC-INSPIRESERVER, per instance (8188 then, after verifying, 8189):
Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
  ? { $_.CommandLine -match 'main.py.*--port 8188' } | % { Stop-Process $_.ProcessId -Force }
Start-ScheduledTask -TaskName InspireComfyUI_8188
# verify: /system_stats OK; /object_info contains FaceDetailer + UltralyticsDetectorProvider + WanVideo;
#         python -c "import numpy,torch;print(numpy.__version__,torch.__version__)"  == 2.4.4 / 2.11.0+cu128
```
The HandDetailer roughly doubles per-image time (detect + re-render each hand: ~15–30 s vs ~4 s).
Disable per-run with `--fix-hands 0` if speed matters more than hand fidelity.

**C. Family-safe / Christian-audience guardrail — NudeNet.**
Isolated venv `D:\inspire-imgsafe\venv` (system Python 3.11; `nudenet` + `onnxruntime`,
**no torch** — separate from ComfyUI so production is never at risk). Classifier
`D:\inspire-imgsafe\safety_check.py` flags exposed-nudity classes
(genitalia / breast / buttocks / anus) at score ≥ 0.45. Run as a **one-shot** (no standing
service, no open port — those were intentionally NOT added):

```
powershell -File scripts\safety-scan.ps1 -Dir "J:\articles\<root>\images"
#  -> SAFE/UNSAFE per file; exit 1 if any flagged (gates publishing)
```

Verified: the celebration-mishpakhah set scans **SAFE** (0 flags). A standing HTTP
version (`safety_server.py`, port 8501) is deployed but **dormant** — enabling it needs an
inbound firewall rule + service registration, which require explicit authorization.

---

## 7. Troubleshooting
- **HTTP 302 / HTML from api.inspirecortex.com** → Cloudflare Access rejected the
  token. Use the LAN ComfyUI path instead, or regenerate `INSPIRECORTEX_CF_CLIENT_SECRET`.
- **HTTP 400 from ComfyUI / empty loader** → a model file is missing or a stalled
  `*.part`. Check byte sizes (§4); delete partials and re-download; restart the task.
- **`UnicodeEncodeError` crash on 5090 boot** → launch script missing `PYTHONUTF8=1`
  (see `restore_5090.ps1`).
- **5090 down after reboot** → run `restore_5090.ps1` on HDC-INSPIRESERVER.
- **FQDN required** → `Invoke-Command` to the short name fails Kerberos; use
  `HDC-INSPIRESERVER.JubileeIntelligence.com`.

---

## 8. Future options
- **Use the RTX PRO 6000 for top-tier stills**: add an image route to
  `farm_service.py` (`HPC-FLYWHEEL:8300`) or LAN-expose its ComfyUI, then run full
  **FLUX.1-dev bf16** for the highest fidelity. Add it as a third lane.
- **Auto-run images at article creation**: chain `generate-article-images.js` to
  the end of the article workflow so every new article gets its image set.
- **Aesthetic LoRA**: add a curated MJ-style FLUX LoRA for an even closer match.
