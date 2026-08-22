import { Article } from '@/lib/feeds';

/**
 * Groups near-duplicate articles so one story from six outlets is one card.
 *
 * ## Why this helps the small outlets rather than hurting them
 *
 * Not obvious, and it's the strongest argument for the module: six national
 * outlets running the same wire story collapse into a single entry, while
 * beat writers each writing their own local angle don't match and survive
 * as separate ones. The rendered list comes out *more* beat-heavy than the
 * input, before `balanceBySource` even runs. Clustering helps that module
 * rather than fighting it.
 *
 * ## Presentation layer only
 *
 * Never run this inside the news pool. `notable-players.ts` ranks "most
 * talked about" players by counting how many articles name them, and six
 * outlets covering one hire genuinely *is* more coverage than one — collapse
 * that first and the ranking inverts. `source-balance.ts` states the same
 * rule for itself; this falls under the same sentence.
 */

const DEFAULT_THRESHOLD = 0.55;
const DEFAULT_WINDOW_MS = 36 * 60 * 60 * 1000;
const DEFAULT_MIN_SHARED_RARE = 2;

/**
 * How much of the *distinctive* vocabulary two headlines must have in
 * common, as a fraction of the smaller side.
 *
 * Overlap alone is not enough, and this was measured rather than reasoned
 * about. Boilerplate series share almost everything and differ in exactly
 * the word that matters:
 *
 *   "Penn State's Top 10 Players for 2026: #5 Andrew Rappelyea"
 *   "Penn State's Top 10 Players For 2026: No. 4 Marcus Neal Jr."
 *
 *   "25 Michigan high school football defensive stars to watch"
 *   "25 Michigan high school football offensive playmakers to watch"
 *
 * Weighted Dice rates both pairs as near-duplicates because the template
 * dominates the token count. Requiring the *rare* tokens to agree flips
 * that: the player names and offensive/defensive carry nearly all the
 * weight, and they don't overlap at all.
 *
 * The same gate catches the worst failure of the three found live — an AP
 * poll story about Penn State merging with one about Michigan, because the
 * only meaningful difference was the team name.
 */
const MIN_RARE_OVERLAP = 0.5;

/**
 * Words that come in opposing pairs. A headline containing one and a
 * headline containing the other are covering different things, however
 * much boilerplate they share.
 *
 * This exists because raising the similarity threshold is the wrong fix
 * for it. MLive's "25 Michigan high school football defensive stars to
 * watch" and "...offensive playmakers to watch" differ in two words out of
 * nine, so no threshold separates them from genuine duplicates without
 * also blocking the case this module exists for — six outlets writing
 * their own headline about one hire. IDF can't help either: only MLive
 * publishes high-school content here, so the *template* scores as rare.
 *
 * Same species as the domain traps in claim-type.ts — a small, specific
 * rule about how sports headlines are actually written, rather than a
 * number tuned until one day's data looked right.
 */
const CONTRAST_PAIRS: [string, string][] = [
  ['offensive', 'defensive'],
  ['offense', 'defense'],
  ['men', 'women'],
  ['home', 'away'],
  ['win', 'loss'],
  ['first', 'second'],
];

function hasOpposingTerms(a: Set<string>, b: Set<string>): boolean {
  return CONTRAST_PAIRS.some(
    ([left, right]) =>
      (a.has(left) && b.has(right) && !a.has(right) && !b.has(left)) ||
      (a.has(right) && b.has(left) && !a.has(left) && !b.has(right)),
  );
}

/** Beyond this, skip clustering entirely rather than stall. */
const MAX_INPUT = 1500;

/** Sub-minute ordering across independent feeds is noise, not information. */
const LEAD_TIE_MS = 5 * 60 * 1000;

/**
 * Words that carry no discriminative power *inside this app*, where every
 * article is already sport-filtered and often already team-filtered.
 *
 * Team names are deliberately absent: they're the main thing separating
 * "Ohio State fires OC" from "Michigan fires OC". The
 * team-name-is-constant-on-a-team-screen problem is real but is solved far
 * better by the IDF weighting below, which adapts per batch instead of
 * needing a list maintained by hand.
 */
const STOPWORDS = new Set([
  'a', 'an', 'and', 'the', 'to', 'of', 'in', 'on', 'at', 'for', 'from', 'with',
  'by', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'it', 'its', 'this',
  'that', 'these', 'those', 'his', 'her', 'their', 'has', 'have', 'had', 'will',
  'not', 'but', 'or', 'after', 'before', 'into', 'over', 'up', 'down', 'out',
  'college', 'football', 'cfb', 'ncaa', 'fbs', 'big', 'ten', 'b1g', 'bigten',
  'conference', 'game', 'games', 'week', 'weekend', 'saturday', 'sunday',
  'friday', 'season', 'vs', 'v', 'no', 'news', 'update', 'report', 'team',
]);

/** Label prefixes that describe the *article*, not the story. */
const LABEL_PREFIX =
  /^\s*(?:reports?|sources?|breaking|update|exclusive|analysis|instant analysis|column|opinion|commentary|watch|look|photos|video|live|recap|final|notebook|podcast|takeaways)\s*:\s*/i;

/**
 * Minimal plural fold. Not a stemmer — a real one is a dependency and a
 * behavior surface, for a marginal gain on eight-token strings.
 */
function singularize(token: string): string {
  if (token.length >= 5 && token.endsWith('ies')) return `${token.slice(0, -3)}y`;
  if (token.length >= 5 && /(?:s|x|z|ch|sh)es$/.test(token)) return token.slice(0, -2);
  if (token.length >= 5 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
  return token;
}

/**
 * Turns a headline into comparable tokens.
 *
 * Runs on a *derived* string and never mutates the article. `claim-type.ts`
 * depends on `Report:` and `Mailbag:` still being at position 0 — if these
 * prefixes were ever stripped upstream in `feeds.ts` instead, that module
 * would silently degrade.
 */
export function normalizeTitle(title: string, sourceName?: string): string[] {
  if (typeof title !== 'string') return [];

  let text = title
    .toLowerCase()
    // Outlets differ on curly vs straight for the same wire text, which is
    // enough to split a cluster on its own.
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, ' ');

  text = text.replace(LABEL_PREFIX, '');

  // A trailing " - MLive" is the outlet signing its own work. Only stripped
  // when it actually matches this article's source: a blind trailing-dash
  // strip would eat the payload of "Ohio State survives 30-24 - here's how".
  if (sourceName) {
    const escaped = sourceName.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(new RegExp(`\\s*[-–—|:]\\s*${escaped}\\s*$`), '');
  }

  // Possessives before punctuation, or "michigan's" becomes "michigan s"
  // and contributes a junk token.
  text = text.replace(/'s\b/g, '').replace(/s'\b/g, 's');

  return text
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map((t) => t.replace(/^-+|-+$/g, ''))
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .map(singularize);
}

/**
 * Inverse document frequency over *this batch*, not a static table.
 *
 * This is the key decision. It self-tunes for free: on Michigan's team
 * screen "michigan" appears in nearly every headline and drifts to the
 * floor automatically, while on a multi-team feed it stays discriminative.
 * A hand-maintained stopword list cannot do that, and would need editing
 * every time a followed team changed.
 */
const MIN_WEIGHT = 0.05;
const MIN_DOCS_FOR_IDF = 15;

function buildWeights(tokenSets: Set<string>[]): Map<string, number> {
  const weights = new Map<string, number>();
  const n = tokenSets.length;

  // Below this, IDF over so few documents is noise — a token in 1 of 8
  // titles gets a wildly overstated weight. Fall back to unweighted.
  if (n < MIN_DOCS_FOR_IDF) return weights;

  const df = new Map<string, number>();
  for (const tokens of tokenSets) {
    for (const token of tokens) df.set(token, (df.get(token) ?? 0) + 1);
  }
  for (const [token, count] of df) {
    weights.set(token, Math.max(Math.log(n / (1 + count)), MIN_WEIGHT));
  }
  return weights;
}

const weightOf = (weights: Map<string, number>, token: string) => weights.get(token) ?? 1;

/**
 * IDF-weighted Dice.
 *
 * Dice rather than Jaccard because headline lengths differ a lot: a 6-token
 * beat headline fully contained in a 12-token national one scores 0.50 on
 * Jaccard while being unambiguously the same story, and 0.67 here. Overlap
 * coefficient would go further but is too permissive — a 4-token title is
 * trivially "contained" in something unrelated.
 */
function titleSimilarity(
  a: Set<string>,
  b: Set<string>,
  weights: Map<string, number>,
): number {
  if (a.size === 0 || b.size === 0) return 0;

  let shared = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const token of small) {
    if (large.has(token)) shared += weightOf(weights, token);
  }
  if (shared === 0) return 0;

  let total = 0;
  for (const token of a) total += weightOf(weights, token);
  for (const token of b) total += weightOf(weights, token);

  return (2 * shared) / total;
}

export type ClusterableArticle = Pick<
  Article,
  'title' | 'link' | 'source' | 'publishedAt' | 'tier' | 'reach'
>;

export interface Cluster<T extends ClusterableArticle> {
  /** The lead's link — stable, and safe as a React key. */
  id: string;
  lead: T;
  /** Every member including the lead, earliest first. Always at least one. */
  members: T[];
  /** members.length - 1. Zero for a singleton. */
  duplicateCount: number;
  /** Distinct source names other than the lead's, in member order. */
  alsoCoveredBy: string[];
  /**
   * The newest member's timestamp — what a feed should sort by.
   *
   * Note the asymmetry: the *lead* is the earliest member but the cluster's
   * *position* comes from the newest. Sorting by the lead would make an
   * actively developing story sink as it develops. This reads like a bug;
   * it isn't.
   */
  latestPublishedAt: string | null;
}

export interface ClusterOptions {
  threshold?: number;
  windowMs?: number;
  minSharedRareTokens?: number;
}

function timeOf(article: ClusterableArticle): number | null {
  if (!article.publishedAt) return null;
  const t = Date.parse(article.publishedAt);
  return Number.isNaN(t) ? null : t;
}

/**
 * Exactly-midnight timestamps are the signature of a feed publishing dates
 * without times, and several community feeds do it. Treated as end-of-day
 * for *ordering only* — untreated, those sources win "earliest" on every
 * cluster they touch, every day, which is the single largest skew available
 * to the lead rule.
 */
function leadOrderTime(article: ClusterableArticle): number {
  const t = timeOf(article);
  if (t === null) return Number.POSITIVE_INFINITY;
  const d = new Date(t);
  const isMidnight =
    d.getUTCHours() === 0 &&
    d.getUTCMinutes() === 0 &&
    d.getUTCSeconds() === 0 &&
    d.getUTCMilliseconds() === 0;
  return isMidnight ? t + 24 * 60 * 60 * 1000 - 1 : t;
}

/**
 * Earliest published wins, with tier and reach only breaking genuine ties.
 *
 * Leading by tier would hand the top of every cluster back to ESPN and undo
 * what `source-balance.ts` exists to prevent. Earliest-published credits
 * whoever actually broke it.
 *
 * Worth being precise about what this is: a *credit-assignment* rule, not a
 * diversity mechanism. On a big coaching hire the national scoop reporter
 * genuinely was first, and this correctly gives them the lead. The diversity
 * comes from the collapsing described at the top of the file.
 */
function pickLead<T extends ClusterableArticle>(members: T[]): T {
  return members.reduce((best, candidate) => {
    const bestTime = leadOrderTime(best);
    const candidateTime = leadOrderTime(candidate);

    if (Math.abs(bestTime - candidateTime) > LEAD_TIE_MS) {
      return candidateTime < bestTime ? candidate : best;
    }
    // Tied on time: nobody broke it, so there's no credit to assign.
    if (candidate.tier !== best.tier) return candidate.tier < best.tier ? candidate : best;
    // Still tied: prefer the writer closest to the program. Only fires when
    // the primary signal is silent, which is different from overriding it.
    if (candidate.reach !== best.reach) return candidate.reach === 'beat' ? candidate : best;
    // Deterministic, because the lead's link is a React key and a flapping
    // one would remount cards between renders.
    return candidate.link < best.link ? candidate : best;
  });
}

/**
 * Groups near-duplicates.
 *
 * Sorts its input internally, so the result is a function of the input
 * *set* rather than its order — greedy agglomeration is order-sensitive
 * otherwise, and callers shouldn't have to know that.
 *
 * Candidates are compared against each cluster's **lead**, not every
 * member. That's a correctness choice more than a speed one: full
 * single-link clustering allows transitive chaining (A~B, B~C, A≁C), which
 * on a busy news day produces one enormous drifting blob.
 */
export function clusterArticles<T extends ClusterableArticle>(
  articles: T[],
  options?: ClusterOptions,
): Cluster<T>[] {
  const threshold = options?.threshold ?? DEFAULT_THRESHOLD;
  const windowMs = options?.windowMs ?? DEFAULT_WINDOW_MS;
  const minSharedRare = options?.minSharedRareTokens ?? DEFAULT_MIN_SHARED_RARE;

  if (articles.length === 0) return [];
  if (articles.length > MAX_INPUT) {
    // A correctness cliff, and a silent one: the return shape is identical
    // to a feed that genuinely had no duplicates in it, so no caller can
    // tell clustering was skipped. Worth saying out loud because it fires
    // exactly backwards from intuition — clustering turns *off* on the
    // busiest day, when there is the most to collapse.
    console.warn(
      `[cluster] ${articles.length} articles is over MAX_INPUT (${MAX_INPUT}) — skipping clustering, every story stays a singleton`,
    );
    return articles.map((a) => singleton(a));
  }

  // Newest first, nulls last — the same ordering the pools already use.
  const sorted = [...articles].sort((a, b) => {
    const ta = timeOf(a);
    const tb = timeOf(b);
    if (ta === null && tb === null) return a.link < b.link ? -1 : 1;
    if (ta === null) return 1;
    if (tb === null) return -1;
    return tb - ta;
  });

  const tokenSets = sorted.map((a) => new Set(normalizeTitle(a.title, a.source)));
  const weights = buildWeights(tokenSets);

  // Above-median weight is what "rare" means here. One shared rare token is
  // not a story: "Hartline promoted to OC" and "Hartline's WR room in 2027"
  // share exactly the name and would otherwise score high on short titles.
  const allWeights = [...weights.values()].sort((a, b) => a - b);
  const medianWeight = allWeights.length
    ? allWeights[Math.floor(allWeights.length / 2)]
    : Number.POSITIVE_INFINITY;

  // The distinctive half of each headline. Empty on small batches, where
  // IDF is meaningless and the gate below is skipped in favour of plain
  // Dice.
  const rareSets = tokenSets.map(
    (tokens) => new Set([...tokens].filter((t) => weightOf(weights, t) >= medianWeight)),
  );

  const groups: { leadIndex: number; memberIndices: number[] }[] = [];
  const assigned = new Array<boolean>(sorted.length).fill(false);

  for (let i = 0; i < sorted.length; i += 1) {
    if (assigned[i]) continue;
    assigned[i] = true;
    const group = { leadIndex: i, memberIndices: [i] };
    groups.push(group);

    const anchorTime = timeOf(sorted[i]);
    // A null-dated article can't be time-bounded, so it never merges — it
    // is precisely the annual-repeat hazard the window exists to stop.
    if (anchorTime === null) continue;

    for (let j = i + 1; j < sorted.length; j += 1) {
      if (assigned[j]) continue;
      const candidateTime = timeOf(sorted[j]);
      if (candidateTime === null) continue;
      // Sorted descending, so once outside the window everything after is too.
      if (anchorTime - candidateTime > windowMs) break;

      const shared = [...tokenSets[i]].filter((t) => tokenSets[j].has(t));
      const rareShared = shared.filter((t) => weightOf(weights, t) >= medianWeight).length;

      // One shared rare token is not a story: "Hartline promoted to OC" and
      // "Hartline's WR room in 2027" share only the name.
      if (rareShared < minSharedRare && shared.length < 3) continue;

      // And sharing rare tokens is not enough either if each side also has
      // distinctive ones the other lacks — that's a series, not a duplicate.
      const smallerRare = Math.min(rareSets[i].size, rareSets[j].size);
      if (smallerRare > 0 && rareShared / smallerRare < MIN_RARE_OVERLAP) continue;

      if (hasOpposingTerms(tokenSets[i], tokenSets[j])) continue;

      if (titleSimilarity(tokenSets[i], tokenSets[j], weights) >= threshold) {
        assigned[j] = true;
        group.memberIndices.push(j);
      }
    }
  }

  return groups.map(({ memberIndices }) => {
    const members = memberIndices
      .map((index) => sorted[index])
      .sort((a, b) => leadOrderTime(a) - leadOrderTime(b));
    return build(members);
  });
}

function singleton<T extends ClusterableArticle>(article: T): Cluster<T> {
  return {
    id: article.link,
    lead: article,
    members: [article],
    duplicateCount: 0,
    alsoCoveredBy: [],
    latestPublishedAt: article.publishedAt,
  };
}

function build<T extends ClusterableArticle>(members: T[]): Cluster<T> {
  const lead = pickLead(members);

  const alsoCoveredBy: string[] = [];
  const seen = new Set([lead.source]);
  for (const member of members) {
    if (seen.has(member.source)) continue;
    seen.add(member.source);
    alsoCoveredBy.push(member.source);
  }

  const times = members
    .map((m) => m.publishedAt)
    .filter((p): p is string => typeof p === 'string' && p.length > 0)
    .sort();

  return {
    id: lead.link,
    lead,
    members,
    duplicateCount: members.length - 1,
    alsoCoveredBy,
    latestPublishedAt: times.length ? times[times.length - 1] : null,
  };
}

/** A lead carrying what it absorbed, so the rest of the pipeline sees articles. */
export type WithDuplicates<T> = T & { duplicates: T[] };

/**
 * Flattens clusters back to a list of articles, each carrying the ones it
 * absorbed. Everything downstream — `balanceBySource`, the FlatList, the
 * card — then works on articles as before rather than learning about
 * clusters.
 */
export function leadsWithDuplicates<T extends ClusterableArticle>(
  clusters: Cluster<T>[],
): WithDuplicates<T>[] {
  return clusters.map((cluster) => ({
    ...cluster.lead,
    duplicates: cluster.members.filter((m) => m.link !== cluster.lead.link),
  }));
}
