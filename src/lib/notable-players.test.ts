import { describe, expect, it } from 'vitest';

import { Article } from '@/lib/feeds';
import { rankNotablePlayers } from '@/lib/notable-players';
import { matchArticlesForPlayer } from '@/lib/player-match';
import { Player } from '@/lib/roster';

function article(id: string, title: string, description = ''): Article {
  return {
    id,
    title,
    link: `https://example.com/${id}`,
    description,
    source: 'Test Source',
    author: null,
    publishedAt: '2026-08-18T00:00:00.000Z',
    imageUrl: null,
    tier: 1,
    reach: 'national',
    scope: 'broad',
  };
}

function player(id: string, firstName: string, lastName: string, fullName = `${firstName} ${lastName}`): Player {
  return {
    id,
    fullName,
    firstName,
    lastName,
    jersey: id,
    position: 'DL',
    positionGroup: 'defense',
    headshotUrl: null,
    experienceYears: 2,
  };
}

/**
 * The bug this file exists for: a player's card said "4 articles" and his
 * screen listed 2. Nothing was wrong with either number on its own — they
 * were two different questions being asked of the same pool, and only one
 * of them was the question the card claimed to be answering.
 *
 * So the assertion worth keeping isn't a particular count. It's that the
 * count and the list can't disagree, whichever way the matching goes.
 */
describe('the card count matches the list the player screen renders', () => {
  const HOUSTON = player('1', 'Eddrick', 'Houston');

  // Two that name him, two that say "Houston" about a city. The old count
  // added both buckets; the screen only ever showed the precise ones.
  const POOL = [
    article('a', 'Eddrick Houston is turning heads in camp'),
    article('b', 'Buckeyes defense', 'Eddrick Houston has added fifteen pounds.'),
    article('c', 'Ohio State to play a neutral-site game in Houston'),
    article('d', 'Recruiting notebook', 'The Houston area is a growing pipeline.'),
  ];

  it('counts only the articles it will show', () => {
    const [ranked] = rankNotablePlayers([HOUSTON], POOL);

    expect(ranked.mentions).toBe(2);
    expect(ranked.detail).toBe('2 articles');
  });

  it('agrees with matchArticlesForPlayer, which is what the screen calls', () => {
    const [ranked] = rankNotablePlayers([HOUSTON], POOL);
    const listed = matchArticlesForPlayer(POOL, HOUSTON, { allowLastName: ranked.matchesSurname });

    expect(listed).toHaveLength(ranked.mentions);
  });

  // The surname bucket is not discarded — it's what a player nobody writes
  // out in full is matched on, and the count follows the list there too.
  it('holds when the surname fallback is what produced the list', () => {
    const pool = [
      article('a', 'Houston records two sacks'),
      article('b', 'Houston named a captain'),
      article('c', 'Unrelated recruiting news'),
    ];
    const [ranked] = rankNotablePlayers([HOUSTON], pool);
    const listed = matchArticlesForPlayer(pool, HOUSTON, { allowLastName: ranked.matchesSurname });

    expect(ranked.mentions).toBe(2);
    expect(listed).toHaveLength(2);
  });

  // Two players sharing a surname is the case where the two screens could
  // still drift: the ranking knows the roster and the player screen doesn't,
  // so the decision travels with the player (see openPlayer in team/[id]).
  it('holds for a shared surname, where surname matching is off', () => {
    const roster = [player('1', 'Eddrick', 'Houston'), player('2', 'Marcus', 'Houston')];
    const pool = [
      article('a', 'Eddrick Houston is turning heads in camp'),
      article('b', 'Houston had a big day'),
    ];

    const ranked = rankNotablePlayers(roster, pool);
    const eddrick = ranked.find((entry) => entry.player.id === '1');

    expect(eddrick?.matchesSurname).toBe(false);
    expect(eddrick?.mentions).toBe(1);
    expect(
      matchArticlesForPlayer(pool, roster[0], { allowLastName: eddrick!.matchesSurname }),
    ).toHaveLength(1);

    // The teammate has no precise mention at all, so he doesn't make the
    // list on coverage — the ambiguous "Houston" counts for neither of them.
    expect(ranked.find((entry) => entry.player.id === '2')).toBeUndefined();
  });

  // ESPN's fullName is not what a beat writer types, and the player screen
  // is handed firstName for exactly this reason.
  it('holds when the roster name carries a middle name', () => {
    const raiola = player('9', 'Dylan', 'Raiola', 'Dylan James Raiola');
    const pool = [article('a', 'Dylan Raiola throws for 300')];

    const [ranked] = rankNotablePlayers([raiola], pool);

    expect(ranked.mentions).toBe(1);
    expect(
      matchArticlesForPlayer(pool, raiola, { allowLastName: ranked.matchesSurname }),
    ).toHaveLength(1);
  });
});

describe('rankNotablePlayers', () => {
  it('ranks a precisely-named player above one matched only by surname', () => {
    const roster = [player('1', 'Eddrick', 'Houston'), player('2', 'Caden', 'Curry')];
    const pool = [
      article('a', 'Eddrick Houston is turning heads in camp'),
      article('b', 'Curry mentioned in passing'),
    ];

    expect(rankNotablePlayers(roster, pool).map((entry) => entry.player.id)).toEqual(['1', '2']);
  });

  it('leaves out players nobody wrote about and who led no category', () => {
    const roster = [player('1', 'Eddrick', 'Houston'), player('2', 'Walter', 'Benchwarmer')];
    const pool = [article('a', 'Eddrick Houston is turning heads in camp')];

    expect(rankNotablePlayers(roster, pool).map((entry) => entry.player.id)).toEqual(['1']);
  });

  // A stat leader is notable whether or not anyone wrote about him this
  // week, and shows his stat line instead of a count he doesn't have.
  it('keeps a stat leader with no coverage, showing the stat rather than a count', () => {
    const roster = [player('1', 'Eddrick', 'Houston')];
    const leaders = [
      {
        athleteId: '1',
        category: 'Sacks Leader',
        displayValue: '8.5',
        rank: 1,
      },
    ];

    const [ranked] = rankNotablePlayers(roster, [], leaders);

    expect(ranked.mentions).toBe(0);
    expect(ranked.detail).toBe('Sacks · 8.5');
  });

  it('handles an empty roster', () => {
    expect(rankNotablePlayers([], [article('a', 'Anything')])).toEqual([]);
  });

  it('handles an empty pool', () => {
    expect(rankNotablePlayers([player('1', 'Eddrick', 'Houston')], [])).toEqual([]);
  });

  it('respects the limit', () => {
    const roster = Array.from({ length: 12 }, (_, i) => player(String(i), 'Player', `Surname${i}`));
    const pool = roster.map((p, i) => article(String(i), `${p.fullName} had a good day`));

    expect(rankNotablePlayers(roster, pool, [], 5)).toHaveLength(5);
  });
});
