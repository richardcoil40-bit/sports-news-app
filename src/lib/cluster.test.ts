import { describe, expect, it } from 'vitest';

import corpus from '@/lib/__fixtures__/cluster-corpus.json';
import {
  Cluster,
  ClusterableArticle,
  clusterArticles,
  leadArticles,
  normalizeTitle,
} from '@/lib/cluster';

let seq = 0;
const article = (
  title: string,
  overrides: Partial<ClusterableArticle> = {},
): ClusterableArticle => ({
  title,
  link: `https://example.com/${seq++}`,
  source: 'Source',
  publishedAt: '2026-08-18T12:00:00.000Z',
  tier: 1,
  reach: 'national',
  ...overrides,
});

const hoursAgo = (h: number) => new Date(Date.parse('2026-08-18T12:00:00.000Z') - h * 3_600_000).toISOString();


describe('normalizeTitle', () => {
  it('drops a label prefix', () => {
    expect(normalizeTitle('Report: Michigan hires Hartline')).toEqual(['michigan', 'hire', 'hartline']);
  });

  it('drops a trailing source signature only when it matches the source', () => {
    expect(normalizeTitle('Michigan hires Hartline - MLive', 'MLive')).toEqual([
      'michigan',
      'hire',
      'hartline',
    ]);
    // Must not eat the payload of a headline that merely contains a dash.
    expect(normalizeTitle("Ohio State survives 30-24 - here's how", 'MLive')).toContain('30-24');
  });

  it('folds possessives rather than splitting them into junk', () => {
    expect(normalizeTitle("Michigan's coordinator")).toEqual(['michigan', 'coordinator']);
  });

  it('normalizes curly quotes, so two outlets of the same wire text agree', () => {
    expect(normalizeTitle('Michigan’s coordinator')).toEqual(normalizeTitle("Michigan's coordinator"));
  });

  it('keeps digits, which are among the most discriminative tokens', () => {
    expect(normalizeTitle('Ohio State wins 30-24')).toContain('30-24');
  });

  it('degrades rather than throwing', () => {
    expect(normalizeTitle('')).toEqual([]);
    expect(normalizeTitle(null as unknown as string)).toEqual([]);
  });
});

describe('grouping', () => {
  // Six outlets, six different headlines, one story.
  it('collapses one story written up by many outlets', () => {
    const clusters = clusterArticles([
      article('Michigan hires Brian Hartline as offensive coordinator', { source: 'MLive' }),
      article('Brian Hartline hired as Michigan offensive coordinator', { source: 'ESPN' }),
      article('Michigan names Brian Hartline its new offensive coordinator', { source: 'CBS' }),
      article('Report: Michigan hires Brian Hartline to coordinate the offense', { source: 'Yahoo' }),
    ]);

    expect(clusters).toHaveLength(1);
    expect(clusters[0].members).toHaveLength(4);
    expect(clusters[0].duplicateCount).toBe(3);
    expect(clusters[0].alsoCoveredBy).toHaveLength(3);
  });

  // Over-clustering silently deletes news, and it is the error a user
  // notices immediately — a "+3 more" hiding three different stories.
  it('does not merge different stories about the same person', () => {
    const clusters = clusterArticles([
      article('Brian Hartline promoted to offensive coordinator'),
      article("Brian Hartline's receiver room looks loaded in 2027"),
    ]);

    expect(clusters).toHaveLength(2);
  });

  it('does not merge two different games on the same day', () => {
    const clusters = clusterArticles([
      article('Michigan beats Ohio State 30-24'),
      article('Penn State beats Iowa 17-10'),
    ]);

    expect(clusters).toHaveLength(2);
  });

  it('leaves unrelated headlines alone', () => {
    const clusters = clusterArticles([
      article('Michigan hires a coordinator'),
      article('Iowa announces its captains'),
      article('Nebraska opens fall camp'),
    ]);

    expect(clusters).toHaveLength(3);
  });
});

describe('the time window', () => {
  const same = 'Michigan opens fall camp with a new quarterback';

  it('merges two versions inside the window', () => {
    const clusters = clusterArticles([
      article(same, { source: 'A', publishedAt: hoursAgo(0) }),
      article(same, { source: 'B', publishedAt: hoursAgo(20) }),
    ]);
    expect(clusters).toHaveLength(1);
  });

  it('does not merge across the window', () => {
    const clusters = clusterArticles([
      article(same, { source: 'A', publishedAt: hoursAgo(0) }),
      article(same, { source: 'B', publishedAt: hoursAgo(40) }),
    ]);
    expect(clusters).toHaveLength(2);
  });

  // The reason the window is a correctness requirement rather than an
  // optimization: sports headlines recur verbatim every year.
  it('does not merge a headline with its own anniversary', () => {
    const clusters = clusterArticles([
      article(same, { source: 'A', publishedAt: '2026-08-18T12:00:00.000Z' }),
      article(same, { source: 'A', publishedAt: '2025-08-18T12:00:00.000Z' }),
    ]);
    expect(clusters).toHaveLength(2);
  });

  it('never merges an article with no timestamp', () => {
    const clusters = clusterArticles([
      article(same, { source: 'A', publishedAt: hoursAgo(0) }),
      article(same, { source: 'B', publishedAt: null }),
    ]);
    expect(clusters).toHaveLength(2);
  });
});

describe('lead selection', () => {
  const same = 'Michigan hires Brian Hartline as offensive coordinator';

  it('credits whoever published first', () => {
    const clusters = clusterArticles([
      article(same, { source: 'ESPN', publishedAt: hoursAgo(2) }),
      article(same, { source: 'MLive', publishedAt: hoursAgo(5) }),
    ]);

    expect(clusters[0].lead.source).toBe('MLive');
    expect(clusters[0].alsoCoveredBy).toEqual(['ESPN']);
  });

  // Untreated, a feed that publishes dates without times wins "earliest" on
  // every cluster it touches, every day.
  it('treats an exactly-midnight timestamp as end of day', () => {
    const clusters = clusterArticles([
      article(same, { source: 'DateOnly', publishedAt: '2026-08-18T00:00:00.000Z' }),
      article(same, { source: 'Timed', publishedAt: '2026-08-18T09:00:00.000Z' }),
    ]);

    expect(clusters[0].lead.source).toBe('Timed');
  });

  it('breaks a near-simultaneous tie on tier', () => {
    const clusters = clusterArticles([
      article(same, { source: 'Blog', tier: 3, publishedAt: '2026-08-18T12:00:00.000Z' }),
      article(same, { source: 'Newsroom', tier: 1, publishedAt: '2026-08-18T12:02:00.000Z' }),
    ]);

    expect(clusters[0].lead.source).toBe('Newsroom');
  });

  it('prefers beat coverage when tier ties too', () => {
    const clusters = clusterArticles([
      article(same, { source: 'National', tier: 1, reach: 'national', publishedAt: '2026-08-18T12:00:00.000Z' }),
      article(same, { source: 'Beat', tier: 1, reach: 'beat', publishedAt: '2026-08-18T12:01:00.000Z' }),
    ]);

    expect(clusters[0].lead.source).toBe('Beat');
  });

  // The lead's link is a React key; a flapping lead would remount cards.
  it('is deterministic when everything ties', () => {
    const build = () => [
      { ...article(same, { source: 'A' }), link: 'https://a.test/1' },
      { ...article(same, { source: 'B' }), link: 'https://b.test/1' },
    ];
    const forward = clusterArticles(build());
    const reversed = clusterArticles(build().reverse());

    expect(forward[0].lead.link).toBe(reversed[0].lead.link);
  });
});

describe('ordering', () => {
  // Counterintuitive and load-bearing: the lead is the earliest member but
  // the cluster's position comes from the newest, so a developing story
  // doesn't sink as it develops.
  it('leads with the earliest but reports the newest timestamp', () => {
    const same = 'Michigan hires Brian Hartline as offensive coordinator';
    const clusters = clusterArticles([
      article(same, { source: 'Late', publishedAt: hoursAgo(1) }),
      article(same, { source: 'First', publishedAt: hoursAgo(6) }),
    ]);

    expect(clusters[0].lead.source).toBe('First');
    expect(clusters[0].latestPublishedAt).toBe(hoursAgo(1));
  });

  // Greedy grouping is order-sensitive unless the module sorts internally.
  it('gives the same clusters whatever order the input arrives in', () => {
    const build = () => [
      article('Michigan hires Brian Hartline as offensive coordinator', { source: 'A', publishedAt: hoursAgo(1) }),
      article('Brian Hartline hired as Michigan offensive coordinator', { source: 'B', publishedAt: hoursAgo(2) }),
      article('Iowa announces its captains for 2026', { source: 'C', publishedAt: hoursAgo(3) }),
    ];

    const key = (cs: Cluster<ClusterableArticle>[]) =>
      cs.map((c) => c.members.map((m) => m.source).sort().join('+')).sort();

    expect(key(clusterArticles(build()))).toEqual(key(clusterArticles(build().reverse())));
  });
});

describe('degenerate inputs', () => {
  it('handles an empty list', () => {
    expect(clusterArticles([])).toEqual([]);
  });

  it('handles one article', () => {
    const clusters = clusterArticles([article('Michigan hires a coordinator')]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].duplicateCount).toBe(0);
    expect(clusters[0].alsoCoveredBy).toEqual([]);
  });

  it('handles identical titles', () => {
    const same = 'Michigan hires Brian Hartline as offensive coordinator';
    expect(clusterArticles([article(same), article(same), article(same)])).toHaveLength(1);
  });

  it('handles empty titles without merging them all together', () => {
    const clusters = clusterArticles([article(''), article('')]);
    expect(clusters).toHaveLength(2);
  });

  it('skips clustering entirely past the safety cap', () => {
    const same = 'Michigan hires Brian Hartline as offensive coordinator';
    const many = Array.from({ length: 1600 }, () => article(same));
    expect(clusterArticles(many)).toHaveLength(1600);
  });

  it('stays fast on a realistically large feed', () => {
    const many = Array.from({ length: 500 }, (_, i) =>
      article(`Michigan story number ${i} about the offense`, { publishedAt: hoursAgo(i % 30) }),
    );
    const started = Date.now();
    clusterArticles(many);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe('leadArticles', () => {
  it('unwraps to the leads', () => {
    const clusters = clusterArticles([
      article('Michigan hires a coordinator'),
      article('Iowa announces its captains'),
    ]);
    expect(leadArticles(clusters)).toHaveLength(2);
  });

  it('passes extra fields through', () => {
    const clusters = clusterArticles([
      { ...article('Michigan hires a coordinator'), claimType: 'reported' as const },
    ]);
    expect(leadArticles(clusters)[0].claimType).toBe('reported');
  });
});

/**
 * All three were real over-merges, found by running this against a live
 * feed rather than by reasoning about it. Each one silently hid a real
 * article behind another article's "+1", which is the error a reader
 * notices immediately.
 */
describe('boilerplate series must not collapse', () => {
  // The distinguishing word is the entire point of the headline, and the
  // template around it dominates the token count.
  // Two words out of nine, and no similarity threshold separates this from
  // a genuine duplicate without also blocking six outlets writing their own
  // headline about one hire. Hence the contrast-pair rule.
  it('keeps an offensive/defensive pair apart', () => {
    const clusters = clusterArticles([
      article('25 Michigan high school football defensive stars to watch in 2026'),
      article('25 Michigan high school football offensive playmakers to watch in 2026'),
    ]);
    expect(clusters).toHaveLength(2);
  });

  it('still merges a contrast word when both sides have it', () => {
    const same = 'Michigan hires Brian Hartline as offensive coordinator';
    const clusters = clusterArticles([
      article(same, { source: 'A' }),
      article('Brian Hartline named Michigan offensive coordinator', { source: 'B' }),
    ]);
    expect(clusters).toHaveLength(1);
  });
});

describe('titles that only share one rare word', () => {
  it('needs more than a shared surname to merge', () => {
    const clusters = clusterArticles([
      article('Hartline promoted'),
      article('Hartline recruiting'),
    ]);
    expect(clusters).toHaveLength(2);
  });
});

/**
 * Clustering is corpus-dependent by design — the rare-token weighting reads
 * how common a word is *in this batch*. That makes it untestable against a
 * handful of invented headlines: a synthetic corpus gives synthetic
 * statistics, and an early attempt at these cases passed or failed
 * depending on how the filler was worded rather than on the code.
 *
 * So this suite runs against a real captured feed. Every assertion below is
 * a merge that actually happened, or an over-merge that actually happened
 * and was fixed. See __fixtures__/README.md.
 */
describe('against a real captured feed', () => {
  const articles = corpus as ClusterableArticle[];
  const clusters = clusterArticles(articles);
  const merged = clusters.filter((c) => c.duplicateCount > 0);

  const groupContaining = (fragment: string) =>
    merged.find((c) => c.members.some((m) => m.title.includes(fragment)));

  it('reduces the card count without losing an article', () => {
    expect(clusters.length).toBeLessThan(articles.length);
    expect(clusters.reduce((n, c) => n + c.members.length, 0)).toBe(articles.length);
  });

  describe('merges genuine duplicates', () => {
    // SB Nation syndicates its own team blogs, so the identical headline
    // appears twice under two names. This is most of the real duplication.
    const syndicated = [
      'Max Granville',
      'Opponent Preview: UCLA',
      'best offense at Ohio State',
      'Monday Night Therapy',
    ];

    for (const fragment of syndicated) {
      it(`"${fragment}"`, () => {
        expect(groupContaining(fragment)?.duplicateCount).toBe(1);
      });
    }

    // The case the module exists for: two outlets, two different wordings,
    // one event. Nothing in a synthetic test proves this works.
    it('merges differently-worded coverage of one event', () => {
      const group = groupContaining('AP Top 25 poll');
      expect(group?.duplicateCount).toBe(1);
      expect(group?.members.map((m) => m.source).sort()).toEqual(['CBS Sports', 'ESPN']);
    });
  });

  /**
   * Each of these merged at some point during development and had to be
   * fixed. Over-merging silently hides a real article behind another one's
   * "+1", which is the error a reader notices immediately.
   */
  describe('does not over-merge', () => {
    const mustStayApart: [string, string, string][] = [
      [
        'a numbered series',
        "Top 10 Players for 2026: #5",
        'Top 10 Players For 2026: No. 4',
      ],
      [
        'an offensive/defensive pair',
        'high school football defensive',
        'high school football offensive',
      ],
      [
        'the same story about two different teams',
        'AP Poll of 2026 is here',
        'Preseason AP Poll: Where Michigan',
      ],
    ];

    for (const [label, a, b] of mustStayApart) {
      it(label, () => {
        const groupA = clusters.find((c) => c.members.some((m) => m.title.includes(a)));
        const groupB = clusters.find((c) => c.members.some((m) => m.title.includes(b)));
        expect(groupA).toBeDefined();
        expect(groupB).toBeDefined();
        expect(groupA?.id).not.toBe(groupB?.id);
      });
    }
  });

  it('merges nothing it cannot justify', () => {
    // Every merge in this corpus was reviewed by hand. If a change starts
    // merging more, look at what it merged before raising this number.
    expect(merged).toHaveLength(5);
  });
});
