import type { FeedSource } from '@/lib/feeds';
import { createTeamReview, type ReviewState } from '@/lib/team-review';
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
 * - The Gannett metro papers (Des Moines Register, Indianapolis Star,
 *   Journal & Courier) retired RSS entirely — every documented path returns
 *   200 with an empty body — but each still publishes a Google news
 *   sitemap, which is what their SITEMAP() entries read since 2026-08-25.
 *   Chicago Tribune and Baltimore Sun (Illinois/Northwestern and Maryland)
 *   return 403 to any programmatic request and publish no sitemap either,
 *   so those two programs run on their SB Nation blog alone.
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
const GANNETT_SITEMAP =
  'the paper still publishes a Google news sitemap (news-sitemap.xml, a ' +
  'rolling ~48h window of the whole paper), which the SITEMAP() helper ' +
  'reads with the sports desk filtered back out by URL path — so the ' +
  'beat is recoverable even though RSS is gone';
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

/**
 * Not an owner ruling — one domain, and the only failure of this kind in
 * the catalog so far. Kept up here anyway because it is the shape a source
 * dies in that no liveness check can see: the feed answers 200 with ten
 * items and always will.
 */
const CU_INDEPENDENT_SOLD =
  'The CU Independent is no longer the CU Boulder student paper: its own ' +
  'news feed stops in July 2024, the domain now describes itself as ' +
  'covering "celebrity news, art, sexuality, sports, and lifestyle", and ' +
  'its sports category is casino-affiliate and listicle copy. Removed ' +
  'rather than retuned — there is no section of it left to point at.';

/** The same rulings by owner, for anything that wants to read them. */
export const DEAD_FEED_OWNERS: Record<string, string> = {
  gannett: GANNETT,
  tribune: TRIBUNE,
  mcclatchy: MCCLATCHY,
  'vox-ab5': VOX_AB5,
  'vox-shutdown': VOX_SHUTDOWN,
  'usa-today-wire': USA_TODAY_WIRE,
};

/**
 * Where each surviving chain publishes, keyed by the owner rather than by
 * the paper.
 *
 * Every one of these serves all of its papers from a single path, so a
 * paper's feed URL is a function of its host — which is the same shape
 * SB_NATION has had since the Big Ten, generalized to the two chains the
 * SEC added. Naming the owner at each call site is the point: these papers
 * live and die as a chain, not one at a time. Gannett retired RSS across
 * 130 papers at once, and the sixteen TownNews/BLOX sites below are the
 * same sixteen a CI runner cannot reach.
 *
 * Exported as builders so scripts/review/propose.mjs probes the exact URL
 * this table would produce for a candidate host, rather than a second
 * guess at the same path. The live/dead findings behind them are the owner
 * table in docs/source-reliability.md.
 *
 * `lee` takes a section as well as a host, and defaults it to `sports`
 * only for the probe: `c=sports` proves a host runs this CMS, and is the
 * wrong feed to then subscribe to. See the LEE() helper below for why.
 */
export const OWNER_FEED_URL: Record<string, (host: string, section?: string) => string> = {
  advance: (host) => `https://${host}/arc/outboundfeeds/rss/category/sports/?outputType=xml`,
  gannett: (host) => `https://${host}/news-sitemap.xml`,
  lee: (host, section = 'sports') => `https://${host}/search/?f=rss&t=article&c=${section}&l=50`,
  'sb-nation': (host) => `https://${host}/rss/index.xml`,
};

/**
 * Vox's network. Takes a bare domain because every one of these is on
 * `www.`; the two newspaper chains take a full host, because theirs are
 * split roughly evenly and the host is what was actually verified.
 */
const SB_NATION = (id: string, name: string, domain: string): FeedSource => ({
  id,
  name,
  url: OWNER_FEED_URL['sb-nation'](`www.${domain}`),
  tier: 3,
  scope: 'team',
});

/** Advance Local — metro papers, all tier 1 and all broad sports sections. */
const ADVANCE = (id: string, name: string, host: string): FeedSource => ({
  id,
  name,
  url: OWNER_FEED_URL.advance(host),
  tier: 1,
  scope: 'broad',
});

/**
 * Lee Enterprises and the student papers on the same TownNews/BLOX CMS.
 * The tier is a parameter because the CMS spans both: a metro daily is
 * tier 1 and a campus newsroom is tier 3, and they are otherwise identical
 * down to the query string.
 *
 * **`section` is required, and used to be an implicit `sports`.** That
 * default was wrong on nearly every paper here and wrong invisibly, which
 * is the reason it is now a parameter nobody can forget. On this CMS the
 * root `sports` category is where the syndicated wire lands — AP copy,
 * daily agate ("For the Record: Scores, results, boxscores"), Little
 * League regionals, sportsbook affiliate posts — while the beat writer who
 * actually covers the program files to a section below it. With `l=50` the
 * wire alone fills the whole response, so the local coverage is not merely
 * diluted, it is off the end of the feed.
 *
 * Measured on the shipping catalog, `c=sports` returned *zero* articles
 * naming the team for the Tulsa World, the St. Louis Post-Dispatch and The
 * Eagle, and one for the Waco Tribune-Herald. Every one of them is a live
 * feed answering 200 with fifty items, so scripts/check-feeds.sh passes
 * them and always did — see scripts/review/yield.mjs, which is the report
 * that asks the question that catches this.
 *
 * The sections themselves are research, not a pattern: papers on one CMS
 * still name their own sections. `sports/college/<team>` is the most
 * common (Waco, Tulsa, Opelika, St. Louis), student papers file by sport
 * (`sports/football`), and The Manhattan Mercury puts K-State at the top
 * level in `k_state_sports/` — outside `sports/` altogether. Read the
 * paper's own navigation rather than guessing.
 *
 * None of which was unknown here: The Advocate has carried
 * `c=sports/lsu` and a comment saying why since the SEC went in. It was
 * read as one paper's quirk instead of as the chain's shape, and the
 * other twenty-two kept the default. A finding recorded at one call site
 * is a finding until someone hits it again — which is the argument for
 * pushing it into the helper's signature rather than into a third
 * comment.
 */
const LEE = (
  id: string,
  name: string,
  host: string,
  section: string,
  tier: FeedSource['tier'] = 1,
): FeedSource => ({
  id,
  name,
  url: OWNER_FEED_URL.lee(host, section),
  tier,
  scope: 'broad',
});

/**
 * Gannett's mastheads — all tier-1 metro dailies, read through their Google
 * news sitemap because the chain retired RSS across every paper at once
 * (see GANNETT above). The sitemap is the *whole* paper on a rolling ~48h
 * window, so feeds.ts's sitemap mapper filters back down to /story/sports/
 * URLs before anything else sees the items, and item counts run lower than
 * an RSS feed's — a short check-feeds.sh row here is the window, not a
 * dying source (see docs/evidence/README.md). Every host below was
 * verified live before its entry was added.
 */
const SITEMAP = (id: string, name: string, host: string): FeedSource => ({
  id,
  name,
  url: OWNER_FEED_URL.gannett(host),
  tier: 1,
  scope: 'broad',
});

/** Alabama and Auburn share a statewide paper, the way UCLA and USC do. */
const AL_COM: FeedSource = ADVANCE('al-com', 'AL.com', 'www.al.com');

/**
 * Iowa and Iowa State share the statewide Register the way Alabama and
 * Auburn share AL.com — and like the Tulsa World, the id must stay
 * identical across the two tables so nickname-safety.ts can see the
 * shared newsroom. The Ames Tribune (Iowa State's town paper) has a live
 * sitemap too, but its window is prep sports — see the Big 12 reasons.
 */
const DES_MOINES_REGISTER: FeedSource = SITEMAP(
  'des-moines-register',
  'The Des Moines Register',
  'www.desmoinesregister.com',
);

const BIG_TEN_SOURCES_BY_SLUG: Record<string, FeedSource[]> = {
  illinois: [
    SB_NATION('champaign-room', 'The Champaign Room', 'thechampaignroom.com'),
    LEE('news-gazette', 'The News-Gazette', 'www.news-gazette.com', 'sports/illini-sports'),
  ],
  indiana: [
    SB_NATION('crimson-quarry', 'The Crimson Quarry', 'crimsonquarry.com'),
    SITEMAP('indianapolis-star', 'The Indianapolis Star', 'www.indystar.com'),
  ],
  iowa: [
    SB_NATION('bhgp', 'Black Heart Gold Pants', 'blackheartgoldpants.com'),
    DES_MOINES_REGISTER,
  ],
  maryland: [SB_NATION('testudo-times', 'Testudo Times', 'testudotimes.com')],
  michigan: [
    SB_NATION('maize-n-brew', 'Maize n Brew', 'maizenbrew.com'),
    ADVANCE('mlive', 'MLive', 'www.mlive.com'),
  ],
  'michigan-state': [
    SB_NATION('only-colors', 'The Only Colors', 'theonlycolors.com'),
    ADVANCE('mlive', 'MLive', 'www.mlive.com'),
  ],
  minnesota: [
    SB_NATION('daily-gopher', 'The Daily Gopher', 'thedailygopher.com'),
    // Independently owned and on its own path rather than a chain's, so
    // this one stays a literal.
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
    LEE('lincoln-journal-star', 'Lincoln Journal Star', 'journalstar.com', 'sports/huskers'),
    LEE('omaha-world-herald', 'Omaha World-Herald', 'omaha.com', 'sports/huskers'),
    LEE('daily-nebraskan', 'Daily Nebraskan', 'www.dailynebraskan.com', 'sports/football', 3),
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
    ADVANCE('cleveland-com', 'Cleveland.com', 'www.cleveland.com'),
  ],
  oregon: [
    SB_NATION('addicted-to-quack', 'Addicted To Quack', 'addictedtoquack.com'),
    ADVANCE('oregonlive', 'OregonLive', 'www.oregonlive.com'),
  ],
  'penn-state': [
    SB_NATION('black-shoe-diaries', 'Black Shoe Diaries', 'blackshoediaries.com'),
    ADVANCE('pennlive', 'PennLive', 'www.pennlive.com'),
  ],
  purdue: [
    SB_NATION('hammer-and-rails', 'Hammer and Rails', 'hammerandrails.com'),
    SITEMAP('journal-courier', 'Journal & Courier', 'www.jconline.com'),
  ],
  rutgers: [
    SB_NATION('on-the-banks', 'On the Banks', 'onthebanks.com'),
    ADVANCE('nj-com', 'NJ.com', 'www.nj.com'),
  ],
  // The LA Times publishes a per-program feed on the same path shape as its
  // sports front, so UCLA and USC each read their own rather than sharing
  // one and name-filtering it down. That paper covers two college programs
  // and five pro teams, and the shared front gave USC two articles and UCLA
  // four; the sections give 18 and 15. Same failure as the TownNews front
  // page (see LEE()), different CMS — which is why the yield report is
  // owner-agnostic and this one keeps its own id per section: they really
  // are two beats, not one paper read twice.
  ucla: [
    {
      id: 'la-times-ucla',
      name: 'Los Angeles Times',
      url: 'https://www.latimes.com/sports/ucla/rss2.0.xml',
      tier: 1,
      scope: 'broad',
    },
  ],
  usc: [
    {
      id: 'la-times-usc',
      name: 'Los Angeles Times',
      url: 'https://www.latimes.com/sports/usc/rss2.0.xml',
      tier: 1,
      scope: 'broad',
    },
  ],
  washington: [
    SB_NATION('uw-dawg-pound', 'UW Dawg Pound', 'uwdawgpound.com'),
    // WordPress, and the section feed is the program's own beat: the sports
    // front gave six articles against this one's 29, because Seattle has
    // two pro teams that outproduce the Huskies in the offseason.
    {
      id: 'seattle-times',
      name: 'The Seattle Times',
      url: 'https://www.seattletimes.com/sports/uw-husky-football/feed/',
      tier: 1,
      scope: 'broad',
    },
  ],
  wisconsin: [
    SB_NATION('buckys-5th-quarter', "Bucky's 5th Quarter", 'buckys5thquarter.com'),
    LEE('wisconsin-state-journal', 'Wisconsin State Journal', 'madison.com', 'sports/college'),
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
  indiana: `Indianapolis Star: ${GANNETT}, but ${GANNETT_SITEMAP} — verified 2026-08-25, and the entry above.`,
  iowa: `Des Moines Register: ${GANNETT}, but ${GANNETT_SITEMAP} — verified 2026-08-25. The Register entry is shared with Iowa State, like AL.com across the Alabama schools.`,
  maryland: `Baltimore Sun: ${TRIBUNE}. No local newsroom feed available.`,
  northwestern: `Chicago Tribune: ${TRIBUNE}. No local newsroom feed available.`,
  purdue: `Indianapolis Star and Journal & Courier: ${GANNETT}, but ${GANNETT_SITEMAP} — the Journal & Courier (Lafayette, Purdue's town) verified 2026-08-25 and is the entry above; its window runs small.`,
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
 *   body for RSS — the same retirement documented for the Big Ten above.
 *   All six are carried through their news sitemaps instead since
 *   2026-08-25; see the SITEMAP() helper. McClatchy (Lexington
 *   Herald-Leader, The State) resets the connection to any programmatic
 *   request, like the Tribune papers do, and publishes no sitemap.
 */
const SEC_SOURCES_BY_SLUG: Record<string, FeedSource[]> = {
  alabama: [
    SB_NATION('roll-bama-roll', 'Roll Bama Roll', 'rollbamaroll.com'),
    AL_COM,
    SITEMAP('tuscaloosa-news', 'The Tuscaloosa News', 'www.tuscaloosanews.com'),
  ],
  arkansas: [
    {
      id: 'arkansas-democrat-gazette',
      name: 'Arkansas Democrat-Gazette',
      url: 'https://www.arkansasonline.com/rss/headlines/sports/',
      tier: 1,
      scope: 'broad',
    },
    LEE('arkansas-traveler', 'The Arkansas Traveler', 'www.uatrav.com', 'sports/football', 3),
  ],
  // No blog left, so Auburn runs on its own small-city daily plus the
  // statewide one it shares with Alabama.
  auburn: [
    LEE('opelika-auburn-news', 'Opelika-Auburn News', 'oanow.com', 'sports/college/auburn'),
    AL_COM,
    SITEMAP('montgomery-advertiser', 'Montgomery Advertiser', 'www.montgomeryadvertiser.com'),
  ],
  florida: [
    {
      id: 'gator-country',
      name: 'Gator Country',
      url: 'https://www.gatorcountry.com/feed/',
      tier: 2,
      scope: 'team',
    },
    SITEMAP('gainesville-sun', 'The Gainesville Sun', 'www.gainesville.com'),
  ],
  georgia: [
    SB_NATION('dawg-sports', 'Dawg Sports', 'dawgsports.com'),
    LEE('red-and-black', 'The Red & Black', 'www.redandblack.com', 'sports/football', 3),
    SITEMAP('athens-banner-herald', 'Athens Banner-Herald', 'www.onlineathens.com'),
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
    LEE('starkville-daily-news', 'Starkville Daily News', 'www.starkvilledailynews.com', 'sports'),
  ],
  missouri: [
    SB_NATION('rock-m-nation', 'Rock M Nation', 'rockmnation.com'),
    LEE('st-louis-post-dispatch', 'St. Louis Post-Dispatch', 'www.stltoday.com', 'sports/college/mizzou'),
    // Operated by the Missouri School of Journalism, which is a real
    // affiliation to the university it covers — but the same one the Daily
    // Nebraskan already carries, and tier 3 is where this app has
    // consistently filed student and campus newsrooms. Tier 4 is for
    // athletics-department output, not for a newsroom with an editor.
    LEE('columbia-missourian', 'Columbia Missourian', 'www.columbiamissourian.com', 'sports/mizzou_football', 3),
  ],
  'ole-miss': [
    SB_NATION('red-cup-rebellion', 'Red Cup Rebellion', 'redcuprebellion.com'),
    SITEMAP('clarion-ledger', 'The Clarion-Ledger', 'www.clarionledger.com'),
  ],
  oklahoma: [
    // The statewide paper, read through OU's own section rather than its
    // sports front — see the Big 12 table's note on the shared id, and the
    // LEE() helper on why the front is the wire.
    LEE('tulsa-world', 'Tulsa World', 'tulsaworld.com', 'sports/college/ou'),
    LEE('ou-daily', 'The OU Daily', 'www.oudaily.com', 'sports/football', 3),
    SITEMAP('the-oklahoman', 'The Oklahoman', 'www.oklahoman.com'),
  ],
  'south-carolina': [
    LEE('post-and-courier', 'The Post and Courier', 'www.postandcourier.com', 'sports/college'),
  ],
  tennessee: [
    SB_NATION('rocky-top-talk', 'Rocky Top Talk', 'rockytoptalk.com'),
    SITEMAP('knoxville-news-sentinel', 'Knoxville News Sentinel', 'www.knoxnews.com'),
  ],
  texas: [
    SB_NATION('burnt-orange-nation', 'Burnt Orange Nation', 'burntorangenation.com'),
    // The one Gannett masthead whose /news-sitemap.xml is a sitemap *index*
    // holding a single "local" child — subscribe to the child directly. Its
    // URLs also drop the /story/ prefix (sports/longhorns/…), which is why
    // SITEMAP_SPORTS_PATH in feeds.ts matches the bare /sports/ segment.
    {
      id: 'austin-american-statesman',
      name: 'Austin American-Statesman',
      url: 'https://www.statesman.com/sitemap/news/local.xml',
      tier: 1,
      scope: 'broad',
    },
  ],
  'texas-am': [
    SB_NATION('good-bull-hunting', 'Good Bull Hunting', 'goodbullhunting.com'),
    LEE('the-eagle', 'The Eagle', 'theeagle.com', 'sports/college/aggiesports'),
  ],
  vanderbilt: [
    SB_NATION('anchor-of-gold', 'Anchor Of Gold', 'anchorofgold.com'),
    SITEMAP('tennessean', 'The Tennessean', 'www.tennessean.com'),
  ],
};

/** The SEC's half of the same record. See BIG_TEN_NO_SOURCE_REASONS. */
const SEC_NO_SOURCE_REASONS: Record<string, string> = {
  alabama: `The Tuscaloosa News: ${GANNETT}, but ${GANNETT_SITEMAP} — verified 2026-08-25, the entry above. Roll Tide Wire: ${USA_TODAY_WIRE}. AL.com also carries the program.`,
  arkansas: `Arkansas Fight is gone: ${VOX_SHUTDOWN}.`,
  auburn: `College and Magnolia is gone: ${VOX_SHUTDOWN}. Montgomery Advertiser: ${GANNETT}, but ${GANNETT_SITEMAP} — verified 2026-08-25, the entry above.`,
  florida: `Alligator Army still publishes and still advertises /rss/index.xml, but that path 404s — a broken feed on a working site, so worth re-checking rather than writing off. Gainesville Sun: ${GANNETT}, but ${GANNETT_SITEMAP} — verified 2026-08-25, the entry above. Gators Wire: ${USA_TODAY_WIRE}.`,
  georgia: `Athens Banner-Herald: ${GANNETT}, but ${GANNETT_SITEMAP} — verified 2026-08-25, the entry above, beside the Red & Black.`,
  kentucky: `Lexington Herald-Leader: ${MCCLATCHY}. No local newsroom feed available.`,
  'mississippi-state': `For Whom the Cowbell Tolls is gone: ${VOX_SHUTDOWN}. The Starkville Daily News carries the program.`,
  'ole-miss': `Clarion Ledger, the statewide paper: ${GANNETT}, but ${GANNETT_SITEMAP} — verified 2026-08-25, the entry above. No local newsroom feed verified for Oxford itself.`,
  oklahoma: `Crimson And Cream Machine is gone: ${VOX_SHUTDOWN}. The Oklahoman: ${GANNETT}, but ${GANNETT_SITEMAP} — verified 2026-08-25, the entry above, beside Tulsa World and the OU Daily.`,
  'south-carolina': `Garnet And Black Attack is gone: ${VOX_SHUTDOWN}. The State: ${MCCLATCHY}. The Post and Courier carries the program.`,
  tennessee: `Knoxville News Sentinel: ${GANNETT}, but ${GANNETT_SITEMAP} — verified 2026-08-25, the entry above.`,
  texas: `Austin American-Statesman: ${GANNETT}, and its sitemap is live in a nonstandard shape — /news-sitemap.xml is an index holding one "local" child, so the entry above subscribes to the child directly (verified 2026-08-25, Longhorns coverage present). Longhorns Wire: ${USA_TODAY_WIRE}.`,
  vanderbilt: `Tennessean: ${GANNETT}, but ${GANNETT_SITEMAP} — verified 2026-08-25 with four live Vanderbilt football beat stories, which is the second entry above.`,
};

/**
 * ## Big 12
 *
 * A third table, for the reason there is a second: slugs are unique per
 * school and realignment moves schools between conferences, so one merged
 * map would eventually serve a school another school's feeds. This
 * conference is the argument rather than the exception — Arizona, Arizona
 * State, Colorado, Utah, BYU, Cincinnati, Houston and UCF all arrived here
 * from somewhere else.
 *
 * What this league cost, and what it says about the next one:
 *
 * - **The TownNews/BLOX papers are the reliable tier now, not SB Nation.**
 *   Six of six answered with a full sports feed; four of fifteen Vox blogs
 *   are gone (Our Daily Bears, Down The Drive, Cowboys Ride For Free, Viva
 *   The Matadors) and two more are up with a 404 feed (House of Sparky,
 *   Block U) — the Alligator Army case from the SEC, twice.
 * - **Three of those six papers are not Lee Enterprises.** The Manhattan
 *   Mercury, the Stillwater News Press and the Charleston Gazette-Mail are
 *   independently owned and answer on the identical query string, because
 *   what they share is the CMS rather than the owner. The LEE() helper is
 *   named for the biggest operator on that platform, not for who cashes
 *   the cheque; see its comment.
 * - **The metro dailies that block are a different failure from the ones
 *   that retired RSS.** The Daily Camera and the Denver Post return 403 to
 *   a programmatic request rather than 200-with-nothing, and the Houston
 *   Chronicle (Hearst) and both Salt Lake dailies simply publish no feed at
 *   any path tried. None of those are Gannett, Tribune or McClatchy, so
 *   DEAD_FEED_OWNERS does not cover them and each cost its own probe.
 * - **Student papers carry a bigger share here than in either other
 *   conference** — it is what the Big 12 has instead of metro coverage.
 *   Five programs at review time; Utah's Chronicle went behind a bot
 *   challenge on 2026-08-25 (see the reasons), so four today.
 */
const BIG_12_SOURCES_BY_SLUG: Record<string, FeedSource[]> = {
  arizona: [
    SB_NATION('az-desert-swarm', 'AZ Desert Swarm', 'azdesertswarm.com'),
    LEE('arizona-daily-star', 'Arizona Daily Star', 'tucson.com', 'sports/arizonawildcats'),
  ],
  'arizona-state': [
    SITEMAP('arizona-republic', 'The Arizona Republic', 'www.azcentral.com'),
  ],
  baylor: [LEE('waco-tribune-herald', 'Waco Tribune-Herald', 'wacotrib.com', 'sports/college/baylor')],
  byu: [SB_NATION('vanquish-the-foe', 'Vanquish The Foe', 'vanquishthefoe.com')],
  cincinnati: [
    LEE('news-record', 'The News Record', 'www.newsrecord.org', 'sports/football', 3),
    SITEMAP('cincinnati-enquirer', 'The Cincinnati Enquirer', 'www.cincinnati.com'),
  ],
  // The CU Independent was here and was removed rather than retuned — see
  // BIG_12_NO_SOURCE_REASONS. The blog carries the program alone now.
  colorado: [SB_NATION('ralphie-report', 'The Ralphie Report', 'ralphiereport.com')],
  houston: [
    {
      id: 'daily-cougar',
      name: 'The Daily Cougar',
      url: 'https://thedailycougar.com/feed/',
      tier: 3,
      scope: 'broad',
    },
  ],
  'iowa-state': [
    SB_NATION('wide-right-natty-lite', 'Wide Right & Natty Lite', 'widerightnattylite.com'),
    DES_MOINES_REGISTER,
  ],
  kansas: [
    SB_NATION('rock-chalk-talk', 'Rock Chalk Talk', 'rockchalktalk.com'),
    LEE('the-kansan', 'The University Daily Kansan', 'www.kansan.com', 'sports/football', 3),
  ],
  'kansas-state': [
    SB_NATION('bring-on-the-cats', 'Bring On The Cats', 'bringonthecats.com'),
    LEE('manhattan-mercury', 'The Manhattan Mercury', 'themercury.com', 'k_state_sports/football'),
  ],
  // No blog left, so Oklahoma State runs on the statewide paper plus its
  // own small-city daily — the shape Auburn has in the SEC.
  //
  // The Tulsa World is the first source two leagues share: Oklahoma has it
  // in the SEC table, for the obvious reason that one statewide paper covers
  // both programs. Two things follow, and the second is the load-bearing one.
  //
  // It is why scripts/check-feeds.sh reports 21 new sources here and not 22
  // — the report dedupes by URL, so a paper already in the catalog is
  // checked once however many teams claim it. That dedupe no longer applies
  // to this pair, because the two entries now read different *sections* of
  // the paper: `sports/college/osu` here and `sports/college/ou` there. The
  // paper is one subscription; the beat is not.
  //
  // And **the id must be identical in both tables**, which is why this one
  // is copied rather than renamed. nickname-safety.ts decides whether a
  // shared broad source makes a nickname collision real by intersecting
  // `broadSourceIds`, and it compares ids, not URLs. Two entries for one
  // paper under different ids would read as two different papers, and the
  // gate would pass a collision it exists to catch. Nothing costs anything
  // today because Oklahoma State claims no nicknames at all — but the day
  // it does, this is what makes the check work.
  //
  // The differing sections do not weaken that and must not be taken as a
  // reason to split the id: one newsroom writes both sections and columns
  // run across them, so two schools sharing this paper is exactly the
  // overlap the hazard is about. The id tracks the newsroom, not the URL.
  'oklahoma-state': [
    LEE('tulsa-world', 'Tulsa World', 'tulsaworld.com', 'sports/college/osu'),
    LEE('stillwater-news-press', 'Stillwater News Press', 'www.stwnewspress.com', 'sports/osu_sports'),
  ],
  tcu: [SB_NATION('frogs-o-war', "Frogs O' War", 'frogsowar.com')],
  'texas-tech': [
    SITEMAP('lubbock-avalanche-journal', 'Lubbock Avalanche-Journal', 'www.lubbockonline.com'),
  ],
  ucf: [
    SB_NATION('black-and-gold-banneret', 'Black And Gold Banneret', 'blackandgoldbanneret.com'),
    // Orlando's own paper is Tribune (dark, see the reasons), so the beat
    // comes from the next paper over: Daytona Beach is ~50 miles out and
    // its sports desk genuinely covers UCF alongside NASCAR — verified
    // 2026-08-25 with UCF football and basketball stories in the window.
    SITEMAP('daytona-beach-news-journal', 'The Daytona Beach News-Journal', 'www.news-journalonline.com'),
    // The student outlet, on the same WordPress-category shape as The
    // Daily Cougar. Campus-wide sports section (UFL's Orlando team, rec
    // sports), so broad-scoped and name-filtered like every student paper
    // that isn't purely one program's.
    {
      id: 'knightnews',
      name: 'KnightNews',
      url: 'https://knightnews.com/category/sports/feed/',
      tier: 3,
      scope: 'broad',
    },
  ],
  // Reviewed and currently empty: the Chronicle went behind a bot
  // challenge on 2026-08-25 — see BIG_12_NO_SOURCE_REASONS.
  utah: [],
  // A blog and a metro daily. WV MetroNews was here for a day and came out
  // again — see BIG_12_NO_SOURCE_REASONS.
  'west-virginia': [
    SB_NATION('the-smoking-musket', 'The Smoking Musket', 'smokingmusket.com'),
    LEE('charleston-gazette-mail', 'Charleston Gazette-Mail', 'wvgazettemail.com', 'sports/wvu'),
  ],
};

/** The Big 12's third of the same record. See BIG_TEN_NO_SOURCE_REASONS. */
const BIG_12_NO_SOURCE_REASONS: Record<string, string> = {
  'arizona-state': `House of Sparky is still publishing but /rss/index.xml 404s, the same broken-feed-on-a-live-site case as Alligator Army. The State Press runs TownNews and returns no items at any category slug tried. Arizona Republic: ${GANNETT}, but ${GANNETT_SITEMAP} — verified 2026-08-25 with live ASU football beat coverage, which is the entry above.`,
  baylor: `Our Daily Bears is gone: ${VOX_SHUTDOWN} The Waco Tribune-Herald carries the program.`,
  byu: 'Neither Salt Lake daily publishes a feed: the Deseret News and the Salt Lake Tribune both 404 at every path tried. Vanquish The Foe carries the program, and is the reason BYU has no broad-scoped source at all.',
  cincinnati: `Down The Drive is gone: ${VOX_SHUTDOWN} Cincinnati Enquirer: ${GANNETT}, but ${GANNETT_SITEMAP} — verified 2026-08-25, the entry above, beside the student paper.`,
  colorado: `The Daily Camera and the Denver Post both answer 403 to a programmatic request — a block rather than a retirement, so worth re-checking rather than writing off. ${CU_INDEPENDENT_SOLD} The Ralphie Report carries the program alone.`,
  houston: 'The Houston Chronicle is Hearst and publishes no public sports feed at any path tried. No SB Nation blog ever covered Houston.',
  'iowa-state': `Des Moines Register: ${GANNETT}, but ${GANNETT_SITEMAP} — verified 2026-08-25; the entry is shared with Iowa, like AL.com across the Alabama schools. The Ames Tribune's sitemap is live too, but its whole window was prep sports on the day checked, so the statewide Register carries the Cyclones instead.`,
  kansas: `The Lawrence Journal-World returns 200 with no items at both feed paths. Kansas City Star: ${MCCLATCHY}`,
  'oklahoma-state': `Cowboys Ride For Free is gone: ${VOX_SHUTDOWN}`,
  tcu: `Fort Worth Star-Telegram: ${MCCLATCHY}`,
  'texas-tech': `Viva The Matadors is gone: ${VOX_SHUTDOWN} The Daily Toreador runs TownNews and returns no items at any category slug tried. Lubbock Avalanche-Journal: ${GANNETT}, but ${GANNETT_SITEMAP} — verified 2026-08-25 with live Red Raiders coverage, which is the entry above.`,
  ucf: `Orlando Sentinel: ${TRIBUNE}, and it publishes no news sitemap either (404, checked 2026-08-25). Black And Gold Banneret is kept but has published no football since 2026-03-01 — re-checked 2026-08-25, its window is still all other sports. Left in rather than removed: a quiet publisher is not a broken source, and the season opens this week; if it is still silent when the season is underway it belongs out, the way the CU Independent went. The beat now comes from the two entries beside it: the Daytona Beach News-Journal, the nearest Gannett masthead, whose sitemap carried UCF football and basketball stories when verified 2026-08-25, and KnightNews, the student outlet (offseason window is UFL and campus sports; football expected in season).`,
  'west-virginia':
    'WV MetroNews answers, and takes 16-20s to do it — measured five times '  +
    'in a row. That is inside check-feeds.sh\'s 20s curl budget and outside '  +
    'FETCH_TIMEOUT_MS, so it reported healthy and would have timed out on '  +
    'every device. Removed rather than kept as a source that can only ever '  +
    'contribute a failed-source line. Worth re-checking: a slow origin is '  +
    'not a dead one.',
  utah:
    'Block U is still up but its feed 404s. The Daily Utah Chronicle ' +
    'carried the program until 2026-08-25, when its WordPress feed went ' +
    'behind a Cloudflare challenge — 403 "Just a moment…" to any ' +
    'programmatic request, the same class of block as the Tribune papers. ' +
    'Removed rather than kept as a permanent failed-source line, the way ' +
    'WV MetroNews went; a bot challenge is configuration rather than a ' +
    'shutdown, so worth re-checking. Neither Salt Lake daily publishes a ' +
    'feed or a news sitemap (both 404, checked 2026-08-25) — the same gap ' +
    'BYU has, from the other school in that city.',
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

export function big12SourcesForTeam(teamShortName: string): FeedSource[] {
  return beatSources(BIG_12_SOURCES_BY_SLUG, teamShortName);
}

const bigTenReview = createTeamReview(BIG_TEN_SOURCES_BY_SLUG, BIG_TEN_NO_SOURCE_REASONS);
const secReview = createTeamReview(SEC_SOURCES_BY_SLUG, SEC_NO_SOURCE_REASONS);
const big12Review = createTeamReview(BIG_12_SOURCES_BY_SLUG, BIG_12_NO_SOURCE_REASONS);

/**
 * One conference's table as data, for the review gate and
 * scripts/review/propose.mjs.
 *
 * The lookups above answer for one team, which is all the app needs. Two
 * questions the reviewer asks can only be answered across the whole table:
 * which teams have been ruled on at all, and which of them share a source —
 * the second being what decides whether a nickname collision matters. See
 * nickname-safety.ts.
 *
 * `sourcesBySlug` is the same object the lookup reads, not a copy, so the
 * two cannot disagree about what is in the table.
 */
export interface CuratedSourceTable {
  readonly sourcesBySlug: Readonly<Record<string, readonly FeedSource[]>>;
  readonly reviewFor: (teamShortName: string) => ReviewState;
}

export const BIG_TEN_CURATED: CuratedSourceTable = {
  sourcesBySlug: BIG_TEN_SOURCES_BY_SLUG,
  reviewFor: (teamShortName) => bigTenReview.reviewFor(teamShortName),
};

export const SEC_CURATED: CuratedSourceTable = {
  sourcesBySlug: SEC_SOURCES_BY_SLUG,
  reviewFor: (teamShortName) => secReview.reviewFor(teamShortName),
};

export const BIG_12_CURATED: CuratedSourceTable = {
  sourcesBySlug: BIG_12_SOURCES_BY_SLUG,
  reviewFor: (teamShortName) => big12Review.reviewFor(teamShortName),
};

/**
 * Which league each table serves.
 *
 * Keyed by league id here, rather than in source-catalog.ts where the rest
 * of the league→sources mapping lives, for one reason: scripts/review/ has
 * to read this from plain Node, and source-catalog.ts reaches feeds.ts and
 * the league catalog at runtime — an npm package and a JSON import, neither
 * of which loads that way. This file reaches nothing, which is what keeps
 * the review tooling reading the real tables instead of parsing them.
 *
 * A league absent from here has no curated per-team sources, which is a
 * normal state and not a gap — see the note on `teamSources` in
 * source-catalog.ts.
 */
export const CURATED_SOURCE_TABLES: Readonly<Record<string, CuratedSourceTable>> = {
  'big-ten': BIG_TEN_CURATED,
  sec: SEC_CURATED,
  'big-12': BIG_12_CURATED,
};

/**
 * Whether a team's sources have been ruled on, and what was ruled out.
 * Accessors are per table, for the reason the tables are separate at all: a
 * slug is unique per school, not per league, and realignment moves schools.
 * Only the tables something asks about by name have one — every table is
 * covered wholesale by `communitySourceReviewIssues` below, which is what the
 * review gate reads.
 */
export function bigTenSourceReviewFor(teamShortName: string): ReviewState {
  return bigTenReview.reviewFor(teamShortName);
}

export function secSourceReviewFor(teamShortName: string): ReviewState {
  return secReview.reviewFor(teamShortName);
}

/** Empty in healthy tables — see TeamReview.issues. */
export function communitySourceReviewIssues(): string[] {
  return [...bigTenReview.issues(), ...secReview.issues(), ...big12Review.issues()];
}
