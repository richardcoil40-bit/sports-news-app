import { describe, expect, it } from 'vitest';

import { detectOffTopic, filterOffTopic, isOffTopic } from '@/lib/off-topic';

const check = (title: string, description = '') => detectOffTopic({ title, description });

/**
 * This is the only module that *removes* articles rather than labeling
 * them, so its false positives are the expensive kind — a dropped article
 * leaves no trace for the reader to disagree with. This list comes first
 * for the same reason the asymmetry list leads claim-type.test.ts.
 *
 * **Add to it rather than narrowing it.**
 */
const MUST_SURVIVE = [
  // Money words in real news. A naive commerce detector eats all of these.
  'Michigan signs $12 million deal with new coordinator',
  'Buyout talks stall as Michigan weighs a change',
  'Big Ten lands record TV rights deal',
  'Ticket sales up 30% after the playoff run',
  'Michigan announces a $50 million stadium renovation',
  'Star receiver signs an NIL deal with a local dealership',
  // Institutional words anchored to athletics.
  'Regents approve a new football stadium',
  'University hires a new athletic director',
  'Chancellor backs the football coach after a difficult season',
  'Trustees approve the basketball arena renovation',
  // The recruiting sense of words the institutional list must not claim.
  'Four-star recruit sets a campus visit for June',
  'Dean Smith commits to Michigan',
  'Michigan opens enrollment period for season tickets',
];

describe('real news must survive', () => {
  for (const title of MUST_SURVIVE) {
    it(`"${title.slice(0, 50)}…"`, () => {
      expect(check(title)).toBeNull();
    });
  }
});

describe('commerce', () => {
  const cases = [
    'Michigan State Spartans fans can save up to $90 on these official Nike jerseys',
    'Best deals on Michigan football gear this week',
    'Shop the new Michigan sideline collection',
    'Get 20% off with code BLUE at checkout',
    'Black Friday deals on Big Ten merch',
    'Where to buy the new Ohio State jersey',
  ];

  for (const title of cases) {
    it(`"${title.slice(0, 46)}…"`, () => {
      expect(check(title)).toBe('commerce');
    });
  }

  // Affiliate copy routinely puts the pitch in the summary rather than the
  // headline.
  it('reads the teaser too', () => {
    expect(check('New Michigan gear has arrived', 'Shop the collection and save up to $40')).toBe(
      'commerce',
    );
  });

  it('catches a discount amount', () => {
    expect(check('Nike jerseys $30 off through Sunday')).toBe('commerce');
  });
});

describe('institutional', () => {
  const cases = [
    'University of Michigan hires Vanderbilt provost C. Cybele Raver as next president',
    'Board of trustees approves a tuition increase',
    'Presidential search narrows to three finalists',
    'University announces record admissions numbers',
  ];

  for (const title of cases) {
    it(`"${title.slice(0, 46)}…"`, () => {
      expect(check(title)).toBe('institutional');
    });
  }

  // Removal is destructive, so institutional evidence has to be in the
  // headline — a passing mention in a teaser is much weaker.
  it('ignores an institutional word that appears only in the teaser', () => {
    expect(check('Michigan opens fall camp', 'The provost attended practice')).toBeNull();
  });
});

describe('degrades rather than throwing', () => {
  const junk: [string, unknown, unknown][] = [
    ['empty', '', ''],
    ['whitespace', '   ', ''],
    ['null fields', null, null],
    ['undefined fields', undefined, undefined],
    ['numeric title', 42, 42],
  ];

  for (const [label, title, description] of junk) {
    it(label, () => {
      const article = { title, description } as unknown as { title: string; description: string };
      expect(() => detectOffTopic(article)).not.toThrow();
      expect(detectOffTopic(article)).toBeNull();
    });
  }
});

describe('filterOffTopic', () => {
  it('drops off-topic articles and keeps the rest', () => {
    const kept = filterOffTopic([
      { title: 'Michigan hires Brian Hartline', description: '' },
      { title: 'Save up to $90 on official jerseys', description: '' },
      { title: 'Board of trustees approves tuition increase', description: '' },
      { title: 'Ohio State beats Michigan 30-24', description: '' },
    ]);

    expect(kept.map((a) => a.title)).toEqual([
      'Michigan hires Brian Hartline',
      'Ohio State beats Michigan 30-24',
    ]);
  });

  it('preserves extra fields', () => {
    const kept = filterOffTopic([
      { title: 'Michigan hires Hartline', description: '', claimType: 'reported' as const },
    ]);
    expect(kept[0].claimType).toBe('reported');
  });

  it('is a no-op on an empty list', () => {
    expect(filterOffTopic([])).toEqual([]);
  });
});

describe('isOffTopic', () => {
  it('is the boolean form', () => {
    expect(isOffTopic({ title: 'Shop the new collection', description: '' })).toBe(true);
    expect(isOffTopic({ title: 'Michigan hires Hartline', description: '' })).toBe(false);
  });
});
