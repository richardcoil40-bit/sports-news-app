import { Article } from '@/lib/feeds';
import { Team } from '@/lib/teams';
import { compileWordBoundary } from '@/lib/text-match';

/**
 * Which team an article is actually *about*.
 *
 * Not the same thing as which team's pool surfaced it, which is what the
 * feed previously tagged. A Michigan follower's pool legitimately contains
 * "Michigan State to hire W. Michigan AD" — it came up because MLive and
 * the national feeds cover the region — and tagging that MICHIGAN would be
 * actively wrong. The tag has to come from the headline, not the plumbing.
 *
 * ## The trap this exists to handle
 *
 * Team names nest. A word-boundary match for "Michigan" matches inside
 * "Michigan State", so naive matching tags every Spartans story MICHIGAN —
 * and in a conference containing Michigan/Michigan State, Ohio State/Ohio,
 * and Washington/Washington State, that is not an edge case. Candidates are
 * therefore matched **longest name first**, and the first match wins.
 */

interface CompiledTeam {
  team: Team;
  patterns: RegExp[];
}

/**
 * Compiled once per team list rather than per article. The list is ~18
 * teams and a feed is a few hundred articles; rebuilding these per
 * comparison is thousands of needless RegExp constructions.
 *
 * Sorted longest-name-first so "Michigan State" is tested before
 * "Michigan" and wins.
 */
export function compileTeamMatchers(teams: Team[]): CompiledTeam[] {
  return teams
    .map((team) => {
      // displayName ("Michigan State Spartans"), location ("Michigan
      // State") and shortName ("Michigan St") — all three, because feeds
      // use any of them and ESPN abbreviates the last one. Dropping
      // location is what tagged Spartans stories MICHIGAN: "Michigan St"
      // does not match the words "Michigan State".
      const names = [team.name, team.location, team.shortName]
        .filter((n): n is string => typeof n === 'string' && n.trim().length > 0)
        .sort((a, b) => b.length - a.length);
      return { team, patterns: names.map(compileWordBoundary) };
    })
    .sort((a, b) => {
      const longest = (c: CompiledTeam) =>
        Math.max(...[c.team.name, c.team.location, c.team.shortName].map((n) => n?.length ?? 0));
      return longest(b) - longest(a);
    });
}

/**
 * The team a headline names, or null.
 *
 * Reads the title first and only falls back to the teaser: a headline that
 * names a team is about that team, whereas a teaser mentioning one in
 * passing ("...ahead of the Ohio State game") often isn't. Checking the
 * title alone first is what stops a Michigan story being tagged with its
 * opponent.
 */
export function detectTeam(
  article: Pick<Article, 'title' | 'description'>,
  compiled: CompiledTeam[],
): Team | null {
  const title = typeof article.title === 'string' ? article.title : '';
  const description = typeof article.description === 'string' ? article.description : '';

  for (const haystack of [title, description]) {
    if (!haystack) continue;
    for (const { team, patterns } of compiled) {
      if (patterns.some((pattern) => pattern.test(haystack))) return team;
    }
  }

  return null;
}

/** An article with the team it names attached, computed once. */
export type Tagged<T> = T & { mentionedTeam: Team | null };

export function withTeamMentions<T extends Pick<Article, 'title' | 'description'>>(
  articles: T[],
  teams: Team[],
): Tagged<T>[] {
  const compiled = compileTeamMatchers(teams);
  return articles.map((article) => ({ ...article, mentionedTeam: detectTeam(article, compiled) }));
}
