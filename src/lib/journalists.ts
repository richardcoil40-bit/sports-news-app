import { Article } from '@/lib/feeds';

/**
 * There's no API to filter national coverage by reporter reputation, and
 * most top college football writers (The Athletic, Yahoo's Pete Thamel,
 * etc.) publish behind paywalls with no public RSS. This is a best-effort
 * name match against whatever byline (dc:creator/author) the free
 * ESPN/CBS/Yahoo feeds happen to expose — partial coverage, but it's the
 * only honest option without a paid data source.
 */
const NOTABLE_JOURNALISTS = [
  'Pete Thamel',
  'Bruce Feldman',
  'Chris Low',
  'Heather Dinich',
  'Adam Rittenberg',
  'Mark Schlabach',
  'David Hale',
  'Max Olson',
  'Bill Connelly',
  'Ross Dellenger',
  'Dennis Dodd',
  'Brad Crawford',
  'Tom Fornelli',
  'Chip Patterson',
  'Barrett Sallee',
  'John Talty',
  'Matt Zenitz',
  'Eli Lederman',
  'Andrea Adelson',
  'Dan Wetzel',
  'Ralph Russo',
  'Stewart Mandel',
  'Antonio Morales',
  'Nicole Auerbach',
];

const NORMALIZED_JOURNALISTS = NOTABLE_JOURNALISTS.map((name) => name.toLowerCase());

export function isNotableJournalist(author: string | null): boolean {
  if (!author) return false;
  const normalized = author.toLowerCase();
  return NORMALIZED_JOURNALISTS.some((name) => normalized.includes(name));
}

export function filterByNotableJournalists(articles: Article[]): Article[] {
  return articles.filter((a) => isNotableJournalist(a.author));
}
