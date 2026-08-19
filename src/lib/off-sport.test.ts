import { describe, expect, it } from 'vitest';

import { detectOtherSport, filterOtherSports } from '@/lib/off-sport';
import { DEFAULT_LEAGUE } from '@/lib/league-catalog';
import { League } from '@/lib/leagues';

const check = (title: string, link = 'https://example.com/story') =>
  detectOtherSport({ title, link }, DEFAULT_LEAGUE);

/**
 * Same posture as off-topic.test.ts: this module *removes* articles, so a
 * false positive is the expensive kind — the reader never sees what was
 * dropped and can't disagree with it. This list leads the file.
 *
 * **Add to it rather than narrowing it.**
 */
const MUST_SURVIVE = [
  // Plain football coverage that names no sport at all.
  'Ohio State is No. 1 in the AP preseason poll; are they cursed?',
  'Rhule names starting quarterback ahead of the opener',
  'Four-star recruit commits to Nebraska',
  'Injury report: two starters out for Saturday',
  // Bowling Green is an FBS program. A "bowling" term would eat this.
  'Nebraska opens the season against Bowling Green',
  // Football clichés built on other sports' vocabulary.
  'Rhule is diving into the depth chart this week',
  'Michigan wrestling with a quarterback decision',
  // Mixed roundups. A story that covers both is football coverage too,
  // and keeping it is the error the reader can see.
  'Corn Flakes: Volleyball Red-White game and fall football camp',
  'Football recruit is also a basketball star at his high school',
];

describe('football coverage must survive', () => {
  for (const title of MUST_SURVIVE) {
    it(`"${title.slice(0, 50)}…"`, () => {
      expect(check(title)).toBeNull();
    });
  }
});

describe('other sports', () => {
  const cases: [string, string][] = [
    ['Husker volleyball gets set for season in Red-White scrimmage', 'volleyball'],
    ['Nebraska basketball adds a transfer guard', 'basketball'],
    ['Hoops preview: what to expect from the new rotation', 'basketball'],
    ['Huskers baseball sweeps the weekend series', 'baseball'],
    ['Softball drops the opener in extra innings', 'softball'],
    ['Wrestlers claim three individual titles', 'wrestling'],
  ];

  for (const [title, sport] of cases) {
    it(`"${title.slice(0, 46)}…"`, () => {
      expect(check(title)).toBe(sport);
    });
  }
});

/**
 * The case that motivated reading the link at all: SB Nation files stories
 * under a section slug, so a basketball post can have a headline that never
 * says "basketball" — only the URL does.
 */
describe('the link is evidence too', () => {
  it('reads the section slug when the headline says nothing', () => {
    expect(
      check(
        'Analyzing the pros and cons of a potential Christoph Tilly reunion',
        'https://www.landgrantholyland.com/ohio-state-mens-basketball/120133/analyzing-the-pros-and-cons',
      ),
    ).toBe('basketball');
  });

  it('treats punctuation as word breaks, so slug words are whole words', () => {
    expect(
      check('Weekend results', 'https://www.cornnation.com/nebraska-swim-and-dive/1/weekend-results'),
    ).toBe('swimming');
  });

  // Land-Grant Holy Land's main section slug literally contains both
  // sports. Football in the URL has to rescue it, or every story filed
  // there disappears.
  it('a section naming football rescues the article', () => {
    expect(
      check(
        'Everything you need to know coming out of the first scrimmage',
        'https://www.landgrantholyland.com/ohio-state-football-basketball-recruiting-news/120149/everything',
      ),
    ).toBeNull();
  });
});

describe('fail-open rules', () => {
  it('filters nothing for a league whose sport has no lexicon', () => {
    const curling: League = {
      id: 'curling-test',
      displayName: 'Test Curling League',
      espnSport: 'curling',
      espnLeaguePath: 'test',
    };
    const articles = [{ title: 'Volleyball team wins again', link: 'https://example.com/a' }];
    expect(filterOtherSports(articles, curling)).toHaveLength(1);
  });

  it('ignores an article with no title rather than guessing', () => {
    expect(detectOtherSport({ title: '   ', link: 'https://example.com/volleyball/1' }, DEFAULT_LEAGUE)).toBeNull();
  });

  it('survives a malformed article', () => {
    const junk = { title: null, link: undefined } as unknown as { title: string; link: string };
    expect(() => detectOtherSport(junk, DEFAULT_LEAGUE)).not.toThrow();
  });
});

describe('filterOtherSports', () => {
  it('keeps football and drops the rest', () => {
    const articles = [
      { title: 'Quarterback named starter', link: 'https://example.com/1' },
      { title: 'Volleyball sweeps Texas', link: 'https://example.com/2' },
      { title: 'Recruit commits', link: 'https://example.com/3' },
    ];
    expect(filterOtherSports(articles, DEFAULT_LEAGUE).map((a) => a.title)).toEqual([
      'Quarterback named starter',
      'Recruit commits',
    ]);
  });
});
