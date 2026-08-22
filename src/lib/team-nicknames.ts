import { createTeamReview, ReviewState } from '@/lib/team-review';
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
 * ## An empty list is a decision, not a gap
 *
 * A team is in the table or it isn't, and that is now the difference
 * between "researched, nothing here is unambiguous enough to use" and
 * "nobody has looked at this league yet". A key present with `[]` is the
 * first; an absent key is the second. See team-review.ts, and record the
 * why in NO_NICKNAME_REASONS below whenever the entry is empty.
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
 * ## Why one table across conferences, where sources need two
 *
 * community-sources.ts keeps a table per conference because a slug
 * collision there would serve one school another school's feeds. Here a
 * collision is harmless in the same way it is meaningless: the key is a
 * school, and a school has one set of nicknames whichever conference it
 * currently plays in. Realignment moves the source table's entries between
 * leagues; it doesn't change what Oklahoma is called.
 *
 * The contents are still research, exactly like community-sources.ts —
 * which is most of what a second conference cost.
 */
const NICKNAMES_BY_SLUG: Record<string, string[]> = {
  alabama: ['Crimson Tide', 'Bama'],
  // "Hogs" is what the Democrat-Gazette writes; the singular is left out
  // because an Arkansas paper also covers actual hog farming.
  arkansas: ['Razorback', 'Razorbacks', 'Hogs'],
  // "Tigers" is claimed by three schools in this conference alone —
  // Auburn, LSU and Missouri — plus Clemson and a baseball team in
  // Detroit. So none of the three gets it, and each falls back to the one
  // name nobody else uses. Auburn's is a yell rather than a nickname, and
  // its papers print it constantly.
  auburn: ['War Eagle'],
  florida: ['Gator', 'Gators'],
  // "Bulldogs" is Mississippi State's below and half of college sport's
  // besides; "Dawgs" is Georgia's own spelling and nobody else's.
  georgia: ['Dawg', 'Dawgs'],
  illinois: ['Illini', 'Fighting Illini'],
  indiana: ['Hoosier', 'Hoosiers'],
  iowa: ['Hawkeye', 'Hawkeyes'],
  kentucky: ['Wildcat', 'Wildcats'],
  // Reviewed and deliberately empty rather than missing — "Tigers" is the
  // three-way collision described above, and nothing else survives the
  // metro-sports-section rule. See NO_NICKNAME_REASONS.
  lsu: [],
  maryland: ['Terp', 'Terps', 'Terrapins'],
  michigan: ['Wolverine', 'Wolverines'],
  'michigan-state': ['Spartan', 'Spartans'],
  minnesota: ['Gopher', 'Gophers', 'Golden Gophers'],
  // Safe here and not for Georgia because the rule is about the source,
  // not the word: Mississippi State's only paper is in Starkville, where
  // the Bulldogs are one team.
  'mississippi-state': ['Bulldog', 'Bulldogs'],
  missouri: ['Mizzou'],
  nebraska: ['Husker', 'Huskers', 'Cornhuskers'],
  northwestern: ['Wildcat', 'Wildcats'],
  'ohio-state': ['Buckeye', 'Buckeyes'],
  oklahoma: ['Sooner', 'Sooners'],
  'ole-miss': ['Rebel', 'Rebels'],
  oregon: ['Duck', 'Ducks'],
  'penn-state': ['Nittany Lion', 'Nittany Lions'],
  purdue: ['Boilermaker', 'Boilermakers'],
  rutgers: ['Scarlet Knight', 'Scarlet Knights'],
  'south-carolina': ['Gamecock', 'Gamecocks'],
  // "Vol" on its own is left out — it is how a volume number abbreviates.
  tennessee: ['Vols', 'Volunteers'],
  texas: ['Longhorn', 'Longhorns', 'Horns'],
  'texas-am': ['Aggie', 'Aggies'],
  ucla: ['Bruin', 'Bruins'],
  usc: ['Trojan', 'Trojans'],
  vanderbilt: ['Commodore', 'Commodores', 'Vandy'],
  washington: ['Husky', 'Huskies'],
  wisconsin: ['Badger', 'Badgers'],
};

/**
 * Why a reviewed team has no nicknames. Required for every `[]` above —
 * without it the entry is indistinguishable from the absent key it was
 * added to stop being confused with.
 */
const NO_NICKNAME_REASONS: Record<string, string> = {
  lsu:
    '"Tigers" is Auburn, LSU and Missouri, so none of the three claims it, ' +
    'and unlike Auburn ("War Eagle") no second form has been verified ' +
    'against LSU\'s own papers. Unreachable either way: both LSU sources ' +
    'are scope: team, so the local-newsroom filter these names feed never ' +
    'runs on them.',
};

const nicknameReview = createTeamReview(NICKNAMES_BY_SLUG, NO_NICKNAME_REASONS);

/**
 * Whether anyone has ruled on this team's nicknames, and why the ruling
 * was "nothing" where it was. Distinct from `teamNicknamesFor` returning
 * `[]`, which is both states at once by design at the call sites.
 */
export function nicknameReviewFor(teamShortName: string): ReviewState {
  return nicknameReview.reviewFor(teamShortName);
}

/** Empty in a healthy table — see TeamReview.issues. */
export function nicknameReviewIssues(): string[] {
  return nicknameReview.issues();
}

/**
 * The nicknames for a team, or an empty list. Empty is a normal state, not
 * a failure — a league nobody has researched simply keeps matching on the
 * school name, which is what happened for every team before this existed.
 * Callers that need to tell "researched, nothing to add" from "nobody
 * looked" ask `nicknameReviewFor` instead; both are `[]` here on purpose,
 * because filtering headlines is the same job either way.
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
