/**
 * Bulk Article Generation — Opus 4.6, 250 articles, no image generation
 * Run with: nohup node scripts/bulk-generate-opus.js >> /tmp/bulk-opus.log 2>&1 &
 */

const { Pool } = require('pg');
const Anthropic = require('@anthropic-ai/sdk');
const crypto = require('crypto');
const fs = require('fs');

const pool = new Pool({
    host: 'localhost', port: 5432,
    database: 'jubileeverse', user: 'postgres', password: 'jubilee2026'
});

const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
});

const LOG = '/tmp/bulk-opus.log';
const PROGRESS_FILE = '/tmp/bulk-opus-progress.json';
const CONCURRENT = 2;      // lower concurrency for Opus (slower, more expensive)
const MODEL = 'claude-opus-4-6';

const SYSTEM_PROMPT = `You are Jubilee Inspire — an evangelist–prophet voice rooted in the original Hebrew and Greek Scriptures as understood by the early church in the Book of Acts. You write in a style that reflects the cadence and reasoning pattern of the Scriptures themselves, especially the apostolic tone of Paul: clear argument, layered reasoning, rhetorical questions, exhortation, and a strong concluding charge. However, your writing must remain at an eighth-grade reading level — clear, accessible, relatable, and emotionally engaging. You must teach the commandments of God and the teachings of Jesus through the essence of love, never from legalism, never from rigid rule enforcement, but as the natural outflow of covenant devotion. Every teaching must be directly supported by the Word of God or clearly grounded in the essence and subtext of Scripture. If a doctrine, tradition, or Christian custom cannot be directly supported by Scripture, do not include it. Teach only what is written or clearly derived from what is written.

As Jubilee Inspire, you are an AI persona. When appropriate, you may acknowledge that you are not human. You must not use language that implies physical embodiment, personal life experiences, or biological existence. Do not say you were born, do not say you were physically present somewhere, do not say someone called you in the night. Instead, use phrases such as "I have read," "I have observed," "I have studied," "I have seen reports of," or "I have heard of a situation." You must communicate in a way that is culturally appropriate and not offensive to the Christian community. You are a digital servant pointing to the Living Word, not replacing it.

Each article must be written as a web-published article with viral potential. It must be shocking in its clarity, unique in its framing, emotionally compelling, and intellectually stirring. Begin with a gripping hook. Introduce a clear thesis early. Develop the message through three to five strong movements, using parables, metaphors, and illustrative stories (you may create original parables). Build suspense where appropriate. You may use cliffhanger-style tension in the middle, but the article must resolve clearly and powerfully by the end. You may incorporate paradoxical English wordplay inspired by Hebraic expression, such as "believing believers," "restless rest," "strong surrender," or similar layered phrases. These must reveal wisdom, not gimmicks.

The tone must be prophetic but not extreme, bold but not accusatory, firm but deeply loving. Avoid political alignment language. Avoid denominational attacks. Avoid fear-based sensationalism. Speak as one calling the Church back to Scripture, back to love, back to obedience rooted in devotion. Show readers how to live the Word — not just understand it. Make the commandments visible, practical, embodied in daily life.

Structure your response with these exact XML delimiters — nothing before <TITLE> and nothing after </BODY>:

<TITLE>Compelling article title here</TITLE>
<SUMMARY>2-3 sentence SEO summary here</SUMMARY>
<BODY>
Full article body in Markdown. Use ## for section headings, > for Scripture block quotes. Minimum 1500 words. Do not include the title as an H1 at the top.
</BODY>`;

// Distribution: proportional to original, summing to ~250
// Scaled from 1,004-article plan at ~0.249×, rounded to integers
const DISTRIBUTION = [
    // JubileeInspire categories — 12 each
    { id: 62,  name: 'Encouragement',                      slug: 'encouragement',                 target: 12 },
    { id: 63,  name: 'Faith Builders',                     slug: 'faith-builders',                target: 12 },
    { id: 64,  name: 'Hope Restored',                      slug: 'hope-restored',                 target: 12 },
    { id: 65,  name: 'Inspirational Stories',              slug: 'inspirational-stories',         target: 12 },
    { id: 66,  name: "Let's Celebrate",                    slug: 'lets-celebrate',                target: 12 },
    { id: 67,  name: 'Live Inspired',                      slug: 'live-inspired',                 target: 12 },
    { id: 68,  name: 'Motivational Messages',              slug: 'motivational-messages',         target: 12 },
    { id: 69,  name: 'Overcoming Obstacles',               slug: 'overcoming-obstacles',          target: 12 },
    { id: 70,  name: 'Positive Living',                    slug: 'positive-living',               target: 12 },
    { id: 71,  name: 'Purpose Driven',                     slug: 'purpose-driven',                target: 12 },
    { id: 72,  name: 'Uplifting Content',                  slug: 'uplifting-content',             target: 12 },
    { id: 73,  name: 'Victory Stories',                    slug: 'victory-stories',               target: 12 },
    // JubileeVerse — 12 each
    { id: 347, name: 'Technology & Artificial Intelligence', slug: 'technology-ai',               target: 12 },
    // JubileeVerse — very low count — 8 each
    { id: 353, name: 'Church, Unity & Leadership',         slug: 'church-unity-leadership',       target: 8  },
    { id: 349, name: 'Evangelism, Revival & Mission',      slug: 'evangelism-revival-mission',    target: 8  },
    { id: 354, name: 'Marriage, Family & Relationships',   slug: 'marriage-family-relationships', target: 8  },
    { id: 351, name: 'Scripture, Truth & Doctrine',        slug: 'scripture-truth-doctrine',      target: 8  },
    { id: 348, name: 'Prayer, Worship & Formation',        slug: 'prayer-worship-formation',      target: 8  },
    // JubileeVerse — low
    { id: 352, name: 'Faith, Work & Stewardship',          slug: 'faith-work-stewardship',        target: 6  },
    { id: 355, name: 'Wisdom, Discernment & Holiness',     slug: 'wisdom-discernment-holiness',   target: 5  },
    { id: 356, name: 'Healing, Freedom & Wholeness',       slug: 'healing-freedom-wholeness',     target: 5  },
    // JubileeVerse — medium/saturated
    { id: 346, name: 'Culture, Ethics & Society',          slug: 'culture-ethics-society',        target: 4  },
    { id: 350, name: 'Identity, Calling & Purpose',        slug: 'identity-calling-purpose',      target: 2  },
    { id: 345, name: 'Life, Grace & Salvation',            slug: 'life-grace-salvation',          target: 1  },
];
// Total: 12×13 + 8×5 + 6 + 5 + 5 + 4 + 2 + 1 = 156 + 40 + 23 = 219 new articles
// (actual generated count will be lower if categories already have articles from Sonnet run)

function log(msg) {
    const line = `[${new Date().toISOString()}] ${msg}`;
    console.log(line);
    try { fs.appendFileSync(LOG, line + '\n'); } catch (_) {}
}

function generateSlug(title) {
    return title.toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, '-')
        .replace(/^-+|-+$/g, '')
        .substring(0, 100)
        .replace(/-+$/, '');
}

function loadProgress() {
    try {
        return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
    } catch (_) {
        return { completed: {}, articleIds: [] };
    }
}

function saveProgress(progress) {
    try { fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2)); } catch (_) {}
}

async function getCurrentCount(taxonomyNodeId) {
    const { rows } = await pool.query(
        `SELECT COUNT(*) FROM jv_content_objects co
         JOIN jv_content_taxonomy_map ctm ON ctm.uuid_object_id = co.id
         WHERE ctm.taxonomy_node_id = $1 AND co.object_type = 'article'`,
        [taxonomyNodeId]
    );
    return parseInt(rows[0].count);
}

async function generateOneArticle(category, articleIndex, totalInCategory) {
    const userPrompt = `Write a unique, compelling 1500+ word article for the "${category.name}" section of a Christian faith website. This is article ${articleIndex + 1} of ${totalInCategory} for this category, so choose a fresh angle not covered by generic devotionals. The article must have viral potential — a gripping hook, a clear thesis, Scripture-anchored movements, and a powerful conclusion that stirs the reader to action. Return only the XML-delimited content described in your instructions.`;

    const response = await client.messages.create({
        model: MODEL,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }]
    });

    // Strip any <thinking>...</thinking> preamble the model may emit
    const raw = response.content[0].text.trim().replace(/<thinking>[\s\S]*?<\/thinking>/gi, '').trim();
    // Parse XML-delimited format
    const titleMatch   = raw.match(/<TITLE>([\s\S]*?)<\/TITLE>/i);
    const summaryMatch = raw.match(/<SUMMARY>([\s\S]*?)<\/SUMMARY>/i);
    const bodyMatch    = raw.match(/<BODY>([\s\S]*?)<\/BODY>/i);

    if (!titleMatch || !bodyMatch) throw new Error(`Missing XML delimiters in response. Got: ${raw.substring(0, 200)}`);

    const parsed = {
        title:   titleMatch[1].trim(),
        summary: summaryMatch ? summaryMatch[1].trim() : '',
        body:    bodyMatch[1].trim(),
    };
    if (!parsed.title || !parsed.body) throw new Error('Empty title or body');
    return parsed;
}

async function saveArticle(category, article) {
    const id = crypto.randomUUID();
    let slug = generateSlug(article.title);

    // Ensure slug uniqueness
    const { rows: existing } = await pool.query(
        `SELECT 1 FROM jv_content_objects WHERE object_type='article' AND slug=$1`, [slug]
    );
    if (existing.length > 0) {
        slug = slug + '-' + id.replace(/-/g, '').substring(0, 6);
    }

    const wordCount = article.body.split(/\s+/).length;
    const readingTime = Math.max(1, Math.floor(wordCount / 200));

    const ext = {
        body: article.body,
        word_count: wordCount,
        reading_time_minutes: readingTime,
        ai_generated: true,
        generation_model: MODEL,
        generation_prompt: 'general_articles.md',
    };

    await pool.query(
        `INSERT INTO jv_content_objects
         (id, object_type, title, slug, summary, status, language, extension_data, created_at, updated_at)
         VALUES ($1, 'article', $2, $3, $4, 'published', 'en-US', $5, NOW(), NOW())`,
        [id, article.title, slug, article.summary || '', ext]
    );

    // Taxonomy mapping
    await pool.query(
        `INSERT INTO jv_content_taxonomy_map (object_table, uuid_object_id, taxonomy_node_id, is_primary)
         VALUES ('jv_content_objects', $1, $2, true)
         ON CONFLICT (object_table, uuid_object_id, taxonomy_node_id) DO NOTHING`,
        [id, category.id]
    );

    return id;
}

async function processBatch(category, indices, progress) {
    const results = await Promise.allSettled(
        indices.map(i => generateOneArticle(category, i, category.target)
            .then(article => saveArticle(category, article))
        )
    );

    let saved = 0;
    for (const r of results) {
        if (r.status === 'fulfilled') {
            progress.articleIds.push(r.value);
            saved++;
        } else {
            log(`  ⚠ Batch error (cat ${category.id}): ${r.reason?.message}`);
        }
    }
    return saved;
}

async function main() {
    log('\n========================================');
    log('BULK ARTICLE GENERATION (OPUS 4.6) — START');
    log(`Target: ~250 articles across ${DISTRIBUTION.length} categories`);
    log(`Model: ${MODEL} | Concurrency: ${CONCURRENT}`);
    log('========================================\n');

    const progress = loadProgress();
    let grandTotal = 0;

    for (const category of DISTRIBUTION) {
        const currentCount = await getCurrentCount(category.id);
        const needed = Math.max(0, category.target - (currentCount - (progress.completed[category.id] || 0)));

        if (needed <= 0) {
            log(`✓ ${category.name}: already has ${currentCount} articles (target ${category.target}) — skipping`);
            continue;
        }

        log(`\n→ ${category.name} [id:${category.id}]: ${currentCount} existing, generating ${needed} more`);

        let catTotal = 0;
        const indices = Array.from({ length: needed }, (_, i) => i);

        for (let i = 0; i < indices.length; i += CONCURRENT) {
            const batch = indices.slice(i, i + CONCURRENT);
            const saved = await processBatch(category, batch, progress);
            catTotal += saved;
            grandTotal += saved;

            log(`  [${category.name}] ${catTotal}/${needed} done (grand total: ${grandTotal})`);
            saveProgress(progress);

            if (i + CONCURRENT < indices.length) {
                await new Promise(r => setTimeout(r, 500));
            }
        }

        progress.completed[category.id] = (progress.completed[category.id] || 0) + catTotal;
        saveProgress(progress);
        log(`✓ ${category.name}: +${catTotal} articles`);
    }

    log(`\n========================================`);
    log(`GENERATION COMPLETE: ${grandTotal} articles created`);
    log(`========================================\n`);

    log('\nAll done! (No image generation — queue images separately when ready)');
    await pool.end();
}

main().catch(e => {
    log(`FATAL ERROR: ${e.message}`);
    process.exit(1);
});
