'use strict';
/**
 * Feed parsing across the shapes our real sources actually emit.
 *
 * Each fixture here corresponds to a live feed that broke at some point. The
 * failure mode is always the same and always silent: an item with no title or
 * no link is dropped, so a mis-parse looks like "that outlet published nothing
 * today" rather than an error.
 */

const { parseRssFeed, TOPIC_FEEDS } = require('../../lib/rss-feeds');

const rss = (items) => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Feed</title>${items}</channel></rss>`;

describe('RSS', () => {
    test('parses a plain item', () => {
        const out = parseRssFeed(rss(`
            <item>
                <title>Court Rules on Zoning</title>
                <link>https://example.org/a</link>
                <description>Some summary text.</description>
                <pubDate>Fri, 31 Jul 2026 12:00:00 GMT</pubDate>
            </item>`), 'example.org');
        expect(out).toHaveLength(1);
        expect(out[0].title).toBe('Court Rules on Zoning');
        expect(out[0].link).toBe('https://example.org/a');
        expect(out[0].description).toBe('Some summary text.');
    });

    test('unwraps CDATA that is padded with whitespace', () => {
        // Vatican News pretty-prints exactly like this. Matching the CDATA
        // markers inline leaves the wrapper in the value, and because
        // `<![CDATA[ ... ]]>` scans as one HTML tag, tag-stripping then wipes
        // the whole title and the item is silently dropped.
        const out = parseRssFeed(rss(`
            <item>
                <title>
                    <![CDATA[Behind the scam: Restoring human dignity]]>
                </title>
                <link>https://example.org/b</link>
                <description>
                    <![CDATA[ <p>Body text here.</p> ]]>
                </description>
            </item>`), 'example.org');
        expect(out).toHaveLength(1);
        expect(out[0].title).toBe('Behind the scam: Restoring human dignity');
        expect(out[0].title).not.toContain('CDATA');
        expect(out[0].description).toBe('Body text here.');
    });

    test('unwraps CDATA with no padding', () => {
        const out = parseRssFeed(rss(`
            <item><title><![CDATA[Tight CDATA]]></title><link>https://example.org/c</link></item>`), 'x');
        expect(out[0].title).toBe('Tight CDATA');
    });

    test('decodes HTML entities in titles', () => {
        const out = parseRssFeed(rss(`
            <item><title>Faith &amp; Freedom &#8217;26</title><link>https://example.org/d</link></item>`), 'x');
        expect(out[0].title).toBe("Faith & Freedom '26");
    });

    test('finds the image across the four common carriers', () => {
        const carriers = [
            '<media:content url="https://img/1.jpg"/>',
            '<media:thumbnail url="https://img/2.jpg"/>',
            '<enclosure url="https://img/3.jpg" type="image/jpeg"/>',
            '<content:encoded><![CDATA[<p><img src="https://img/4.jpg"/></p>]]></content:encoded>',
        ];
        carriers.forEach((carrier, i) => {
            const out = parseRssFeed(rss(`
                <item><title>T${i}</title><link>https://example.org/${i}</link>${carrier}</item>`), 'x');
            expect(out[0].hasImage).toBe(true);
            expect(out[0].imageUrl).toBe(`https://img/${i + 1}.jpg`);
        });
    });

    test('drops items missing a title or a link', () => {
        const out = parseRssFeed(rss(`
            <item><title>No link here</title></item>
            <item><link>https://example.org/no-title</link></item>
            <item><title>Good</title><link>https://example.org/good</link></item>`), 'x');
        expect(out).toHaveLength(1);
        expect(out[0].title).toBe('Good');
    });

    test('honours maxItems', () => {
        const many = Array.from({ length: 40 }, (_, i) =>
            `<item><title>T${i}</title><link>https://example.org/${i}</link></item>`).join('');
        expect(parseRssFeed(rss(many), 'x', { maxItems: 5 })).toHaveLength(5);
    });
});

describe('Atom', () => {
    const atom = (entries) => `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">${entries}</feed>`;

    test('parses <entry> and pulls the link out of the href attribute', () => {
        // The Verge is Atom-only; an <item>-only parser returns zero for it.
        const out = parseRssFeed(atom(`
            <entry>
                <title>Atom Story</title>
                <link rel="alternate" type="text/html" href="https://theverge.com/x"/>
                <summary>Atom summary.</summary>
                <published>2026-07-31T12:00:00Z</published>
            </entry>`), 'theverge.com');
        expect(out).toHaveLength(1);
        expect(out[0].title).toBe('Atom Story');
        expect(out[0].link).toBe('https://theverge.com/x');
        expect(out[0].description).toBe('Atom summary.');
        expect(out[0].pubDate).toBe('2026-07-31T12:00:00Z');
    });

    test('falls back to <id> when no usable link element exists', () => {
        const out = parseRssFeed(atom(`
            <entry><title>Story</title><id>https://example.org/entry-1</id></entry>`), 'x');
        expect(out[0].link).toBe('https://example.org/entry-1');
    });

    test('ignores a non-URL <id>', () => {
        const out = parseRssFeed(atom(`
            <entry><title>Story</title><id>urn:uuid:1234</id></entry>`), 'x');
        expect(out).toHaveLength(0);
    });

    test('reads an enclosure link as the image', () => {
        const out = parseRssFeed(atom(`
            <entry>
                <title>Story</title>
                <link rel="alternate" href="https://example.org/a"/>
                <link rel="enclosure" type="image/jpeg" href="https://img/hero.jpg"/>
            </entry>`), 'x');
        expect(out[0].imageUrl).toBe('https://img/hero.jpg');
    });
});

describe('feed catalog', () => {
    test('every topic has at least three feeds', () => {
        for (const [topic, feeds] of Object.entries(TOPIC_FEEDS)) {
            expect(`${topic}:${feeds.length}`).toBe(`${topic}:${Math.max(feeds.length, 3)}`);
        }
    });

    test('no feed url is listed twice within one topic', () => {
        for (const [topic, feeds] of Object.entries(TOPIC_FEEDS)) {
            expect(`${topic}:${new Set(feeds).size}`).toBe(`${topic}:${feeds.length}`);
        }
    });

    test('the faith topics still cover the anchor outlets', () => {
        const faithFeeds = [
            ...TOPIC_FEEDS['church-us'],
            ...TOPIC_FEEDS['church-global'],
            ...TOPIC_FEEDS['faith'],
            ...TOPIC_FEEDS['christian-watch-us'],
        ].join(' ');
        for (const host of ['christianpost.com', 'christianitytoday.com', 'religionnews.com', 'jpost.com']) {
            expect(faithFeeds).toContain(host);
        }
    });
});
