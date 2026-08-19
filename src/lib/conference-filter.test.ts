import { describe, expect, it } from 'vitest';

import { filterArticlesForTeams } from '@/lib/conference-filter';
import { Article } from '@/lib/feeds';

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

const BIG_TEN_SAMPLE = ['Ohio State', 'Michigan', 'Penn State', 'UCLA'];

describe('filterArticlesForTeams', () => {
  it('keeps articles naming any of the teams', () => {
    const articles = [
      article('a', 'Ohio State wins The Game'),
      article('b', 'Alabama and Georgia set for the SEC title'),
      article('c', 'UCLA upsets a ranked opponent'),
    ];

    const kept = filterArticlesForTeams(articles, BIG_TEN_SAMPLE);

    expect(kept.map((a) => a.id)).toEqual(['a', 'c']);
  });

  it('matches on the description too', () => {
    const articles = [article('a', 'Weekend preview', 'Penn State travels to Rutgers.')];

    expect(filterArticlesForTeams(articles, BIG_TEN_SAMPLE).map((a) => a.id)).toEqual(['a']);
  });

  it('drops everything when no team is named', () => {
    const articles = [
      article('a', 'Alabama rolls'),
      article('b', 'NFL draft stock report'),
    ];

    expect(filterArticlesForTeams(articles, BIG_TEN_SAMPLE)).toEqual([]);
  });

  it('returns nothing when the team list is empty', () => {
    const articles = [article('a', 'Ohio State wins The Game')];

    expect(filterArticlesForTeams(articles, [])).toEqual([]);
  });

  it('handles an empty article list', () => {
    expect(filterArticlesForTeams([], BIG_TEN_SAMPLE)).toEqual([]);
  });

  it('preserves the original order of the articles it keeps', () => {
    const articles = [
      article('a', 'Michigan news'),
      article('b', 'Unrelated'),
      article('c', 'Ohio State news'),
      article('d', 'UCLA news'),
    ];

    expect(filterArticlesForTeams(articles, BIG_TEN_SAMPLE).map((a) => a.id)).toEqual([
      'a',
      'c',
      'd',
    ]);
  });

  it('does not match a team name inside a longer word', () => {
    const articles = [article('a', 'Michigander voters head to the polls')];

    expect(filterArticlesForTeams(articles, ['Michigan'])).toEqual([]);
  });

  it('keeps an article only once even if it names several teams', () => {
    const articles = [article('a', 'Ohio State and Michigan both ranked')];

    expect(filterArticlesForTeams(articles, BIG_TEN_SAMPLE)).toHaveLength(1);
  });
});
