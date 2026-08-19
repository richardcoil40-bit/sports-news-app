import { Article } from '@/lib/feeds';
import { wordBoundaryMatch } from '@/lib/text-match';

/**
 * The RSS pool (ESPN/CBS/Yahoo) covers all of FBS — there's no Big
 * Ten–only feed anywhere. This narrows it down to the conference by
 * checking whether an article names one of the current Big Ten teams,
 * matched on ESPN's short display name (e.g. "Ohio State", "UCLA").
 * Same honest-match approach as player-match.ts: no per-conference feed
 * exists, so text matching against the live team list is the only option.
 *
 * `teamNames` is any list of names, not necessarily school names — a
 * caller filtering a team's own local paper passes nicknames too, via
 * team-nicknames.ts. Whether a given name is specific enough to trust is
 * the caller's call, because it depends entirely on what it's matching
 * against; this function just asks whether the article says one of them.
 */
export function filterArticlesForTeams(articles: Article[], teamNames: string[]): Article[] {
  return articles.filter((article) =>
    teamNames.some((name) => wordBoundaryMatch(`${article.title} ${article.description}`, name)),
  );
}
