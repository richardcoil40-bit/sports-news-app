import { SourceTier } from '@/lib/feeds';

/**
 * Short, plain labels for the tiers defined in docs/source-reliability.md.
 *
 * These are shown on every article rather than hidden behind the
 * "trusted only" filter, because knowing what kind of outlet you're
 * reading is the point — a staffed newsroom, a credible independent, and
 * a fan community are all worth reading, and all worth telling apart. No
 * mainstream sports app does this, and it's the clearest expression of
 * what this app is for.
 *
 * Wording is deliberately descriptive rather than evaluative: "Community"
 * says what a source is, where something like "Unverified" would imply
 * the writing is worse, which isn't what the tiers mean.
 */
const TIER_LABELS: Record<SourceTier, string> = {
  1: 'Newsroom',
  2: 'Independent',
  3: 'Community',
};

export function tierLabel(tier: SourceTier): string {
  return TIER_LABELS[tier] ?? TIER_LABELS[3];
}
