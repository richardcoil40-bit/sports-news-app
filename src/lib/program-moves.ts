import { Article } from '@/lib/feeds';
import { RECRUITING_KEYWORDS } from '@/lib/recruiting';
import { ScheduledGame } from '@/lib/schedule';

/**
 * Roster and staff movement — the offseason story.
 *
 * A separate axis from claim type: that asks *how firm is this*, this asks
 * *is this the program changing shape*. A signing can be reported or a
 * rumor; both are movement.
 *
 * Exists because a countdown is useless for seven months of the year.
 * College football has a long offseason, and padding those months with
 * retrospectives of the last game or previews of the next one is exactly
 * the filler this app is supposed to remove. What actually happens between
 * January and August is people arriving and leaving.
 */
export type MoveKind = 'transfer' | 'commitment' | 'coaching';

function phraseRegex(phrases: string[]): RegExp {
  const escaped = phrases.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`\\b(?:${escaped.join('|')})\\b`, 'i');
}

/**
 * Recruiting and portal vocabulary is reused from recruiting.ts rather than
 * copied. AGENTS.md is explicit about not introducing a second pattern for
 * something that already has one, and two lists of commitment words would
 * drift apart within a release.
 */
const COMMITMENT = phraseRegex(RECRUITING_KEYWORDS);

const TRANSFER = phraseRegex([
  'transfer portal',
  'enters the portal',
  'entered the portal',
  'hits the portal',
  'transferring to',
  'transfers to',
  'waived',
  'released',
]);

/**
 * The category recruiting.ts has no words for, and a large share of what
 * happens in an offseason.
 *
 * `named` and `staff` are exactly the tokens naive substring matching
 * mangles — "named" appears in "renamed", "staff" in "staffing" — which is
 * why this goes through word boundaries like everything else here.
 */
const COACHING = phraseRegex([
  'hired',
  'hires',
  'fired',
  'fires',
  'named',
  'promoted',
  'demoted',
  'coordinator',
  'position coach',
  'assistant coach',
  'head coach',
  'coaching staff',
  'contract extension',
  'steps down',
  'stepped down',
  'resigns',
  'resigned',
  'retires',
  'retired',
  'interim',
  'parts ways',
  'athletic director',
]);

export function detectMove(
  article: Pick<Article, 'title' | 'description'>,
): MoveKind | null {
  const title = typeof article.title === 'string' ? article.title : '';
  const description = typeof article.description === 'string' ? article.description : '';
  const text = `${title} ${description}`;
  if (!title.trim()) return null;

  // Ordered by specificity: a portal story usually also matches the
  // commitment vocabulary, and "entered the portal" is the more precise
  // description of it.
  if (TRANSFER.test(text)) return 'transfer';
  if (COACHING.test(title)) return 'coaching';
  if (COMMITMENT.test(text)) return 'commitment';
  return null;
}

export function filterProgramMoves<T extends Pick<Article, 'title' | 'description'>>(
  articles: T[],
): T[] {
  return articles.filter((article) => detectMove(article) !== null);
}

/** A game this close ahead, or this recently past, means the season is live. */
const UPCOMING_WINDOW_MS = 10 * 24 * 60 * 60 * 1000;
const RECENT_WINDOW_MS = 4 * 24 * 60 * 60 * 1000;

/**
 * Whether there's a game close enough to be the thing you care about.
 *
 * Derived from the schedule rather than the calendar month, so it stays
 * correct for a sport whose season runs at a different time of year — the
 * same discipline as putting seasonStartMonth on the league descriptor
 * instead of hardcoding August.
 *
 * An empty schedule reads as out of season, which is the safe direction: a
 * failed fetch then shows program moves rather than a broken countdown.
 */
export function isInSeason(games: ScheduledGame[], now: Date = new Date()): boolean {
  return games.some((game) => {
    const kickoff = Date.parse(game.date);
    if (Number.isNaN(kickoff)) return false;
    const delta = kickoff - now.getTime();
    return delta <= UPCOMING_WINDOW_MS && delta >= -RECENT_WINDOW_MS;
  });
}

/**
 * The game worth showing: one in progress or imminent, else the next one,
 * else the most recent result.
 */
export function focusGame(games: ScheduledGame[], now: Date = new Date()): ScheduledGame | null {
  const dated = games
    .map((game) => ({ game, at: Date.parse(game.date) }))
    .filter((g) => !Number.isNaN(g.at))
    .sort((a, b) => a.at - b.at);

  if (dated.length === 0) return null;

  const upcoming = dated.find((g) => g.at >= now.getTime() - RECENT_WINDOW_MS);
  return (upcoming ?? dated[dated.length - 1]).game;
}
