import { describe, expect, it } from 'vitest';

import {
  compileTeamMatchers,
  detectTeam,
  detectTeams,
  filterToTeams,
  withTeamMentions,
} from '@/lib/team-mentions';
import { Team } from '@/lib/teams';

const team = (id: string, shortName: string, name: string, location = shortName): Team => ({
  id,
  name,
  shortName,
  location,
  abbreviation: shortName.slice(0, 3).toUpperCase(),
  logoUrl: null,
  leagueId: 'big-ten',
});

// Deliberately includes all three nesting pairs the Big Ten actually
// contains: Michigan/Michigan State, Ohio State/Ohio, Washington/
// Washington State.
const TEAMS = [
  team('130', 'Michigan', 'Michigan Wolverines'),
  // ESPN really does abbreviate this one, and that is the bug this
  // module was written to fix: "Michigan St" never matches a headline
  // that says "Michigan State".
  team('127', 'Michigan St', 'Michigan State Spartans', 'Michigan State'),
  team('194', 'Ohio State', 'Ohio State Buckeyes'),
  team('195', 'Ohio', 'Ohio Bobcats'),
  team('264', 'Washington', 'Washington Huskies'),
  team('265', 'Washington St', 'Washington State Cougars', 'Washington State'),
  team('213', 'Penn State', 'Penn State Nittany Lions'),
];

const compiled = compileTeamMatchers(TEAMS);
const detect = (title: string, description = '') =>
  detectTeam({ title, description }, compiled)?.shortName ?? null;

/**
 * The whole reason this module exists. A word-boundary match for "Michigan"
 * matches inside "Michigan State", so without longest-first ordering every
 * Spartans story gets tagged MICHIGAN — and this conference contains three
 * such pairs.
 */
describe('nested team names', () => {
  const nested: [string, string][] = [
    ['Michigan State to hire W. Michigan AD', 'Michigan St'],
    ['Michigan State football lands a four-star', 'Michigan St'],
    ['Michigan football names four captains', 'Michigan'],
    ['Washington State opens camp', 'Washington St'],
    ['Washington hires a new coordinator', 'Washington'],
    ['Ohio State is the preseason No. 1', 'Ohio State'],
    ['Ohio upsets a ranked opponent', 'Ohio'],
  ];

  for (const [title, expected] of nested) {
    it(`"${title}" -> ${expected}`, () => {
      expect(detect(title)).toBe(expected);
    });
  }
});

describe('detectTeam', () => {
  it('matches the full name as well as the short name', () => {
    expect(detect('Penn State Nittany Lions open fall camp')).toBe('Penn State');
  });

  it('is case-insensitive', () => {
    expect(detect('MICHIGAN STATE FOOTBALL ADDS A TRANSFER')).toBe('Michigan St');
  });

  // A headline that names a team is about that team; a teaser mentioning
  // one in passing often isn't. Checking the title first is what stops a
  // Michigan story being tagged with its opponent.
  it('prefers the title over the description', () => {
    expect(detect('Michigan opens camp', 'A look ahead to the Ohio State game')).toBe('Michigan');
  });

  it('falls back to the description when the title names nobody', () => {
    expect(detect('Five things we learned', 'Ohio State looked sharp in practice')).toBe(
      'Ohio State',
    );
  });

  it('returns null when no team is named', () => {
    expect(detect('College football playoff expansion explained')).toBeNull();
  });

  // Word boundaries, not substrings: this must not match "Michigan".
  it('does not match a team name inside another word', () => {
    expect(detect('Michigander sportswriters weigh in')).toBeNull();
  });

  describe('degrades rather than throwing', () => {
    const junk: [string, unknown, unknown][] = [
      ['empty', '', ''],
      ['null fields', null, null],
      ['undefined fields', undefined, undefined],
      ['numeric title', 42, 42],
    ];

    for (const [label, title, description] of junk) {
      it(label, () => {
        expect(() =>
          detectTeam({ title, description } as unknown as Pick<
            { title: string; description: string },
            'title' | 'description'
          >, compiled),
        ).not.toThrow();
      });
    }

    it('handles an empty team list', () => {
      expect(detectTeam({ title: 'Michigan wins', description: '' }, [])).toBeNull();
    });
  });
});

describe('withTeamMentions', () => {
  it('attaches the team to every article', () => {
    const tagged = withTeamMentions(
      [
        { title: 'Michigan State to hire W. Michigan AD', description: '' },
        { title: 'Playoff expansion explained', description: '' },
      ],
      TEAMS,
    );

    expect(tagged.map((a) => a.mentionedTeam?.shortName ?? null)).toEqual(['Michigan St', null]);
  });

  /**
   * A team site never says the school's name, because its readers already
   * know whose site they're on — so headline matching alone left every
   * Corn Nation story untagged while Land-Grant Holy Land's, which do say
   * "Ohio State", got a tag. Provenance closes that, and only that.
   */
  describe('the team-site fallback', () => {
    const NEBRASKA = team('158', 'Nebraska', 'Nebraska Cornhuskers');
    const WITH_NEBRASKA = [...TEAMS, NEBRASKA];

    it('tags a team-site story the headline does not name', () => {
      const tagged = withTeamMentions(
        [
          {
            title: 'Corn Flakes: Huskers vs. Texas in Primetime',
            description: '',
            scope: 'team' as const,
            teamId: '158',
            leagueId: 'big-ten',
          },
        ],
        WITH_NEBRASKA,
      );
      expect(tagged[0].mentionedTeam?.shortName).toBe('Nebraska');
    });

    it('still lets the headline win, so a rival story is tagged with the rival', () => {
      const tagged = withTeamMentions(
        [
          {
            title: 'Why Ohio State is the team to beat',
            description: '',
            scope: 'team' as const,
            teamId: '158',
            leagueId: 'big-ten',
          },
        ],
        WITH_NEBRASKA,
      );
      expect(tagged[0].mentionedTeam?.shortName).toBe('Ohio State');
    });

    // The whole point of the tag: a broad source's pool is full of stories
    // about other teams, so which pool surfaced it proves nothing.
    it('does not fire for a broad source', () => {
      const tagged = withTeamMentions(
        [{
          title: 'Playoff expansion explained',
          description: '',
          scope: 'broad' as const,
          teamId: '158',
          leagueId: 'big-ten',
        }],
        WITH_NEBRASKA,
      );
      expect(tagged[0].mentionedTeam).toBeNull();
    });

    it('does not fire without a team id', () => {
      const tagged = withTeamMentions(
        [{ title: 'Playoff expansion explained', description: '', scope: 'team' as const }],
        WITH_NEBRASKA,
      );
      expect(tagged[0].mentionedTeam).toBeNull();
    });
  });

  it('preserves extra fields', () => {
    const tagged = withTeamMentions(
      [{ title: 'Michigan wins', description: '', claimType: 'reported' as const }],
      TEAMS,
    );
    expect(tagged[0].claimType).toBe('reported');
  });
});

/**
 * The single-team answer is only ever the first of these, so the ordering
 * rules above still hold — but a story naming two teams has to say so, or
 * the home feed can't tell "your opponent's preview, written for you" from
 * "someone else's team entirely".
 */
describe('detectTeams', () => {
  const detectAll = (title: string, description = '') =>
    detectTeams({ title, description }, compiled).map((t) => t.shortName);

  it('returns every team a headline names, longest name first', () => {
    expect(detectAll('Michigan State beats Michigan in overtime')).toEqual([
      'Michigan St',
      'Michigan',
    ]);
  });

  // The masking, from the other side: the shorter name has to be genuinely
  // named, not merely nested inside the longer one.
  it('does not report the nested team when only the longer name appears', () => {
    expect(detectAll('Michigan State football lands a four-star')).toEqual(['Michigan St']);
  });

  // Every occurrence gets masked, not just the first — one that didn't
  // would find a phantom "Michigan" in the second "Michigan State".
  it('is not fooled by a repeated nested name', () => {
    expect(detectAll('Michigan State opens camp', 'Michigan State looked sharp')).toEqual([
      'Michigan St',
    ]);
  });

  it('reads the title before the description', () => {
    expect(detectAll('Ohio wins', 'A look ahead to the Ohio State game')).toEqual([
      'Ohio',
      'Ohio State',
    ]);
  });

  it('returns an empty list when nobody is named', () => {
    expect(detectAll('Playoff expansion explained')).toEqual([]);
  });
});

/**
 * Which of several named teams gets the tag. Only the home feed passes
 * this, because only the home feed has a vantage point: the team screen is
 * looking at one team's pool and has no business re-pointing a headline.
 */
describe('withTeamMentions with preferred teams', () => {
  const MICHIGAN = TEAMS[0];

  it('credits a two-team story to the team you follow', () => {
    const tagged = withTeamMentions(
      [{ title: 'Michigan State vs. Michigan: what to watch', description: '' }],
      TEAMS,
      [MICHIGAN],
    );
    expect(tagged[0].mentionedTeam?.shortName).toBe('Michigan');
  });

  it('leaves a story naming nobody you follow alone', () => {
    const tagged = withTeamMentions(
      [{ title: 'Michigan State football lands a four-star', description: '' }],
      TEAMS,
      [MICHIGAN],
    );
    expect(tagged[0].mentionedTeam?.shortName).toBe('Michigan St');
  });

  // The preference picks between teams named in the *same* place. It does
  // not reach into the teaser to overturn the headline, which is the rule
  // detectTeam already lives by.
  it('does not promote a team named only in the teaser over one in the title', () => {
    const tagged = withTeamMentions(
      [{ title: 'Ohio State is the preseason No. 1', description: 'Michigan opens camp Monday' }],
      TEAMS,
      [MICHIGAN],
    );
    expect(tagged[0].mentionedTeam?.shortName).toBe('Ohio State');
  });
});

/**
 * The bug: "came from a followed team's source" was standing in for "is
 * about a followed team". A community site's opponent preview is the case
 * that separates them.
 */
describe('filterToTeams', () => {
  const MICHIGAN = TEAMS[0];
  const tagged = (title: string, description = '', preferred: typeof TEAMS = []) =>
    withTeamMentions([{ title, description }], TEAMS, preferred);

  it('drops an article about a team you do not follow', () => {
    expect(filterToTeams(tagged('Michigan State Spartans 2026 Football Preview'), [MICHIGAN])).toEqual(
      [],
    );
  });

  it('keeps an article about a team you follow', () => {
    expect(
      filterToTeams(tagged('Michigan football names four captains'), [MICHIGAN]),
    ).toHaveLength(1);
  });

  // Together with the preference above: a game preview names both teams,
  // and it is your team's game.
  it('keeps a two-team story once the followed team has the tag', () => {
    expect(
      filterToTeams(tagged('Michigan State vs. Michigan: what to watch', '', [MICHIGAN]), [
        MICHIGAN,
      ]),
    ).toHaveLength(1);
  });

  // Untagged is not the same as "about someone else" — the local paper's
  // "Huskers" stories arrive with no name a matcher can read.
  it('keeps an untagged article', () => {
    expect(filterToTeams(tagged('Playoff expansion explained'), [MICHIGAN])).toHaveLength(1);
  });

  it('drops everything when nothing is followed, except the untagged', () => {
    const articles = withTeamMentions(
      [
        { title: 'Michigan football names four captains', description: '' },
        { title: 'Playoff expansion explained', description: '' },
      ],
      TEAMS,
    );
    expect(filterToTeams(articles, [])).toHaveLength(1);
  });
});
