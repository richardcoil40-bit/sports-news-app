import { FeedSource } from '@/lib/feeds';

/**
 * Per-team sources beyond the national pool. Every URL here was verified to
 * return real items by scripts/check-feeds.sh — nothing is added on the
 * assumption that a feed "should" exist. Tiers follow the criteria in
 * docs/source-reliability.md.
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
 */

const SB_NATION = (id: string, name: string, domain: string): FeedSource => ({
  id,
  name,
  url: `https://www.${domain}/rss/index.xml`,
  tier: 3,
  scope: 'team',
});

const SOURCES_BY_SLUG: Record<string, FeedSource[]> = {
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
 * ESPN's short names don't always match how a school is normally written
 * ("Michigan St", not "Michigan State"), so lookups go through a slug plus
 * an alias table rather than depending on an exact string.
 */
const SLUG_ALIASES: Record<string, string> = {
  'michigan-st': 'michigan-state',
  'ohio-st': 'ohio-state',
  'penn-st': 'penn-state',
  'washington-st': 'washington',
};

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function communitySourcesForTeam(teamShortName: string): FeedSource[] {
  const slug = slugify(teamShortName);
  return SOURCES_BY_SLUG[slug] ?? SOURCES_BY_SLUG[SLUG_ALIASES[slug] ?? ''] ?? [];
}
