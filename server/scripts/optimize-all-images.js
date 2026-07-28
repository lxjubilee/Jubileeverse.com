#!/usr/bin/env node
/**
 * Optimize all site images using sharp + mozjpeg.
 * Processes multiple directories in parallel (CONCURRENCY workers).
 * Skips files that are already smaller than the result would be.
 */

const sharp  = require('sharp');
const fs     = require('fs');
const path   = require('path');
const os     = require('os');

const ROOT        = path.join(__dirname, '..', 'public', 'images');
const MAX_WIDTH   = 1920;
const MAX_HEIGHT  = 1080;
const QUALITY     = 82;
const CONCURRENCY = Math.max(4, os.cpus().length);  // parallel workers

// Directories to optimize (relative to ROOT). Skip deprecated + other-site dirs.
const DIRS = [
    'jubileeinspire.com',
    'JubileeVerse.com',
    'prominence',
    'personas',
    'current-events',
];

// ─── helpers ────────────────────────────────────────────────────────────────

function walk(dir) {
    const results = [];
    try {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const fp = path.join(dir, entry.name);
            if (entry.isDirectory()) results.push(...walk(fp));
            else if (/\.(jpe?g|png|webp)$/i.test(entry.name)) results.push(fp);
        }
    } catch (_) {}
    return results;
}

async function optimiseFile(fp) {
    const sizeBefore = fs.statSync(fp).size;
    const tmp = fp + '.opt.tmp';
    try {
        const img  = sharp(fp);
        const meta = await img.metadata();

        let pipe = img;
        if ((meta.width || 0) > MAX_WIDTH || (meta.height || 0) > MAX_HEIGHT) {
            pipe = pipe.resize(MAX_WIDTH, MAX_HEIGHT, { fit: 'inside', withoutEnlargement: true });
        }

        // Always output JPEG (covers PNG→JPEG conversion too, saves more)
        await pipe.jpeg({ quality: QUALITY, progressive: true, mozjpeg: true }).toFile(tmp);

        const sizeAfter = fs.statSync(tmp).size;
        if (sizeAfter < sizeBefore) {
            fs.renameSync(tmp, fp);
            return { saved: sizeBefore - sizeAfter, before: sizeBefore, after: sizeAfter };
        } else {
            fs.unlinkSync(tmp);
            return { saved: 0, before: sizeBefore, after: sizeBefore };
        }
    } catch (e) {
        try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_) {}
        return { saved: 0, before: sizeBefore, after: sizeBefore, err: e.message };
    }
}

async function runPool(files, label) {
    let idx = 0, done = 0, errs = 0;
    let totalBefore = 0, totalAfter = 0;
    const n = files.length;

    async function worker() {
        while (true) {
            const i = idx++;
            if (i >= n) break;
            const fp = files[i];
            const rel = path.relative(ROOT, fp);
            const r = await optimiseFile(fp);
            done++;
            totalBefore += r.before;
            totalAfter  += r.after;
            if (r.err) {
                errs++;
                process.stdout.write(`  [ERR]  ${rel}: ${r.err}\n`);
            } else if (r.saved > 0) {
                const pct = (r.saved / r.before * 100).toFixed(1);
                process.stdout.write(`  [${done}/${n}] ${rel} — ${(r.before/1024).toFixed(0)}KB → ${(r.after/1024).toFixed(0)}KB (-${pct}%)\n`);
            }
            // else: already optimal — silent skip
        }
    }

    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    const savedMB = ((totalBefore - totalAfter) / 1024 / 1024).toFixed(1);
    const pct     = totalBefore ? ((totalBefore - totalAfter) / totalBefore * 100).toFixed(1) : '0.0';
    console.log(`\n  ── ${label} ──`);
    console.log(`  Files : ${n} processed  (${errs} errors)`);
    console.log(`  Before: ${(totalBefore / 1024 / 1024).toFixed(1)} MB`);
    console.log(`  After : ${(totalAfter  / 1024 / 1024).toFixed(1)} MB`);
    console.log(`  Saved : ${savedMB} MB (${pct}%)\n`);
    return { totalBefore, totalAfter, n, errs };
}

// ─── main ───────────────────────────────────────────────────────────────────

async function main() {
    console.log(`\nJubileeVerse Image Optimizer`);
    console.log(`Concurrency: ${CONCURRENCY} workers | Quality: ${QUALITY} | Max: ${MAX_WIDTH}×${MAX_HEIGHT}\n`);
    console.log('='.repeat(60));

    let grandBefore = 0, grandAfter = 0, grandFiles = 0, grandErrs = 0;

    for (const dir of DIRS) {
        const absDir = path.join(ROOT, dir);
        if (!fs.existsSync(absDir)) { console.log(`\nSkip (not found): ${dir}`); continue; }
        const files = walk(absDir);
        if (!files.length) { console.log(`\nSkip (empty): ${dir}`); continue; }
        console.log(`\nProcessing: ${dir} (${files.length} files)`);
        const r = await runPool(files, dir);
        grandBefore += r.totalBefore;
        grandAfter  += r.totalAfter;
        grandFiles  += r.n;
        grandErrs   += r.errs;
    }

    const savedMB = ((grandBefore - grandAfter) / 1024 / 1024).toFixed(1);
    const pct     = grandBefore ? ((grandBefore - grandAfter) / grandBefore * 100).toFixed(1) : '0.0';
    console.log('='.repeat(60));
    console.log(`TOTAL  : ${grandFiles} files, ${grandErrs} errors`);
    console.log(`Before : ${(grandBefore / 1024 / 1024).toFixed(1)} MB`);
    console.log(`After  : ${(grandAfter  / 1024 / 1024).toFixed(1)} MB`);
    console.log(`Saved  : ${savedMB} MB (${pct}%)\n`);
}

main().catch(console.error);
