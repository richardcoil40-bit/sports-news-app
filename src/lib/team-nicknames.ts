import { createTeamReview, type ReviewState } from '@/lib/team-review';
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
  // The fourth school in the table to claim it, after Kentucky,
  // Northwestern and Kansas State. Safe for the reason all four are: the
  // Arizona Daily Star covers one Wildcats team, and no two of the four
  // share a paper.
  arizona: ['Wildcat', 'Wildcats'],
  // Recorded although nothing can reach them: ASU has no working feed at
  // all (see NO_SOURCE_REASONS). Unambiguous and free to carry until one
  // turns up. Bare "Devils" is left out — New Jersey and Duke.
  'arizona-state': ['Sun Devil', 'Sun Devils'],
  // "Hogs" is what the Democrat-Gazette writes; the singular is left out
  // because an Arkansas paper also covers actual hog farming.
  arkansas: ['Razorback', 'Razorbacks', 'Hogs'],
  // "Tigers" is claimed by three schools in this conference alone —
  // Auburn, LSU and Missouri — plus Clemson and a baseball team in
  // Detroit. So none of the three gets it, and each falls back to the one
  // name nobody else uses. Auburn's is a yell rather than a nickname, and
  // its papers print it constantly.
  auburn: ['War Eagle'],
  baylor: [],
  // Shared with Houston below, and safe by circumstance rather than by
  // the word: BYU has no broad-scoped source, so these never run.
  byu: ['Cougar', 'Cougars'],
  cincinnati: ['Bearcat', 'Bearcats'],
  // "Buffalo" singular is out — a city and a pro team before a mascot.
  colorado: ['Buffs', 'Buffaloes'],
  florida: ['Gator', 'Gators'],
  // "Bulldogs" is Mississippi State's below and half of college sport's
  // besides; "Dawgs" is Georgia's own spelling and nobody else's.
  georgia: ['Dawg', 'Dawgs'],
  // "Coogs" is the local short form and belongs to nobody else.
  houston: ['Coogs', 'Cougar', 'Cougars'],
  illinois: ['Illini', 'Fighting Illini'],
  indiana: ['Hoosier', 'Hoosiers'],
  iowa: ['Hawkeye', 'Hawkeyes'],
  // "Clones" is out — an ordinary noun.
  'iowa-state': ['Cyclone', 'Cyclones'],
  // "Hawks" is out — Atlanta, Chicago's hockey team, and Iowa.
  kansas: ['Jayhawk', 'Jayhawks'],
  // "K-State" is what the Manhattan Mercury prints and is not reachable
  // from ESPN's "Kansas St" by the -St expansion, which only produces
  // "Kansas State".
  'kansas-state': ['K-State', 'Wildcat', 'Wildcats'],
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
  'oklahoma-state': [],
  'ole-miss': ['Rebel', 'Rebels'],
  oregon: ['Duck', 'Ducks'],
  'penn-state': ['Nittany Lion', 'Nittany Lions'],
  purdue: ['Boilermaker', 'Boilermakers'],
  rutgers: ['Scarlet Knight', 'Scarlet Knights'],
  'south-carolina': ['Gamecock', 'Gamecocks'],
  // Bare "Frogs" is out — an ordinary noun.
  tcu: ['Horned Frog', 'Horned Frogs'],
  // "Vol" on its own is left out — it is how a volume number abbreviates.
  tennessee: ['Vols', 'Volunteers'],
  texas: ['Longhorn', 'Longhorns', 'Horns'],
  'texas-am': ['Aggie', 'Aggies'],
  // Only the two-word form: bare "Raiders" is reserved to Las Vegas.
  'texas-tech': ['Red Raider', 'Red Raiders'],
  ucf: [],
  ucla: ['Bruin', 'Bruins'],
  usc: ['Trojan', 'Trojans'],
  utah: ['Ute', 'Utes'],
  vanderbilt: ['Commodore', 'Commodores', 'Vandy'],
  washington: ['Husky', 'Huskies'],
  // Appalachian State is also the Mountaineers and shares none of West
  // Virginia's three sources.
  'west-virginia': ['Mountaineer', 'Mountaineers'],
  wisconsin: ['Badger', 'Badgers'],

  /**
   * ## Professional teams, keyed by franchise
   *
   * The same table as the schools above, for the reason argued there: the
   * key is the thing that owns the names, and a franchise keeps its mascot
   * across a relocation the way a school keeps its across realignment.
   *
   * What differs is that nearly every entry here is deliberately empty, for
   * one reason rather than twenty-nine. ESPN's short name for a pro
   * franchise *is* the mascot — "Chiefs", not "Kansas City" — so
   * `schoolNamesFor` already matches the word a headline prints, and the
   * gap this table exists to close has nothing to close. The three
   * exceptions are contractions a word-boundary match on the short name
   * cannot reach: `\bJaguars\b` never fires on "Jags".
   *
   * None of these can fire yet. Nicknames are only matched against a team's
   * own `scope: 'broad'` sources and the NFL has no table in
   * community-sources.ts, so every entry here is unreachable — which is
   * why what was *rejected* is recorded in NO_NICKNAME_REASONS rather than
   * argued once here. The day a metro paper is added for one of these
   * teams, that reasoning is what the reviewer needs and cannot re-derive.
   *
   * **A pro slug is a mascot, and mascots repeat across sports.** These 32
   * are unique among themselves and collide with no school, but 'cardinals'
   * is Arizona here and St. Louis in baseball, and 'giants', 'jets',
   * 'panthers', 'kings' and 'rangers' all split the same way. So one table
   * holds one professional league and cannot hold two: a second needs the
   * key qualified by league. That is off-sport.ts's "a school is not a
   * team" arriving from the other end — there one source covers a school
   * across many sports, here one word covers many teams — and it is the
   * decision to make before a second pro league, not during.
   */
  '49ers': ['Niners'],
  bears: [],
  bengals: [],
  bills: [],
  broncos: [],
  browns: [],
  buccaneers: [],
  cardinals: [],
  chargers: [],
  chiefs: [],
  colts: [],
  commanders: [],
  cowboys: [],
  dolphins: [],
  eagles: [],
  falcons: [],
  giants: [],
  jaguars: ['Jags'],
  jets: [],
  lions: [],
  packers: [],
  panthers: [],
  patriots: ['Pats'],
  raiders: [],
  rams: [],
  ravens: [],
  saints: [],
  seahawks: [],
  steelers: [],
  texans: [],
  titans: [],
  vikings: [],
};

/**
 * The finding that covers a whole professional league, named once and
 * composed into each entry rather than restated twenty-nine times. The same
 * shape community-sources.ts uses for a dead newspaper chain, and for the
 * same reason: the next pro league should read the finding rather than
 * spend an afternoon rediscovering it.
 */
const PRO_MASCOT_IS_THE_SHORT_NAME =
  "ESPN's short name for a pro franchise is the mascot itself, so " +
  'schoolNamesFor already matches the word a headline prints — there is no ' +
  'second form the way "Huskers" is a second form of "Cornhuskers".';

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

  baylor:
    '"Bears" is reserved to Chicago — the entry RESERVED_NICKNAMES already ' +
    'wrote with Baylor in mind. Nothing else survives the metro-sports-' +
    'section rule: "BU" is Boston University first. The Waco ' +
    'Tribune-Herald carries the program on the school name alone.',
  'oklahoma-state':
    '"Cowboys" is reserved to Dallas, which is a word that only became ' +
    'unavailable when the NFL shipped — the first time a pro roster took ' +
    'a name off a college team. "Pokes" is Wyoming too, and a verb ' +
    'besides; "OSU" is three schools. Cowboys Ride For Free is gone, so ' +
    'two live papers carry the program on the school name.',
  ucf:
    '"Knights" is reserved, and RESERVED_NICKNAMES names UCF itself in ' +
    'the reason — Rutgers\' "Scarlet Knights" shortens to it and Vegas ' +
    'has a hockey team. A word reserved because of this team is still ' +
    'reserved to it, since ownership is only ever established by a pro ' +
    'roster. No loss: "UCF" is the short name and is unambiguous.',

  bears:
    PRO_MASCOT_IS_THE_SHORT_NAME +
    ' "Bears" is this team\'s own short name, and already reserved to ' +
    'Chicago.',
  bengals: PRO_MASCOT_IS_THE_SHORT_NAME,
  bills:
    PRO_MASCOT_IS_THE_SHORT_NAME +
    ' "Bills" doubles as an ordinary noun. That costs nothing while ' +
    'the name only runs against ESPN\'s own team feed, and wants ' +
    're-reading the day a broad source is added here.',
  broncos: PRO_MASCOT_IS_THE_SHORT_NAME,
  browns:
    PRO_MASCOT_IS_THE_SHORT_NAME +
    ' "Browns" doubles as a surname — the same caveat as Buffalo.',
  buccaneers:
    PRO_MASCOT_IS_THE_SHORT_NAME +
    ' "Bucs" rejected: Pittsburgh\'s baseball team has answered to it ' +
    'longer.',
  cardinals:
    PRO_MASCOT_IS_THE_SHORT_NAME +
    ' "Cards" rejected: St. Louis and Louisville both claim it, ' +
    'which is also why "Cardinals" is reserved.',
  chargers:
    PRO_MASCOT_IS_THE_SHORT_NAME +
    ' "Bolts" rejected: Tampa Bay\'s hockey team.',
  chiefs: PRO_MASCOT_IS_THE_SHORT_NAME,
  colts: PRO_MASCOT_IS_THE_SHORT_NAME,
  commanders:
    PRO_MASCOT_IS_THE_SHORT_NAME +
    ' The franchise\'s retired name is deliberately not carried. It ' +
    'is a slur, and matching on it would surface what is written ' +
    'about the name rather than coverage of the team.',
  cowboys:
    PRO_MASCOT_IS_THE_SHORT_NAME +
    ' "\'Boys" rejected: a sports section prints "boys" literally, ' +
    'and Oklahoma State is also the Cowboys.',
  dolphins:
    PRO_MASCOT_IS_THE_SHORT_NAME +
    ' "Fins" rejected: too thin to carry a word-boundary match on ' +
    'its own.',
  eagles:
    PRO_MASCOT_IS_THE_SHORT_NAME +
    ' "Birds" rejected: Baltimore and Philadelphia are both the ' +
    'Birds in their own papers. "Eagles" is already reserved.',
  falcons: PRO_MASCOT_IS_THE_SHORT_NAME,
  giants:
    PRO_MASCOT_IS_THE_SHORT_NAME +
    ' "G-Men" rejected: it reads as federal agents anywhere but a ' +
    'sports page. "Giants" is already reserved to New York and San ' +
    'Francisco both.',
  jets:
    PRO_MASCOT_IS_THE_SHORT_NAME +
    ' "Jets" is already reserved — Winnipeg\'s hockey team, and a ' +
    'word a sports section uses literally.',
  lions:
    PRO_MASCOT_IS_THE_SHORT_NAME +
    ' "Lions" is already reserved, which is what keeps it out of ' +
    'Penn State\'s entry. Here it is Detroit\'s own short name.',
  packers:
    PRO_MASCOT_IS_THE_SHORT_NAME +
    ' "Pack" rejected: NC State\'s Wolfpack, and an ordinary noun ' +
    'besides.',
  panthers:
    PRO_MASCOT_IS_THE_SHORT_NAME +
    ' "Panthers" is already reserved — Florida\'s hockey team, and ' +
    'Pitt.',
  raiders: PRO_MASCOT_IS_THE_SHORT_NAME,
  rams: PRO_MASCOT_IS_THE_SHORT_NAME,
  ravens: PRO_MASCOT_IS_THE_SHORT_NAME,
  saints: PRO_MASCOT_IS_THE_SHORT_NAME,
  seahawks:
    PRO_MASCOT_IS_THE_SHORT_NAME +
    ' "Hawks" rejected: Atlanta, Chicago\'s hockey team, and Iowa\'s ' +
    'Hawkeyes.',
  steelers: PRO_MASCOT_IS_THE_SHORT_NAME,
  texans: PRO_MASCOT_IS_THE_SHORT_NAME,
  titans: PRO_MASCOT_IS_THE_SHORT_NAME,
  vikings:
    PRO_MASCOT_IS_THE_SHORT_NAME +
    ' "Vikes" rejected: too thin to carry a word-boundary match on ' +
    'its own.',
};

/**
 * The table as data, for the review gate and scripts/review/propose.mjs.
 *
 * `teamNicknamesFor` answers one team at a time, which is all the app ever
 * needs. Deciding whether a *new* nickname is safe is a question about the
 * whole table — who else already claims that word — so the reviewer needs
 * to read across it. Read-only: the research is edited above, in the entry
 * that carries its reasoning, never through this handle.
 */
export const CURATED_NICKNAMES: Readonly<Record<string, readonly string[]>> = NICKNAMES_BY_SLUG;

/**
 * Words no team may claim, whatever its mascot is, and why.
 *
 * These are the failures of the metro-sports-section rule stated at the top
 * of this file: a word that a paper covering this team also prints about
 * somebody else. Almost all of them are professional teams, and that is not
 * a coincidence — it is the one collision a *region* cannot resolve. Two
 * schools can share "Bulldogs" safely as long as each is matched only
 * against its own city's paper, because no Starkville paper is covering
 * Georgia. Every metro sports section in the country covers the NFL.
 *
 * That asymmetry is the whole rule: **a college mascot collision is decided
 * by the sources, a professional one is decided by the word.** See
 * nickname-safety.ts, which is where both halves are enforced.
 *
 * Moved here from team-nicknames.test.ts, which is where it was first
 * written. A test can only say a bad word already got in; the reviewer
 * choosing between candidates needs to be told before they paste it, and
 * the list is research either way.
 */
export const RESERVED_NICKNAMES: Readonly<Record<string, string>> = {
  Lions: 'Detroit — PennLive covers both them and Penn State',
  Knights: 'UCF, and what Rutgers\' "Scarlet Knights" shortens to',
  Cardinals: 'Arizona and St. Louis, before any of the three colleges',
  Eagles: 'Philadelphia, and a mascot roughly seventy schools share',
  Tigers: 'Detroit, plus Auburn, LSU, Missouri and Clemson',
  Giants: 'New York and San Francisco',
  Panthers: 'Carolina and Florida, plus Pitt',
  Bears: 'Chicago — and Baylor, in a state with two SEC programs',
  Jets: 'New York, and a word a sports section uses literally',
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
