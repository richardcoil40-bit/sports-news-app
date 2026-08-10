import { Article } from '@/lib/feeds';

function wordBoundaryMatch(haystack: string, needle: string): boolean {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i').test(haystack);
}

/**
 * There's no per-player news feed anywhere (ESPN, CBS, Yahoo all lack one) —
 * this is the only honest option: find articles that happen to name the
 * player. Tries the full name first since it's the most precise signal;
 * falls back to a last-name-only match (skipped for short/common surnames,
 * to keep false positives down) so recognizable players still surface.
 */
export function matchArticlesForPlayer(
  articles: Article[],
  player: { fullName: string; lastName: string },
): Article[] {
  const fullNameMatches = articles.filter((a) =>
    wordBoundaryMatch(`${a.title} ${a.description}`, player.fullName),
  );
  if (fullNameMatches.length > 0) return fullNameMatches;

  if (player.lastName.length < 5) return [];

  return articles.filter((a) => wordBoundaryMatch(`${a.title} ${a.description}`, player.lastName));
}
