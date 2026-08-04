'use strict';
/** Fact extraction — pure parsing only, no network. */

const F = require('../../lib/source-facts');

const page = (head = '', body = '') =>
    `<!DOCTYPE html><html><head>${head}</head><body>${body}</body></html>`;

describe('blocklist', () => {
    test.each([
        'https://www.nytimes.com/2026/07/31/us/story.html',
        'https://wsj.com/articles/x',
        'https://www.christianpost.com/news/x.html',
        'https://sub.bloomberg.com/news/x',
    ])('blocks %s', (url) => expect(F.isBlocked(url)).toBe(true));

    test.each([
        'https://www.bbc.co.uk/news/x',
        'https://religionnews.com/2026/07/31/x/',
        'https://notnytimes.com/x',
    ])('allows %s', (url) => expect(F.isBlocked(url)).toBe(false));
});

describe('JSON-LD extraction', () => {
    const ld = (obj) =>
        page(`<script type="application/ld+json">${JSON.stringify(obj)}</script>`);

    test('reads a plain NewsArticle', () => {
        const out = F.extractJsonLdNewsArticle(ld({
            '@type': 'NewsArticle',
            headline: 'Court Rules on Zoning',
            description: 'A summary.',
            articleBody: 'The body of the article.',
            datePublished: '2026-07-31T10:00:00Z',
            author: { name: 'Jane Reporter' },
            publisher: { name: 'Example News' },
        }));
        expect(out.headline).toBe('Court Rules on Zoning');
        expect(out.articleBody).toBe('The body of the article.');
        expect(out.author).toBe('Jane Reporter');
        expect(out.publisher).toBe('Example News');
    });

    test('digs through an @graph wrapper', () => {
        const out = F.extractJsonLdNewsArticle(ld({
            '@context': 'https://schema.org',
            '@graph': [
                { '@type': 'WebSite', name: 'Site' },
                { '@type': 'NewsArticle', headline: 'Found Me', articleBody: 'Body.' },
            ],
        }));
        expect(out.headline).toBe('Found Me');
    });

    test('handles an array payload and a multi-author list', () => {
        const out = F.extractJsonLdNewsArticle(ld([
            { '@type': 'Organization', name: 'Org' },
            { '@type': ['Article', 'NewsArticle'], headline: 'H', author: [{ name: 'A' }, { name: 'B' }] },
        ]));
        expect(out.headline).toBe('H');
        expect(out.author).toBe('A, B');
    });

    test('skips a malformed block and keeps looking', () => {
        const html = page(
            `<script type="application/ld+json">{ not json at all }</script>` +
            `<script type="application/ld+json">${JSON.stringify({ '@type': 'NewsArticle', headline: 'Second' })}</script>`
        );
        expect(F.extractJsonLdNewsArticle(html).headline).toBe('Second');
    });

    test('returns null when there is no article node', () => {
        expect(F.extractJsonLdNewsArticle(ld({ '@type': 'WebPage', name: 'x' }))).toBeNull();
        expect(F.extractJsonLdNewsArticle(page())).toBeNull();
        expect(F.extractJsonLdNewsArticle(null)).toBeNull();
    });
});

describe('meta extraction', () => {
    test('reads OpenGraph in either attribute order', () => {
        const a = F.extractMetaFacts(page(`<meta property="og:title" content="Title A">`));
        const b = F.extractMetaFacts(page(`<meta content="Title B" property="og:title">`));
        expect(a.title).toBe('Title A');
        expect(b.title).toBe('Title B');
    });

    test('falls back to <title> then decodes entities', () => {
        const out = F.extractMetaFacts(page('<title>Faith &amp; Freedom</title>'));
        expect(out.title).toBe('Faith & Freedom');
    });
});

describe('image extraction', () => {
    test('prefers og:image', () => {
        const out = F.extractMetaFacts(page(`<meta property="og:image" content="https://cdn.x/og.jpg">`));
        expect(out.image).toBe('https://cdn.x/og.jpg');
    });

    test.each([
        ['og:image:secure_url', `<meta property="og:image:secure_url" content="https://cdn.x/s.jpg">`],
        ['og:image:url', `<meta property="og:image:url" content="https://cdn.x/s.jpg">`],
        ['twitter:image', `<meta name="twitter:image" content="https://cdn.x/s.jpg">`],
        ['twitter:image:src', `<meta name="twitter:image:src" content="https://cdn.x/s.jpg">`],
        ['link rel=image_src', `<link rel="image_src" href="https://cdn.x/s.jpg">`],
    ])('falls back to %s', (_label, tag) => {
        expect(F.extractMetaFacts(page(tag)).image).toBe('https://cdn.x/s.jpg');
    });

    test('decodes entities in the query string', () => {
        // Unescaped, `&amp;` survives into the URL and the download 404s.
        const out = F.extractMetaFacts(page(`<meta property="og:image" content="https://cdn.x/p.jpg?w=1200&amp;h=630">`));
        expect(out.image).toBe('https://cdn.x/p.jpg?w=1200&h=630');
    });

    test('reports no image rather than an empty tag artefact', () => {
        expect(F.extractMetaFacts(page('<title>t</title>')).image).toBe('');
    });
});

describe('schema.org image shapes', () => {
    test('a bare url string', () => {
        expect(F.jsonLdImageUrl('https://cdn.x/a.jpg')).toBe('https://cdn.x/a.jpg');
    });

    test('an ImageObject', () => {
        expect(F.jsonLdImageUrl({ '@type': 'ImageObject', url: 'https://cdn.x/a.jpg' })).toBe('https://cdn.x/a.jpg');
    });

    test('contentUrl, which some CMSs emit instead of url', () => {
        expect(F.jsonLdImageUrl({ contentUrl: 'https://cdn.x/a.jpg' })).toBe('https://cdn.x/a.jpg');
    });

    test('an array takes the first entry, which is the largest by convention', () => {
        expect(F.jsonLdImageUrl(['https://cdn.x/big.jpg', 'https://cdn.x/small.jpg'])).toBe('https://cdn.x/big.jpg');
        expect(F.jsonLdImageUrl([{ url: 'https://cdn.x/big.jpg' }])).toBe('https://cdn.x/big.jpg');
    });

    test('absent, empty and malformed values yield an empty string', () => {
        expect(F.jsonLdImageUrl(undefined)).toBe('');
        expect(F.jsonLdImageUrl([])).toBe('');
        expect(F.jsonLdImageUrl({ width: 1200 })).toBe('');
    });

    test('the article node carries its image through', () => {
        const ld = F.extractJsonLdNewsArticle(page(
            `<script type="application/ld+json">${JSON.stringify({
                '@type': 'NewsArticle',
                headline: 'H',
                image: [{ '@type': 'ImageObject', url: 'https://cdn.x/ld.jpg' }],
            })}</script>`,
        ));
        expect(ld.image).toBe('https://cdn.x/ld.jpg');
    });
});

describe('absoluteUrl', () => {
    const PAGE = 'https://news.example.com/world/story.html';

    test.each([
        ['root-relative', '/media/p.jpg', 'https://news.example.com/media/p.jpg'],
        ['protocol-relative', '//cdn.example.com/p.jpg', 'https://cdn.example.com/p.jpg'],
        ['path-relative', 'p.jpg', 'https://news.example.com/world/p.jpg'],
        ['already absolute', 'https://cdn.example.com/p.jpg', 'https://cdn.example.com/p.jpg'],
    ])('resolves a %s url', (_label, src, expected) => {
        expect(F.absoluteUrl(src, PAGE)).toBe(expected);
    });

    test('refuses non-http schemes', () => {
        expect(F.absoluteUrl('data:image/png;base64,AAAA', PAGE)).toBe('');
        expect(F.absoluteUrl('javascript:alert(1)', PAGE)).toBe('');
    });

    test('an empty or unparseable value is empty, never a throw', () => {
        expect(F.absoluteUrl('', PAGE)).toBe('');
        expect(F.absoluteUrl(null, PAGE)).toBe('');
        expect(F.absoluteUrl('http://[bad', PAGE)).toBe('');
    });
});

describe('paragraph extraction', () => {
    test('keeps substantive paragraphs, drops furniture', () => {
        const html = page('', `
            <nav><p>Home About Contact and some more nav text to pad this out</p></nav>
            <script>var x = "<p>not a real paragraph at all, just script text</p>";</script>
            <p>Short</p>
            <p>Advertisement — this line is long enough to pass the length filter easily.</p>
            <p>This is a genuine paragraph of article prose with enough length to count.</p>
            <p>And a second genuine paragraph, also comfortably past the minimum length.</p>`);
        const out = F.extractBodyParagraphs(html);
        expect(out).toContain('genuine paragraph of article prose');
        expect(out).toContain('second genuine paragraph');
        expect(out).not.toContain('Short');
        expect(out).not.toContain('Advertisement');
        expect(out).not.toContain('not a real paragraph');
        expect(out).not.toContain('Home About Contact');
    });

    test('honours the character cap', () => {
        const many = Array.from({ length: 200 }, () =>
            '<p>' + 'w'.repeat(120) + '</p>').join('');
        expect(F.extractBodyParagraphs(page('', many), { maxChars: 500 }).length).toBeLessThanOrEqual(500);
    });
});

describe('fact and quote splitting', () => {
    test('splits prose into sentence-sized facts', () => {
        const text = 'The court issued its ruling on Tuesday afternoon in a unanimous decision. '
            + 'The city had argued that the zoning code applied equally to all applicants. '
            + 'Attorneys for the congregation said the ruling restores their building plans.';
        const facts = F.toKeyFacts(text);
        expect(facts.length).toBe(3);
        expect(facts[0]).toMatch(/^The court issued/);
    });

    test('drops fragments too short to be a fact', () => {
        expect(F.toKeyFacts('Yes. No. Maybe.')).toHaveLength(0);
    });

    test('pulls direct quotations, straight and curly', () => {
        const quotes = F.extractQuotes(
            'She said “this ruling restores what the congregation lost years ago” at the hearing. '
            + 'He added "we are grateful for the outcome and ready to rebuild now".'
        );
        expect(quotes).toHaveLength(2);
        expect(quotes[0].text).toContain('restores what the congregation lost');
    });
});

describe('fact sheet rendering', () => {
    const sheet = {
        headline: 'Court Rules on Zoning',
        source_name: 'Example News',
        source_url: 'https://example.org/a',
        published_at: '2026-07-31',
        byline: 'Jane Reporter',
        lede: 'A summary of the ruling.',
        key_facts: ['Fact zero here.', 'Fact one here.'],
        quotes: [{ text: 'a direct quote' }],
        corroborating_sources: [{ name: 'bbc.com', headline: 'Same event, other outlet' }],
        confidence: 'full',
    };

    test('numbers the facts so facts_used can index them', () => {
        const out = F.renderFactSheetBlock(sheet);
        expect(out).toContain('[0] Fact zero here.');
        expect(out).toContain('[1] Fact one here.');
    });

    test('states the confidence level explicitly', () => {
        expect(F.renderFactSheetBlock(sheet)).toContain('Confidence: full');
    });

    test('says plainly when only the headline is verified', () => {
        const bare = { ...sheet, key_facts: [], quotes: [], corroborating_sources: [], confidence: 'headline_only' };
        const out = F.renderFactSheetBlock(bare);
        expect(out).toContain('only the headline above is verified');
    });

    test('lists corroborating outlets when present', () => {
        expect(F.renderFactSheetBlock(sheet)).toContain('bbc.com: Same event, other outlet');
    });
});

describe('corroborator matching', () => {
    const { normalizeTitle } = require('../../lib/news-sources');
    const mk = (title, sourceName, hash) => ({
        title, sourceName, contentHash: hash, link: `https://${sourceName}/x`,
        description: 'd', titleTokens: normalizeTitle(title),
    });

    test('matches the same event across outlets', () => {
        const target = mk('Federal Court Rules Against City in Church Zoning Case', 'cnn.com', 'h1');
        const pool = [
            target,
            mk('Church Wins Federal Zoning Case Against City, Court Rules', 'bbc.com', 'h2'),
            mk('Scientists Map Deep Ocean Currents Near Iceland', 'nature.com', 'h3'),
        ];
        const out = F.findCorroborators(target, pool);
        expect(out).toHaveLength(1);
        expect(out[0].name).toBe('bbc.com');
    });

    test('never corroborates a story with its own outlet', () => {
        const target = mk('Federal Court Rules Against City in Church Zoning Case', 'cnn.com', 'h1');
        const pool = [target, mk('Federal Court Rules Against City in Church Zoning Case Today', 'cnn.com', 'h2')];
        expect(F.findCorroborators(target, pool)).toHaveLength(0);
    });
});
