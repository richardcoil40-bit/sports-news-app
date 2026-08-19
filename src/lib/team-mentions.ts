import { Article, SourceScope } from '@/lib/feeds';
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
 *
 * ## The one case the headline can't answer
 *
 * A team site writes for people who already know whose site they're on, so
 * it never says the school's name: Corn Nation runs "Corn Flakes: Huskers
 * vs. Texas in Primetime" and Land-Grant Holy Land runs "Ohio State is No.
 * 1 in the AP poll". Only the second gets a tag from the headline, so the
 * feed showed Nebraska stories bare next to tagged Ohio State ones — an
 * inconsistency that reads like a bug because it is one.
 *
 * Nicknames don't fix this ("Huskers" is not derivable from "Nebraska
 * Cornhuskers", and "Wildcats" is three different schools). Provenance
 * does: a `scope: 'team'` source publishes about exactly one team, which is
 * the same fact team-news-pool.ts already relies on when it takes those
 * feeds wholesale. So when the headline names nobody, the surfacing team
 * is used — and only then, so a team site writing about a rival is still
 * tagged with the rival it named.
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

/**
 * What tagging needs off an article: the text to read, plus the provenance
 * fallback. Both provenance fields are optional — a caller that has no
 * per-team pool (a plain feed) simply gets headline matching.
 */
export type Taggable = Pick<Article, 'title' | 'description'> & {
  /** The feed's scope. Only 'team' licenses the fallback below. */
  scope?: SourceScope;
  /**
   * The team whose pool surfaced it, as carried by multi-team-feed. Both
   * halves are required to resolve one, because an ESPN id is unique only
   * within a sport — the same reason espnCacheKey exists. A caller that
   * supplies neither simply gets headline matching.
   */
  teamId?: string;
  leagueId?: string;
};

const teamKey = (leagueId: string, teamId: string) => `${leagueId}:${teamId}`;

/**
 * The team a team-scoped source is by definition about, or null. Kept out
 * of detectTeam so that function stays a pure headline reader.
 */
function sourceTeam(article: Taggable, byKey: Map<string, Team>): Team | null {
  if (article.scope !== 'team' || !article.teamId || !article.leagueId) return null;
  return byKey.get(teamKey(article.leagueId, article.teamId)) ?? null;
}

/** An article with the team it names attached, computed once. */
export type Tagged<T> = T & { mentionedTeam: Team | null };

export function withTeamMentions<T extends Taggable>(articles: T[], teams: Team[]): Tagged<T>[] {
  const compiled = compileTeamMatchers(teams);
  const byKey = new Map(teams.map((team) => [teamKey(team.leagueId, team.id), team]));
  return articles.map((article) => ({
    ...article,
    mentionedTeam: detectTeam(article, compiled) ?? sourceTeam(article, byKey),
  }));
}
