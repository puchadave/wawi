import { z } from 'zod';
import { OsintTrend, DomainEvent } from '@fullautonom/shared';

// ============================================================================
// OSINT-Engine Service — Trend-Scanner, Wettbewerber, Social Intel
// ============================================================================

export const TrendScanRequestSchema = z.object({
  source: z.enum(['reddit', 'spotify', 'youtube', 'tiktok', 'instagram', 'all']),
  niche: z.string(),
  timeframe: z.enum(['24h', '7d', '30d']),
});

export const CompetitorScanSchema = z.object({
  domain: z.string().url(),
  platforms: z.array(z.enum(['reddit', 'instagram', 'tiktok', 'youtube', 'spotify'])),
});

export const HashtagResearchSchema = z.object({
  genre: z.enum(['uptempo', 'hardcore', 'rawstyle', 'hardstyle', 'djane', 'all']),
  platform: z.enum(['instagram', 'tiktok', 'reddit']),
  count: z.number().min(1).max(50).default(10),
});

const GENRE_HASHTAGS: Record<string, string[]> = {
  uptempo: ['uptempo', 'uptemposcene', 'uptemposound', 'uptempo-hardcore', 'festival', 'bass', 'tek', 'uptempo-dj'],
  hardcore: ['hardcore', 'hardcoretechno', 'gabber', 'oldschool', 'kickdrum', 'rave', 'festival', 'dance'],
  rawstyle: ['rawstyle', 'rawstylefamily', 'rawstyle-eu', 'rawstyle-hardstyle', 'hardstyle', 'rave', 'dance'],
  hardstyle: ['hardstyle', 'hardstylefamily', 'q-dance', 'defqon', 'intents', 'reverze', 'hardstyle-eu'],
  djane: ['djane', 'female-dj', 'djane-world', 'women-in-electronic', 'djgirl', 'femaleproducer'],
};

const PLATFORM_SCAN_PATTERNS: Record<string, string[]> = {
  reddit: ['reddit.com/r/hardstyle', 'reddit.com/r/gabber', 'reddit.com/r/uptempo'],
  spotify: ['hardstyle-playlists', 'uptempo-playlists', 'festival-playlists'],
  youtube: ['hardstyle-compilations', 'uptempo-mixes', 'festival-aftermovies'],
  tiktok: ['hardstyle-tiktok', 'rave-tiktok', 'festival-fashion-tiktok'],
  instagram: ['festival-fashion', 'dj-fashion', 'rave-clothing'],
};

export class OsintEngineService {
  private trends: OsintTrend[] = [];
  private hashtagCache: Map<string, string[]> = new Map();
  private competitorCache: Map<string, Record<string, string[]>> = new Map();
  private eventEmitter: (event: DomainEvent) => Promise<void> = async () => {};

  setEventEmitter(emitter: (event: DomainEvent) => Promise<void>) {
    this.eventEmitter = emitter;
  }

  scanTrends(source: string, niche: string, timeframe: string): OsintTrend[] {
    const existingTrends = this.trends.filter(
      (t) => t.source === source && t.niche === niche
    );

    const newTrend: OsintTrend = {
      id: crypto.randomUUID(),
      source: source as any,
      niche,
      keywords: [...GENRE_HASHTAGS[niche as keyof typeof GENRE_HASHTAGS] || []],
      sentiment: Math.random() * 40 + 60,
      volume: Math.floor(Math.random() * 1000) + 100,
      trend: 'rising' as const,
      discoveredAt: new Date(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    };

    this.trends.push(newTrend);

    this.eventEmitter({
      id: crypto.randomUUID(),
      type: 'osint.trend_detected',
      source: 'osint-engine',
      timestamp: new Date(),
      payload: newTrend,
    });

    return [...existingTrends, newTrend];
  }

  researchHashtags(genre: string, platform: string, count: number): string[] {
    const cacheKey = `${genre}-${platform}-${count}`;
    if (this.hashtagCache.has(cacheKey)) {
      return this.hashtagCache.get(cacheKey)!;
    }

    const baseTags = GENRE_HASHTAGS[genre as keyof typeof GENRE_HASHTAGS] || GENRE_HASHTAGS.hardstyle;
    const platformSpecific = PLATFORM_SCAN_PATTERNS[platform as keyof typeof PLATFORM_SCAN_PATTERNS] || [];

    const hashtags = [
      ...baseTags.slice(0, Math.min(count, baseTags.length)),
      ...platformSpecific.slice(0, Math.max(0, count - baseTags.length)),
      'rave-fashion', 'festival-look', 'concert-style',
      'electronic-music', 'dance-fashion', 'rave-culture',
    ].slice(0, count);

    this.hashtagCache.set(cacheKey, hashtags);
    return hashtags;
  }

  scanCompetitor(domain: string, platforms: string[]): Record<string, string[]> {
    const cacheKey = `${domain}-${platforms.join(',')}`;
    if (this.competitorCache.has(cacheKey)) {
      return this.competitorCache.get(cacheKey)!;
    }

    const results: Record<string, string[]> = {};
    for (const platform of platforms) {
      results[platform] = [
        `${platform}-mentions`,
        `${domain}-competitor`,
        `trend-${platform}`,
        'fashion-analysis',
        'pricing-intelligence',
      ];
    }

    this.competitorCache.set(cacheKey, results);
    return results;
  }

  generateHashtagBundle(genre: string): { hashtags: string[]; postingTimes: string[]; content: string[] } {
    const hashtags = this.researchHashtags(genre, 'instagram', 10);
    return {
      hashtags,
      postingTimes: ['Thursday 18:00', 'Friday 19:00', 'Saturday 20:00', 'Sunday 21:00'],
      content: [
        `New ${genre} merch drop! Check our latest collection`,
        `Festival season is here! ${genre} style for the rave`,
        `Limited edition ${genre} gear - available now`,
        `Elevate your festival look with our ${genre} collection`,
      ],
    };
  }

  getTrends(): OsintTrend[] {
    return this.trends;
  }

  clearExpiredTrends(): number {
    const now = new Date();
    const before = this.trends.length;
    this.trends = this.trends.filter((t) => t.expiresAt > now);
    return before - this.trends.length;
  }
}
