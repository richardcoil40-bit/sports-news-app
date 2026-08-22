import { FeedSource } from '@/lib/feeds';
import { createTeamReview, ReviewState } from '@/lib/team-review';
import { teamSlug } from '@/lib/team-slug';

/**
 * Per-team sources beyond the national pool. Every URL here was verified to
 * return real items by scripts/check-feeds.sh — nothing is added on the
 * assumption that a feed "should" exist. Tiers follow the criteria in
 * docs/source-reliability.md.
 *
 * One table per conference, each keyed by slug through team-slug.ts. The
 * *shape* is league-agnostic and the contents are research — which is the
 * whole reason a second conference took a day of verifying URLs and about
 * ten lines of code.
 *
 * ## Big Ten
 *
 * Two gaps are deliberate rather than oversights:
 *
 * - UCLA and USC have no SB Nation blog. Vox shut down its California team
 *   sites after AB5 (the state's freelancer law) made the contributor model
 *   unworkable there. The LA Times sports feed covers both programs instead.
 *
 * - Iowa, Indiana, and Purdue have no local newsroom feed. Their metro papers
 *   are Gannett (Des Moines Register, Indianapolis Star), and Gannett appears
 *   to have retired RSS entirely — every documented path returns 200 with an
 *   empty body. Chicago Tribune and Baltimore Sun (Illinois/Northwestern and
 *   Maryland) return 403 to any programmatic request. Neither is a wrong-URL
 *   problem, so those programs run on their SB Nation blog alone for now.
 *
 * ## Present-with-nothing vs. absent
 *
 * A team key in either table means someone ruled on that team; an absent
 * key means nobody has looked. `[]` is therefore a decision, and needs a
 * line in that league's reasons table below saying what was ruled out.
 * See team-review.ts. Both tables happen to be complete for the teams
 * these two leagues ship, so the reasons tables carry the *partial* cases
 * instead — a team that has a blog but no reachable metro paper — which is
 * where the ownership research above stops being re-done once per team.
 */

/**
 * Chain-level rulings, in one place because the failures come in matched
 * pairs: a paper is dead because its owner retired or blocked RSS, not
 * because its URL is wrong. The per-team reasons below compose these, so
 * the next league that runs into Gannett reads the finding rather than
 * spending an afternoon rediscovering it. Full write-ups, with the paths
 * that were tried, in docs/source-reliability.md.
 */
const GANNETT =
  'Gannett has retired RSS: every documented path returns 200 with an ' +
  'empty body, which is a shut-off feature rather than a wrong URL';
const TRIBUNE =
  'Tribune returns HTTP 403 to any programmatic request, regardless of ' +
  'path or user agent';
const MCCLATCHY =
  'McClatchy resets the connection to any programmatic request, the way ' +
  'the Tribune papers 403';
const VOX_AB5 =
  'Vox shut down its California SB Nation team sites after AB5 made the ' +
  'contributor model unworkable there';
const VOX_SHUTDOWN =
  'Vox shut the SB Nation blog down — the domain resets the connection ' +
  'outright rather than 404ing, so it is gone rather than moved';
const USA_TODAY_WIRE =
  "USA Today's Wire team sites are all 404, including the control " +
  '(Fighting Irish Wire), so the network was folded in rather than moved';

/** The same rulings by owner, for anything that wants to read them. */
export const DEAD_FEED_OWNERS: Record<string, string> = {
  gannett: GANNETT,
  tribune: TRIBUNE,
  mcclatchy: MCCLATCHY,
  'vox-ab5': VOX_AB5,
  'vox-shutdown': VOX_SHUTDOWN,
  'usa-today-wire': USA_TODAY_WIRE,
};

const SB_NATION = (id: string, name: string, domain: string): FeedSource => ({
  id,
  name,
  url: `https://www.${domain}/rss/index.xml`,
  tier: 3,
  scope: 'team',
});

/** Alabama and Auburn share a statewide paper, the way UCLA and USC do. */
const AL_COM: FeedSource = {
  id: 'al-com',
  name: 'AL.com',
  url: 'https://www.al.com/arc/outboundfeeds/rss/category/sports/?outputType=xml',
  tier: 1,
  scope: 'broad',
};

const BIG_TEN_SOURCES_BY_SLUG: Record<string, FeedSource[]> = {
  illinois: [
    SB_NATION('champaign-room', 'The Champaign Room', 'thechampaignroom.com'),
    {
      id: 'news-gazette',
      name: 'The News-Gazette',
      url: 'https://www.news-gazette.com/search/?f=rss&t=article&c=sports&l=50',
      tier: 1,
      scope: 'broad',
    },
  ],
  indiana: [SB_NATION('crimson-quarry', 'The Crimson Quarry', 'crimsonquarry.com')],
  iowa: [SB_NATION('bhgp', 'Black Heart Gold Pants', 'blackheartgoldpants.com')],
  maryland: [SB_NATION('testudo-times', 'Testudo Times', 'testudotimes.com')],
  michigan: [
    SB_NATION('maize-n-brew', 'Maize n Brew', 'maizenbrew.com'),
    {
      id: 'mlive',
      name: 'MLive',
      url: 'https://www.mlive.com/arc/outboundfeeds/rss/category/sports/?outputType=xml',
      tier: 1,
      scope: 'broad',
    },
  ],
  'michigan-state': [
    SB_NATION('only-colors', 'The Only Colors', 'theonlycolors.com'),
    {
      id: 'mlive',
      name: 'MLive',
      url: 'https://www.mlive.com/arc/outboundfeeds/rss/category/sports/?outputType=xml',
      tier: 1,
      scope: 'broad',
    },
  ],
  minnesota: [
    SB_NATION('daily-gopher', 'The Daily Gopher', 'thedailygopher.com'),
    {
      id: 'star-tribune',
      name: 'Star Tribune',
      url: 'https://www.startribune.com/sports/index.rss2',
      tier: 1,
      scope: 'broad',
    },
  ],
  nebraska: [
    SB_NATION('corn-nation', 'Corn Nation', 'cornnation.com'),
    {
      id: 'lincoln-journal-star',
      name: 'Lincoln Journal Star',
      url: 'https://journalstar.com/search/?f=rss&t=article&c=sports&l=50',
      tier: 1,
      scope: 'broad',
    },
    {
      id: 'omaha-world-herald',
      name: 'Omaha World-Herald',
      url: 'https://omaha.com/search/?f=rss&t=article&c=sports&l=50',
      tier: 1,
      scope: 'broad',
    },
    {
      id: 'daily-nebraskan',
      name: 'Daily Nebraskan',
      url: 'https://www.dailynebraskan.com/search/?f=rss&t=article&c=sports&l=50',
      tier: 3,
      scope: 'broad',
    },
  ],
  northwestern: [SB_NATION('inside-nu', 'Inside NU', 'insidenu.com')],
  'ohio-state': [
    SB_NATION('lghl', 'Land-Grant Holy Land', 'landgrantholyland.com'),
    {
      id: 'eleven-warriors',
      name: 'Eleven Warriors',
      url: 'https://www.elevenwarriors.com/rss.xml',
      tier: 2,
      scope: 'team',
    },
    {
      id: 'cleveland-com',
      name: 'Cleveland.com',
      url: 'https://www.cleveland.com/arc/outboundfeeds/rss/category/sports/?outputType=xml',
      tier: 1,
      scope: 'broad',
    },
  ],
  oregon: [
    SB_NATION('addicted-to-quack', 'Addicted To Quack', 'addictedtoquack.com'),
    {
      id: 'oregonlive',
      name: 'OregonLive',
      url: 'https://www.oregonlive.com/arc/outboundfeeds/rss/category/sports/?outputType=xml',
      tier: 1,
      scope: 'broad',
    },
  ],
  'penn-state': [
    SB_NATION('black-shoe-diaries', 'Black Shoe Diaries', 'blackshoediaries.com'),
    {
      id: 'pennlive',
      name: 'PennLive',
      url: 'https://www.pennlive.com/arc/outboundfeeds/rss/category/sports/?outputType=xml',
      tier: 1,
      scope: 'broad',
    },
  ],
  purdue: [SB_NATION('hammer-and-rails', 'Hammer and Rails', 'hammerandrails.com')],
  rutgers: [
    SB_NATION('on-the-banks', 'On the Banks', 'onthebanks.com'),
    {
      id: 'nj-com',
      name: 'NJ.com',
      url: 'https://www.nj.com/arc/outboundfeeds/rss/category/sports/?outputType=xml',
      tier: 1,
      scope: 'broad',
    },
  ],
  ucla: [
    {
      id: 'la-times',
      name: 'Los Angeles Times',
      url: 'https://www.latimes.com/sports/rss2.0.xml',
      tier: 1,
      scope: 'broad',
    },
  ],
  usc: [
    {
      id: 'la-times',
      name: 'Los Angeles Times',
      url: 'https://www.latimes.com/sports/rss2.0.xml',
      tier: 1,
      scope: 'broad',
    },
  ],
  washington: [
    SB_NATION('uw-dawg-pound', 'UW Dawg Pound', 'uwdawgpound.com'),
    {
      id: 'seattle-times',
      name: 'The Seattle Times',
      url: 'https://www.seattletimes.com/sports/feed/',
      tier: 1,
      scope: 'broad',
    },
  ],
  wisconsin: [
    SB_NATION('buckys-5th-quarter', "Bucky's 5th Quarter", 'buckys5thquarter.com'),
    {
      id: 'wisconsin-state-journal',
      name: 'Wisconsin State Journal',
      url: 'https://madison.com/search/?f=rss&t=article&c=sports&l=50',
      tier: 1,
      scope: 'broad',
    },
  ],
};

/**
 * What was checked for a Big Ten team and ruled out. Every `[]` above
 * needs a line here; a team with a partial list gets one too, which is
 * most of these — the entry is a blog, and this is why there's no paper
 * beside it.
 */
const BIG_TEN_NO_SOURCE_REASONS: Record<string, string> = {
  illinois: `Chicago Tribune: ${TRIBUNE}. The News-Gazette carries the program instead.`,
  indiana: `Indianapolis Star: ${GANNETT}. No local newsroom feed available.`,
  iowa: `Des Moines Register: ${GANNETT}. No local newsroom feed available.`,
  maryland: `Baltimore Sun: ${TRIBUNE}. No local newsroom feed available.`,
  northwestern: `Chicago Tribune: ${TRIBUNE}. No local newsroom feed available.`,
  purdue: `Indianapolis Star and Journal & Courier: ${GANNETT}. No local newsroom feed available.`,
  ucla: `No SB Nation blog: ${VOX_AB5}. The LA Times covers both LA programs.`,
  usc: `No SB Nation blog: ${VOX_AB5}. The LA Times covers both LA programs.`,
};

/**
 * ## SEC
 *
 * Separate from the table above on purpose rather than merged into one
 * map: slugs are unique per school, not per league, and realignment moves
 * schools between conferences. Two tables keyed the same way cost nothing
 * and can't collide.
 *
 * Vox shut down more of SB Nation in the SEC than in the Big Ten, so the
 * gaps here are different ones and worth naming:
 *
 * - Auburn, Arkansas, South Carolina, Oklahoma and Mississippi State lost
 *   their SB Nation blogs (College and Magnolia, Arkansas Fight, Garnet
 *   And Black Attack, Crimson And Cream Machine, For Whom the Cowbell
 *   Tolls). All five domains now reset the connection outright rather than
 *   404 — they are gone, not moved. Team Speed Kills, the conference-wide
 *   blog that would have been the SEC's Off Tackle Empire, went the same
 *   way; Saturday Down South covers that ground instead.
 *
 * - Alligator Army (Florida) is still publishing and still advertises
 *   `/rss/index.xml` in its own `<link rel="alternate">`, but that path
 *   404s. That's a broken feed rather than a dead site, so it's worth
 *   re-checking; Gator Country carries Florida for now.
 *
 * - Gannett owns the metro paper for Florida, Tennessee, Texas, Georgia,
 *   Oklahoma and Mississippi (Gainesville Sun, Knoxville News Sentinel,
 *   Austin American-Statesman, Athens Banner-Herald, The Oklahoman,
 *   Clarion Ledger), and every one of those returns 200 with an empty
 *   body — the same retirement documented for the Big Ten above. McClatchy
 *   (Lexington Herald-Leader, The State) resets the connection to any
 *   programmatic request, like the Tribune papers do.
 */
const SEC_SOURCES_BY_SLUG: Record<string, FeedSource[]> = {
  alabama: [
    SB_NATION('roll-bama-roll', 'Roll Bama Roll', 'rollbamaroll.com'),
    AL_COM,
  ],
  arkansas: [
    {
      id: 'arkansas-democrat-gazette',
      name: 'Arkansas Democrat-Gazette',
      url: 'https://www.arkansasonline.com/rss/headlines/sports/',
      tier: 1,
      scope: 'broad',
    },
    {
      id: 'arkansas-traveler',
      name: 'The Arkansas Traveler',
      url: 'https://www.uatrav.com/search/?f=rss&t=article&c=sports&l=50',
      tier: 3,
      scope: 'broad',
    },
  ],
  // No blog left, so Auburn runs on its own small-city daily plus the
  // statewide one it shares with Alabama.
  auburn: [
    {
      id: 'opelika-auburn-news',
      name: 'Opelika-Auburn News',
      url: 'https://oanow.com/search/?f=rss&t=article&c=sports&l=50',
      tier: 1,
      scope: 'broad',
    },
    AL_COM,
  ],
  florida: [
    {
      id: 'gator-country',
      name: 'Gator Country',
      url: 'https://www.gatorcountry.com/feed/',
      tier: 2,
      scope: 'team',
    },
  ],
  georgia: [
    SB_NATION('dawg-sports', 'Dawg Sports', 'dawgsports.com'),
    {
      id: 'red-and-black',
      name: 'The Red & Black',
      url: 'https://www.redandblack.com/search/?f=rss&t=article&c=sports&l=50',
      tier: 3,
      scope: 'broad',
    },
  ],
  kentucky: [SB_NATION('a-sea-of-blue', 'A Sea of Blue', 'aseaofblue.com')],
  lsu: [
    SB_NATION('and-the-valley-shook', 'And The Valley Shook', 'andthevalleyshook.com'),
    // The paper's LSU section rather than its sports front: the latter is
    // a stub that returns eight items no matter what `l` asks for, while
    // this one is a full 50 and is already about one program — which is
    // why it's scoped 'team' where every other newspaper here is 'broad'.
    //
    // The comment sits above the entry rather than inside it because
    // scripts/check-feeds.sh extracts sources by matching `name:` and
    // `url:` as adjacent lines. Split them and the source silently drops
    // out of the liveness report while still being fetched by the app.
    {
      id: 'the-advocate',
      name: 'The Advocate',
      url: 'https://www.theadvocate.com/search/?f=rss&t=article&c=sports/lsu&l=50',
      tier: 1,
      scope: 'team',
    },
  ],
  'mississippi-state': [
    {
      id: 'starkville-daily-news',
      name: 'Starkville Daily News',
      url: 'https://www.starkvilledailynews.com/search/?f=rss&t=article&c=sports&l=50',
      tier: 1,
      scope: 'broad',
    },
  ],
  missouri: [
    SB_NATION('rock-m-nation', 'Rock M Nation', 'rockmnation.com'),
    {
      id: 'st-louis-post-dispatch',
      name: 'St. Louis Post-Dispatch',
      url: 'https://www.stltoday.com/search/?f=rss&t=article&c=sports&l=50',
      tier: 1,
      scope: 'broad',
    },
    // Operated by the Missouri School of Journalism, which is a real
    // affiliation to the university it covers — but the same one the Daily
    // Nebraskan already carries, and tier 3 is where this app has
    // consistently filed student and campus newsrooms. Tier 4 is for
    // athletics-department output, not for a newsroom with an editor.
    {
      id: 'columbia-missourian',
      name: 'Columbia Missourian',
      url: 'https://www.columbiamissourian.com/search/?f=rss&t=article&c=sports&l=50',
      tier: 3,
      scope: 'broad',
    },
  ],
  'ole-miss': [SB_NATION('red-cup-rebellion', 'Red Cup Rebellion', 'redcuprebellion.com')],
  oklahoma: [
    {
      id: 'tulsa-world',
      name: 'Tulsa World',
      url: 'https://tulsaworld.com/search/?f=rss&t=article&c=sports&l=50',
      tier: 1,
      scope: 'broad',
    },
    {
      id: 'ou-daily',
      name: 'The OU Daily',
      url: 'https://www.oudaily.com/search/?f=rss&t=article&c=sports&l=50',
      tier: 3,
      scope: 'broad',
    },
  ],
  'south-carolina': [
    {
      id: 'post-and-courier',
      name: 'The Post and Courier',
      url: 'https://www.postandcourier.com/search/?f=rss&t=article&c=sports&l=50',
      tier: 1,
      scope: 'broad',
    },
  ],
  tennessee: [SB_NATION('rocky-top-talk', 'Rocky Top Talk', 'rockytoptalk.com')],
  texas: [SB_NATION('burnt-orange-nation', 'Burnt Orange Nation', 'burntorangenation.com')],
  'texas-am': [
    SB_NATION('good-bull-hunting', 'Good Bull Hunting', 'goodbullhunting.com'),
    {
      id: 'the-eagle',
      name: 'The Eagle',
      url: 'https://theeagle.com/search/?f=rss&t=article&c=sports&l=50',
      tier: 1,
      scope: 'broad',
    },
  ],
  vanderbilt: [SB_NATION('anchor-of-gold', 'Anchor Of Gold', 'anchorofgold.com')],
};

/** The SEC's half of the same record. See BIG_TEN_NO_SOURCE_REASONS. */
const SEC_NO_SOURCE_REASONS: Record<string, string> = {
  alabama: `The Tuscaloosa News: ${GANNETT}. Roll Tide Wire: ${USA_TODAY_WIRE}. AL.com carries the program.`,
  arkansas: `Arkansas Fight is gone: ${VOX_SHUTDOWN}.`,
  auburn: `College and Magnolia is gone: ${VOX_SHUTDOWN}. Montgomery Advertiser: ${GANNETT}.`,
  florida: `Alligator Army still publishes and still advertises /rss/index.xml, but that path 404s — a broken feed on a working site, so worth re-checking rather than writing off. Gainesville Sun: ${GANNETT}. Gators Wire: ${USA_TODAY_WIRE}.`,
  georgia: `Athens Banner-Herald: ${GANNETT}. The Red & Black, the student paper, carries what a metro paper would.`,
  kentucky: `Lexington Herald-Leader: ${MCCLATCHY}. No local newsroom feed available.`,
  'mississippi-state': `For Whom the Cowbell Tolls is gone: ${VOX_SHUTDOWN}. The Starkville Daily News carries the program.`,
  'ole-miss': `Clarion Ledger, the statewide paper: ${GANNETT}. No local newsroom feed verified for Oxford.`,
  oklahoma: `Crimson And Cream Machine is gone: ${VOX_SHUTDOWN}. The Oklahoman: ${GANNETT}. Tulsa World and the OU Daily carry the program.`,
  'south-carolina': `Garnet And Black Attack is gone: ${VOX_SHUTDOWN}. The State: ${MCCLATCHY}. The Post and Courier carries the program.`,
  tennessee: `Knoxville News Sentinel: ${GANNETT}. No local newsroom feed available.`,
  texas: `Austin American-Statesman: ${GANNETT}. Longhorns Wire: ${USA_TODAY_WIRE}. No local newsroom feed available.`,
  vanderbilt: `Tennessean: ${GANNETT}. No local newsroom feed available.`,
};

/**
 * Everything in this file is beat coverage by definition — a team blog, an
 * independent that covers one program, or a metro paper's sports section.
 * Tagged in one place rather than repeated on every entry, so a source
 * added later can't accidentally be left untagged and get filed under
 * national. Note this can't be derived from `scope`: local newsrooms are
 * broad-scoped (they cover pro teams and other sports too, so they need
 * name-filtering) but are still beat coverage of the program.
 */
function beatSources(table: Record<string, FeedSource[]>, teamShortName: string): FeedSource[] {
  // Slug and aliases live in team-slug.ts, shared with the nickname table.
  const sources = table[teamSlug(teamShortName)] ?? [];
  return sources.map((source) => ({ ...source, reach: 'beat' as const }));
}

export function bigTenSourcesForTeam(teamShortName: string): FeedSource[] {
  return beatSources(BIG_TEN_SOURCES_BY_SLUG, teamShortName);
}

export function secSourcesForTeam(teamShortName: string): FeedSource[] {
  return beatSources(SEC_SOURCES_BY_SLUG, teamShortName);
}

const bigTenReview = createTeamReview(BIG_TEN_SOURCES_BY_SLUG, BIG_TEN_NO_SOURCE_REASONS);
const secReview = createTeamReview(SEC_SOURCES_BY_SLUG, SEC_NO_SOURCE_REASONS);

/**
 * Whether a team's sources have been ruled on, and what was ruled out.
 * One function per table for the reason there are two tables: a slug is
 * unique per school, not per league, and realignment moves schools.
 */
export function bigTenSourceReviewFor(teamShortName: string): ReviewState {
  return bigTenReview.reviewFor(teamShortName);
}

export function secSourceReviewFor(teamShortName: string): ReviewState {
  return secReview.reviewFor(teamShortName);
}

/** Empty in healthy tables — see TeamReview.issues. */
export function communitySourceReviewIssues(): string[] {
  return [...bigTenReview.issues(), ...secReview.issues()];
}
