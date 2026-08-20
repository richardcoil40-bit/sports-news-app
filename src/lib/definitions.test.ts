import { describe, expect, it } from 'vitest';

import { claimTypeLabel } from '@/lib/claim-type';
import { DEFINITION_SECTIONS } from '@/lib/definitions';
import { tierLabel } from '@/lib/source-tier';

/**
 * The glossary's whole value is that it describes the words the app
 * really shows. These assert the two ways it could stop doing that: a
 * heading drifting away from the label it explains, and an entry losing
 * its body in an edit.
 */
describe('DEFINITION_SECTIONS', () => {
  const entries = DEFINITION_SECTIONS.flatMap((section) => section.entries);

  it('heads the claim entries with the same labels the article row renders', () => {
    const terms = entries.map((entry) => entry.term);
    for (const claim of ['reported', 'rumor', 'take'] as const) {
      expect(terms).toContain(claimTypeLabel(claim));
    }
  });

  it('heads the tier entries with the same labels the article row renders', () => {
    const terms = entries.map((entry) => entry.term);
    for (const tier of [0, 1, 2, 3] as const) {
      expect(terms).toContain(tierLabel(tier));
    }
  });

  it('gives every term a definition', () => {
    for (const entry of entries) {
      expect(entry.term.trim()).not.toBe('');
      expect(entry.body.trim()).not.toBe('');
    }
  });

  it('defines each term once', () => {
    const terms = entries.map((entry) => entry.term);
    expect(new Set(terms).size).toBe(terms.length);
  });
});
