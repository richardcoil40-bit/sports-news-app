import type { Article } from '@/lib/feeds';

/**
 * Content that isn't sports news at all, and is dropped rather than labeled.
 *
 * ## Why this one removes instead of describing
 *
 * Everything else in this app labels and lets the reader decide — source
 * tiers, claim types, the team tag. That posture is deliberate and worth
 * defending. This module is the exception, and the line it draws is:
 *
 *   **Labeling is for news of varying quality. Removal is for things that
 *   aren't news.**
 *
 * A rumor is weak news, so it gets a badge. An affiliate jersey ad is not
 * news at any strength, and there is no honest label that makes it worth a
 * slot in a feed.
 *
 * For commerce specifically there's a second argument, and it's the
 * stronger one. The README promises a "plain, ad-free, subscription-free
 * feed". Affiliate content is advertising with a newsroom byline — showing
 * it means carrying ads the project isn't even paid for.
 *
 * ## What this deliberately does not catch
 *
 * "Is this a real news article about this team?" is a much bigger question
 * than these two lexicons answer. High-school coverage from a metro paper,
 * or a story about a rival, are judgment calls that keyword matching gets
 * wrong. Those wait for the relevance check in `docs/deferred-work.md`.
 * These two categories are here because both are unambiguous in language,
 * which is exactly what makes them safe to remove without a model.
 */
export type OffTopicReason = 'commerce' | 'institutional';

function phraseRegex(phrases: string[]): RegExp {
  const escaped = phrases.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`\\b(?:${escaped.join('|')})\\b`, 'i');
}

/**
 * Affiliate and merchandise copy.
 *
 * Phrases only, never a bare money word. A naive detector eats real news:
 * "Michigan signs $12 million deal", "buyout talks", "record TV rights
 * deal" and "ticket sales up 30%" all contain money or commerce stems while
 * being exactly the coverage this app exists for. Same discipline as the
 * `targeting` and `hearing` traps in claim-type.ts.
 */
const COMMERCE = phraseRegex([
  'save up to',
  'save big',
  'on sale now',
  'now on sale',
  'best deals',
  'best deal on',
  'deals on',
  'promo code',
  'coupon',
  'discount code',
  'discounted',
  'shop the',
  'shop now',
  'shop for',
  'buy now',
  'where to buy',
  'gift guide',
  'holiday gifts',
  'black friday',
  'cyber monday',
  'prime day',
  'merch',
  'merchandise sale',
  'order yours',
  'available now at',
  'as low as',
  'off with code',
]);

/**
 * "$90 off", "20% off" — a number *attached* to a discount, not a contract.
 *
 * No leading `\b`: `$` is not a word character, so a word boundary before it
 * never matches after a space, and the pattern silently did nothing.
 */
const PRICE_OFF = /(?:\$\d[\d,.]*|\b\d{1,3}%)\s*(?:off|or less)\b/i;

/**
 * The university as an institution rather than an athletics program.
 *
 * Every entry here is institutional-only vocabulary. Notably absent:
 *
 * - `president` on its own — pro teams have team presidents, and "team
 *   president" is sports news.
 * - `campus` — "campus visit" is recruiting, one of the most common
 *   recruiting phrases there is.
 * - `dean` — a common surname.
 * - `research`, `study` — ordinary words in injury and analytics coverage.
 */
const INSTITUTIONAL = phraseRegex([
  'provost',
  'board of trustees',
  'board of regents',
  'trustees',
  'regents',
  'chancellor',
  'tuition',
  'faculty senate',
  'admissions',
  'enrollment',
  'curriculum',
  'commencement',
  'valedictorian',
  'residence hall',
  'academic senate',
  'university president',
  'next president',
  'interim president',
  'presidential search',
  'accreditation',
]);

/**
 * Anything that anchors a story to the athletics program.
 *
 * The institutional lexicon only fires when none of these appear, because
 * plenty of genuinely sporting stories run through the university's
 * governance: "Regents approve new football stadium" and "University hires
 * athletic director" are both news this app wants.
 */
const ATHLETIC_ANCHOR = phraseRegex([
  'football',
  'basketball',
  'athletics',
  'athletic',
  'coach',
  'quarterback',
  'recruit',
  'recruiting',
  'commit',
  'stadium',
  'arena',
  'roster',
  'player',
  'season',
  'transfer portal',
  'nil',
  'bowl',
  'playoff',
  'touchdown',
  'scrimmage',
  'kickoff',
  'sports',
]);

/**
 * Why this article isn't sports news, or null if it is.
 *
 * Commerce is checked against the teaser as well as the headline, because
 * affiliate copy routinely puts the pitch in the summary. Institutional
 * signals are read from the **title only** — removal is destructive, and a
 * passing mention of trustees in a teaser is much weaker evidence than a
 * headline about them.
 */
export function detectOffTopic(
  article: Pick<Article, 'title' | 'description'>,
): OffTopicReason | null {
  const title = typeof article.title === 'string' ? article.title : '';
  const description = typeof article.description === 'string' ? article.description : '';
  if (!title.trim()) return null;

  if (COMMERCE.test(title) || COMMERCE.test(description)) return 'commerce';
  if (PRICE_OFF.test(title) || PRICE_OFF.test(description)) return 'commerce';

  if (INSTITUTIONAL.test(title) && !ATHLETIC_ANCHOR.test(title)) return 'institutional';

  return null;
}

export function isOffTopic(article: Pick<Article, 'title' | 'description'>): boolean {
  return detectOffTopic(article) !== null;
}

/** Drops anything that isn't sports news. */
export function filterOffTopic<T extends Pick<Article, 'title' | 'description'>>(
  articles: T[],
): T[] {
  return articles.filter((article) => !isOffTopic(article));
}
