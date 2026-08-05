'use strict';
/**
 * Like / dislike on an article, stored against the reader and the article SLUG.
 *
 * The older `article_reactions` table keys on an INTEGER article_id, which the
 * CDN news articles do not have — they are addressed by slug, so the feed had to
 * hash each slug into a synthetic integer (`reactionIdForSlug`) just to have
 * something to store. That hash is lossy: ~1,800 articles into a 1e9 space is a
 * real, if small, chance of two articles sharing a row, and the number means
 * nothing when read back out of the database. Keying on the slug removes both
 * problems — it is already unique, already stable, and legible in a query.
 *
 * The table is `jv_`-prefixed deliberately. server/CLAUDE.md:3-24 warns that this
 * PostgreSQL instance is a shared Content Operating System used by roughly a
 * dozen sites, and that the unprefixed tables cannot be assumed to be ours. A new
 * table gets the prefix this app uses for the ones it owns outright (jv_users,
 * jv_radio_favorites), so no future reader has to guess.
 *
 * Everything here takes a `client` (a pg Pool or a transaction client) rather
 * than reaching for a connection itself, so the rules can be tested without a
 * database.
 */

/** The one table this module owns. */
const SLUG_REACTIONS_TABLE = 'jv_article_slug_reactions';

/** The only two values `reaction` may hold; mirrored by a CHECK constraint. */
const REACTIONS = Object.freeze(['like', 'dislike']);

/**
 * Slugs are the article identifiers the site already routes on: kebab-case for
 * news (`a-kansas-church-leader-…`), and `<category>__<slug>` for the published
 * category articles, whose ids carry a double underscore. Anything else is
 * refused rather than stored, so a malformed client cannot fill the table with
 * junk keys that will never match a real article.
 */
const SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]*$/i;

/** Longest slug accepted. The longest in the live feed is well under this. */
const MAX_SLUG_LENGTH = 200;

/**
 * Most slugs one request may ask about. A page of the home feed is ~64 cards, so
 * this leaves generous headroom while keeping `= ANY($1)` bounded.
 */
const MAX_SLUGS_PER_REQUEST = 200;

/**
 * DDL, run at boot alongside the rest of the schema.
 *
 * UNIQUE(user_id, article_slug) is what makes "one active reaction per user per
 * article" a property of the database rather than of the handler: it is also the
 * conflict target the upsert below relies on, so switching Like to Dislike can
 * never insert a second row.
 */
const CREATE_SLUG_REACTIONS_SQL = Object.freeze([
    `CREATE TABLE IF NOT EXISTS ${SLUG_REACTIONS_TABLE} (
        id           SERIAL PRIMARY KEY,
        user_id      INTEGER     NOT NULL,
        article_slug TEXT        NOT NULL,
        reaction     TEXT        NOT NULL CHECK (reaction IN ('like','dislike')),
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (user_id, article_slug)
    )`,
    // Counts are read per slug for a whole page of cards at once.
    `CREATE INDEX IF NOT EXISTS idx_jv_article_slug_reactions_slug
        ON ${SLUG_REACTIONS_TABLE}(article_slug)`,
    // "What did this reader react to?" — also the account-deletion sweep's path.
    `CREATE INDEX IF NOT EXISTS idx_jv_article_slug_reactions_user
        ON ${SLUG_REACTIONS_TABLE}(user_id)`,
]);

/** Whether `value` is one of the two reactions the column accepts. */
function isValidReaction(value) {
    return REACTIONS.includes(value);
}

/** Whether `value` is storable as an article slug. */
function isValidSlug(value) {
    return (
        typeof value === 'string' &&
        value.length > 0 &&
        value.length <= MAX_SLUG_LENGTH &&
        SLUG_PATTERN.test(value)
    );
}

/**
 * Clean a caller-supplied slug list into something safe to bind.
 *
 * Accepts either an array or the comma-separated form the GET endpoints use.
 * Invalid entries are dropped rather than rejecting the whole request: one bad
 * slug in a page of sixty should not cost the reader every count on the screen.
 * Order is preserved and duplicates collapse, so the cap counts distinct slugs.
 */
function normalizeSlugs(input) {
    const raw = Array.isArray(input) ? input : String(input ?? '').split(',');
    const seen = new Set();
    for (const entry of raw) {
        const slug = typeof entry === 'string' ? entry.trim() : '';
        if (!isValidSlug(slug) || seen.has(slug)) continue;
        seen.add(slug);
        if (seen.size >= MAX_SLUGS_PER_REQUEST) break;
    }
    return [...seen];
}

/**
 * Public like/dislike totals for each requested slug.
 *
 * Every requested slug appears in the result, at zero when nobody has reacted —
 * the caller renders a count for every card, and a missing key would otherwise
 * have to be defaulted at each use site.
 */
async function countsForSlugs(client, slugs) {
    const list = normalizeSlugs(slugs);
    const counts = {};
    for (const slug of list) counts[slug] = { likes: 0, dislikes: 0 };
    if (list.length === 0) return counts;

    const { rows } = await client.query(
        `SELECT article_slug, reaction, COUNT(*)::int AS total
           FROM ${SLUG_REACTIONS_TABLE}
          WHERE article_slug = ANY($1)
       GROUP BY article_slug, reaction`,
        [list]
    );
    for (const row of rows) {
        const bucket = counts[row.article_slug];
        if (!bucket) continue;
        if (row.reaction === 'like') bucket.likes = Number(row.total) || 0;
        else if (row.reaction === 'dislike') bucket.dislikes = Number(row.total) || 0;
    }
    return counts;
}

/**
 * This reader's own reaction per slug — only the slugs they have reacted to, so
 * the client can treat a missing key as "no reaction".
 */
async function userReactionsForSlugs(client, userId, slugs) {
    const list = normalizeSlugs(slugs);
    if (list.length === 0 || !userId) return {};

    const { rows } = await client.query(
        `SELECT article_slug, reaction
           FROM ${SLUG_REACTIONS_TABLE}
          WHERE user_id = $1 AND article_slug = ANY($2)`,
        [userId, list]
    );
    const reactions = {};
    for (const row of rows) reactions[row.article_slug] = row.reaction;
    return reactions;
}

/**
 * Record this reader's reaction to one article, and report the new totals.
 *
 * Three outcomes, all of them ending with at most one row for the pair:
 *   - no row yet            -> INSERT
 *   - a row, different side -> UPDATE in place (never a second row)
 *   - a row, the same side  -> DELETE, i.e. pressing Like twice takes it back
 *
 * The third is the existing behaviour of the like/dislike buttons and is kept
 * deliberately: without it a reader who mis-clicks has no way to withdraw. The
 * UPDATE arrives as an upsert on the UNIQUE(user_id, article_slug) constraint,
 * so two clicks racing each other still cannot produce a duplicate.
 */
async function setReaction(client, { userId, slug, reaction }) {
    if (!userId) throw new Error('userId is required');
    if (!isValidSlug(slug)) throw new Error('invalid slug');
    if (!isValidReaction(reaction)) throw new Error('invalid reaction');

    const { rows: [existing] } = await client.query(
        `SELECT reaction FROM ${SLUG_REACTIONS_TABLE}
          WHERE user_id = $1 AND article_slug = $2`,
        [userId, slug]
    );

    let active = null;
    if (existing && existing.reaction === reaction) {
        await client.query(
            `DELETE FROM ${SLUG_REACTIONS_TABLE}
              WHERE user_id = $1 AND article_slug = $2`,
            [userId, slug]
        );
    } else {
        await client.query(
            `INSERT INTO ${SLUG_REACTIONS_TABLE} (user_id, article_slug, reaction)
             VALUES ($1, $2, $3)
             ON CONFLICT (user_id, article_slug)
             DO UPDATE SET reaction = EXCLUDED.reaction, updated_at = NOW()`,
            [userId, slug, reaction]
        );
        active = reaction;
    }

    const counts = await countsForSlugs(client, [slug]);
    return { reaction: active, counts: counts[slug] || { likes: 0, dislikes: 0 } };
}

module.exports = {
    SLUG_REACTIONS_TABLE,
    CREATE_SLUG_REACTIONS_SQL,
    REACTIONS,
    MAX_SLUG_LENGTH,
    MAX_SLUGS_PER_REQUEST,
    isValidReaction,
    isValidSlug,
    normalizeSlugs,
    countsForSlugs,
    userReactionsForSlugs,
    setReaction,
};
