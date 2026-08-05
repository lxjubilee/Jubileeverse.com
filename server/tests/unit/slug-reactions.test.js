'use strict';
/**
 * Like / dislike stored against the reader and the article slug.
 *
 * The property that actually matters is "one active reaction per user per
 * article, and it survives". Three things can break it, and each is driven here
 * through the real functions against a mock client rather than asserted as a
 * restatement of the rule:
 *
 *   1. A SECOND ROW. Switching Like to Dislike must update the row in place. An
 *      INSERT that is not an upsert would either duplicate or raise 23505 on the
 *      UNIQUE, and the reader would see their reaction fail silently — the client
 *      swallows errors on the reaction path.
 *   2. THE WRONG KEY. Slugs are the identifier now. A slug that reaches the
 *      database unvalidated fills the table with rows no article will ever match;
 *      one that is wrongly rejected loses a real reaction. The category articles'
 *      `<category>__<slug>` ids must pass, since they share the grid.
 *   3. A MISSING ZERO. Counts are rendered per card, so every requested slug has
 *      to come back present. An absent key would read as "undefined likes" at
 *      each use site.
 *
 * A mock client is used rather than a database: these are properties of the
 * statements issued and the shape returned, not of PostgreSQL.
 */

const {
    SLUG_REACTIONS_TABLE,
    CREATE_SLUG_REACTIONS_SQL,
    isValidReaction,
    isValidSlug,
    normalizeSlugs,
    countsForSlugs,
    userReactionsForSlugs,
    setReaction,
    MAX_SLUGS_PER_REQUEST,
} = require('../../lib/slug-reactions');

/**
 * A mock pg client backed by an in-memory row list, so a whole sequence of
 * clicks can run and the resulting table be inspected. Only the four statement
 * shapes this module issues are recognised; anything else fails loudly rather
 * than silently returning no rows.
 */
function mockClient(initialRows = []) {
    const rows = [...initialRows];
    const statements = [];

    return {
        rows,
        statements,
        async query(sql, params = []) {
            const text = sql.replace(/\s+/g, ' ').trim();
            statements.push({ sql: text, params });

            if (/^SELECT reaction FROM/.test(text)) {
                const [userId, slug] = params;
                const found = rows.find(r => r.user_id === userId && r.article_slug === slug);
                return { rows: found ? [{ reaction: found.reaction }] : [] };
            }
            if (/^DELETE FROM/.test(text)) {
                const [userId, slug] = params;
                const i = rows.findIndex(r => r.user_id === userId && r.article_slug === slug);
                if (i >= 0) rows.splice(i, 1);
                return { rows: [] };
            }
            if (/^INSERT INTO/.test(text)) {
                const [userId, slug, reaction] = params;
                const existing = rows.find(r => r.user_id === userId && r.article_slug === slug);
                // ON CONFLICT (user_id, article_slug) DO UPDATE — never a 2nd row.
                if (existing) {
                    if (!/ON CONFLICT \(user_id, article_slug\) DO UPDATE/.test(text)) {
                        throw new Error('duplicate key value violates unique constraint');
                    }
                    existing.reaction = reaction;
                    existing.updated_at = 'now';
                } else {
                    rows.push({ user_id: userId, article_slug: slug, reaction, updated_at: 'now' });
                }
                return { rows: [] };
            }
            if (/^SELECT article_slug, reaction, COUNT/.test(text)) {
                const [slugs] = params;
                const tally = new Map();
                for (const r of rows) {
                    if (!slugs.includes(r.article_slug)) continue;
                    const key = `${r.article_slug}|${r.reaction}`;
                    tally.set(key, (tally.get(key) || 0) + 1);
                }
                return {
                    rows: [...tally.entries()].map(([key, total]) => {
                        const [article_slug, reaction] = key.split('|');
                        return { article_slug, reaction, total };
                    }),
                };
            }
            if (/^SELECT article_slug, reaction FROM/.test(text)) {
                const [userId, slugs] = params;
                return {
                    rows: rows
                        .filter(r => r.user_id === userId && slugs.includes(r.article_slug))
                        .map(r => ({ article_slug: r.article_slug, reaction: r.reaction })),
                };
            }
            throw new Error(`unexpected statement: ${text}`);
        },
    };
}

const READER = 42;
const OTHER_READER = 99;
const NEWS = 'a-kansas-church-leader-leads-the-democratic-senate-field';
const CATEGORY_ARTICLE = 'covenant-identity__nobody-had-to-call-him-back';

describe('one active reaction per reader per article', () => {
    test('switching Like to Dislike updates the row instead of adding one', async () => {
        const db = mockClient();

        await setReaction(db, { userId: READER, slug: NEWS, reaction: 'like' });
        expect(db.rows).toHaveLength(1);

        const result = await setReaction(db, { userId: READER, slug: NEWS, reaction: 'dislike' });

        expect(db.rows).toHaveLength(1);
        expect(db.rows[0].reaction).toBe('dislike');
        expect(result.reaction).toBe('dislike');
        expect(result.counts).toEqual({ likes: 0, dislikes: 1 });
    });

    test('the update rides the UNIQUE constraint, so a race cannot duplicate', async () => {
        const db = mockClient();
        await setReaction(db, { userId: READER, slug: NEWS, reaction: 'like' });
        await setReaction(db, { userId: READER, slug: NEWS, reaction: 'dislike' });

        const insert = db.statements.find(s => /^INSERT INTO/.test(s.sql) && /DO UPDATE/.test(s.sql));
        expect(insert).toBeDefined();
        expect(insert.sql).toMatch(/ON CONFLICT \(user_id, article_slug\)/);
        expect(insert.sql).toMatch(/updated_at = NOW\(\)/);
    });

    test('pressing the reaction already held withdraws it', async () => {
        const db = mockClient();
        await setReaction(db, { userId: READER, slug: NEWS, reaction: 'like' });

        const result = await setReaction(db, { userId: READER, slug: NEWS, reaction: 'like' });

        expect(db.rows).toHaveLength(0);
        expect(result.reaction).toBeNull();
        expect(result.counts).toEqual({ likes: 0, dislikes: 0 });
    });

    test('a long run of clicks still leaves at most one row', async () => {
        const db = mockClient();
        const clicks = ['like', 'dislike', 'dislike', 'like', 'like', 'like', 'dislike'];
        for (const reaction of clicks) {
            await setReaction(db, { userId: READER, slug: NEWS, reaction });
            expect(db.rows.length).toBeLessThanOrEqual(1);
        }
        // like,dislike(swap),dislike(withdraw),like,like(withdraw),like,dislike(swap)
        expect(db.rows).toEqual([
            expect.objectContaining({ user_id: READER, article_slug: NEWS, reaction: 'dislike' }),
        ]);
    });

    test('two readers on the same article keep separate rows', async () => {
        const db = mockClient();
        await setReaction(db, { userId: READER, slug: NEWS, reaction: 'like' });
        const result = await setReaction(db, { userId: OTHER_READER, slug: NEWS, reaction: 'like' });

        expect(db.rows).toHaveLength(2);
        expect(result.counts).toEqual({ likes: 2, dislikes: 0 });
    });

    test('one reader across two articles keeps separate rows', async () => {
        const db = mockClient();
        await setReaction(db, { userId: READER, slug: NEWS, reaction: 'like' });
        await setReaction(db, { userId: READER, slug: CATEGORY_ARTICLE, reaction: 'dislike' });

        expect(db.rows).toHaveLength(2);
    });
});

describe('reading the reaction back — what restores the UI', () => {
    test("a reader's stored reaction survives to the next page load", async () => {
        const db = mockClient();
        await setReaction(db, { userId: READER, slug: NEWS, reaction: 'like' });

        // A fresh session asks for the whole grid at once.
        const mine = await userReactionsForSlugs(db, READER, [NEWS, CATEGORY_ARTICLE]);
        expect(mine).toEqual({ [NEWS]: 'like' });
    });

    test('another reader does not inherit it', async () => {
        const db = mockClient();
        await setReaction(db, { userId: READER, slug: NEWS, reaction: 'like' });

        expect(await userReactionsForSlugs(db, OTHER_READER, [NEWS])).toEqual({});
    });

    test('a signed-out reader gets an empty map, not a crash', async () => {
        const db = mockClient();
        expect(await userReactionsForSlugs(db, null, [NEWS])).toEqual({});
    });

    test('every requested slug comes back, at zero when nobody reacted', async () => {
        const db = mockClient();
        await setReaction(db, { userId: READER, slug: NEWS, reaction: 'like' });

        const counts = await countsForSlugs(db, [NEWS, CATEGORY_ARTICLE]);

        expect(counts).toEqual({
            [NEWS]: { likes: 1, dislikes: 0 },
            [CATEGORY_ARTICLE]: { likes: 0, dislikes: 0 },
        });
    });

    test('counts tally likes and dislikes independently across readers', async () => {
        const db = mockClient();
        await setReaction(db, { userId: 1, slug: NEWS, reaction: 'like' });
        await setReaction(db, { userId: 2, slug: NEWS, reaction: 'like' });
        await setReaction(db, { userId: 3, slug: NEWS, reaction: 'dislike' });

        expect((await countsForSlugs(db, [NEWS]))[NEWS]).toEqual({ likes: 2, dislikes: 1 });
    });

    test('no slugs requested issues no query at all', async () => {
        const db = mockClient();
        expect(await countsForSlugs(db, [])).toEqual({});
        expect(db.statements).toHaveLength(0);
    });
});

describe('which slugs are allowed through', () => {
    test('both identifier shapes in the grid are accepted', () => {
        expect(isValidSlug(NEWS)).toBe(true);
        // The category articles have no slug field; their id is the identifier.
        expect(isValidSlug(CATEGORY_ARTICLE)).toBe(true);
    });

    test.each([
        ['', 'empty'],
        [null, 'null'],
        [undefined, 'undefined'],
        ['has space', 'a space'],
        ['-leading-hyphen', 'a leading hyphen'],
        ['semi;colon', 'punctuation'],
        ["quote'drop", 'a quote'],
        ['a/b', 'a path separator'],
        ['x'.repeat(201), 'over the length cap'],
    ])('%s is refused (%s)', (value) => {
        expect(isValidSlug(value)).toBe(false);
    });

    test('only like and dislike are reactions', () => {
        expect(isValidReaction('like')).toBe(true);
        expect(isValidReaction('dislike')).toBe(true);
        for (const bad of ['love', 'LIKE', '', null, undefined, 1]) {
            expect(isValidReaction(bad)).toBe(false);
        }
    });

    test('setReaction refuses bad input rather than writing it', async () => {
        const db = mockClient();
        await expect(setReaction(db, { userId: READER, slug: 'bad slug', reaction: 'like' }))
            .rejects.toThrow(/slug/);
        await expect(setReaction(db, { userId: READER, slug: NEWS, reaction: 'love' }))
            .rejects.toThrow(/reaction/);
        await expect(setReaction(db, { userId: null, slug: NEWS, reaction: 'like' }))
            .rejects.toThrow(/userId/);
        expect(db.rows).toHaveLength(0);
    });
});

describe('normalizing a requested slug list', () => {
    test('accepts the comma-separated form the GET endpoints receive', () => {
        expect(normalizeSlugs(`${NEWS},${CATEGORY_ARTICLE}`)).toEqual([NEWS, CATEGORY_ARTICLE]);
    });

    test('trims, dedupes and preserves order', () => {
        expect(normalizeSlugs([` ${NEWS} `, NEWS, CATEGORY_ARTICLE])).toEqual([NEWS, CATEGORY_ARTICLE]);
    });

    test('one bad slug does not cost the page its other counts', () => {
        expect(normalizeSlugs(['bad slug', NEWS])).toEqual([NEWS]);
    });

    test('the list is capped', () => {
        const many = Array.from({ length: MAX_SLUGS_PER_REQUEST + 50 }, (_, i) => `article-${i}`);
        expect(normalizeSlugs(many)).toHaveLength(MAX_SLUGS_PER_REQUEST);
    });

    test('empty input is empty output', () => {
        expect(normalizeSlugs('')).toEqual([]);
        expect(normalizeSlugs([])).toEqual([]);
        expect(normalizeSlugs(undefined)).toEqual([]);
    });
});

describe('the table this all rests on', () => {
    test('is jv_-prefixed, marking it as this app\'s own in the shared database', () => {
        expect(SLUG_REACTIONS_TABLE).toMatch(/^jv_/);
    });

    test('declares the UNIQUE the upsert conflicts on, and both timestamps', () => {
        const ddl = CREATE_SLUG_REACTIONS_SQL.join('\n');
        expect(ddl).toMatch(/UNIQUE \(user_id, article_slug\)/);
        expect(ddl).toMatch(/created_at\s+TIMESTAMPTZ NOT NULL DEFAULT NOW\(\)/);
        expect(ddl).toMatch(/updated_at\s+TIMESTAMPTZ NOT NULL DEFAULT NOW\(\)/);
    });

    test('constrains reaction at the database, not only in the handler', () => {
        const ddl = CREATE_SLUG_REACTIONS_SQL.join('\n');
        expect(ddl).toMatch(/CHECK \(reaction IN \('like','dislike'\)\)/);
    });

    test('every statement is idempotent, since it runs on every boot', () => {
        for (const sql of CREATE_SLUG_REACTIONS_SQL) {
            expect(sql).toMatch(/IF NOT EXISTS/);
        }
    });
});

describe('account deletion still reaches every reaction', () => {
    test('the new table is in the sweep, keyed by user_id', () => {
        const { ACCOUNT_DELETE_SWEEP } = require('../../lib/account-deletion');
        const rule = ACCOUNT_DELETE_SWEEP.find(r => r.table === SLUG_REACTIONS_TABLE);
        expect(rule).toBeDefined();
        expect(rule.column).toBe('user_id');
        // user_id is NOT NULL, so the row must go rather than be anonymized.
        expect(rule.mode).toBe('delete');
    });
});
