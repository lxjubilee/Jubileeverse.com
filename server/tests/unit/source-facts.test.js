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
