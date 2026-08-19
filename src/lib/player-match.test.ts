import { describe, expect, it } from 'vitest';

import { Article } from '@/lib/feeds';
import { matchArticlesForPlayer } from '@/lib/player-match';

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
