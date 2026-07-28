#!/usr/bin/env node
/*
 * r2-sync-avatars.js — incremental sync of J:/avatars -> Cloudflare R2 (the jubileeverse-cdn bucket)
 * under the `avatars/` prefix, so clips serve at https://cdn.jubileeverse.com/avatars/<persona>/<file>.
 *
 * Mirrors the proven music sync: diff by size (nothing is ever deleted), `--apply` to upload, immutable
 * cache headers for media. Credentials are read from a .env file (NEVER printed):
 *   R2_S3_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_CDN
 *
 * Usage:
 *   node r2-sync-avatars.js                    # diff only — shows what would upload
 *   node r2-sync-avatars.js --apply            # upload missing/size-mismatched files
 *   node r2-sync-avatars.js --apply --concurrency=8
 *   node r2-sync-avatars.js --src=J:/avatars --prefix=avatars/ --env=W:/JubileeVerse.com/.env
 */
const fs = require("fs");
const path = require("path");
const { S3Client, ListObjectsV2Command, PutObjectCommand } = require("@aws-sdk/client-s3");

const args = process.argv.slice(2);
const arg = (k, d) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.split("=").slice(1).join("=") : d; };
const APPLY = args.includes("--apply");
const CONC = Math.max(1, Math.min(parseInt(arg("concurrency", "6"), 10) || 6, 12));
const SRC = arg("src", "J:/avatars");
const PREFIX = arg("prefix", "avatars/").replace(/^\/+/, "");
const ENVF = arg("env", process.env.R2_ENV_FILE || "");

// load a .env into process.env (only vars not already set); silent if file missing
function loadEnv(file) {
  if (!file) return;
  try {
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
}
[ENVF, "W:/JubileeVerse.com/.env", "W:/Jubilujah.com/.env", "C:/Websites/jubileeverse.com/.env"].forEach(loadEnv);

const { R2_S3_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_CDN } = process.env;
if (!R2_S3_ENDPOINT || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_CDN) {
  console.error("Missing R2 creds (need R2_S3_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_CDN).");
  console.error("Point --env=<path to a .env that has them>, or export them in the shell.");
  process.exit(2);
}

const s3 = new S3Client({
  region: "auto",
  endpoint: R2_S3_ENDPOINT,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

const CT = { ".mp4": "video/mp4", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".json": "application/json" };

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

async function listRemote() {
  const map = new Map();
  let token;
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket: R2_BUCKET_CDN, Prefix: PREFIX, ContinuationToken: token }));
    for (const o of r.Contents || []) map.set(o.Key, o.Size);
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  return map;
}

(async () => {
  if (!fs.existsSync(SRC)) { console.error("source dir not found:", SRC); process.exit(2); }
  const files = walk(SRC).filter((f) => /\.(mp4|png|jpe?g|webp|json)$/i.test(f));
  const remote = await listRemote();
  const todo = [];
  for (const f of files) {
    const rel = path.relative(SRC, f).split(path.sep).join("/");
    const key = PREFIX + rel;
    const size = fs.statSync(f).size;
    if (remote.get(key) !== size) todo.push({ f, key, size });
  }
  console.log(`R2 bucket=${R2_BUCKET_CDN} prefix=${PREFIX}`);
  console.log(`local files: ${files.length} | remote keys: ${remote.size} | PLAN: upload ${todo.length}`);
  todo.slice(0, 15).forEach((t) => console.log("  +", t.key, `(${(t.size / 1048576).toFixed(2)} MB)`));
  if (todo.length > 15) console.log(`  ... and ${todo.length - 15} more`);
  if (!APPLY) { console.log("\n(diff only — re-run with --apply to upload)"); return; }

  let i = 0, done = 0, fail = 0;
  async function worker() {
    while (i < todo.length) {
      const t = todo[i++];
      const ext = path.extname(t.f).toLowerCase();
      const cache = ext === ".json" ? "public, max-age=60" : "public, max-age=31536000, immutable";
      try {
        await s3.send(new PutObjectCommand({
          Bucket: R2_BUCKET_CDN, Key: t.key, Body: fs.createReadStream(t.f),
          ContentType: CT[ext] || "application/octet-stream", CacheControl: cache, ContentLength: t.size,
        }));
        if (++done % 20 === 0 || done + fail === todo.length) console.log(`  uploaded ${done}/${todo.length}`);
      } catch (e) { fail++; console.error("  FAIL", t.key, String((e && e.message) || e).slice(0, 140)); }
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));
  console.log(`\nDONE: uploaded ${done}, failed ${fail}`);
  process.exit(fail ? 1 : 0);
})();
