import { Article } from '@/lib/feeds';
import { wordBoundaryMatch } from '@/lib/text-match';

/**
 * The RSS pool (ESPN/CBS/Yahoo) covers all of FBS — there's no Big
 * Ten–only feed anywhere. This narrows it down to the conference by
 * checking whether an article names one of the current Big Ten teams,
 * matched on ESPN's short display name (e.g. "Ohio State", "UCLA").
 * Same honest-match approach as player-match.ts: no per-conference feed
 * exists, so text matching against the live team list is the only option.
 */
export function filterArticlesForTeams(articles: Article[], teamNames: string[]): Article[] {
  return articles.filter((article) =>
    teamNames.some((name) => wordBoundaryMatch(`${article.title} ${article.description}`, name)),
  );
}
