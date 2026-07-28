/**
 * Scan engine for the News Scanner tool.
 *
 * Ports the original /public/scanner.html script logic 1:1, but expressed as
 * typed pure functions + a single orchestrating `runScan` generator-of-state.
 * All network access goes through `@/lib/api` (Bearer token auto-attached).
 *
 * Wired backend endpoints (Express, unchanged):
 *   - GET  /api/scanner/rss/:sourceId   -> { success, source, count, articles }
 *   - POST /api/scanner/download-image  -> { success, localPath, size, message }
 * Plus a same-origin HEAD verify against the returned localPath.
 */
import { api, ApiError } from '@/lib/api';
import {
  NEWS_SOURCES,
  REWRITE_TRANSFORMATIONS,
  SOURCE_WEIGHTS,
  STOCK_FALLBACK_IMAGES,
  STORY_CLUSTERS,
  type DownloadLogEntry,
  type NewsSource,
  type ProminenceScore,
  type RewriteTemplate,
  type ScannerStory,
  type StoryCluster,
} from './scannerData';

/** Shape of a single article returned by GET /api/scanner/rss/:source. */
interface RssArticle {
  title: string;
  link: string;
  description?: string;
  pubDate?: string;
  imageUrl?: string;
  position?: number;
  hasImage?: boolean;
}

interface RssResponse {
  success?: boolean;
  source?: string;
  count?: number;
  articles?: RssArticle[];
  error?: string;
}

interface DownloadImageResponse {
  success?: boolean;
  localPath?: string;
  size?: number;
  message?: string;
  error?: string;
}

interface DownloadResult {
  success: boolean;
  verified?: boolean;
  localPath?: string;
  size?: number;
  error?: string;
}

/** Progress reporter so the UI can mirror the original scanning overlay. */
export type ScanProgress = (text: string, subtext: string) => void;

export const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// ============================================================================
// SCORING + CLUSTERING (pure)
// ============================================================================

export function getSourceWeight(sourceId: string): number {
  return SOURCE_WEIGHTS[sourceId] ?? 3;
}

export function calculateProminenceScore(story: {
  position: number;
  hasImage: boolean;
  originalTitle: string;
  source: string;
}): ProminenceScore {
  const scores = {
    position: Math.max(0, 10 - (story.position - 1) * 2),
    hasImage: story.hasImage ? 5 : 0,
    titleLength:
      story.originalTitle.length > 50 ? 3 : story.originalTitle.length > 30 ? 5 : 2,
    sourceWeight: getSourceWeight(story.source),
    recency: 5,
  };

  const total = Object.values(scores).reduce((sum, val) => sum + val, 0);

  return {
    ...scores,
    total,
    normalized: Math.round((total / 30) * 100),
  };
}

export function identifyStoryCluster(title: string): StoryCluster {
  const titleLower = title.toLowerCase();
  let bestMatch: StoryCluster | null = null;
  let bestScore = 0;

  for (const [cluster, keywords] of Object.entries(STORY_CLUSTERS)) {
    let score = 0;
    for (const keyword of keywords) {
      if (titleLower.includes(keyword)) {
        score += keyword.length;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = cluster as StoryCluster;
    }
  }

  return bestMatch ?? 'general';
}

export function rewriteAsGoodNews(story: ScannerStory): RewriteTemplate {
  const cluster = story.storyCluster || 'general';
  return REWRITE_TRANSFORMATIONS[cluster] ?? REWRITE_TRANSFORMATIONS.general;
}

// ============================================================================
// NETWORK: RSS FETCH + IMAGE DOWNLOAD/VERIFY
// ============================================================================

async function fetchTopStory(source: NewsSource): Promise<Partial<ScannerStory> | null> {
  try {
    const data = await api.get<RssResponse>(`/api/scanner/rss/${source.id}`);

    if (!data.success || !data.articles || data.articles.length === 0) {
      return null;
    }

    const topArticle = data.articles[0];

    return {
      source: source.id,
      sourceName: source.name,
      sourceUrl: source.url,
      originalTitle: topArticle.title,
      originalUrl: topArticle.link,
      originalExcerpt: topArticle.description || '',
      position: topArticle.position || 1,
      hasImage: !!topArticle.imageUrl,
      imageUrl: topArticle.imageUrl || '',
      pubDate: topArticle.pubDate || '',
    };
  } catch {
    return null;
  }
}

async function downloadAndVerifyImage(
  imageUrl: string,
  sourceId: string,
): Promise<DownloadResult> {
  const filename = `${sourceId}_${Date.now()}`;

  try {
    const result = await api.post<DownloadImageResponse>('/api/scanner/download-image', {
      imageUrl,
      filename,
    });

    if (!result.success || !result.localPath) {
      return { success: false, error: result.message || 'Download failed' };
    }

    // Verify the image was actually saved + is reachable (same-origin HEAD).
    const verifyResponse = await fetch(result.localPath, { method: 'HEAD' });

    if (verifyResponse.ok) {
      return {
        success: true,
        verified: true,
        localPath: result.localPath,
        size: result.size,
      };
    }
    return { success: false, error: 'Verification failed - file not accessible' };
  } catch (error) {
    const message =
      error instanceof ApiError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Download failed';
    return { success: false, error: message };
  }
}

async function searchGoogleImage(sourceId: string): Promise<DownloadResult> {
  // Curated stock images as the Google fallback simulation (kept external).
  const randomImage =
    STOCK_FALLBACK_IMAGES[Math.floor(Math.random() * STOCK_FALLBACK_IMAGES.length)];
  try {
    return await downloadAndVerifyImage(randomImage, `google_${sourceId}`);
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Search failed' };
  }
}

// ============================================================================
// IMAGE CASCADE
// ============================================================================

function findMatchingStories(
  target: ScannerStory,
  all: ScannerStory[],
): ScannerStory[] {
  return all.filter(
    (story) => story.id !== target.id && story.storyCluster === target.storyCluster,
  );
}

async function downloadImageWithCascade(
  story: ScannerStory,
  all: ScannerStory[],
  onProgress: ScanProgress,
): Promise<boolean> {
  // Step 1: primary source.
  if (story.imageUrl) {
    onProgress('Acquiring article image...', `Downloading from ${story.sourceName}`);
    const primary = await downloadAndVerifyImage(story.imageUrl, story.source);
    if (primary.success && primary.verified) {
      story.downloadedImage = primary.localPath ?? null;
      story.imageStatus = 'success';
      story.imageSource = story.sourceName;
      story.imageDownloadLog.push({
        source: story.sourceName,
        status: 'success',
        message: `Downloaded ${primary.size} bytes`,
        path: primary.localPath,
      });
      return true;
    }
    story.imageDownloadLog.push({
      source: story.sourceName,
      status: 'failed',
      message: primary.error || 'Download failed',
    });
  } else {
    story.imageDownloadLog.push({
      source: story.sourceName,
      status: 'skipped',
      message: 'No image URL available',
    });
  }

  // Step 2: matching stories (same cluster) from other sources.
  const matchingStories = findMatchingStories(story, all);
  for (const matchStory of matchingStories) {
    if (!matchStory.imageUrl) {
      story.imageDownloadLog.push({
        source: matchStory.sourceName,
        status: 'skipped',
        message: 'No image URL available',
      });
      continue;
    }
    onProgress('Acquiring article image...', `Trying fallback: ${matchStory.sourceName}`);
    const fallback = await downloadAndVerifyImage(matchStory.imageUrl, matchStory.source);
    if (fallback.success && fallback.verified) {
      story.downloadedImage = fallback.localPath ?? null;
      story.imageStatus = 'success';
      story.imageSource = `${matchStory.sourceName} (fallback)`;
      story.imageDownloadLog.push({
        source: matchStory.sourceName,
        status: 'success',
        message: `Downloaded ${fallback.size} bytes (fallback)`,
        path: fallback.localPath,
      });
      return true;
    }
    story.imageDownloadLog.push({
      source: matchStory.sourceName,
      status: 'failed',
      message: fallback.error || 'Download failed',
    });
  }

  // Step 3: all remaining sources not yet tried.
  const triedSources = new Set<string>([
    story.source,
    ...matchingStories.map((s) => s.source),
  ]);
  const remainingSources = all.filter((s) => !triedSources.has(s.source));
  for (const remainingStory of remainingSources) {
    if (!remainingStory.imageUrl) {
      story.imageDownloadLog.push({
        source: remainingStory.sourceName,
        status: 'skipped',
        message: 'No image URL available',
      });
      continue;
    }
    onProgress(
      'Acquiring article image...',
      `Trying additional source: ${remainingStory.sourceName}`,
    );
    const result = await downloadAndVerifyImage(remainingStory.imageUrl, remainingStory.source);
    if (result.success && result.verified) {
      story.downloadedImage = result.localPath ?? null;
      story.imageStatus = 'success';
      story.imageSource = `${remainingStory.sourceName} (alternate)`;
      story.imageDownloadLog.push({
        source: remainingStory.sourceName,
        status: 'success',
        message: `Downloaded ${result.size} bytes (alternate)`,
        path: result.localPath,
      });
      return true;
    }
    story.imageDownloadLog.push({
      source: remainingStory.sourceName,
      status: 'failed',
      message: result.error || 'Download failed',
    });
  }

  // Step 4: Google Image search fallback.
  onProgress('Acquiring article image...', 'Searching Google Images as final fallback');
  const googleResult = await searchGoogleImage(story.source);
  if (googleResult.success && googleResult.verified) {
    story.downloadedImage = googleResult.localPath ?? null;
    story.imageStatus = 'success';
    story.imageSource = 'Google Images';
    story.imageDownloadLog.push({
      source: 'Google Images',
      status: 'success',
      message: `Downloaded ${googleResult.size} bytes`,
      path: googleResult.localPath,
    });
    return true;
  }
  story.imageDownloadLog.push({
    source: 'Google Images',
    status: 'failed',
    message: googleResult.error || 'Search/download failed',
  });

  // All attempts failed.
  story.imageStatus = 'failed';
  return false;
}

// ============================================================================
// ORCHESTRATION
// ============================================================================

let storyIdCounter = 0;
function nextStoryId(): string {
  storyIdCounter += 1;
  return `${Date.now()}-${storyIdCounter}`;
}

export interface RunScanResult {
  topStories: ScannerStory[];
}

/**
 * Run a full scan: fetch the top story from each source, score + cluster them,
 * select the top 3 by prominence, acquire an image via the cascade, and rewrite
 * each with a hopeful perspective. Mirrors the original `runScan()` exactly.
 */
export async function runScan(onProgress: ScanProgress): Promise<RunScanResult> {
  const allCollectedStories: ScannerStory[] = [];

  // Phase 1: fetch stories from all sources.
  for (const source of NEWS_SOURCES) {
    onProgress(`Scanning ${source.name}...`, 'Fetching top headlines and analyzing prominence');
    await delay(400 + Math.random() * 200);

    const partial = await fetchTopStory(source);
    if (partial && partial.originalTitle) {
      const story: ScannerStory = {
        id: nextStoryId(),
        source: partial.source ?? source.id,
        sourceName: partial.sourceName ?? source.name,
        sourceUrl: partial.sourceUrl ?? source.url,
        originalTitle: partial.originalTitle,
        originalUrl: partial.originalUrl ?? '',
        originalExcerpt: partial.originalExcerpt ?? '',
        position: partial.position ?? 1,
        hasImage: partial.hasImage ?? false,
        imageUrl: partial.imageUrl ?? '',
        pubDate: partial.pubDate ?? '',
        timestamp: new Date().toISOString(),
        score: calculateProminenceScore({
          position: partial.position ?? 1,
          hasImage: partial.hasImage ?? false,
          originalTitle: partial.originalTitle,
          source: partial.source ?? source.id,
        }),
        storyCluster: identifyStoryCluster(partial.originalTitle),
        imageStatus: 'pending',
        downloadedImage: null,
        imageDownloadLog: [],
      };
      allCollectedStories.push(story);
    }
  }

  // Phase 2: select the top 3 by prominence (no sentiment filtering).
  onProgress('Evaluating prominence scores...', 'Selecting the top 3 most prominent stories');
  await delay(300);

  allCollectedStories.sort((a, b) => b.score.normalized - a.score.normalized);
  const numStories = Math.min(3, allCollectedStories.length);
  const topStories = allCollectedStories.slice(0, numStories);

  // Phase 3: process each of the top 3 (image cascade + hopeful rewrite).
  for (let i = 0; i < topStories.length; i += 1) {
    const story = topStories[i];
    story.rank = i + 1;
    story.isTopStory = true;

    onProgress(
      `Acquiring image ${i + 1}/${numStories}...`,
      `Downloading from ${story.sourceName}`,
    );
    await downloadImageWithCascade(story, allCollectedStories, onProgress);

    onProgress(
      `Transforming story ${i + 1}/${numStories}...`,
      'Creating faith-inspired perspective',
    );
    await delay(200);

    const rewritten = rewriteAsGoodNews(story);
    story.rewrittenTitle = rewritten.title;
    story.rewrittenContent = rewritten.content;
  }

  return { topStories };
}

// ============================================================================
// SMALL UI HELPERS (shared by the page)
// ============================================================================

export function stripHtml(html: string): string {
  if (typeof document === 'undefined') {
    return html.replace(/<[^>]*>/g, '');
  }
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || '';
}

export function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}
