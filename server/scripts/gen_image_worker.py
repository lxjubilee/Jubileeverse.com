"""
InspireCortex Local GPU Image Generator
Runs inside the images-worker Docker container via: docker exec inspirecortex-images-worker-1 python3 /tmp/gen_image_worker.py

Reads a JSON batch file from /tmp/jubilee_batch.json, generates images using the
Juggernaut Ragnarok model, and saves them to /tmp/jubilee_output/<article_id>.jpg

Input JSON format:
[
  {
    "id": 123,
    "prompt": "...",
    "negative_prompt": "..."
  },
  ...
]

Output: Writes /tmp/jubilee_output/<id>.jpg for each article
        Writes /tmp/jubilee_results.json with status per article
"""

import gc
import json
import os
import sys
import time
from pathlib import Path

import torch
from diffusers import StableDiffusionXLPipeline
from PIL import Image

# ── Config ──────────────────────────────────────────────────────────────────
MODEL_PATH   = "/models/juggernaut-xl/juggernautXL_ragnarokBy.safetensors"
INPUT_FILE   = "/tmp/jubilee_batch.json"
OUTPUT_DIR   = "/tmp/jubilee_output"
RESULTS_FILE = "/tmp/jubilee_results.json"
WIDTH        = 1280
HEIGHT       = 720
STEPS        = 35
CFG_SCALE    = 5.0
THROTTLE_SEC = 3   # seconds between generations (GPU cooldown)

STANDARD_NEGATIVE = (
    "ugly, deformed, noisy, blurry, low quality, jpeg artifacts, bad anatomy, "
    "extra limbs, missing limbs, malformed fingers, extra fingers, fused digits, "
    "distorted hands, warped knuckles, duplicate limbs, mutated anatomy, "
    "unrealistic proportions, overexposed, underexposed, flat lighting, "
    "studio lights, text, watermarks, logos, writing, signs, lettering, "
    "nsfw, nude, violence, gore, dark mood, despair, sorrow, crying alone, "
    "hopeless, defeated, ominous shadows, sinister, dark atmosphere, "
    "cartoon, anime, illustration, painting, drawing, sketch, "
    "low resolution, grainy, pixelated, compression artifacts"
)

# ── Load model ───────────────────────────────────────────────────────────────

def load_model():
    if not Path(MODEL_PATH).is_file():
        print(f"ERROR: Model not found at {MODEL_PATH}", flush=True)
        sys.exit(1)

    print(f"[GPU] Loading Juggernaut Ragnarok from {MODEL_PATH}", flush=True)
    print(f"[GPU] VRAM free before load: {get_vram_free_mb():.0f} MB", flush=True)

    pipe = StableDiffusionXLPipeline.from_single_file(
        MODEL_PATH,
        torch_dtype=torch.float16,
    ).to("cuda")

    pipe.enable_attention_slicing()
    pipe.enable_vae_slicing()

    print(f"[GPU] Model loaded — VRAM used: {get_vram_used_mb():.0f} MB", flush=True)
    return pipe


def get_vram_used_mb():
    if torch.cuda.is_available():
        return torch.cuda.memory_allocated(0) / (1024 * 1024)
    return 0


def get_vram_free_mb():
    if torch.cuda.is_available():
        total = torch.cuda.get_device_properties(0).total_memory
        used  = torch.cuda.memory_allocated(0)
        return (total - used) / (1024 * 1024)
    return 0


# ── Generate images ──────────────────────────────────────────────────────────

def generate_batch(pipe, articles):
    Path(OUTPUT_DIR).mkdir(parents=True, exist_ok=True)
    results = []

    for i, article in enumerate(articles):
        article_id  = article["id"]
        prompt      = article["prompt"]
        neg_prompt  = article.get("negative_prompt", "") + " " + STANDARD_NEGATIVE

        output_path = Path(OUTPUT_DIR) / f"{article_id}.jpg"
        print(f"\n[{i+1}/{len(articles)}] Article {article_id}", flush=True)
        print(f"  Prompt: {prompt[:100]}...", flush=True)

        t_start = time.time()
        try:
            with torch.inference_mode():
                result = pipe(
                    prompt=prompt,
                    negative_prompt=neg_prompt,
                    width=WIDTH,
                    height=HEIGHT,
                    num_inference_steps=STEPS,
                    guidance_scale=CFG_SCALE,
                    num_images_per_prompt=1,
                )

            image: Image.Image = result.images[0]

            # Save as high-quality JPEG
            image.save(str(output_path), format="JPEG", quality=90, optimize=True)
            file_size_kb = output_path.stat().st_size // 1024
            elapsed = time.time() - t_start

            print(f"  Saved: {output_path} ({file_size_kb} KB) in {elapsed:.1f}s", flush=True)

            # Basic validation: file must be at least 100KB
            if file_size_kb < 100:
                raise ValueError(f"Output file too small ({file_size_kb} KB) — likely a blank image")

            results.append({
                "id":       article_id,
                "status":   "generated",
                "path":     str(output_path),
                "size_kb":  file_size_kb,
                "time_sec": round(elapsed, 1),
            })

        except Exception as e:
            print(f"  ERROR: {e}", flush=True)
            results.append({
                "id":     article_id,
                "status": "failed",
                "error":  str(e),
            })

        # Throttle between generations
        if i < len(articles) - 1:
            time.sleep(THROTTLE_SEC)

    return results


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    if not Path(INPUT_FILE).exists():
        print(f"ERROR: Input file not found: {INPUT_FILE}", flush=True)
        sys.exit(1)

    with open(INPUT_FILE, "r") as f:
        articles = json.load(f)

    print(f"[Batch] Loaded {len(articles)} articles to process", flush=True)

    pipe = load_model()
    results = generate_batch(pipe, articles)

    # Write results
    with open(RESULTS_FILE, "w") as f:
        json.dump(results, f, indent=2)

    # Summary
    generated = sum(1 for r in results if r["status"] == "generated")
    failed    = sum(1 for r in results if r["status"] == "failed")
    print(f"\n[DONE] Generated: {generated} | Failed: {failed}", flush=True)
    print(f"[DONE] Results written to {RESULTS_FILE}", flush=True)

    # Cleanup
    del pipe
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()


if __name__ == "__main__":
    main()
