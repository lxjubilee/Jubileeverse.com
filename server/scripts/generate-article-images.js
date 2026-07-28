#!/usr/bin/env node
/**
 * generate-article-images.js — implements .prompts/image-generator.md
 *
 * Reads image-prompt01/02/03 from an article .md, mints one random 12-char
 * [0-9a-zA-Z] set ID, generates three images, saves them to
 * <root>/images/<ID>-N.png, and writes the ID into the .md and into
 * articles_catalog.json.
 *
 * Providers (--provider):
 *   comfy  (default) — direct LAN ComfyUI FLUX txt2img across the RTX 5090s
 *                      (10.0.0.52:8188 / :8189). No Cloudflare. See docs/IMAGE-GENERATION-INFRA.md
 *   cf              — InspireCortex /v1/midjourney API (Cloudflare Access)
 *   mock            — placeholder PNGs (offline)
 * Any provider falls back to a placeholder PNG per-image on failure.
 *
 * Usage:
 *   node scripts/generate-article-images.js --provider comfy \
 *     --comfy "http://10.0.0.52:8188,http://10.0.0.52:8189" \
 *     --article "J:/articles/celebration-mishpakhah/<slug>.md" --root celebration-mishpakhah
 */
'use strict';

try { require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') }); } catch (_) {}

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const net = require('net');
const zlib = require('zlib');
const crypto = require('crypto');

// ── Args ───────────────────────────────────────────────────────────────────
function arg(name, def) { const i = process.argv.indexOf(`--${name}`); return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def; }
const ROOT_SLUG = arg('root', 'celebration-mishpakhah');
const ARTICLES_BASE = arg('base', 'J:\\articles');
const ARTICLE_MD = arg('article', path.join(ARTICLES_BASE, ROOT_SLUG, 'fatted-calf-comes-first-restoration-before-reform.md'));
const CATALOG = path.join(ARTICLES_BASE, 'articles_catalog.json');
const PROVIDER = arg('provider', 'comfy'); // comfy | cf | mock
const COMFY_URLS = arg('comfy', 'http://10.0.0.52:8188,http://10.0.0.52:8189').split(',').map((s) => s.trim()).filter(Boolean);

// FLUX model on the ComfyUI servers. Default: FLUX.1-schnell all-in-one fp8 checkpoint
// (Apache-2.0, commercial-safe) loaded via CheckpointLoaderSimple. schnell = 4-step distilled.
const FLUX = {
  checkpoint: arg('flux-checkpoint', 'flux1-schnell-fp8.safetensors'),
  steps: Number(arg('steps', '4')),
  guidance: Number(arg('guidance', '3.5')),
  width: Number(arg('width', '1344')),
  height: Number(arg('height', '768')),
  // Photoreal FLUX RealismLoRA (XLabs). Set --realism 0 to disable.
  realism: Number(arg('realism', '0.7')),
  realismLora: arg('realism-lora', 'flux-realism.safetensors'),
  // HandDetailer (Impact-Pack: detect each hand + re-render it correct). --fix-hands 0 to disable.
  // schnell is 4-step distilled: keep detailer steps low (over-stepping degrades the re-render),
  // use higher denoise so the hand is REBUILT (not just polished), and cycle twice.
  fixHands: arg('fix-hands', '1') !== '0',
  handModel: arg('hand-model', 'bbox/hand_yolov8s.pt'),
  handSteps: Number(arg('hand-steps', '8')),
  handDenoise: Number(arg('hand-denoise', '0.6')),
  handCycle: Number(arg('hand-cycle', '2')),
  handBbox: Number(arg('hand-bbox', '0.3')),     // lower => catch occluded/atypical hands
  handDilation: Number(arg('hand-dilation', '16')),
};

// InspireCortex Cloudflare API (cf provider)
const API_URL = process.env.INSPIRECORTEX_API_URL || 'http://localhost:8080';
const JWT = process.env.INSPIRECORTEX_JWT || '';
const CF_ID = process.env.INSPIRECORTEX_CF_CLIENT_ID || '';
const CF_SECRET = process.env.INSPIRECORTEX_CF_CLIENT_SECRET || '';
const MOCK_ENV = String(process.env.IMAGE_REGEN_MOCK || '').toLowerCase() === 'true';

const STYLE_SUFFIX = ', photorealistic cinematic film still, dramatic natural lighting, rich color depth, emotionally compelling, sharp focus, fine detail, gallery quality, professional MidJourney-grade render, anatomically correct hands with exactly five fingers and one thumb, natural well-formed hands';
const NEGATIVE = 'nsfw, nude, bare skin, suggestive, sexual content, ugly, deformed, blurry, low quality, bad anatomy, malformed hands, mutated hands, six fingers, extra fingers, missing fingers, fused fingers, distorted hands, extra limbs, text, watermark, logo, signature, gore, violence, dark ominous mood';

function log(m) { console.log(`[${new Date().toISOString()}] ${m}`); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ── 12-char [0-9a-zA-Z] id ───────────────────────────────────────────────────
function mintId() { const ab = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'; let s = ''; for (let i = 0; i < 12; i++) s += ab[crypto.randomInt(ab.length)]; return s; }

function extractPrompts(md) {
  const out = [];
  for (let n = 1; n <= 3; n++) {
    const m = md.match(new RegExp(`\\*\\*image-prompt0${n}:\\*\\*\\s*([^\\n]+)`));
    if (!m) throw new Error(`image-prompt0${n} not found in article`);
    out.push(m[1].trim());
  }
  return out;
}

// ── Generic HTTP ─────────────────────────────────────────────────────────────
function request(method, urlStr, { headers = {}, body = null, timeout = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const lib = u.protocol === 'https:' ? https : http;
    const h = { ...headers };
    let data = null;
    if (body != null) { data = typeof body === 'string' ? body : JSON.stringify(body); h['Content-Length'] = Buffer.byteLength(data); if (!h['Content-Type']) h['Content-Type'] = 'application/json'; }
    const req = lib.request({ hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname + u.search, method, headers: h, timeout }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, buf: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('request timeout')); });
    if (data) req.write(data);
    req.end();
  });
}
function reachable(urlStr, timeoutMs = 5000) {
  return new Promise((resolve) => {
    let u; try { u = new URL(urlStr); } catch { return resolve(false); }
    const sock = net.connect({ host: u.hostname, port: Number(u.port || (u.protocol === 'https:' ? 443 : 80)) });
    const done = (ok) => { try { sock.destroy(); } catch {} resolve(ok); };
    sock.setTimeout(timeoutMs); sock.once('connect', () => done(true)); sock.once('timeout', () => done(false)); sock.once('error', () => done(false));
  });
}

// ── Provider: ComfyUI FLUX (LAN) ─────────────────────────────────────────────
function fluxGraph(prompt, seed, id) {
  // All-in-one FLUX fp8 checkpoint via CheckpointLoaderSimple -> MODEL(0) CLIP(1) VAE(2)
  const g = {
    '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: FLUX.checkpoint } },
    '4': { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['1', 1] } },
    '5': { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['1', 1] } },
    '6': { class_type: 'FluxGuidance', inputs: { conditioning: ['4', 0], guidance: FLUX.guidance } },
    '7': { class_type: 'EmptySD3LatentImage', inputs: { width: FLUX.width, height: FLUX.height, batch_size: 1 } },
    '8': { class_type: 'KSampler', inputs: { model: ['1', 0], positive: ['6', 0], negative: ['5', 0], latent_image: ['7', 0], seed, steps: FLUX.steps, cfg: 1.0, sampler_name: 'euler', scheduler: 'simple', denoise: 1.0 } },
    '9': { class_type: 'VAEDecode', inputs: { samples: ['8', 0], vae: ['1', 2] } },
    '10': { class_type: 'SaveImage', inputs: { images: ['9', 0], filename_prefix: `jv_${id}` } },
  };
  // Photoreal: insert the RealismLoRA on the model path (XLabs flux-RealismLora)
  if (FLUX.realism > 0 && FLUX.realismLora) {
    g['11'] = { class_type: 'LoraLoaderModelOnly', inputs: { model: ['1', 0], lora_name: FLUX.realismLora, strength_model: FLUX.realism } };
    g['8'].inputs.model = ['11', 0];
  }
  // HandDetailer: detect each hand (YOLO) and re-render that region with correct anatomy.
  if (FLUX.fixHands) {
    const modelRef = (FLUX.realism > 0 && FLUX.realismLora) ? ['11', 0] : ['1', 0];
    g['12'] = { class_type: 'UltralyticsDetectorProvider', inputs: { model_name: FLUX.handModel } };
    g['13'] = { class_type: 'FaceDetailer', inputs: {
      image: ['9', 0], model: modelRef, clip: ['1', 1], vae: ['1', 2],
      positive: ['6', 0], negative: ['5', 0], bbox_detector: ['12', 0],
      guide_size: 512, guide_size_for: true, max_size: 1024,
      seed, steps: FLUX.handSteps, cfg: 1.0, sampler_name: 'euler', scheduler: 'simple',
      denoise: FLUX.handDenoise, feather: 5, noise_mask: true, force_inpaint: true,
      bbox_threshold: FLUX.handBbox, bbox_dilation: FLUX.handDilation, bbox_crop_factor: 3.0,
      sam_detection_hint: 'center-1', sam_dilation: 0, sam_threshold: 0.93,
      sam_bbox_expansion: 0, sam_mask_hint_threshold: 0.7, sam_mask_hint_use_negative: 'False',
      drop_size: 10, wildcard: '', cycle: 1,
    } };
    g['10'].inputs.images = ['13', 0]; // save the hand-corrected image
  }
  return g;
}
async function comfyGenerate(baseUrl, prompt, dest, id) {
  const clientId = crypto.randomUUID();
  const seed = crypto.randomInt(1, 2 ** 31);
  const sub = await request('POST', `${baseUrl}/prompt`, { body: { prompt: fluxGraph(prompt, seed, id), client_id: clientId }, timeout: 30000 });
  if (sub.status !== 200) throw new Error(`/prompt HTTP ${sub.status}: ${sub.buf.toString().slice(0, 200)}`);
  const promptId = JSON.parse(sub.buf.toString()).prompt_id;
  if (!promptId) throw new Error('no prompt_id');
  // poll history (FLUX ~5-15s on a 5090)
  let outImg = null;
  for (let t = 0; t < 90; t++) {
    await sleep(2000);
    const h = await request('GET', `${baseUrl}/history/${promptId}`, { timeout: 15000 });
    if (h.status !== 200) continue;
    const hist = JSON.parse(h.buf.toString() || '{}');
    const rec = hist[promptId];
    if (rec && rec.outputs) {
      for (const node of Object.values(rec.outputs)) if (node.images && node.images[0]) { outImg = node.images[0]; break; }
      if (outImg) break;
      if (rec.status && rec.status.status_str === 'error') throw new Error('comfy job error');
    }
  }
  if (!outImg) throw new Error('timed out waiting for image');
  const q = `filename=${encodeURIComponent(outImg.filename)}&subfolder=${encodeURIComponent(outImg.subfolder || '')}&type=${encodeURIComponent(outImg.type || 'output')}`;
  const img = await request('GET', `${baseUrl}/view?${q}`, { timeout: 30000 });
  if (img.status !== 200 || img.buf.length < 10000) throw new Error(`view HTTP ${img.status} size ${img.buf.length}`);
  fs.writeFileSync(dest, img.buf);
  return img.buf.length;
}

// ── Provider: InspireCortex /v1/midjourney (Cloudflare) ──────────────────────
function cfHeaders(urlStr) { const h = { 'Content-Type': 'application/json' }; if (JWT) h.Authorization = `Bearer ${JWT}`; if (/inspirecortex\.com/i.test(urlStr)) { if (CF_ID) h['CF-Access-Client-Id'] = CF_ID; if (CF_SECRET) h['CF-Access-Client-Secret'] = CF_SECRET; } return h; }
async function cfGenerate(prompt, dest) {
  const gen = await request('POST', `${API_URL}/v1/midjourney/generate`, { headers: cfHeaders(API_URL), body: { prompt, negative_prompt: NEGATIVE, style_preset: 'cinematic', steps: 30, guidance_scale: 7.0, num_variations: 1 }, timeout: 120000 });
  if (gen.status !== 200) throw new Error(`generate HTTP ${gen.status}: ${gen.buf.toString().slice(0, 120)}`);
  const v = (JSON.parse(gen.buf.toString()).variations || [])[0];
  if (!v || !v.minio_key) throw new Error('no minio_key');
  const key = v.minio_key.split('/').map(encodeURIComponent).join('/');
  const img = await request('GET', `${API_URL}/v1/midjourney/image/${key}`, { headers: cfHeaders(API_URL), timeout: 60000 });
  if (img.status !== 200 || img.buf.length < 10000) throw new Error(`download HTTP ${img.status} size ${img.buf.length}`);
  fs.writeFileSync(dest, img.buf);
  return img.buf.length;
}

// ── Placeholder PNG ──────────────────────────────────────────────────────────
const CRC = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const t = Buffer.from(type, 'ascii'); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, crc]); }
function placeholderPng(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h); let p = 0;
  for (let y = 0; y < h; y++) { raw[p++] = 0; const s = 1 - (y / h) * 0.35; for (let x = 0; x < w; x++) { raw[p++] = Math.round(rgb[0] * s); raw[p++] = Math.round(rgb[1] * s); raw[p++] = Math.round(rgb[2] * s); } }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const PH_COLORS = [[196, 150, 86], [212, 180, 112], [92, 112, 150]];

// ── .md + catalog writers ────────────────────────────────────────────────────
function updateMd(mdPath, id, rels) {
  let md = fs.readFileSync(mdPath, 'utf8');
  md = md.replace(/\n\*\*Image Set ID:\*\*[\s\S]*?\*\*image03:\*\* [^\n]*\n/, '\n');
  const block = `\n**Image Set ID:** ${id}\n\n**image01:** ${rels[0]}\n**image02:** ${rels[1]}\n**image03:** ${rels[2]}\n`;
  md = md.replace(/(\*\*image-prompt03:\*\* [^\n]*\n)/, `$1${block}`);
  fs.writeFileSync(mdPath, md, 'utf8');
}
function updateCatalog(id, rels, status) {
  const cat = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
  const node = cat.categories.find((c) => c.slug === ROOT_SLUG);
  if (node && node.article) { node.article.image_set_id = id; node.article.images = rels; node.article.image_status = status; }
  cat.articles = (cat.articles || []).map((a) => (a.category_path === ROOT_SLUG || (node && node.article && a.file === node.article.file)) ? { ...a, image_set_id: id, images: rels, image_status: status } : a);
  fs.writeFileSync(CATALOG, JSON.stringify(cat, null, 2) + '\n', 'utf8');
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  log('='.repeat(66));
  log(`Article images — ${path.basename(ARTICLE_MD)} | provider=${PROVIDER}`);
  const md = fs.readFileSync(ARTICLE_MD, 'utf8');
  const prompts = extractPrompts(md);
  const id = mintId();
  const imagesDir = path.join(ARTICLES_BASE, ROOT_SLUG, 'images');
  fs.mkdirSync(imagesDir, { recursive: true });
  const rels = [1, 2, 3].map((n) => `${ROOT_SLUG}/images/${id}-${n}.png`);
  log(`Set ID: ${id}`);

  // Decide live lanes for the comfy provider
  let comfyLanes = [];
  if (PROVIDER === 'comfy' && !MOCK_ENV) {
    for (const u of COMFY_URLS) { if (await reachable(`${u}/`)) comfyLanes.push(u); }
    log(`ComfyUI lanes reachable: ${comfyLanes.length ? comfyLanes.join(', ') : 'none'}`);
  }

  let real = 0;
  for (let i = 0; i < 3; i++) {
    const dest = path.join(imagesDir, `${id}-${i + 1}.png`);
    const full = prompts[i] + STYLE_SUFFIX;
    let done = false;
    if (PROVIDER === 'comfy' && comfyLanes.length) {
      for (let a = 0; a < comfyLanes.length && !done; a++) {
        const lane = comfyLanes[(i + a) % comfyLanes.length];
        try { log(`[img${i + 1}] ComfyUI ${lane} (FLUX) ...`); const sz = await comfyGenerate(lane, full, dest, id); log(`[img${i + 1}] saved ${Math.round(sz / 1024)}KB`); done = true; real++; }
        catch (e) { log(`[img${i + 1}] ${lane} failed: ${e.message}`); }
      }
    } else if (PROVIDER === 'cf' && !MOCK_ENV && JWT) {
      try { log(`[img${i + 1}] InspireCortex CF MJ ...`); const sz = await cfGenerate(full, dest); log(`[img${i + 1}] saved ${Math.round(sz / 1024)}KB`); done = true; real++; }
      catch (e) { log(`[img${i + 1}] CF failed: ${e.message}`); }
    }
    if (!done) { fs.writeFileSync(dest, placeholderPng(1280, 720, PH_COLORS[i])); log(`[img${i + 1}] placeholder -> ${path.basename(dest)}`); }
  }

  const status = real === 3 ? 'generated' : real > 0 ? 'partial' : 'mock';
  updateMd(ARTICLE_MD, id, rels);
  updateCatalog(id, rels, status);
  log('-'.repeat(66));
  log(`image_status: ${status} (real ${real}/3) | dir ${imagesDir}`);
  rels.forEach((r) => log(`  ${r}`));
  log(`.md + catalog updated with set ID ${id}`);
  log('='.repeat(66));
}

main().catch((e) => { log(`FATAL: ${e.message}`); process.exit(1); });
