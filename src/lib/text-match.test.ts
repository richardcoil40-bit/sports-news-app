import { describe, expect, it } from 'vitest';

import { compileWordBoundary, wordBoundaryMatch } from '@/lib/text-match';

describe('wordBoundaryMatch', () => {
  it('matches a whole word regardless of case', () => {
    expect(wordBoundaryMatch('Ohio State wins again', 'ohio state')).toBe(true);
    expect(wordBoundaryMatch('ohio state wins again', 'Ohio State')).toBe(true);
  });

  // The whole point of the word boundary: "Cal" must not light up on
  // "Calzone", or a team filter starts matching unrelated articles.
  it('does not match inside a longer word', () => {
    expect(wordBoundaryMatch('A great calzone recipe', 'Cal')).toBe(false);
    expect(wordBoundaryMatch('Miner details', 'Minnesota')).toBe(false);
  });

  it('matches at the start and end of the string', () => {
    expect(wordBoundaryMatch('Michigan lost', 'Michigan')).toBe(true);
    expect(wordBoundaryMatch('A loss for Michigan', 'Michigan')).toBe(true);
  });

  it('matches a word adjacent to punctuation', () => {
    expect(wordBoundaryMatch('Purdue, again', 'Purdue')).toBe(true);
    expect(wordBoundaryMatch('(Rutgers)', 'Rutgers')).toBe(true);
    expect(wordBoundaryMatch('"Iowa" said the coach', 'Iowa')).toBe(true);
  });

  // Real team names contain regex metacharacters — an unescaped needle would
  // either throw or silently match the wrong things.
  it('escapes regex metacharacters in the needle', () => {
    expect(() => wordBoundaryMatch('anything', 'Texas A&M (+)')).not.toThrow();
    expect(wordBoundaryMatch('Texas A&M won', 'Texas A&M')).toBe(true);
    expect(wordBoundaryMatch('Miami wins', 'M.ami')).toBe(false);
    expect(wordBoundaryMatch('M.ami wins', 'M.ami')).toBe(true);
  });

  it('handles an empty haystack without throwing', () => {
    expect(wordBoundaryMatch('', 'Michigan')).toBe(false);
  });
});

describe('compileWordBoundary', () => {
  it('returns a reusable pattern that matches the same way', () => {
    const pattern = compileWordBoundary('Penn State');

    expect(pattern.test('Penn State rallies')).toBe(true);
    expect(pattern.test('penn state rallies')).toBe(true);
    expect(pattern.test('Pennsylvania rallies')).toBe(false);
  });

  // Compiled once and reused across many articles, so it must not be stateful.
  // A /g flag here would make .test() advance lastIndex between calls and
  // return alternating results for identical input.
  it('gives the same answer when reused across calls', () => {
    const pattern = compileWordBoundary('Oregon');
    const haystack = 'Oregon and Oregon again';

    expect(pattern.test(haystack)).toBe(true);
    expect(pattern.test(haystack)).toBe(true);
    expect(pattern.test(haystack)).toBe(true);
  });
});
