import { FeedSource } from '@/lib/feeds';

/**
 * Independent/community team-specific RSS, layered on top of the general
 * ESPN/CBS/Yahoo pool. Most legacy SB Nation team blogs (Land-Grant Holy
 * Land, Maize n Brew, etc.) no longer expose a working public RSS feed —
 * checked directly, all came back empty. Eleven Warriors is a verified
 * working exception, so it's here as the Ohio State entry; the map is
 * keyed by team shortName so more can be dropped in per-team as their
 * feeds get verified, without touching any calling code.
 */
export const COMMUNITY_SOURCES: Record<string, FeedSource[]> = {
  'Ohio State': [
    { id: 'eleven-warriors', name: 'Eleven Warriors', url: 'https://www.elevenwarriors.com/rss.xml' },
  ],
};

export function communitySourcesForTeam(teamShortName: string): FeedSource[] {
  return COMMUNITY_SOURCES[teamShortName] ?? [];
}
