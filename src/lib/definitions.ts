import { ClaimType, claimTypeLabel } from '@/lib/claim-type';
import { SourceTier } from '@/lib/feeds';
import { tierLabel } from '@/lib/source-tier';

/**
 * The glossary behind Settings → Definitions.
 *
 * Every term here has to be one the app actually puts on screen. The
 * failure mode this is written against is a glossary that explains
 * vocabulary the app doesn't use — which is worse than no glossary,
 * because it teaches the reader words they'll then look for and never
 * find. Two rules keep it honest:
 *
 * **Terms are derived, not retyped.** The claim and tier headings come
 * from `claimTypeLabel` and `tierLabel`, the same functions the article
 * row calls. Rewording a chip reworders its definition automatically; it
 * is not possible for the two to disagree.
 *
 * **The maps are Records over the unions**, so adding a fourth claim type
 * or a fifth tier fails to compile until it has a definition. That is the
 * whole guard against this file quietly falling behind the app.
 *
 * Deliberately absent, because none of them render anywhere: "trusted
 * source", "notable journalist", and "verdict". The verdict service does
 * run — see `team-news-pool.ts` — but purely as a relevance filter, and
 * nothing it decides is ever labelled on screen. Don't add a term here
 * for something only the code says.
 */

export interface Definition {
  term: string;
  body: string;
}

export interface DefinitionSection {
  label: string;
  entries: Definition[];
}

/**
 * Wording note, carried over from the two modules these describe:
 * `claim-type.ts` requires REPORTED never be glossed as "true" — it reads
 * headline grammar, not fact — and `source-tier.ts` requires tier wording
 * stay descriptive rather than evaluative, since "Community" says what a
 * source *is* where "Unverified" would imply the writing is worse.
 */
const CLAIM_DEFINITIONS: Record<ClaimType, string> = {
  reported:
    'Someone is stating this happened. It describes how the headline is written, not whether it turns out to be true — which is why it never says "fact".',
  rumor:
    'Speculation, or sourced only to people who are not named. It might well be right; nobody has put their name to it yet.',
  take: 'Opinion — a column, a ranking, a grade, a prediction.',
};

const TIER_DEFINITIONS: Record<SourceTier, string> = {
  1: 'A staffed outlet with editors, and a correction to issue when it gets something wrong.',
  2: 'A credible individual or small operation doing its own reporting.',
  3: 'A fan site, forum, or blog. Often first, often closest to a team — and not the same thing as a newsroom.',
  0: "This app doesn't know what this outlet is. That's an absence of a judgment, not a bad one.",
};

/** Reading order rather than numeric order: best-understood first. */
const TIER_ORDER: SourceTier[] = [1, 2, 3, 0];
const CLAIM_ORDER: ClaimType[] = ['reported', 'rumor', 'take'];

export const DEFINITION_SECTIONS: DefinitionSection[] = [
  {
    label: 'What the headline is doing',
    entries: CLAIM_ORDER.map((claim) => ({
      term: claimTypeLabel(claim),
      body: CLAIM_DEFINITIONS[claim],
    })),
  },
  {
    label: 'Who it came from',
    entries: TIER_ORDER.map((tier) => ({
      term: tierLabel(tier),
      body: TIER_DEFINITIONS[tier],
    })),
  },
  {
    label: 'Reading the feed',
    entries: [
      {
        term: 'Team tag',
        body: 'Which of your teams the headline names. Not always the team whose sources turned it up — a Nebraska site previewing next week\'s opponent is still a Nebraska site.',
      },
      {
        term: 'Other sources',
        body: 'How many other outlets ran the same story. One story takes one slot; tap the line to see who else has it.',
      },
      {
        term: "You're caught up",
        body: 'The end of what has arrived since you last reached this line. Everything older is still below it, not deleted.',
      },
      {
        term: 'Rumors & takes',
        body: 'Speculation and opinion from the same stretch of time, kept out of the main list but one tap away.',
      },
      {
        term: 'Earlier',
        body: 'Everything from before the current brief, plus anything the brief was too long to show.',
      },
    ],
  },
];
