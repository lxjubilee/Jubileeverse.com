const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'public', 'images', 'jubileeinspire.com', 'encouragement');
const MAX_WIDTH  = 1920;
const MAX_HEIGHT = 1080;
const QUALITY    = 82;   // good balance: noticeably smaller, visually near-identical

const files = fs.readdirSync(DIR).filter(f => /\.(jpe?g|png|webp)$/i.test(f));
let totalBefore = 0, totalAfter = 0, done = 0, skipped = 0;

async function processAll() {
    console.log(`Optimising ${files.length} images in ${DIR}\n`);

    for (const file of files) {
        const fp = path.join(DIR, file);
        const sizeBefore = fs.statSync(fp).size;
        totalBefore += sizeBefore;

        const tmp = fp + '.tmp';
        try {
            const img = sharp(fp);
            const meta = await img.metadata();

            let pipeline = img;
            if (meta.width > MAX_WIDTH || meta.height > MAX_HEIGHT) {
                pipeline = pipeline.resize(MAX_WIDTH, MAX_HEIGHT, { fit: 'inside', withoutEnlargement: true });
            }

            await pipeline
                .jpeg({ quality: QUALITY, progressive: true, mozjpeg: true })
                .toFile(tmp);

            const sizeAfter = fs.statSync(tmp).size;

            if (sizeAfter < sizeBefore) {
                fs.renameSync(tmp, fp);
                totalAfter += sizeAfter;
                done++;
                const saved = ((sizeBefore - sizeAfter) / sizeBefore * 100).toFixed(1);
                process.stdout.write(`  [${done}/${files.length}] ${file} — ${(sizeBefore/1024).toFixed(0)}KB → ${(sizeAfter/1024).toFixed(0)}KB (-${saved}%)\n`);
            } else {
                fs.unlinkSync(tmp);
                totalAfter += sizeBefore;
                skipped++;
                process.stdout.write(`  [skip] ${file} — already optimal\n`);
            }
        } catch (e) {
            if (fs.existsSync(tmp)) try { fs.unlinkSync(tmp); } catch(_) {}
            totalAfter += sizeBefore;
            skipped++;
            console.error(`  [err]  ${file}: ${e.message}`);
        }
    }

    const savedMB = ((totalBefore - totalAfter) / 1024 / 1024).toFixed(1);
    const pct = ((totalBefore - totalAfter) / totalBefore * 100).toFixed(1);
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`Files  : ${done} optimised, ${skipped} skipped (${files.length} total)`);
    console.log(`Before : ${(totalBefore / 1024 / 1024).toFixed(1)} MB`);
    console.log(`After  : ${(totalAfter  / 1024 / 1024).toFixed(1)} MB`);
    console.log(`Saved  : ${savedMB} MB (${pct}%)`);
}

processAll().catch(console.error);
