'use strict';
/** Selection logic for the daily news pipeline: identity, dedupe, quotas. */

const crypto = require('crypto');
const S = require('../../lib/news-sources');

const cand = (over = {}) => {
    const title = over.title || 'Federal Court Rules on Church Zoning Dispute';
    const link = over.link || 'https://example.org/a';
    return {
        title,
        link,
        description: 'x'.repeat(220),
        sourceName: over.sourceName || 'example.org',
        topic: over.topic || 'church-us',
        contentHash: S.contentHashFor(title, link),
        normalizedUrl: S.normalizeUrl(link),
        titleTokens: S.normalizeTitle(title),
        score: { total: over.total ?? 50 },
        ...over,
    };
};

describe('content hash', () => {
    test('matches the legacy ingestTopicStories computation byte for byte', () => {
        const title = 'Some Headline';
        const link = 'https://example.org/story';
        const legacy = crypto.createHash('sha256')
            .update((title || '') + (link || '')).digest('hex').slice(0, 64);
        expect(S.contentHashFor(title, link)).toBe(legacy);
    });

    test('handles missing fields the same way the legacy code does', () => {
        expect(S.contentHashFor(null, null)).toBe(S.contentHashFor('', ''));
    });
});

describe('url normalization', () => {
    test('strips tracking params and www', () => {
        expect(S.normalizeUrl('https://www.example.org/story?utm_source=x&fbclid=y'))
            .toBe(S.normalizeUrl('https://example.org/story'));
    });

    test('strips fragments and trailing slashes', () => {
        expect(S.normalizeUrl('https://example.org/story/#top'))
            .toBe(S.normalizeUrl('https://example.org/story'));
    });

    test('keeps meaningful query params', () => {
        expect(S.normalizeUrl('https://example.org/s?id=42'))
            .not.toBe(S.normalizeUrl('https://example.org/s?id=43'));
    });
});

describe('title similarity', () => {
    test('two outlets covering one event score as near-duplicates', () => {
        const a = 'Federal Court Rules Against City in Church Zoning Case';
        const b = 'Church Wins Federal Zoning Case Against City, Court Rules';
        expect(S.titleSimilarity(a, b)).toBeGreaterThanOrEqual(0.6);
    });

    test('unrelated headlines do not', () => {
        expect(S.titleSimilarity(
            'Federal Court Rules on Church Zoning',
            'Scientists Discover New Exoplanet Orbiting Distant Star',
        )).toBeLessThan(0.2);
    });

    test('stopwords do not manufacture similarity', () => {
        expect(S.titleSimilarity('The Man and the Sea', 'A Dog in the Park')).toBe(0);
    });
});

describe('filterAlreadyPublished', () => {
    const published = [{
        content_hash: S.contentHashFor('Old Story', 'https://example.org/old'),
        source_url: 'https://example.org/old',
        title: 'Federal Court Rules Against City in Church Zoning Case',
    }];

    test('rejects an exact re-run by hash', () => {
        const c = cand({ title: 'Old Story', link: 'https://example.org/old' });
        const { fresh, rejected } = S.filterAlreadyPublished([c], published);
        expect(fresh).toHaveLength(0);
        expect(rejected[0].reason).toBe('duplicate-hash');
    });

    test('rejects the same URL wearing tracking params', () => {
        const c = cand({ title: 'Totally Different Words Here Entirely', link: 'https://example.org/old?utm_source=nl' });
        const { rejected } = S.filterAlreadyPublished([c], published);
        expect(rejected[0].reason).toBe('duplicate-url');
    });

    test('rejects a near-duplicate headline from another outlet', () => {
        const c = cand({
            title: 'Church Wins Federal Zoning Case Against City, Court Rules',
            link: 'https://other.org/new',
        });
        const { rejected } = S.filterAlreadyPublished([c], published);
        expect(rejected[0].reason).toBe('near-duplicate-title');
    });

    test('lets a genuinely new story through', () => {
        const c = cand({ title: 'Missionary Team Returns From Kenya Outreach', link: 'https://other.org/kenya' });
        const { fresh } = S.filterAlreadyPublished([c], published);
        expect(fresh).toHaveLength(1);
    });
});

describe('collapseWithinRun', () => {
    test('keeps the highest-scoring version and attaches the rest as corroborators', () => {
        const a = cand({ title: 'Federal Court Rules Against City in Church Zoning Case', link: 'https://cnn.com/1', sourceName: 'cnn.com', total: 80 });
        const b = cand({ title: 'Church Wins Federal Zoning Case Against City, Court Rules', link: 'https://bbc.com/2', sourceName: 'bbc.com', total: 60 });
        const { kept, dropped } = S.collapseWithinRun([a, b]);
        expect(kept).toHaveLength(1);
        expect(kept[0].sourceName).toBe('cnn.com');
        expect(dropped).toHaveLength(1);
        expect(kept[0].corroborators[0].name).toBe('bbc.com');
    });

    test('leaves genuinely distinct stories alone', () => {
        const a = cand({ title: 'Church Zoning Ruling Lands in Ohio', link: 'https://a.com/1' });
        const b = cand({ title: 'Scientists Map Deep Ocean Currents Near Iceland', link: 'https://b.com/2' });
        expect(S.collapseWithinRun([a, b]).kept).toHaveLength(2);
    });
});

describe('allocateQuota', () => {
    /** n candidates for a topic, descending score, each from a distinct source. */
    const pool = (topic, n, base = 90) => Array.from({ length: n }, (_, i) => cand({
        topic,
        title: `${topic} headline number ${i} about something distinct`,
        link: `https://${topic}-${i}.example/story`,
        sourceName: `${topic}-${i}.example`,
        total: base - i,
    }));

    test('hits the target and spreads across topics', () => {
        const byTopic = new Map(Object.keys(S.DEFAULT_QUOTAS).map(t => [t, pool(t, 12)]));
        const { selected, shortfall, perTopic } = S.allocateQuota(byTopic, { target: 30 });
        expect(selected).toHaveLength(30);
        expect(shortfall).toBe(0);
        expect(Object.values(perTopic).filter(Boolean).length).toBeGreaterThanOrEqual(8);
    });

    test('a dead topic spills its share to the others rather than short-changing the day', () => {
        const byTopic = new Map(Object.keys(S.DEFAULT_QUOTAS).map(t => [
            t, t === 'entertainment' ? [] : pool(t, 12),
        ]));
        const { selected, shortfall, perTopic } = S.allocateQuota(byTopic, { target: 30 });
        expect(selected).toHaveLength(30);
        expect(shortfall).toBe(0);
        expect(perTopic.entertainment || 0).toBe(0);
    });

    test('reports a shortfall instead of inventing filler when feeds are thin', () => {
        const byTopic = new Map([['faith', pool('faith', 5)]]);
        const { selected, shortfall } = S.allocateQuota(byTopic, { target: 30 });
        expect(selected).toHaveLength(5);
        expect(shortfall).toBe(25);
    });

    test('one prolific outlet cannot take over the day', () => {
        const hoggy = Array.from({ length: 20 }, (_, i) => cand({
            topic: 'faith',
            title: `faith headline number ${i} distinct subject matter`,
            link: `https://hog.example/${i}`,
            sourceName: 'hog.example',
            total: 99 - i,
        }));
        const byTopic = new Map([['faith', hoggy], ['social', pool('social', 12)]]);
        const { selected } = S.allocateQuota(byTopic, { target: 20, perSourceCap: 4 });
        expect(selected.filter(c => c.sourceName === 'hog.example').length).toBeLessThanOrEqual(4);
    });

    test('a smaller target still spreads across topics', () => {
        const byTopic = new Map(Object.keys(S.DEFAULT_QUOTAS).map(t => [t, pool(t, 12)]));
        const { selected, perTopic } = S.allocateQuota(byTopic, { target: 10 });
        expect(selected).toHaveLength(10);
        expect(Object.values(perTopic).filter(Boolean).length).toBeGreaterThanOrEqual(5);
    });

    test('assigns a stable render order, best first', () => {
        const byTopic = new Map([['faith', pool('faith', 6)]]);
        const { selected } = S.allocateQuota(byTopic, { target: 6 });
        expect(selected.map(c => c.order)).toEqual([0, 1, 2, 3, 4, 5]);
        expect(selected[0].score.total).toBeGreaterThanOrEqual(selected[5].score.total);
    });
});

describe('default quotas', () => {
    test('sum to 30 and favour the faith topics', () => {
        expect(Object.values(S.DEFAULT_QUOTAS).reduce((a, b) => a + b, 0)).toBe(30);
        const faith = ['church-us', 'church-global', 'faith', 'christian-watch-us']
            .reduce((sum, t) => sum + S.DEFAULT_QUOTAS[t], 0);
        expect(faith).toBeGreaterThan(30 / 2);
    });
});

// ── Scaling to a 60-article day ──────────────────────────────────────────────

describe('allocateQuota at a 60-article target', () => {
    /** n candidates for a topic, descending score, each from a distinct source. */
    const deepPool = (topic, n, base = 90) => Array.from({ length: n }, (_, i) => cand({
        topic,
        title: `${topic} headline number ${i} about something distinct`,
        link: `https://${topic}-${i}.example/story`,
        sourceName: `${topic}-${i}.example`,
        total: base - i,
    }));

    test('fills all sixty and still spreads across every topic', () => {
        const byTopic = new Map(Object.keys(S.DEFAULT_QUOTAS).map(t => [t, deepPool(t, 24)]));
        const { selected, shortfall, perTopic } = S.allocateQuota(byTopic, { target: 60 });
        expect(selected).toHaveLength(60);
        expect(shortfall).toBe(0);
        expect(Object.values(perTopic).filter(Boolean).length).toBe(9);
    });

    test('keeps the same topic mix as a thirty-article day, doubled', () => {
        const byTopic = new Map(Object.keys(S.DEFAULT_QUOTAS).map(t => [t, deepPool(t, 24)]));
        const at30 = S.allocateQuota(byTopic, { target: 30 }).perTopic;
        const at60 = S.allocateQuota(byTopic, { target: 60 }).perTopic;
        for (const topic of Object.keys(S.DEFAULT_QUOTAS)) {
            // Pass 2 spill and rounding move a slot here and there; the shape
            // must still be recognisably the same mix at twice the size.
            expect(at60[topic]).toBeGreaterThanOrEqual(at30[topic]);
            expect(Math.abs(at60[topic] - at30[topic] * 2)).toBeLessThanOrEqual(2);
        }
    });

    test('the faith topics keep the majority of the day', () => {
        const byTopic = new Map(Object.keys(S.DEFAULT_QUOTAS).map(t => [t, deepPool(t, 24)]));
        const { perTopic } = S.allocateQuota(byTopic, { target: 60 });
        const faith = ['church-us', 'church-global', 'faith', 'christian-watch-us']
            .reduce((sum, t) => sum + (perTopic[t] || 0), 0);
        expect(faith).toBeGreaterThan(60 / 2);
    });

    test('still reports a shortfall rather than inventing filler', () => {
        const byTopic = new Map([['faith', deepPool('faith', 20)]]);
        const { selected, shortfall } = S.allocateQuota(byTopic, { target: 60 });
        expect(selected.length).toBeLessThanOrEqual(20);
        expect(shortfall).toBe(60 - selected.length);
    });

    test('ordering is unchanged: best score first, stable render order', () => {
        const byTopic = new Map(Object.keys(S.DEFAULT_QUOTAS).map(t => [t, deepPool(t, 24)]));
        const { selected } = S.allocateQuota(byTopic, { target: 60 });
        expect(selected.map(c => c.order)).toEqual([...Array(60).keys()]);
        for (let i = 1; i < selected.length; i++) {
            expect(selected[i - 1].score.total).toBeGreaterThanOrEqual(selected[i].score.total);
        }
    });
});

describe('perSourceCapFor — diversity that scales with the day', () => {
    test('a thirty-article day is unchanged: still four per outlet', () => {
        // 30 target + 20% reserve is what the pipeline actually allocates.
        expect(S.perSourceCapFor(36)).toBe(S.DEFAULT_PER_SOURCE_CAP);
    });

    test('a sixty-article day doubles it, holding the same share of the day', () => {
        expect(S.perSourceCapFor(72)).toBe(8);
        expect(72 / S.perSourceCapFor(72)).toBe(36 / S.perSourceCapFor(36));
    });

    test('never drops below the floor for small runs', () => {
        for (const size of [1, 6, 12, 24]) {
            expect(S.perSourceCapFor(size)).toBe(S.DEFAULT_PER_SOURCE_CAP);
        }
    });

    test('one prolific outlet still cannot take over a sixty-article day', () => {
        const hoggy = Array.from({ length: 40 }, (_, i) => cand({
            topic: 'faith',
            title: `faith headline number ${i} distinct subject matter`,
            link: `https://hog.example/${i}`,
            sourceName: 'hog.example',
            total: 99 - i,
        }));
        const others = Array.from({ length: 40 }, (_, i) => cand({
            topic: 'social',
            title: `social headline number ${i} distinct subject matter`,
            link: `https://outlet-${i}.example/story`,
            sourceName: `outlet-${i}.example`,
            total: 80 - i,
        }));
        const { selected } = S.allocateQuota(new Map([['faith', hoggy], ['social', others]]), { target: 60 });
        const fromHog = selected.filter(c => c.sourceName === 'hog.example').length;
        expect(fromHog).toBeLessThanOrEqual(S.perSourceCapFor(60));
        expect(fromHog / selected.length).toBeLessThan(0.2);
    });
});

describe('quota weights', () => {
    test('are scaled, not counts — the same mix at any target', () => {
        expect(S.QUOTA_BASELINE).toBe(30);
        const share = (perTopic) => {
            const total = Object.values(perTopic).reduce((a, b) => a + b, 0);
            return Object.fromEntries(Object.entries(perTopic).map(([k, v]) => [k, v / total]));
        };
        const deep = (t) => Array.from({ length: 24 }, (_, i) => cand({
            topic: t,
            title: `${t} headline number ${i} about something distinct`,
            link: `https://${t}-${i}.example/story`,
            sourceName: `${t}-${i}.example`,
            total: 90 - i,
        }));
        const byTopic = new Map(Object.keys(S.DEFAULT_QUOTAS).map(t => [t, deep(t)]));
        const s30 = share(S.allocateQuota(byTopic, { target: 30 }).perTopic);
        const s60 = share(S.allocateQuota(byTopic, { target: 60 }).perTopic);
        for (const topic of Object.keys(S.DEFAULT_QUOTAS)) {
            expect(Math.abs(s60[topic] - s30[topic])).toBeLessThan(0.04);
        }
    });
});
