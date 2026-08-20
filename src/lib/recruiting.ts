import { Article } from '@/lib/feeds';

/**
 * Parked, deliberately — nothing imports this today.
 *
 * The Recruiting tab was removed from the team screen in the navigation
 * redesign: it was this keyword filter over the same article pool the News
 * tab already shows, and "recruiting" doesn't generalise to a league where
 * players are drafted rather than signed. The filter itself is still sound
 * for college specifically, so it is kept rather than deleted, against the
 * repo's usual rule about unreferenced code. Wire it back to a college-only
 * surface, or delete it — but don't delete it as merely unused.
 *
 * No free API exposes recruiting rankings/commitments (Rivals/247Sports/On3
 * recruiting data is proprietary). This narrows the combined news pool down
 * to recruiting-flavored coverage of a team by keyword, same honest-match
 * approach used elsewhere in the app.
 */
const RECRUITING_KEYWORDS = [
  'recruit',
  'recruiting',
  'commit',
  'commits',
  'commitment',
  'decommit',
  'decommits',
  'decommitment',
  'signee',
  'signing day',
  'signing class',
  'flips',
  'flipped',
  'flip to',
  'pledge',
  'four-star',
  '4-star',
  'five-star',
  '5-star',
  'three-star',
  '3-star',
  'transfer portal',
  'nil deal',
];

function mentionsRecruiting(text: string): boolean {
  const lower = text.toLowerCase();
  return RECRUITING_KEYWORDS.some((keyword) => lower.includes(keyword));
}

export function filterRecruitingArticles<T extends Pick<Article, 'title' | 'description'>>(
  articles: T[],
): T[] {
  return articles.filter((a) => mentionsRecruiting(`${a.title} ${a.description}`));
}
