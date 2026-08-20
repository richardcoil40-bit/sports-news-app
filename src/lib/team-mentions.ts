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
      // Global, because detectTeams masks each name it finds rather than
      // just testing for it — see the nesting note there.
      return { team, patterns: names.map((n) => compileWordBoundary(n, 'gi')) };
    })
    .sort((a, b) => {
      const longest = (c: CompiledTeam) =>
        Math.max(...[c.team.name, c.team.location, c.team.shortName].map((n) => n?.length ?? 0));
      return longest(b) - longest(a);
    });
}

/**
 * Every team named, split by where it was named: title first, then teaser,
 * longest name first within each. Kept separate because the two carry
 * different weight — see detectTeam — and flattened by detectTeams for
 * callers that don't care.
 *
 * Each name found is masked out of the text before shorter ones are tried,
 * which is what keeps nesting honest in both directions. Testing alone
 * would tag "Michigan State beats Purdue" as naming Michigan too; masking
 * only the first occurrence would miss the Michigan in "Michigan State
 * beats Michigan". So every occurrence of a matched name is blanked, and
 * whatever still matches afterwards was genuinely named on its own.
 */
function namedTeams(
  article: Pick<Article, 'title' | 'description'>,
  compiled: CompiledTeam[],
): { inTitle: Team[]; inDescription: Team[] } {
  const title = typeof article.title === 'string' ? article.title : '';
  const description = typeof article.description === 'string' ? article.description : '';

  const groups: Team[][] = [];
  const seen = new Set<Team>();

  for (const haystack of [title, description]) {
    const found: Team[] = [];
    groups.push(found);
    if (!haystack) continue;

    // Masked as this loop goes, so each team is matched against what the
    // longer names before it didn't already claim.
    let remaining = haystack;
    for (const { team, patterns } of compiled) {
      let named = false;
      for (const pattern of patterns) {
        const masked = remaining.replace(pattern, (match) => ' '.repeat(match.length));
        if (masked === remaining) continue;
        remaining = masked;
        named = true;
      }
      if (named && !seen.has(team)) {
        seen.add(team);
        found.push(team);
      }
    }
  }

  return { inTitle: groups[0], inDescription: groups[1] };
}

/** Every team an article names, title matches first. */
export function detectTeams(
  article: Pick<Article, 'title' | 'description'>,
  compiled: CompiledTeam[],
): Team[] {
  const { inTitle, inDescription } = namedTeams(article, compiled);
  return [...inTitle, ...inDescription];
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
  return detectTeams(article, compiled)[0] ?? null;
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

/**
 * Tags each article with the team it's about.
 *
 * `preferred` decides which one wins when a story names more than one, and
 * exists for the home feed: a Nebraska follower's "Nebraska vs. Michigan
 * State preview" names both, and longest-name-first would credit it to
 * Michigan State — which then reads as someone else's story sitting in your
 * feed, and gets dropped outright by filterToTeams below. Crediting it to
 * the team you actually follow is both the truer tag and what keeps it in
 * the feed. Screens with no such vantage point (the team screen, which
 * tags a single team's pool against the whole league) pass nothing and get
 * plain longest-first order.
 */
export function withTeamMentions<T extends Taggable>(
  articles: T[],
  teams: Team[],
  preferred: Team[] = [],
): Tagged<T>[] {
  const compiled = compileTeamMatchers(teams);
  const byKey = new Map(teams.map((team) => [teamKey(team.leagueId, team.id), team]));
  const preferredKeys = new Set(preferred.map((team) => teamKey(team.leagueId, team.id)));

  // Preference applies *within* a haystack, never across one: a team named
  // in the title outranks a followed team mentioned in the teaser, because
  // that's the same reason detectTeam reads the title first at all. A
  // ranking piece on Ohio State doesn't become a Michigan story by
  // mentioning Michigan in its second sentence.
  const pick = (named: Team[]): Team | undefined =>
    named.find((team) => preferredKeys.has(teamKey(team.leagueId, team.id))) ?? named[0];

  return articles.map((article) => {
    const { inTitle, inDescription } = namedTeams(article, compiled);
    return {
      ...article,
      mentionedTeam: pick(inTitle) ?? pick(inDescription) ?? sourceTeam(article, byKey),
    };
  });
}

/**
 * Drops articles that are about a team outside `teams`.
 *
 * The home feed needs this because a team's news pool is assembled from
 * that team's *sources*, and a team-scoped source is taken wholesale — so
 * Corn Nation's "Michigan State Spartans 2026 Football Preview" arrives in
 * a Nebraska follower's pool tagged MICHIGAN ST, correctly, and then sat
 * there. "Came from a followed team's source" and "is about a followed
 * team" are different questions, and only the second one is what the feed
 * claims to answer.
 *
 * An untagged article is kept, not dropped. Null means no team name was
 * found anywhere in it, which for everything but a team-scoped source
 * means it got into the pool by matching something this module doesn't
 * read — most often a nickname, since the local paper is filtered on
 * "Huskers" as well as "Nebraska" (see team-nicknames.ts). Those are the
 * followed team's own stories; dropping them would quietly delete the
 * local beat writer from the feed.
 */
export function filterToTeams<T extends { mentionedTeam: Team | null }>(
  articles: T[],
  teams: Team[],
): T[] {
  const keys = new Set(teams.map((team) => teamKey(team.leagueId, team.id)));
  return articles.filter(
    (article) =>
      !article.mentionedTeam ||
      keys.has(teamKey(article.mentionedTeam.leagueId, article.mentionedTeam.id)),
  );
}
