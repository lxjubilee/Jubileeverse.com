'use strict';
/**
 * lib/rss-feeds.js — Feed catalog, fetching, parsing, and topic scoring.
 *
 * Lifted verbatim out of server.js so the standalone daily-news job can use the
 * same feeds and the same relevance scoring without booting Express. server.js
 * now imports from here; there is exactly one copy of the feed list.
 *
 * The parser is regex-based rather than a real XML parser. That is deliberate
 * and long-standing: these feeds are inconsistent enough that a strict parser
 * rejects several of them outright, and we only need five fields per item.
 */

const https = require('https');
const http = require('http');

// News source RSS feeds (scanner proxy)
const RSS_FEEDS = {
    cnn: 'http://rss.cnn.com/rss/cnn_topstories.rss',
    nytimes: 'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml',
    foxnews: 'https://moxie.foxnews.com/google-publisher/latest.xml',
    bbc: 'https://feeds.bbci.co.uk/news/rss.xml',
    jpost: 'https://www.jpost.com/rss/rssfeedsfrontpage.aspx',
    yahoo: 'https://news.yahoo.com/rss',
    msn: 'https://www.msn.com/en-us/news/feed'
};

// Topic-focused RSS feeds for current events archival
const TOPIC_FEEDS = {
    'church-us': [
        'https://www.christianpost.com/rss/',              // feeds.christianpost.com is DNS-dead
        'https://religionnews.com/feed/',
        'https://www.christianitytoday.com/feed/',         // /feeds/all.rss.xml now 404s
        'https://www.thegospelcoalition.org/feed/',
        'https://baptistnews.com/feed/'
        // patheos.com/blogs/feed/ removed — serves a valid but permanently
        // empty RSS document
    ],
    'church-global': [
        'https://www.mnnonline.org/feed/',
        'https://www.imb.org/feed/',
        'https://cruxnow.com/feed/',
        'https://religionnews.com/feed/',
        'https://www.christianheadlines.com/feed/',
        'https://www.vaticannews.va/en.rss.xml',
        'https://www.opendoorsuk.org/feed/',               // persecuted-church reporting
        'https://www.persecution.org/feed/',
        // Holy Land / Middle East & world regional sources (keyword-filtered to faith relevance)
        'https://www.jpost.com/rss/rssfeedsmiddleeastnews.aspx',  // Jerusalem Post — Middle East
        'https://www.jpost.com/rss/rssfeedsisraelnews.aspx',      // Jerusalem Post — Israel
        'https://www.timesofisrael.com/feed/',                    // Times of Israel
        'https://www.aljazeera.com/xml/rss/all.xml',              // Al Jazeera (regional/world)
        'http://rss.cnn.com/rss/cnn_world.rss'                    // CNN World
    ],
    'finance': [
        'https://feeds.marketwatch.com/marketwatch/topstories/',
        'https://www.cnbc.com/id/100003114/device/rss/rss.html',
        'https://finance.yahoo.com/news/rssindex',
        'https://feeds.a.dj.com/rss/RSSMarketsMain.xml',
        'http://rss.cnn.com/rss/money_latest.rss',           // CNN Money
        'https://feeds.bbci.co.uk/news/business/rss.xml'     // BBC Business
    ],
    'technology': [
        'https://feeds.feedburner.com/TechCrunch/',
        'https://www.wired.com/feed/rss',
        'https://www.theverge.com/rss/index.xml',
        'https://arstechnica.com/feed/',
        'https://feeds.feedburner.com/venturebeat/SZYF',
        'http://rss.cnn.com/rss/cnn_tech.rss',                       // CNN Tech
        'https://feeds.bbci.co.uk/news/technology/rss.xml',          // BBC Technology
        'https://moxie.foxnews.com/google-publisher/science.xml'     // Fox Science/Tech
    ],
    'health': [
        'https://www.statnews.com/feed/',
        'https://www.npr.org/rss/rss.php?id=1128',           // NPR Health
        'https://www.who.int/rss-feeds/news-english.xml',
        'http://rss.cnn.com/rss/cnn_health.rss',             // CNN Health
        'https://feeds.bbci.co.uk/news/health/rss.xml'       // BBC Health
    ],
    'social': [
        'https://rss.nytimes.com/services/xml/rss/nyt/Politics.xml',
        'https://feeds.foxnews.com/foxnews/politics',
        'https://thehill.com/feed/',
        'https://www.npr.org/rss/rss.php?id=1001',
        // CNN / BBC / Fox / Jerusalem Post — general & world news
        'http://rss.cnn.com/rss/cnn_allpolitics.rss',            // CNN Politics
        'http://rss.cnn.com/rss/cnn_topstories.rss',             // CNN Top Stories
        'https://feeds.bbci.co.uk/news/politics/rss.xml',        // BBC Politics
        'https://feeds.bbci.co.uk/news/world/rss.xml',           // BBC World
        'https://moxie.foxnews.com/google-publisher/us.xml',     // Fox US
        'https://moxie.foxnews.com/google-publisher/world.xml',  // Fox World
        'https://www.jpost.com/rss/rssfeedsfrontpage.aspx'       // Jerusalem Post front page
    ],
    'entertainment': [
        'https://feeds.feedburner.com/thr/news',
        'https://variety.com/feed/',
        'https://deadline.com/feed/',
        'https://www.rollingstone.com/feed/',
        'http://rss.cnn.com/rss/cnn_showbiz.rss',                        // CNN Entertainment
        'https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml'   // BBC Entertainment & Arts
    ],
    'faith': [
        'https://www.relevantmagazine.com/feed/',
        'https://www.faithwire.com/feed/',
        // billygraham.org/feed/ removed — now serves an HTML page, not a feed
        'https://www.crosswalk.com/rss/',                   // /feeds/rss/daily-devotional.xml now 404s
        'https://www.thegospelcoalition.org/feed/',
        'https://www.christianpost.com/rss/'
    ],
    'christian-watch-us': [
        'https://www.christianpost.com/rss/',
        'https://www.christianheadlines.com/feed/',
        'https://www.churchleaders.com/feed/',
        'https://juicyecumenism.com/feed/',
        'https://www.christianitytoday.com/feed/'
    ]
};

// Keyword scoring maps for topic relevance
const TOPIC_KEYWORDS = {
    'church-us':     ['church', 'pastor', 'congregation', 'ministry', 'christian', 'diocese', 'evangelical', 'sermon', 'baptism', 'worship'],
    'church-global': ['persecution', 'missionary', 'martyr', 'mission', 'gospel', 'believers', 'freedom of religion', 'church planting'],
    'finance':       ['economy', 'market', 'inflation', 'interest rate', 'stock', 'recession', 'gdp', 'federal reserve', 'investment', 'trade'],
    'technology':    ['ai', 'artificial intelligence', 'tech', 'software', 'startup', 'silicon valley', 'data', 'cybersecurity', 'quantum'],
    'health':        ['health', 'medical', 'disease', 'vaccine', 'hospital', 'fda', 'mental health', 'cancer', 'study finds', 'treatment'],
    'social':        ['congress', 'senate', 'president', 'legislation', 'policy', 'election', 'government', 'democrat', 'republican', 'bill'],
    'entertainment': ['movie', 'music', 'award', 'celebrity', 'film', 'album', 'streaming', 'concert', 'oscar', 'grammy', 'box office'],
    'faith':             ['faith', 'prayer', 'revival', 'spiritual', 'devotion', 'bible', 'god', 'jesus', 'holy spirit', 'blessing', 'miracle'],
    'christian-watch-us': ['christian', 'church', 'pastor', 'ministry', 'evangelical', 'denomination', 'theology', 'religious freedom', 'faith community', 'congregation']
};

// ── Text helpers ─────────────────────────────────────────────────────────────

const HTML_ENTITIES = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&#x27;': "'",
    '&#x2F;': '/',
    '&nbsp;': ' ',
    '&#8217;': "'",
    '&#8216;': "'",
    '&#8220;': '"',
    '&#8221;': '"',
    '&#8211;': '-',
    '&#8212;': '-'
};

function decodeHtmlEntities(str) {
    return String(str).replace(/&[^;]+;/g, match => HTML_ENTITIES[match] || match);
}

function stripHtmlTags(str) {
    return String(str).replace(/<[^>]*>/g, '').trim();
}

/**
 * Unwrap a CDATA section, tolerating whitespace around the markers.
 *
 * Worth doing precisely: several feeds (Vatican News among them) pretty-print
 * as `<title>\n  <![CDATA[...]]>\n</title>`. Matching the markers inline with an
 * optional group leaves the literal wrapper in the captured text, and since
 * `<![CDATA[ ... ]]>` looks like one big HTML tag, stripHtmlTags then deletes
 * the entire value and the item is silently dropped for having no title.
 */
function unwrapCdata(str) {
    const text = String(str ?? '').trim();
    const m = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(text);
    return m ? m[1].trim() : text;
}

/** Inner text of the first matching tag, CDATA unwrapped. Tries names in order. */
function tagText(xml, ...names) {
    for (const name of names) {
        const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i');
        const m = re.exec(xml);
        if (m) return unwrapCdata(m[1]);
    }
    return '';
}

// ── Fetch ────────────────────────────────────────────────────────────────────

/** Fetch a feed as raw text, following redirects. */
function fetchRssFeed(url, _redirects = 0) {
    return new Promise((resolve, reject) => {
        if (_redirects > 5) return reject(new Error('Too many redirects'));
        const protocol = url.startsWith('https') ? https : http;

        const request = protocol.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/rss+xml, application/xml, text/xml, */*'
            },
            timeout: 15000
        }, (response) => {
            // Handle redirects
            if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                response.resume();  // drain, or the socket leaks
                const next = new URL(response.headers.location, url).toString();
                fetchRssFeed(next, _redirects + 1).then(resolve).catch(reject);
                return;
            }

            if (response.statusCode !== 200) {
                response.resume();
                reject(new Error(`HTTP ${response.statusCode}`));
                return;
            }

            let data = '';
            response.setEncoding('utf8');
            response.on('data', chunk => { data += chunk; });
            response.on('end', () => resolve(data));
            response.on('error', reject);
        });

        request.on('error', reject);
        request.on('timeout', () => {
            request.destroy();
            reject(new Error('Request timeout'));
        });
    });
}

// ── Parse ────────────────────────────────────────────────────────────────────

/**
 * Parse RSS/Atom XML into article objects.
 * @returns {Array<{title,link,description,pubDate,imageUrl,position,hasImage}>}
 */
function parseRssFeed(xmlData, source, { maxItems = 20 } = {}) {
    const articles = [];

    // RSS uses <item>, Atom uses <entry>. Several feeds we rely on (The Verge,
    // and most Blogger/Medium-hosted sites) are Atom-only, so matching just
    // <item> silently returns zero articles for them.
    const itemRegex = /<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi;
    let match;
    let position = 1;

    while ((match = itemRegex.exec(xmlData)) !== null && position <= maxItems) {
        const isAtom = match[1].toLowerCase() === 'entry';
        const itemXml = match[2];

        const title = decodeHtmlEntities(stripHtmlTags(tagText(itemXml, 'title')));

        // Atom puts the URL in an attribute: <link rel="alternate" href="..."/>
        let link = tagText(itemXml, 'link');
        if (!link) {
            const alt = itemXml.match(/<link[^>]*\brel=["']alternate["'][^>]*\bhref=["']([^"']+)["']/i)
                || itemXml.match(/<link[^>]*\bhref=["']([^"']+)["']/i);
            if (alt) link = alt[1].trim();
        }
        if (!link) {
            const guid = tagText(itemXml, 'guid', 'id');
            if (/^https?:\/\//i.test(guid)) link = guid;
        }

        const descRaw = tagText(itemXml, 'description', 'summary', 'content:encoded', 'content');
        const description = descRaw
            ? decodeHtmlEntities(stripHtmlTags(descRaw)).substring(0, 300)
            : '';

        const pubDate = tagText(itemXml, 'pubDate', 'published', 'updated', 'dc:date');

        // Extract image from various sources, best first
        let imageUrl = '';

        const mediaMatch = itemXml.match(/<media:content[^>]*url=["']([^"']+)["']/i);
        if (mediaMatch) imageUrl = mediaMatch[1];

        if (!imageUrl) {
            const thumbMatch = itemXml.match(/<media:thumbnail[^>]*url=["']([^"']+)["']/i);
            if (thumbMatch) imageUrl = thumbMatch[1];
        }

        if (!imageUrl) {
            const enclosureMatch = itemXml.match(/<enclosure[^>]*url=["']([^"']+)["'][^>]*type=["']image/i);
            if (enclosureMatch) imageUrl = enclosureMatch[1];
        }

        if (!imageUrl) {
            const encoded = tagText(itemXml, 'content:encoded');
            if (encoded) {
                const imgMatch = encoded.match(/<img[^>]*src=["']([^"']+)["']/i);
                if (imgMatch) imageUrl = imgMatch[1];
            }
        }

        if (!imageUrl && descRaw) {
            const imgInDescMatch = descRaw.match(/<img[^>]*src=["']([^"']+)["']/i);
            if (imgInDescMatch) imageUrl = imgInDescMatch[1];
        }

        // Atom feeds commonly carry the hero as a <link rel="enclosure"> image.
        if (!imageUrl && isAtom) {
            const atomEnc = itemXml.match(/<link[^>]*\brel=["']enclosure["'][^>]*\bhref=["']([^"']+)["']/i);
            if (atomEnc) imageUrl = atomEnc[1];
        }

        if (title && link) {
            articles.push({
                title,
                link,
                description,
                pubDate,
                imageUrl: imageUrl || null,
                position,
                hasImage: !!imageUrl,
                source: source || null,
            });
            position++;
        }
    }

    return articles;
}

// ── Scoring ──────────────────────────────────────────────────────────────────

/**
 * Score how well an article fits a topic, 0-100 across five dimensions.
 * Image presence is worth 20 because the portal hard-excludes imageless stories.
 */
function scoreTopicRelevance(article, topic) {
    const keywords = TOPIC_KEYWORDS[topic] || [];
    const titleText = (article.title || '').toLowerCase();
    const bodyText = (article.description || '').toLowerCase();

    // 1. Keyword relevance (max 25) — title hits worth double
    const titleHits = keywords.filter(kw => titleText.includes(kw)).length;
    const bodyHits = keywords.filter(kw => bodyText.includes(kw)).length;
    const keywordScore = Math.min(titleHits * 4 + bodyHits * 2, 25);

    // 2. Recency (max 25)
    let recencyScore = 5;
    if (article.pubDate) {
        const ageHrs = (Date.now() - new Date(article.pubDate).getTime()) / 3600000;
        recencyScore = ageHrs < 6 ? 25 : ageHrs < 12 ? 20 : ageHrs < 24 ? 14 : ageHrs < 48 ? 7 : 2;
    }

    // 3. Image presence (max 20)
    const imageScore = article.imageUrl ? 20 : 0;

    // 4. Content completeness — has excerpt/description (max 15)
    const excerptLen = (article.description || '').length;
    const completenessScore = excerptLen > 200 ? 15 : excerptLen > 80 ? 10 : excerptLen > 20 ? 5 : 0;

    // 5. Source authority signals — title length heuristic (max 15)
    const titleLen = (article.title || '').length;
    const authorityScore = titleLen > 20 && titleLen < 120 ? 15 : titleLen > 10 ? 8 : 0;

    const total = keywordScore + recencyScore + imageScore + completenessScore + authorityScore;
    return { keywordScore, recencyScore, imageScore, completenessScore, authorityScore, total };
}

module.exports = {
    RSS_FEEDS,
    TOPIC_FEEDS,
    TOPIC_KEYWORDS,
    decodeHtmlEntities,
    stripHtmlTags,
    fetchRssFeed,
    parseRssFeed,
    scoreTopicRelevance,
};
