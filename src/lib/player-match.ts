import { Article } from '@/lib/feeds';
import { compileWordBoundary } from '@/lib/text-match';

/** Short surnames produce too many false hits to be worth matching alone. */
const MIN_LAST_NAME_LENGTH = 5;

export interface PlayerName {
  fullName: string;
  /**
   * Optional, and worth supplying: ESPN's fullName can carry a middle name
   * or a suffix no article writes, so "first last" is matched as well
   * whenever it differs. A caller that omits it gets fullName matching
   * alone — and gets a different answer than one that supplies it, which
   * is why the two screens below both pass it.
   */
  firstName?: string;
  lastName: string;
}

/** How an article named the player: precisely, by surname only, or not at all. */
export type NameMatch = 'full' | 'last' | null;

/**
 * Suffixes and trailing periods break word-boundary matching ("Jr." ends in a
 * non-word character, so a trailing \b can never match), so names are trimmed
 * to a form that matches how articles actually write them.
 */
function normalizeName(name: string): string {
  return name.replace(/\.+$/, '').trim();
}

/**
 * A reusable matcher for one player's name.
 *
 * Compiled once per player rather than once per (player, article) pair:
 * ranking a full roster against a full news pool runs this thousands of
 * times, and rebuilding a RegExp per comparison is the expensive way to
 * get the same answer.
 *
 * `allowLastName` is the caller's judgement about whether the surname is
 * specific enough to trust on its own — notable-players.ts says no when two
 * players on the roster share it. Length is checked here regardless, since
 * that part doesn't depend on the caller's context.
 */
export function compilePlayerMatcher(
  player: PlayerName,
  options?: { allowLastName?: boolean },
): (text: string) => NameMatch {
  const fullName = normalizeName(player.fullName);
  const firstLast = player.firstName ? normalizeName(`${player.firstName} ${player.lastName}`) : '';
  const lastName = normalizeName(player.lastName);

  // An empty needle compiles to a pattern that matches every string, so a
  // player missing a name would otherwise be "named" by the entire pool.
  const fullPattern = fullName ? compileWordBoundary(fullName) : null;
  const firstLastPattern =
    firstLast && firstLast !== fullName ? compileWordBoundary(firstLast) : null;
  const lastNamePattern =
    (options?.allowLastName ?? true) && lastName.length >= MIN_LAST_NAME_LENGTH
      ? compileWordBoundary(lastName)
      : null;

  return (text: string): NameMatch => {
    if (fullPattern?.test(text) || firstLastPattern?.test(text)) return 'full';
    if (lastNamePattern?.test(text)) return 'last';
    return null;
  };
}

/**
 * There's no per-player news feed anywhere (ESPN, CBS, Yahoo all lack one) —
 * this is the only honest option: find articles that happen to name the
 * player. Tries the full name first since it's the most precise signal;
 * falls back to a last-name-only match (skipped for short/common surnames,
 * to keep false positives down) so recognizable players still surface.
 *
 * This is the list the player's screen renders, so it is also where any
 * count of that player's articles has to come from — notable-players.ts
 * counts the same two buckets with the same matcher rather than running its
 * own tally, because a card reading "4 articles" over a screen listing 2 is
 * exactly what two independent implementations of "the same" number
 * produce.
 */
export function matchArticlesForPlayer(
  articles: Article[],
  player: PlayerName,
  options?: { allowLastName?: boolean },
): Article[] {
  const match = compilePlayerMatcher(player, options);

  const named: Article[] = [];
  const surnameOnly: Article[] = [];
  for (const article of articles) {
    const kind = match(`${article.title} ${article.description}`);
    if (kind === 'full') named.push(article);
    else if (kind === 'last') surnameOnly.push(article);
  }

  return named.length > 0 ? named : surnameOnly;
}
