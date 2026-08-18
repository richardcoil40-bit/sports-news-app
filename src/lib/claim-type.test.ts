import { describe, expect, it } from 'vitest';

import {
  ClaimType,
  claimTypeLabel,
  classifyClaim,
  filterByClaimType,
} from '@/lib/claim-type';

const classify = (title: string, description = '') => classifyClaim({ title, description });

/**
 * REPORTED is the default and articles only leave it on positive evidence.
 * The two errors are not equal: a rumor left in the feed is what every other
 * app does anyway, while a real sourced report labeled a rumor is the app
 * lying about a story.
 *
 * The list below is this file's most important test — the direct analogue of
 * the shared junk-shape list in espn-parsers.test.ts. **Add to it rather
 * than narrowing it.** It is what stops a future lexicon addition from
 * quietly starting to eat news.
 */
const MUST_STAY_REPORTED = [
  'Michigan hires Brian Hartline as offensive coordinator',
  'Report: Michigan State to hire W. Michigan AD',
  'Ohio State fires its offensive coordinator',
  'Smith enters the transfer portal',
  'Michigan Football announces captains and leadership council for 2026 season',
  'University of Michigan hires Vanderbilt provost as next president',
  'Ohio State beats Michigan 30-24',
  'Player ejected for targeting in the second quarter',
  "Michigan's NCAA infractions hearing set for June",
  'Nebraska signs four-star quarterback',
  'Star running back ruled out for the season',
  'Ohio State, Oregon headline preseason AP college football poll',
  'AP Top 25 poll: Ohio State preseason No. 1',
  'Michigan set to face Ohio State in November',
  'Quarterback undergoes surgery, will miss six weeks',
  'Coach steps down after eight seasons',
  'Team announced Monday that it has parted ways with its coordinator',
];

describe('the asymmetry: real news must never be filed as rumor or take', () => {
  for (const title of MUST_STAY_REPORTED) {
    it(`"${title.slice(0, 52)}…"`, () => {
      expect(classify(title)).toBe('reported');
    });
  }
});

describe('rumor', () => {
  const cases: [string, string][] = [
    ['anonymous sourcing', 'Sources: Michigan closing in on a new coordinator'],
    ['sources say', 'Michigan sources say a decision is near'],
    ['reportedly', 'Coordinator reportedly weighing an offer elsewhere'],
    ['reports indicate', 'Reports indicate Michigan State to get visit from RB prospect'],
    ['not yet happened', 'Michigan expected to promote its receivers coach'],
    ['infinitive scoop', 'Michigan to hire Brian Hartline'],
    ['coaching carousel', 'Michigan emerges as a front-runner for the job'],
    ['transfer target', 'Ohio State makes quarterback its top transfer target'],
    ['modal hedge', 'Three quarterbacks who could commit to Michigan'],
    ["what we're hearing", "What we're hearing about Michigan's quarterback room"],
    ['crystal ball', 'Crystal ball prediction favors Michigan for four-star tackle'],
  ];

  for (const [label, title] of cases) {
    it(label, () => {
      expect(classify(title)).toBe('rumor');
    });
  }

  it('reads anonymous sourcing out of the description too', () => {
    expect(classify('A quiet week in Ann Arbor', 'Multiple sources tell us a move is coming')).toBe(
      'rumor',
    );
  });
});

describe('take', () => {
  const cases: [string, string][] = [
    ['format prefix', 'Mailbag: your Michigan questions answered'],
    ['analysis prefix', 'Analysis: what the new offense actually changes'],
    ['power rankings', 'Big Ten power rankings after Week 3'],
    ['grades', 'Grading the Tommy McClelland hire'],
    ['takeaways', 'What we learned from Iowa practice'],
    ['listicle', '5 things we learned from fall camp'],
    ['stance', 'Why Michigan should fire its coordinator'],
    ['ranking gerund', 'Ranking every Big Ten stadium'],
    ['trailing ranked', 'Every Big Ten uniform, ranked'],
    ['bold predictions', 'Bold predictions for Michigan in 2026'],
    ['hot seat', 'Which Big Ten coach is on the hot seat?'],
    ['player rankings', 'College football Top 150 player rankings'],
    ['question framing', "What does a bigger Quinton Martin mean for Penn State's offense?"],
  ];

  for (const [label, title] of cases) {
    it(label, () => {
      expect(classify(title)).toBe('take');
    });
  }
});

/**
 * Each of these is a word where the obvious reading is the wrong one. They
 * are the reason this file matches on word boundaries and phrases rather
 * than substrings, and every one of them is a real headline pattern.
 */
describe('domain traps', () => {
  const traps: [string, string, ClaimType][] = [
    ['targeting is a penalty', 'Player suspended a half for targeting', 'reported'],
    ['but a transfer target is not', 'Michigan makes him its top target', 'rumor'],
    ['hearing is usually legal', 'NCAA infractions hearing scheduled for June', 'reported'],
    ['commit is not committee', 'Selection committee releases its first rankings', 'reported'],
    ['May is a month', 'Michigan opens May practice with a new quarterback', 'reported'],
    ['set to is schedule-speak', 'Michigan set to open against Fresno State', 'reported'],
    ['but set to hire is not', 'Michigan set to hire a new coordinator', 'rumor'],
    ['Report: prefix is a scoop', 'Report: Michigan lands four-star tackle', 'reported'],
    ['reportedly is not', 'Michigan reportedly nearing a decision', 'rumor'],
    ['report card is a take', 'Report card: grading every position group', 'take'],
    ['poll release is news', 'First rankings of the season are out', 'reported'],
    ['ranking the is a take', 'Ranking the top 10 quarterbacks', 'take'],
    ['picks up is not a pick', 'Iowa picks up a commitment from a four-star', 'reported'],
    ['expert picks is', 'Expert picks for every Big Ten game', 'take'],
  ];

  for (const [label, title, expected] of traps) {
    it(label, () => {
      expect(classify(title)).toBe(expected);
    });
  }
});

describe('quotes', () => {
  // Coaches speak in hedges constantly. Without stripping, every quoted
  // press conference reads as speculation.
  it('ignores a hedge inside a quote', () => {
    expect(classify('Day: "We could have played better on third down"')).toBe('reported');
  });

  it('ignores a stance inside a quote', () => {
    expect(classify('Day says Michigan "should be ranked higher"')).toBe('reported');
  });

  it('does not treat two possessives as one quote', () => {
    // An unguarded single-quote pattern eats everything between the two
    // apostrophes, which would hide the hedge that makes this a rumor.
    expect(classify("Michigan's coordinator could leave for Ohio State's job")).toBe('rumor');
  });

  it('treats a quoted question as reported', () => {
    expect(classify('Day on the rivalry: "Are we tough enough?"')).toBe('reported');
  });
});

describe('question headlines', () => {
  // Betteridge's law is about national clickbait. Measured against a live
  // corpus of 193 headlines, essentially every question headline in this
  // feed was a column framing device instead, so a bare question defaults
  // to take. Questions with something genuinely speculative in them are
  // caught by the rumor lexicon first and never reach this rule.
  it('a bare question is a take', () => {
    expect(classify('What can we believe about Nebraska?')).toBe('take');
  });

  it('a speculative question is still a rumor', () => {
    expect(classify('Is Ohio State expected to hire Hartline?')).toBe('rumor');
  });

  it('a listings page is neither', () => {
    expect(classify('Michigan vs. Ohio State: what time, TV channel?')).toBe('reported');
  });
});

describe('degrades rather than throwing', () => {
  const junk: [string, unknown, unknown][] = [
    ['empty title', '', ''],
    ['whitespace title', '   ', ''],
    ['null title', null, null],
    ['undefined fields', undefined, undefined],
    ['numeric title', 42, 42],
    ['object title', {}, {}],
  ];

  for (const [label, title, description] of junk) {
    it(label, () => {
      expect(() =>
        classifyClaim({ title, description } as unknown as { title: string; description: string }),
      ).not.toThrow();
      expect(
        classifyClaim({ title, description } as unknown as { title: string; description: string }),
      ).toBe('reported');
    });
  }

  it('handles a very long title', () => {
    expect(() => classify('Michigan '.repeat(400))).not.toThrow();
  });
});

// Module-scope compiled RegExps are shared across calls. A stray /g flag
// would make .test() advance lastIndex and alternate between answers —
// the same hazard text-match.test.ts already guards.
describe('determinism', () => {
  it('gives the same answer every time', () => {
    const title = 'Sources: Michigan closing in on a new coordinator';
    expect([classify(title), classify(title), classify(title)]).toEqual([
      'rumor',
      'rumor',
      'rumor',
    ]);
  });
});

describe('claimTypeLabel', () => {
  it('labels the three types', () => {
    expect(claimTypeLabel('reported')).toBe('Reported');
    expect(claimTypeLabel('rumor')).toBe('Rumor');
    expect(claimTypeLabel('take')).toBe('Take');
  });

  // The value will eventually arrive over a network from a model.
  it('falls back for an unrecognised value', () => {
    expect(claimTypeLabel('nonsense' as ClaimType)).toBe('Reported');
  });
});

describe('filterByClaimType', () => {
  const articles = [
    { title: 'Michigan hires Brian Hartline', description: '' },
    { title: 'Sources: Michigan closing in on a coordinator', description: '' },
    { title: 'Mailbag: your questions answered', description: '' },
  ];

  it('returns everything for all', () => {
    expect(filterByClaimType(articles, 'all')).toHaveLength(3);
  });

  it('narrows to one type', () => {
    expect(filterByClaimType(articles, 'rumor').map((a) => a.title)).toEqual([
      'Sources: Michigan closing in on a coordinator',
    ]);
    expect(filterByClaimType(articles, 'take').map((a) => a.title)).toEqual([
      'Mailbag: your questions answered',
    ]);
  });

  it('preserves extra fields on the article', () => {
    const withTeam = [{ title: 'Mailbag: questions', description: '', teamName: 'Michigan' }];
    expect(filterByClaimType(withTeam, 'take')[0].teamName).toBe('Michigan');
  });
});
