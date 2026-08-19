import { teamSlug } from '@/lib/team-slug';

/**
 * What a team's own local paper calls it.
 *
 * ## The gap this closes
 *
 * The metro papers in community-sources.ts are `scope: 'broad'` — they
 * cover pro teams and other sports too, so team-news-pool.ts narrows them
 * to articles that name the team. Matched on ESPN's short name, that meant
 * the Lincoln Journal Star's coverage only counted when it wrote
 * "Nebraska". It mostly doesn't: it writes "Huskers", the way Cleveland.com
 * writes "Buckeye Talk" and the Daily Nebraskan writes "Husker Volleyball".
 * All of that was being dropped before it ever reached the feed.
 *
 * ## Why this is only used on local sources
 *
 * A nickname is unambiguous in its own city's paper and nowhere else.
 * "Wildcats" is Northwestern, Kentucky, Arizona and Kansas State;
 * "Huskies" is Washington, UConn and Northern Illinois; "Bruins" is UCLA
 * and an NHL team. In the Seattle Times, "Huskies" means exactly one of
 * those — which is why team-news-pool.ts passes these names only for the
 * local newsroom group, and leaves the national pool and ESPN's own feed
 * matching on the school name alone. That restriction is what makes the
 * ambiguous entries below safe; don't widen the callers without doing the
 * per-nickname disambiguation research first.
 *
 * ## What belongs in an entry
 *
 * The forms a headline actually uses, singular included — "Husker
 * football" and "Buckeye Breakfast" are as common as the plurals, and a
 * plural-only list misses them. Not derived from ESPN's display name,
 * which gives "Cornhuskers" (a word the paper rarely prints) and can't
 * produce "Huskers", "Illini" or "Terps" at all.
 *
 * Deliberately absent: the bare last word of a two-word nickname.
 * "Nittany Lions" is here and "Lions" is not — PennLive covers the Detroit
 * Lions, and Rutgers' "Scarlet Knights" shortens to a word UCF also uses.
 * The rule is that an entry has to survive being read in a metro sports
 * section that also covers pro teams.
 *
 * Big Ten only, exactly like community-sources.ts, and for the same
 * reason: the shape is league-agnostic, the contents are research.
 */
const NICKNAMES_BY_SLUG: Record<string, string[]> = {
  illinois: ['Illini', 'Fighting Illini'],
  indiana: ['Hoosier', 'Hoosiers'],
  iowa: ['Hawkeye', 'Hawkeyes'],
  maryland: ['Terp', 'Terps', 'Terrapins'],
  michigan: ['Wolverine', 'Wolverines'],
  'michigan-state': ['Spartan', 'Spartans'],
  minnesota: ['Gopher', 'Gophers', 'Golden Gophers'],
  nebraska: ['Husker', 'Huskers', 'Cornhuskers'],
  northwestern: ['Wildcat', 'Wildcats'],
  'ohio-state': ['Buckeye', 'Buckeyes'],
  oregon: ['Duck', 'Ducks'],
  'penn-state': ['Nittany Lion', 'Nittany Lions'],
  purdue: ['Boilermaker', 'Boilermakers'],
  rutgers: ['Scarlet Knight', 'Scarlet Knights'],
  ucla: ['Bruin', 'Bruins'],
  usc: ['Trojan', 'Trojans'],
  washington: ['Husky', 'Huskies'],
  wisconsin: ['Badger', 'Badgers'],
};

/**
 * The nicknames for a team, or an empty list. Empty is a normal state, not
 * a failure — a league nobody has researched simply keeps matching on the
 * school name, which is what happened for every team before this existed.
 */
export function teamNicknamesFor(teamShortName: string): string[] {
  return NICKNAMES_BY_SLUG[teamSlug(teamShortName)] ?? [];
}

/**
 * ESPN abbreviates "Michigan State" to "Michigan St", and a word-boundary
 * match for that abbreviation never fires on a headline writing the name
 * out — `\bMichigan St\b` fails against "Michigan State" because a letter
 * follows. So filtering MLive for "Michigan St" matched nothing at all,
 * which is the same abbreviation trap team-mentions.ts documents, hit from
 * the other side. That module has `location` to fall back on; the news
 * pool is only handed a short name, so the expansion happens here.
 */
function expandedSchoolName(teamShortName: string): string[] {
  return /\bSt$/.test(teamShortName) ? [`${teamShortName}ate`] : [];
}

/**
 * The school's own names — the short name plus any spelled-out form of it.
 * Unambiguous anywhere, so this is what the national pool and ESPN's feed
 * are filtered on.
 */
export function schoolNamesFor(teamShortName: string): string[] {
  return [teamShortName, ...expandedSchoolName(teamShortName)];
}

/**
 * Every name worth matching a team's *own* local paper against: the school
 * names, then its nicknames. Only for sources that cover this team's
 * region — see the note on ambiguity above.
 */
export function localNamesFor(teamShortName: string): string[] {
  return [...schoolNamesFor(teamShortName), ...teamNicknamesFor(teamShortName)];
}
