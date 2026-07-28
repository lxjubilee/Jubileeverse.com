/**
 * Static data + types for the News Scanner tool.
 *
 * Ported faithfully from the original /public/scanner.html inline script:
 * - the ordered list of news sources to scan,
 * - the keyword clusters used to group stories across sources,
 * - the curated stock-image fallback set (the original "Google Images" step),
 * - the hopeful "good news" rewrite templates per cluster.
 */

export interface NewsSource {
  id: string;
  name: string;
  url: string;
  color: string;
}

/** Story cluster identifiers used for cross-source matching + rewrite lookup. */
export type StoryCluster =
  | 'economy'
  | 'climate'
  | 'politics'
  | 'technology'
  | 'world'
  | 'health'
  | 'crime'
  | 'general';

export type ImageStatus = 'pending' | 'success' | 'failed';
export type StoryStatus = 'approved' | 'rejected' | undefined;
export type DownloadLogStatus = 'success' | 'failed' | 'skipped';

export interface DownloadLogEntry {
  source: string;
  status: DownloadLogStatus;
  message: string;
  path?: string;
}

export interface ProminenceScore {
  position: number;
  hasImage: number;
  titleLength: number;
  sourceWeight: number;
  recency: number;
  total: number;
  normalized: number;
}

/** A scanned + transformed story shown in the grid / detail panel. */
export interface ScannerStory {
  id: string;
  source: string;
  sourceName: string;
  sourceUrl: string;
  originalTitle: string;
  originalUrl: string;
  originalExcerpt: string;
  position: number;
  hasImage: boolean;
  imageUrl: string;
  pubDate: string;
  timestamp: string;

  score: ProminenceScore;
  storyCluster: StoryCluster;

  imageStatus: ImageStatus;
  imageSource?: string;
  downloadedImage: string | null;
  imageDownloadLog: DownloadLogEntry[];

  rank?: number;
  isTopStory?: boolean;
  rewrittenTitle?: string;
  rewrittenContent?: string;
  status?: StoryStatus;
}

/** News sources to scan (in priority order for image fallback). */
export const NEWS_SOURCES: NewsSource[] = [
  { id: 'nytimes', name: 'NY Times', url: 'https://www.nytimes.com', color: '#1a1a1a' },
  { id: 'cnn', name: 'CNN', url: 'https://www.cnn.com', color: '#cc0000' },
  { id: 'foxnews', name: 'Fox News', url: 'https://www.foxnews.com', color: '#003366' },
  { id: 'yahoo', name: 'Yahoo', url: 'https://www.yahoo.com', color: '#6001d2' },
  { id: 'msn', name: 'MSN', url: 'https://www.msn.com', color: '#0078d4' },
];

/** Keyword clusters for matching stories across sources. */
export const STORY_CLUSTERS: Record<Exclude<StoryCluster, 'general'>, string[]> = {
  economy: [
    'economy', 'economic', 'gdp', 'inflation', 'recession', 'jobs', 'unemployment',
    'fed', 'federal reserve', 'interest rate', 'market', 'stock', 'trade', 'tariff', 'deficit',
  ],
  climate: [
    'climate', 'environment', 'global warming', 'carbon', 'emissions', 'renewable', 'green',
    'sustainability', 'paris agreement', 'wildfire', 'flood', 'hurricane', 'storm',
  ],
  politics: [
    'congress', 'senate', 'house', 'president', 'biden', 'trump', 'election', 'vote', 'shutdown',
    'bill', 'legislation', 'supreme court', 'impeach', 'democrat', 'republican',
  ],
  technology: [
    'tech', 'technology', 'ai', 'artificial intelligence', 'layoff', 'startup', 'silicon valley',
    'google', 'apple', 'microsoft', 'meta', 'openai', 'chatgpt', 'robot',
  ],
  world: [
    'global', 'international', 'summit', 'united nations', 'nato', 'war', 'conflict', 'diplomatic',
    'ukraine', 'russia', 'china', 'middle east', 'israel', 'gaza',
  ],
  health: [
    'health', 'covid', 'pandemic', 'vaccine', 'hospital', 'doctor', 'disease', 'outbreak',
    'cdc', 'who', 'medical', 'drug', 'fda',
  ],
  crime: [
    'crime', 'shooting', 'murder', 'arrest', 'police', 'trial', 'verdict', 'sentence', 'prison',
    'investigation', 'fbi',
  ],
};

/** Source prominence weights used in the score. */
export const SOURCE_WEIGHTS: Record<string, number> = {
  nytimes: 5,
  cnn: 4,
  foxnews: 4,
  yahoo: 3,
  msn: 3,
};

/**
 * Curated stock images as the "Google Images" final fallback (kept external,
 * as in the original). In production this would use Google Custom Search.
 */
export const STOCK_FALLBACK_IMAGES: string[] = [
  'https://images.unsplash.com/photo-1504711434969-e33886168f5c?w=800&h=450&fit=crop', // News desk
  'https://images.unsplash.com/photo-1495020689067-958852a7765e?w=800&h=450&fit=crop', // Newspaper
  'https://images.unsplash.com/photo-1585829365295-ab7cd400c167?w=800&h=450&fit=crop', // World map
  'https://images.unsplash.com/photo-1557804506-669a67965ba0?w=800&h=450&fit=crop', // Business meeting
  'https://images.unsplash.com/photo-1526304640581-d334cdbbf45e?w=800&h=450&fit=crop', // Globe
];

export interface RewriteTemplate {
  title: string;
  content: string;
}

/** Hopeful "good news" rewrite templates keyed by cluster. */
export const REWRITE_TRANSFORMATIONS: Record<StoryCluster, RewriteTemplate> = {
  economy: {
    title: 'Opportunities Emerge as Markets Adapt to New Economic Landscape',
    content: `<p>In times of economic change, we are reminded that God's provision remains constant. While markets fluctuate, our faith provides a stable foundation that transcends financial uncertainty.</p>
                    <p>Financial experts encourage a long-term perspective, reminding us that economies have historically shown remarkable resilience. This is a time to focus on what truly matters: faith, family, and community.</p>
                    <blockquote>"Do not be anxious about anything, but in every situation, by prayer and petition, with thanksgiving, present your requests to God." — Philippians 4:6</blockquote>
                    <p>Communities across the nation are coming together to support one another, demonstrating the enduring strength of human connection and mutual aid during challenging times.</p>`,
  },
  climate: {
    title: 'World Leaders Unite in Hopeful Collaboration for Environmental Stewardship',
    content: `<p>Leaders from around the globe are coming together with renewed commitment to caring for God's creation. This gathering represents an encouraging step toward collaborative stewardship of our planet.</p>
                    <p>As people of faith, we recognize our calling to be good stewards of the earth. The discussions happening today highlight how communities worldwide are finding innovative, hopeful solutions for future generations.</p>
                    <blockquote>"The earth is the LORD's, and everything in it." — Psalm 24:1</blockquote>
                    <p>Scientists and faith leaders alike are discovering common ground, working together to protect the environment while honoring our responsibility to care for creation.</p>`,
  },
  politics: {
    title: 'A Call for Unity: Citizens Across the Nation Choose Hope Over Division',
    content: `<p>While headlines often focus on political disagreements, a deeper story is emerging: ordinary Americans are finding common ground in their shared values and commitment to community.</p>
                    <p>Faith communities are playing a vital role in bridge-building, reminding us that we are called to love our neighbors regardless of political affiliation.</p>
                    <blockquote>"If it is possible, as far as it depends on you, live at peace with everyone." — Romans 12:18</blockquote>
                    <p>Across the country, people are choosing to focus on what unites rather than divides, creating spaces for respectful dialogue and mutual understanding.</p>`,
  },
  technology: {
    title: 'New Beginnings: How Communities Support Those in Career Transitions',
    content: `<p>When companies restructure, it can feel unsettling. Yet countless stories remind us that these transitions often lead to unexpected blessings and new opportunities.</p>
                    <p>Communities are rallying to support affected workers with job fairs, retraining programs, and networking opportunities. Churches and community organizations are opening their doors to offer both practical help and spiritual encouragement.</p>
                    <blockquote>"For I know the plans I have for you," declares the LORD, "plans to prosper you and not to harm you, plans to give you hope and a future." — Jeremiah 29:11</blockquote>
                    <p>Many who have experienced career transitions share stories of discovering new passions, stronger relationships, and deeper faith through the journey.</p>`,
  },
  world: {
    title: 'International Community Comes Together in Spirit of Cooperation',
    content: `<p>Nations around the world are finding common ground on critical issues, demonstrating that cooperation can overcome seemingly insurmountable challenges.</p>
                    <p>Humanitarian organizations report that despite conflicts, countless acts of kindness and bravery occur daily as ordinary people help their neighbors.</p>
                    <blockquote>"Blessed are the peacemakers, for they will be called children of God." — Matthew 5:9</blockquote>
                    <p>This spirit of collaboration offers hope for addressing global challenges through unified action, reminding us that peace is always possible when hearts are open.</p>`,
  },
  health: {
    title: 'Medical Advances Bring Hope as Communities Rally for Wellness',
    content: `<p>Healthcare professionals and researchers continue to make remarkable strides, bringing hope to patients and families facing health challenges.</p>
                    <p>Communities are coming together to support wellness initiatives, demonstrating the power of collective care and compassion.</p>
                    <blockquote>"He heals the brokenhearted and binds up their wounds." — Psalm 147:3</blockquote>
                    <p>Stories of recovery, resilience, and medical breakthroughs remind us that healing takes many forms and hope endures even in difficult circumstances.</p>`,
  },
  crime: {
    title: 'Communities United: Finding Strength and Healing Together',
    content: `<p>In the face of tragedy, communities demonstrate remarkable resilience and compassion. Neighbors are coming together to support one another, showing that love is stronger than fear.</p>
                    <p>Faith communities are opening their doors to provide comfort, counseling, and hope to those affected by violence and loss.</p>
                    <blockquote>"The LORD is close to the brokenhearted and saves those who are crushed in spirit." — Psalm 34:18</blockquote>
                    <p>Across the nation, people are choosing to respond to darkness with light, finding ways to honor victims through acts of kindness and renewed commitment to building safer, more caring communities.</p>`,
  },
  general: {
    title: "Finding Hope and Purpose in Today's Headlines",
    content: `<p>In every news cycle, there are stories of resilience, compassion, and human connection that remind us of the good in the world.</p>
                    <p>Today's events, whatever their nature, offer opportunities for reflection, growth, and renewed commitment to our values.</p>
                    <blockquote>"And we know that in all things God works for the good of those who love him." — Romans 8:28</blockquote>
                    <p>As we navigate today's challenges, we can find peace knowing that hope endures and that every difficulty carries within it the seeds of positive change.</p>`,
  },
};
