/**
 * Rebuilds every category's articles.json from the .md files on disk.
 *
 * The .md frontmatter is the source of truth, so this is idempotent and works
 * no matter which worker wrote what (or which ones failed). image_status is
 * derived from whether the image actually exists, so it self-heals as the GPU
 * pipeline fills images in.
 *
 * Usage:  node rebuild-manifests.js          (dry run, prints a diff summary)
 *         node rebuild-manifests.js --write  (writes the manifests)
 */
const fs = require('fs');
const path = require('path');

const ROOT = 'J:/jubileeverse.com/articles';
const WRITE = process.argv.includes('--write');

const CATEGORIES = [
    { folder: 'covenant-identity',      name: 'Covenant & Identity',      office: 'Apostolic' },
    { folder: 'teshuvah-restoration',   name: 'Teshuvah & Restoration',   office: 'Prophetic' },
    { folder: 'shalom-salvation',       name: 'Shalom & Salvation',       office: 'Evangelistic' },
    { folder: 'celebration-mishpakhah', name: 'Celebration & Mishpakhah', office: 'Shepherd' },
    { folder: 'torah-hebraic',          name: 'Torah & Hebraic Insights', office: 'Teaching' },
];

/** Scalar `key: value` pairs from a --- frontmatter block. */
function frontmatter(raw) {
    const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
    if (!m) return null;
    const data = {};
    for (const line of m[1].split(/\r?\n/)) {
        const pair = /^([A-Za-z0-9_]+)\s*:\s*(.*)$/.exec(line);
        if (!pair) continue;
        const value = pair[2].trim();
        if (!value || value.startsWith('[') || value.startsWith('{')) continue;
        data[pair[1]] = value.replace(/^["']|["']$/g, '');
    }
    return data;
}

const today = new Date(Date.now()).toISOString().slice(0, 10);
let grandTotal = 0;
let grandNew = 0;

for (const cat of CATEGORIES) {
    const dir = path.join(ROOT, cat.folder);
    if (!fs.existsSync(dir)) { console.log(`SKIP ${cat.folder} (missing)`); continue; }

    const manifestPath = path.join(dir, 'articles.json');
    let previous = { articles: [] };
    try { previous = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch { /* first build */ }
    const previousSlugs = new Set((previous.articles || []).map(a => a.slug));

    const files = fs.readdirSync(dir).filter(f => f.endsWith('.md')).sort();
    const articles = [];
    const skipped = [];

    for (const file of files) {
        const fm = frontmatter(fs.readFileSync(path.join(dir, file), 'utf8'));
        if (!fm || !fm.slug || !fm.title) { skipped.push(file); continue; }

        // NEVER invent a filename here. Spec S15: if no image has been
        // generated, image_file stays empty. A fabricated name makes the image
        // generator treat the article as already rendered and skip it forever.
        const declared = (fm.image_file || '').trim();
        const hasImage = !!declared && fs.existsSync(path.join(dir, 'images', declared));
        const imageFile = hasImage ? declared : '';

        articles.push({
            slug:          fm.slug,
            title:         fm.title,
            file,
            author:        fm.author || '',
            office:        fm.office || cat.office,
            date_updated:  fm.date_updated || fm.date_created || today,
            velocity_tier: fm.velocity_tier || 'Seasonal',
            status:        fm.status || 'published',
            image_prompt:  fm.image_prompt || '',
            image_file:    imageFile,
            image_status:  hasImage ? 'generated' : 'pending',
        });
    }

    articles.sort((a, b) => a.slug.localeCompare(b.slug));
    const generated = articles.filter(a => a.image_status === 'generated').length;
    const added = articles.filter(a => !previousSlugs.has(a.slug)).length;
    grandTotal += articles.length;
    grandNew += added;

    const manifest = {
        category:      cat.name,
        category_slug: cat.folder,
        office:        cat.office,
        updated:       today,
        counts: { total: articles.length, generated, pending: articles.length - generated },
        articles,
    };

    console.log(
        `${cat.folder.padEnd(24)} total=${String(articles.length).padStart(3)}` +
        `  new=${String(added).padStart(3)}  images ${generated}/${articles.length}` +
        (skipped.length ? `  SKIPPED(bad frontmatter)=${skipped.join(',')}` : '')
    );

    if (WRITE) fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}

console.log(`\n${WRITE ? 'WROTE' : 'DRY RUN'} — ${grandTotal} articles total, ${grandNew} new since last manifest`);
if (!WRITE) console.log('re-run with --write to apply');
