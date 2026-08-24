import type { Article } from '@/lib/feeds';
import type { League } from '@/lib/leagues';

/**
 * Coverage of a *different sport* than the league you're following.
 *
 * ## Why this isn't part of off-topic.ts
 *
 * That module removes things that aren't news (jersey ads, campus
 * governance). Nebraska volleyball is real news, reported by real
 * journalists — it just isn't football, and this app follows a football
 * league. So the two are separate questions with separate lexicons, even
 * though both end in removal.
 *
 * ## Why it's needed at all
 *
 * team-news-pool.ts takes team-specific sites wholesale, on the reasoning
 * that "a team site publishes nothing but this team". True — but a *school*
 * is not a team. Corn Nation covers Nebraska volleyball, basketball and
 * baseball alongside football, and every one of those cleared a filter that
 * only ever asked "is this about Nebraska?". That's why a volleyball story
 * appeared in a football feed.
 *
 * ## Keyed on the league's sport, not hardcoded to football
 *
 * A league descriptor already carries `espnSport`, so the lexicon is looked
 * up rather than assumed, and adding a league to the JSON catalog needs no
 * change here. Two deliberate fail-open rules:
 *
 * - A sport with no lexicon filters **nothing**. If the app can't recognize
 *   a league's own coverage, it has no business deciding what isn't it.
 * - Any mention of the league's own sport rescues the article. Roundups and
 *   "football recruit also plays basketball" stories name two sports, and
 *   between dropping a mixed article and keeping it, keeping it is the
 *   error the reader can see and disagree with.
 */

function phraseRegex(phrases: string[]): RegExp {
  const escaped = phrases.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`\\b(?:${escaped.join('|')})\\b`, 'i');
}

/**
 * What each sport is called in a headline or a URL slug.
 *
 * Notably absent: **bowling**. Bowling Green is an FBS program, and a
 * word-boundary match for it would drop every game story against them.
 * "Diving" is out for the same reason — "diving into the depth chart" is a
 * football cliché. The rule for adding an entry is that it must be
 * unambiguous *as a word*, the same discipline off-topic.ts applies to its
 * commerce list.
 */
const SPORT_TERMS: Record<string, string[]> = {
  football: [
    'football',
    'quarterback',
    'qb',
    'running back',
    'rb',
    'wide receiver',
    'wr',
    'tight end',
    'linebacker',
    'lineman',
    'offensive line',
    'defensive line',
    'cornerback',
    'touchdown',
    'gridiron',
    'kickoff',
    'punt',
    'field goal',
    'depth chart',
    'bowl game',
    'spring game',
    'fall camp',
    'training camp',
    'heisman',
    'nfl',
    'redshirt',
    'two-deep',
  ],
  basketball: ['basketball', 'hoops', 'mbb', 'wbb', 'march madness', 'final four'],
  volleyball: ['volleyball'],
  baseball: ['baseball', 'college world series'],
  softball: ['softball'],
  soccer: ['soccer'],
  hockey: ['hockey'],
  wrestling: ['wrestling', 'wrestler', 'wrestlers'],
  'track-and-field': ['track and field', 'cross country'],
  swimming: ['swimming', 'swimmer', 'swim and dive'],
  gymnastics: ['gymnastics', 'gymnast'],
  tennis: ['tennis'],
  golf: ['golf', 'golfer'],
  lacrosse: ['lacrosse'],
  rowing: ['rowing'],
};

const COMPILED: Record<string, RegExp> = Object.fromEntries(
  Object.entries(SPORT_TERMS).map(([sport, terms]) => [sport, phraseRegex(terms)]),
);

/**
 * A URL is evidence, and often the only evidence: SB Nation files stories
 * under a section slug ("/ohio-state-mens-basketball/"), so the sport is in
 * the link even when the headline never says it. Punctuation becomes spaces
 * so slug words are whole words and multi-word phrases still match.
 */
function readableLink(link: string): string {
  return typeof link === 'string' ? link.replace(/[^a-z0-9]+/gi, ' ') : '';
}

/** Which other sport this article is about, or null if it isn't. */
export function detectOtherSport(
  article: Pick<Article, 'title' | 'link'>,
  league: League,
): string | null {
  const own = COMPILED[league.espnSport];
  if (!own) return null;

  const title = typeof article.title === 'string' ? article.title : '';
  if (!title.trim()) return null;
  const link = readableLink(article.link);

  if (own.test(title) || own.test(link)) return null;

  for (const [sport, pattern] of Object.entries(COMPILED)) {
    if (sport === league.espnSport) continue;
    if (pattern.test(title) || pattern.test(link)) return sport;
  }

  return null;
}

function isOtherSport(article: Pick<Article, 'title' | 'link'>, league: League): boolean {
  return detectOtherSport(article, league) !== null;
}

/** Drops coverage of every sport but the league's own. */
export function filterOtherSports<T extends Pick<Article, 'title' | 'link'>>(
  articles: T[],
  league: League,
): T[] {
  return articles.filter((article) => !isOtherSport(article, league));
}
