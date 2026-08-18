import { Article } from '@/lib/feeds';

/**
 * No free API exposes recruiting rankings/commitments (Rivals/247Sports/On3
 * recruiting data is proprietary). This narrows the combined news pool down
 * to recruiting-flavored coverage of a team by keyword, same honest-match
 * approach used elsewhere in the app.
 */
/**
 * Exported so program-moves.ts can reuse it rather than keeping a second
 * list of commitment words that drifts away from this one.
 */
export const RECRUITING_KEYWORDS = [
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
