import { describe, expect, it } from 'vitest';

import { bigTenSourcesForTeam, secSourcesForTeam } from '@/lib/community-sources';
import { filterArticlesForTeams } from '@/lib/conference-filter';
import { Article } from '@/lib/feeds';
import { localNamesFor, schoolNamesFor, teamNicknamesFor } from '@/lib/team-nicknames';

describe('teamNicknamesFor', () => {
  it('finds a team by its ESPN short name', () => {
    expect(teamNicknamesFor('Nebraska')).toContain('Huskers');
  });

  // ESPN abbreviates these, which is the whole reason lookups go through
  // a slug and an alias table rather than the raw string.
  it('resolves the abbreviated short names ESPN actually returns', () => {
    expect(teamNicknamesFor('Michigan St')).toContain('Spartans');
    expect(teamNicknamesFor('Ohio St')).toContain('Buckeyes');
    expect(teamNicknamesFor('Penn St')).toContain('Nittany Lions');
    expect(teamNicknamesFor('Mississippi St')).toContain('Bulldogs');
  });

  // The ampersand is collapsed by the slugifier, not abbreviated by ESPN,
  // but it resolves through the same alias table.
  it('resolves a name the slugifier mangles', () => {
    expect(teamNicknamesFor('Texas A&M')).toContain('Aggies');
  });

  it('returns empty for a team nobody has researched', () => {
    expect(teamNicknamesFor('Boise State')).toEqual([]);
  });

  it('is case- and punctuation-insensitive', () => {
    expect(teamNicknamesFor('OHIO STATE')).toContain('Buckeyes');
  });
});

/**
 * The rule the table is built on: an entry has to survive being read in a
 * metro sports section that also covers pro teams. These are the words
 * that don't, and adding one would quietly pull NFL and NHL coverage into
 * a college football feed.
 */
describe('the ambiguity rule', () => {
  const MUST_NOT_APPEAR = [
    'Lions', // Detroit — PennLive covers both them and Penn State
    'Knights', // UCF
    'Cardinals',
    'Eagles',
    'Tigers',
    'Giants',
    'Panthers',
    'Bears',
    'Jets',
  ];

  const everyNickname = new Set(
    ['Illinois', 'Indiana', 'Iowa', 'Maryland', 'Michigan', 'Michigan St', 'Minnesota',
     'Nebraska', 'Northwestern', 'Ohio St', 'Oregon', 'Penn St', 'Purdue', 'Rutgers',
     'UCLA', 'USC', 'Washington', 'Wisconsin',
     // The SEC is held to the same list. "Tigers" is the one that bites
     // here — Auburn, LSU and Missouri all answer to it, so none of them
     // claims it.
     'Alabama', 'Arkansas', 'Auburn', 'Florida', 'Georgia', 'Kentucky', 'LSU',
     'Mississippi St', 'Missouri', 'Ole Miss', 'Oklahoma', 'South Carolina',
     'Tennessee', 'Texas', 'Texas A&M', 'Vanderbilt'].flatMap(teamNicknamesFor),
  );

  for (const word of MUST_NOT_APPEAR) {
    it(`does not claim "${word}"`, () => {
      expect(everyNickname.has(word)).toBe(false);
    });
  }

  // A nickname is only trusted because the source is that team's own
  // paper. If a team has nicknames but no local source, the entry is
  // unreachable — harmless, but worth noticing rather than assuming.
  it('every team with nicknames has at least one source', () => {
    for (const name of ['Nebraska', 'Ohio St', 'Michigan', 'Washington']) {
      expect(bigTenSourcesForTeam(name).length).toBeGreaterThan(0);
    }
    for (const name of ['Alabama', 'Arkansas', 'Auburn', 'Mississippi St', 'Missouri']) {
      expect(secSourcesForTeam(name).length).toBeGreaterThan(0);
    }
  });
});

const article = (title: string): Article => ({
  id: title,
  title,
  link: 'https://example.com/story',
  description: '',
  source: 'Lincoln Journal Star',
  author: null,
  publishedAt: '2026-08-18T00:00:00.000Z',
  imageUrl: null,
  tier: 1,
  reach: 'beat',
  scope: 'broad',
});

/**
 * The headlines that motivated this, taken verbatim from the corpus
 * fixture. Every one of them was being dropped from the feed.
 */
describe('local coverage that the school name alone missed', () => {
  const HEADLINES = [
    'Corn Flakes: Huskers vs. Texas in Primetime, After Short Stint RB Hayes Dismissed',
    'Corn Nation Reacts Survey: Which HUSKER FOOTBALL Assistant Is the Biggest Key',
    'Huskers Unveil Alternate Uniforms for a Wild Halloween Night',
  ];

  for (const title of HEADLINES) {
    it(`"${title.slice(0, 46)}…"`, () => {
      expect(filterArticlesForTeams([article(title)], ['Nebraska'])).toHaveLength(0);
      expect(filterArticlesForTeams([article(title)], localNamesFor('Nebraska'))).toHaveLength(1);
    });
  }

  // Singular is not a nicety: it's how a paper writes a section name.
  it('matches the singular form too', () => {
    const titles = ['Buckeye Talk: the most important recruit of the Day era', 'Two stars named to the list: Buckeye Breakfast'];
    for (const title of titles) {
      expect(filterArticlesForTeams([article(title)], localNamesFor('Ohio St'))).toHaveLength(1);
    }
  });

  it('still drops what the local paper writes about everyone else', () => {
    const others = ['Chiefs sign a veteran safety', 'Iowa State opens against a familiar foe'];
    for (const title of others) {
      expect(filterArticlesForTeams([article(title)], localNamesFor('Nebraska'))).toHaveLength(0);
    }
  });
});

/**
 * The abbreviation trap from the other side. team-mentions.ts documents it
 * for tagging; the news pool hits the same wall when filtering, and has
 * only the short name to work with.
 */
describe('schoolNamesFor', () => {
  it('spells out the names ESPN abbreviates', () => {
    expect(schoolNamesFor('Michigan St')).toEqual(['Michigan St', 'Michigan State']);
    expect(schoolNamesFor('Washington St')).toEqual(['Washington St', 'Washington State']);
  });

  it('leaves an unabbreviated name alone', () => {
    expect(schoolNamesFor('Nebraska')).toEqual(['Nebraska']);
  });

  it('matches a spelled-out headline, which the abbreviation alone cannot', () => {
    const spartans = [article('Michigan State names its starting quarterback')];
    expect(filterArticlesForTeams(spartans, ['Michigan St'])).toHaveLength(0);
    expect(filterArticlesForTeams(spartans, schoolNamesFor('Michigan St'))).toHaveLength(1);
  });

  // "Michigan State" must not be reachable from Michigan's own name list,
  // which is the nesting trap this codebase keeps running into.
  it('does not let Michigan claim Michigan State', () => {
    expect(schoolNamesFor('Michigan')).toEqual(['Michigan']);
  });
});
