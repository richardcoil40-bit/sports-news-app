import { describe, expect, it } from 'vitest';

import { Article } from '@/lib/feeds';
import { compilePlayerMatcher, matchArticlesForPlayer } from '@/lib/player-match';

function article(id: string, title: string, description = ''): Article {
  return {
    id,
    title,
    link: `https://example.com/${id}`,
    description,
    source: 'Test Source',
    author: null,
    publishedAt: '2025-11-29T00:00:00.000Z',
    imageUrl: null,
    tier: 1,
    reach: 'national',
    scope: 'broad',
  };
}

describe('matchArticlesForPlayer', () => {
  it('prefers full-name matches', () => {
    const articles = [
      article('a', 'Jeremiah Smith goes off for 3 scores'),
      article('b', 'Smith family buys the stadium naming rights'),
    ];

    const matched = matchArticlesForPlayer(articles, {
      fullName: 'Jeremiah Smith',
      lastName: 'Smith',
    });

    expect(matched.map((a) => a.id)).toEqual(['a']);
  });

  it('searches the description as well as the title', () => {
    const articles = [article('a', 'Buckeyes roll', 'Late in the fourth, Will Howard connected twice.')];

    const matched = matchArticlesForPlayer(articles, {
      fullName: 'Will Howard',
      lastName: 'Howard',
    });

    expect(matched.map((a) => a.id)).toEqual(['a']);
  });

  // The last-name fallback only kicks in when the full name appears nowhere —
  // it's the looser signal, so it must not dilute precise matches.
  it('falls back to last name only when there are no full-name matches', () => {
    const articles = [
      article('a', 'Sawyer records two sacks'),
      article('b', 'Unrelated recruiting news'),
    ];

    const matched = matchArticlesForPlayer(articles, {
      fullName: 'Jack Sawyer',
      lastName: 'Sawyer',
    });

    expect(matched.map((a) => a.id)).toEqual(['a']);
  });

  // Short surnames ("Fox", "Day", "Bell") match far too much prose to be a
  // usable signal on their own.
  it('skips the fallback for surnames shorter than 5 characters', () => {
    const articles = [article('a', 'A fox ran onto the field, delaying the game')];

    const matched = matchArticlesForPlayer(articles, {
      fullName: 'Randy Fox',
      lastName: 'Fox',
    });

    expect(matched).toEqual([]);
  });

  it('allows the fallback at exactly 5 characters', () => {
    const articles = [article('a', 'Howard throws for 300')];

    const matched = matchArticlesForPlayer(articles, {
      fullName: 'Will Howard',
      lastName: 'Howard',
    });

    expect(matched.map((a) => a.id)).toEqual(['a']);
  });

  it('returns an empty array when nothing matches', () => {
    const articles = [article('a', 'Completely unrelated headline')];

    expect(
      matchArticlesForPlayer(articles, { fullName: 'Jeremiah Smith', lastName: 'Smith' }),
    ).toEqual([]);
  });

  it('handles an empty article list', () => {
    expect(
      matchArticlesForPlayer([], { fullName: 'Jeremiah Smith', lastName: 'Smith' }),
    ).toEqual([]);
  });

  it('does not match a name embedded in a longer word', () => {
    const articles = [article('a', 'The Smithsonian exhibit opens')];

    expect(
      matchArticlesForPlayer(articles, { fullName: 'Bob Smith', lastName: 'Smith' }),
    ).toEqual([]);
  });
});

describe('the middle-name / suffix case', () => {
  // ESPN's fullName is not what a beat writer types. Matching it alone
  // misses every article about the player, and — before the count and the
  // list shared a matcher — did so on only one of the two screens.
  it('matches first + last when fullName carries a middle name', () => {
    const articles = [article('a', 'Dylan Raiola throws for 300')];

    expect(
      matchArticlesForPlayer(articles, {
        fullName: 'Dylan James Raiola',
        firstName: 'Dylan',
        lastName: 'Raiola',
      }).map((a) => a.id),
    ).toEqual(['a']);
  });

  it('counts as a full-name match, not a surname one', () => {
    const match = compilePlayerMatcher({
      fullName: 'Dylan James Raiola',
      firstName: 'Dylan',
      lastName: 'Raiola',
    });

    expect(match('Dylan Raiola throws for 300')).toBe('full');
    expect(match('Raiola throws for 300')).toBe('last');
    expect(match('Nebraska opens camp')).toBeNull();
  });
});

describe('allowLastName', () => {
  // notable-players.ts says no when two players on the roster share the
  // surname: "Smith had a big day" is then evidence about neither of them.
  it('suppresses the surname fallback when the caller forbids it', () => {
    const articles = [article('a', 'Smith records two sacks')];

    expect(
      matchArticlesForPlayer(
        articles,
        { fullName: 'Jack Smith', firstName: 'Jack', lastName: 'Smith' },
        { allowLastName: false },
      ),
    ).toEqual([]);
  });

  it('still matches the full name when the surname is forbidden', () => {
    const articles = [article('a', 'Jack Smith records two sacks')];

    expect(
      matchArticlesForPlayer(
        articles,
        { fullName: 'Jack Smith', firstName: 'Jack', lastName: 'Smith' },
        { allowLastName: false },
      ).map((a) => a.id),
    ).toEqual(['a']);
  });
});

// An empty needle compiles to a pattern that matches everything, so a
// roster row missing a name would otherwise be "mentioned" by the whole pool.
describe('degrades rather than matching everything', () => {
  it('matches nothing for an empty name', () => {
    const articles = [article('a', 'Some headline')];

    expect(matchArticlesForPlayer(articles, { fullName: '', lastName: '' })).toEqual([]);
  });
});
