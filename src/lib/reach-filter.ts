import { Article, SourceReach } from '@/lib/feeds';

/** The selectable states — the two reaches, plus no filter at all. */
export type ReachFilter = 'all' | SourceReach;

/**
 * Labels for the coverage filter.
 *
 * "Beat" is the actual newsroom term for a reporter assigned to one team
 * full time, which is exactly what this bucket is: the metro paper's
 * writer, the team blog, the student paper. Deliberately not "minor" or
 * "small" — the Lincoln Journal Star is a real newsroom that happens to
 * cover one program, and calling that lesser would be both wrong and the
 * opposite of the point.
 */
export const REACH_FILTER_TABS: { key: ReachFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'national', label: 'National' },
  { key: 'beat', label: 'Beat' },
];

export function filterByReach<T extends Pick<Article, 'reach'>>(
  articles: T[],
  filter: ReachFilter,
): T[] {
  if (filter === 'all') return articles;
  return articles.filter((article) => article.reach === filter);
}
