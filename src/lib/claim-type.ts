// `type` matters: Node's type-stripping (scripts/lib/app-modules.mjs) emits
// a real import for a bare `import {...}`, which fails at runtime because
// Article has no value export — and it would drag fast-xml-parser in besides.
import type { Article } from '@/lib/feeds';

/**
 * What kind of claim a headline is making — the app's second axis of
 * honesty, alongside the source tier.
 *
 * `docs/source-reliability.md` splits trust into two questions: is the
 * *source* reliable (slow-moving, answered by the tier), and is *this
 * particular claim* credible (changes article to article). Tiers answer the
 * first. This answers the second, and the two are meant to be read together
 * — a rumor from a newsroom and a rumor from a fan blog are different
 * things, and neither badge alone says so.
 *
 * Four values, matching what the UI shows so code and product share one
 * vocabulary:
 *   reported  — something happened
 *   rumor     — speculation, or sourced only to anonymous people
 *   take      — opinion: columns, rankings, grades, predictions
 *   unlabeled — neither classifier had a signal, and the badge says so
 *               instead of guessing. Only ever produced by the merge in
 *               `withClaimTypes` (no local lexicon evidence AND no remote
 *               verdict); `classifyClaim` itself never returns it, so its
 *               offline default stays `reported`.
 *
 * ## What this is and isn't
 *
 * It reads headline *grammar*, not truth. It can tell that a headline
 * asserts something happened; it cannot tell whether the thing is true.
 * That is why the label says REPORTED and never FACT.
 *
 * Expect roughly 80-85% agreement with a careful human in a normal week,
 * falling in December when the coaching carousel makes real news and rumor
 * share every word. The biggest blind spot has no lexical fix: a column
 * with a flat declarative headline ("Michigan's defense has a problem")
 * looks exactly like reporting. Fixing that needs a byline signal — a
 * match on the author against known columnists — which nothing here does
 * today. `Article.author` is already parsed and available; what makes it
 * harder than it looks is coverage and list rot, written up in
 * `docs/deferred-work.md` §3a. Read that before rebuilding it.
 *
 * ## The asymmetry that governs every decision here
 *
 * `reported` is the default and an article only leaves it on positive
 * evidence. The two errors are not equal: a rumor left in the main feed is
 * the status quo everywhere else and costs the reader nothing they don't
 * already have. A real, sourced report misfiled as a rumor is the app
 * lying about a story — and it damages beat reporting worst, because a
 * local writer's own scoop is more likely to be phrased with hedges than an
 * ESPN wire piece is. Bias every rule toward leaving things alone.
 *
 * The same asymmetry governs `unlabeled`: it surfaces wherever `reported`
 * does (see brief.ts), because the no-signal pile is mostly real news —
 * routing it to chatter would recreate the misfiled-scoop error at scale.
 * It changes what the badge claims, never what gets shown.
 */
export type ClaimType = 'reported' | 'rumor' | 'take' | 'unlabeled';

const LABELS: Record<ClaimType, string> = {
  reported: 'Reported',
  rumor: 'Rumor',
  take: 'Take',
  unlabeled: 'Unlabeled',
};

export function claimTypeLabel(type: ClaimType): string {
  // Falls back to the default rather than throwing: this value will one day
  // arrive over a network from a model, and an unexpected string must render
  // the least-committal label rather than nothing.
  return LABELS[type] ?? LABELS.reported;
}

/**
 * One alternation instead of N separate tests. The lexicons below total a
 * few hundred entries and the feed can be a few hundred articles; compiling
 * per article, or testing each entry separately, is the difference between
 * a millisecond and a visible pause.
 */
function phraseRegex(phrases: string[]): RegExp {
  const escaped = phrases.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`\\b(?:${escaped.join('|')})\\b`, 'i');
}

/** `Mailbag:` and friends — the marker is the *position*, not the word. */
function prefixRegex(labels: string[]): RegExp {
  return new RegExp(`^\\s*(?:${labels.join('|')})\\s*:`, 'i');
}

// ---------------------------------------------------------------------------
// Quote stripping
// ---------------------------------------------------------------------------

/**
 * Removes quoted spans before any hedge or stance matching.
 *
 * `Day: "We could have played better"` is a press conference — reported —
 * but it contains "could". Coaches speak in hedges constantly, so without
 * this every quote headline reads as speculation.
 *
 * The `{3,}` and the closing lookahead on the single-quote form are both
 * load-bearing: an unguarded `'…'` pattern treats the gap between two
 * possessives ("Michigan's ... Ohio State's") as one enormous quote and
 * eats the middle of the headline.
 */
const DOUBLE_QUOTED = /["“”][^"“”]{3,}["“”]/g;
const SINGLE_QUOTED = /(?:^|\s)['‘][^'’]{3,}['’](?=\s|$|[.,!?])/g;

function stripQuotes(text: string): string {
  return text.replace(DOUBLE_QUOTED, ' ').replace(SINGLE_QUOTED, ' ');
}

// ---------------------------------------------------------------------------
// Evidence that something actually happened. These veto `rumor`.
// ---------------------------------------------------------------------------

/**
 * `Report:` at the head of a headline is ESPN's and CBS's marker for a
 * *confirmed* scoop — the opposite of a hedge. This single pattern is why
 * substring matching is unacceptable here: `report` appears in `Report:`
 * (reported), `reportedly` (rumor), `report card` (take) and `reporter`
 * (nothing), and a naive `includes('report')` gets three of the four wrong.
 */
const SCOOP_PREFIX = prefixRegex(['reports?', 'breaking', 'confirmed', 'official', 'exclusive']);

/** Things that have already happened. Word-boundary matched. */
const COMPLETED_EVENTS = phraseRegex([
  'hired', 'hires', 'fired', 'fires', 'named', 'names', 'announced', 'announces',
  'signed', 'signs', 'committed', 'commits', 'decommitted', 'decommits',
  'flipped', 'flips', 'agreed', 'agrees', 'arrested', 'charged', 'indicted',
  'suspended', 'reinstated', 'benched', 'promoted', 'demoted', 'released',
  'waived', 'retired', 'retires', 'resigned', 'resigns', 'dismissed', 'ejected',
  'transferred', 'enrolled', 'enrolls', 'hospitalized', 'died', 'dies',
  'wins', 'won', 'beats', 'beat', 'defeats', 'defeated', 'upsets', 'upset',
  'loses', 'lost', 'falls', 'fell', 'clinches', 'clinched', 'advances',
  'eliminated', 'undergoes', 'underwent', 'tears', 'tore',
  // Multi-word: a word-boundary match on "down" or "out" alone is meaningless.
  'stepped down', 'steps down', 'ruled out', 'will miss', 'out for the season',
  'parts ways', 'let go',
]);

const OFFICIAL_LANGUAGE = phraseRegex([
  'officially', 'made it official', 'confirms', 'confirmed', 'press conference',
  'introduced as', 'released a statement', 'in a statement', 'the school announced',
  'the university announced', 'signed a contract', 'agreed to terms', 'has been named',
]);

/**
 * A score or a record — very strong evidence a game happened.
 *
 * The `{1,2}` bound is what keeps `4-star` (digit-hyphen-letter), `2025-26`
 * (four digits) and a bare year out of it.
 */
const SCORE_LIKE = /\b\d{1,2}-\d{1,2}\b/;

/**
 * The CFP, AP and Coaches poll *releases* are news events: a committee met
 * and published a result. Without this they collide with the ranking
 * vocabulary below, and every Tuesday night in November turns into takes.
 */
const POLL_RELEASE =
  /\b(?:cfp|college football playoff|college football|ap|coaches|selection committee)\s+(?:preseason\s+)?(?:poll|rankings?|top\s*\d+)\b|\b(?:\d+(?:st|nd|rd|th)|first|final|initial|preseason)\s+(?:ap\s+)?(?:poll|rankings)\b|\brankings?\s+released\b/i;

// ---------------------------------------------------------------------------
// Rumor
// ---------------------------------------------------------------------------

/**
 * Anonymous sourcing. The one lexicon allowed to read the description too,
 * because these phrases are unambiguous wherever they appear.
 *
 * Deliberately excludes `told ESPN` / `told Yahoo` — naming the outlet is
 * attribution of a real interview, which is reporting. Also excludes bare
 * `source`/`sources`, which match "a source of frustration".
 */
const ANONYMOUS_SOURCING = phraseRegex([
  'sources say', 'sources said', 'sources tell', 'sources told', 'per sources',
  'per source', 'according to sources', 'according to a source', 'league sources',
  'industry sources', 'a source told', 'a source with knowledge', 'multiple sources',
  'sources familiar', 'people familiar with', 'a person familiar with',
  'speaking on condition of anonymity', 'requested anonymity', 'on background',
  'has learned', 'learned exclusively',
]);

const SOURCES_PREFIX = prefixRegex(['sources?']);

const SECONDHAND = phraseRegex([
  'reportedly', 'reported to be', 'is said to be', 'said to be', 'per a report',
  'per multiple reports', 'report says', 'reports say', 'reports indicate',
  'report indicates', 'according to a report',
  'believed to be', 'appears to be',
]);

/**
 * "We're hearing" — phrase forms only.
 *
 * Bare `hearing` is banned outright. In college football it is
 * overwhelmingly a legal or NCAA-procedural noun: infractions hearings,
 * eligibility hearings, a judge setting a hearing. Those are hard news, and
 * matching the bare word is one of the worst false positives available.
 * `buzz` is likewise phrase-only — Buzz is a real first name.
 */
const CHATTER = phraseRegex([
  "what we're hearing", "what i'm hearing", "we're hearing", "i'm hearing",
  "what i'm told", "what we're told", 'buzz around', 'the latest buzz',
  'recruiting buzz', 'coaching buzz', 'rumor', 'rumors', 'rumored', 'rumor mill',
  'chatter', 'whispers', 'scuttlebutt',
]);

/**
 * Hasn't happened yet.
 *
 * Bare `set to` is excluded: in a sports feed it is schedule-speak far more
 * often than rumor-speak ("set to face Ohio State", "set to kick off at
 * noon"). Bare `nearing` too — "nearing a return from injury" is a reported
 * medical status. Only the deal/decision forms appear.
 */
const NOT_YET = phraseRegex([
  'expected to', 'is expected', 'are expected', 'was expected', 'widely expected',
  'poised to', 'in line to', 'on track to', 'in the mix for', 'in play for',
  'closing in on', 'zeroing in on', 'nearing a deal', 'nearing an agreement',
  'nearing a decision', 'finalizing', 'in talks', 'in discussions', 'negotiating',
  'agreement in principle', 'trending toward', 'trending to', 'leaning toward',
  'leaning to', 'plans to', 'intends to', 'set to decide', 'set to hire',
  'set to be named', 'no decision yet', 'has yet to decide', 'weighing', 'mulling',
  'considering', 'exploring', 'contemplating', 'could be on the move',
]);

/**
 * The coaching-carousel and recruiting-rumor vocabulary — the domain core.
 *
 * `targeting` is absent on purpose: it is a **penalty**. "Ejected for
 * targeting", "targeting call overturned", "suspended a half for targeting"
 * are all hard news and extremely common. Only the noun phrases are listed.
 *
 * `crystal ball` and `futurecast` are the literal product names of
 * 247Sports' and Rivals' prediction systems, so anything citing them is a
 * prediction by construction — not a dead metaphor.
 */
const CAROUSEL = phraseRegex([
  'coaching search', 'coaching carousel', 'candidates to replace', 'coaching candidate',
  'head coaching candidate', 'candidate for the job', 'candidate to replace',
  'names to watch', 'names to know', 'shortlist', 'short list', 'front-runner',
  'frontrunner', 'emerging as', 'emerged as a', 'top target', 'primary target',
  'transfer target', 'portal target', 'coaching target', 'has interest in',
  'showing interest', 'mutual interest', 'drawing interest', 'has reached out',
  'made contact with', 'linked to', 'linked with', 'monitoring', 'eyeing',
  'pursuing', 'could be a fit', 'would make sense', 'silent commit', 'soft commit',
  'crystal ball', 'futurecast', 'predicted to', 'expected to enter the portal',
  'expected to transfer', 'plans to enter the portal', 'testing the waters',
  'could hit the portal', 'buyout talks',
]);

/**
 * Modal hedges. Title only — RSS teasers are auto-generated lede prose and
 * are full of these as ordinary writing.
 *
 * `may` is excluded entirely. It is the month, and this is a sport whose
 * calendar revolves around May signing periods and May portal windows.
 * There is no cheap disambiguation, and `could`/`might` cover the same
 * meaning with none of the collision. `will` and `would` are excluded for
 * the opposite reason: "Michigan will play at noon" is a fact.
 */
const HEDGES = phraseRegex([
  'could', 'might', 'likely', 'unlikely', 'possibly', 'potentially', 'apparently',
  'seemingly', 'presumably', 'perhaps',
]);

/**
 * The bare-infinitive scoop form: "Michigan to hire Brian Hartline". Means
 * "will, but hasn't yet". Personnel verbs only — "to play", "to host", "to
 * face" are all schedule facts.
 */
const INFINITIVE_SCOOP =
  /\bto\s+(?:be\s+)?(?:hire|hired|name|named|join|leave|depart|replace|become|transfer|step\s+down|be\s+promoted|be\s+fired|be\s+let\s+go)\b/i;

// ---------------------------------------------------------------------------
// Take
// ---------------------------------------------------------------------------

const TAKE_PREFIX = prefixRegex([
  'opinion', 'column', 'commentary', 'analysis', 'instant analysis', 'film study',
  'film room', 'mailbag', 'roundtable', 'debate', 'hot take', 'editorial',
  'notebook', 'rewatch', 'film review', 'staff picks', 'predictions', 'takeaways',
]);

const TAKE_FORMS = phraseRegex([
  'mailbag', 'mail bag', 'overreaction', 'overreactions', 'takeaways',
  'observations', 'what we learned', 'things we learned', 'winners and losers',
  'winners, losers', 'stock up', 'stock down', 'stock report', 'report card',
  'grades', 'grading', 'best and worst', 'the good, the bad', 'burning questions',
  'biggest questions', 'unanswered questions', 'the case for', 'the case against',
  'point-counterpoint', 'roundtable', 'my ballot', 'ap ballot', 'exit interview',
  'season in review', 'midseason awards', 'awards watch', 'heisman watch',
  'panic meter', 'time to panic', 'unpopular opinion', 'hot take', 'bold prediction',
  'bold predictions', 'way-too-early', 'way too early', 'too early to', 'hot seat',
  'hot-seat', 'coaching hot seat', 'power rankings', 'power poll', 'bowl projections',
  'playoff projections', 'cfp projections', 'mock draft', 'nfl mock draft',
  'breakout candidate', 'x-factor', 'most improved', 'underrated', 'overrated',
  'must-win', 'keys to the game', 'what to watch', 'biggest storylines',
  'staff picks', 'expert picks', 'picks and predictions', 'against the spread',
  'best bets', 'sleeper', 'predictions', 'predicting', 'analyzing', 'position preview',
  // The preview family, phrase forms only. Bare `preview` stays out of
  // here on the same doctrine as every bare word (see CHATTER's note) —
  // and it already has a different job below, in SERVICE_JOURNALISM,
  // where it *suppresses* the question-mark rule for listings pages. The
  // two never collide: these phrases decide a headline is a take before
  // the question rule runs, and a "how to watch ... preview?" headline
  // contains none of them.
  'opponent preview', 'game preview', 'season preview', 'matchup preview',
  'players to watch', 'player to watch', 'risers', 'pros and cons', 'roundtable',
]);

/**
 * Evaluative judgments — opinions with no prescriptive word in them.
 * "Green Bay won the trade" asserts a verdict, not an event, but STANCE
 * below only knows should/must. Phrase forms only, per the bare-word
 * doctrine; and gated on ATTRIBUTED at the call site exactly like STANCE,
 * because "Arrington says Green Bay won the trade" is a quote about
 * someone else's evaluation — whether *that* deserves a take badge is a
 * semantic call about who is speaking, which is the remote classifier's
 * job (see withClaimTypes).
 *
 * A second, quieter job in classifyClaimDetailed: when one of these
 * phrases is present, the completed-event reading of its verb is off the
 * table — the "won" in "won the trade" is a verdict, not a score — so it
 * suppresses hasCompletedEvidence. Without that, an attributed trade
 * verdict would count as positive `reported` evidence and the merge would
 * never let the remote classifier near the one case it exists to fix.
 */
const EVALUATIVE = phraseRegex([
  // Article-less forms too: headline-ese drops "the" ("says Green Bay won
  // trade for Parsons"), and the with-article form alone misses it.
  'won the trade', 'lost the trade', 'wins the trade', 'loses the trade',
  'won trade', 'lost trade', 'wins trade', 'loses trade',
  'won the deal', 'lost the deal', 'winner of the trade', 'loser of the trade',
  'biggest winner', 'biggest winners', 'biggest loser', 'biggest losers',
  'biggest snub', 'biggest snubs', 'deserved better', 'deserves better',
]);

/**
 * The *gerund* ranking forms. Bare `rankings` is banned — see POLL_RELEASE;
 * a poll release is a news event, "Ranking every Big Ten stadium" is a
 * column.
 */
const RANKING_GERUND =
  /\branking\s+(?:the|every|all|each|top)\b|\bre-?ranking\b|,\s*ranked\s*$|\b(?:player|position|prospect|team)\s+rankings\b|\btop\s*\d+\s+(?:player|prospect|team)/i;

/** "5 things we learned" — requires the noun, so "3 players arrested" is safe. */
const LISTICLE =
  /^\s*(?:\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:things|takeaways|thoughts|questions|reasons|observations|storylines|bold|predictions|winners|losers|lessons|burning)\b/i;

const STANCE = /\bshould\b|\bneeds to\b|\bmust\b|\bhere'?s why\b|\bwhy\s+\w+\s+(?:will|won'?t|can'?t|should|must)\b|\bi think\b|\bmy take\b/i;

/** Attribution turns a stance into a quote about someone else's stance. */
const ATTRIBUTED = /\b(?:says|said|tells|told|explains|on why)\b/i;

// ---------------------------------------------------------------------------
// Question headlines
// ---------------------------------------------------------------------------

const ENDS_IN_QUESTION = /\?\s*$/;

/** Listings pages: "Michigan vs. Ohio State: What time, TV channel?" */
const SERVICE_JOURNALISM = phraseRegex([
  'what time', 'tv channel', 'what channel', 'how to watch', 'where to watch',
  'live stream', 'kickoff time', "who's playing", 'point spread', 'betting line',
  'odds', 'prediction', 'preview',
]);

// ---------------------------------------------------------------------------

function hasCompletedEvidence(title: string): boolean {
  return (
    SCOOP_PREFIX.test(title) ||
    COMPLETED_EVENTS.test(title) ||
    OFFICIAL_LANGUAGE.test(title) ||
    SCORE_LIKE.test(title) ||
    POLL_RELEASE.test(title)
  );
}

function looksLikeTake(rawTitle: string, strippedTitle: string): boolean {
  if (TAKE_PREFIX.test(rawTitle)) return true;
  if (LISTICLE.test(rawTitle)) return true;
  if (RANKING_GERUND.test(rawTitle)) return true;
  // A poll release mentions rankings without being a ranking piece.
  if (TAKE_FORMS.test(strippedTitle) && !POLL_RELEASE.test(rawTitle)) return true;
  // "Day says Michigan should be ranked higher" is a quote, not a column.
  if (STANCE.test(strippedTitle) && !ATTRIBUTED.test(rawTitle)) return true;
  // Same attribution gate as STANCE — see EVALUATIVE's comment.
  if (EVALUATIVE.test(strippedTitle) && !ATTRIBUTED.test(rawTitle)) return true;
  return false;
}

function looksLikeRumor(strippedTitle: string, description: string): boolean {
  return (
    SOURCES_PREFIX.test(strippedTitle) ||
    ANONYMOUS_SOURCING.test(strippedTitle) ||
    ANONYMOUS_SOURCING.test(description) ||
    SECONDHAND.test(strippedTitle) ||
    CHATTER.test(strippedTitle) ||
    NOT_YET.test(strippedTitle) ||
    CAROUSEL.test(strippedTitle) ||
    HEDGES.test(strippedTitle) ||
    INFINITIVE_SCOOP.test(strippedTitle)
  );
}

/**
 * Whether a classification came from a lexicon actually firing, or from
 * falling through to the default. The two used to be indistinguishable —
 * `reported` was returned identically for "positive completed-event
 * evidence" and "nothing matched at all" — and the difference is exactly
 * what the merge policy in `withClaimTypes` turns on.
 */
export type ClaimBasis = 'evidence' | 'default';

export interface LocalClaim {
  type: ClaimType;
  basis: ClaimBasis;
}

/**
 * Classifies a headline, reporting whether the answer is evidence or the
 * default. Never returns `unlabeled` — that is the merge's word for "no
 * signal from anyone", and this function is only one of the two anyones.
 *
 * Order is deliberate:
 *   1. `take` first. Format markers ("Mailbag:", "power rankings") are far
 *      higher precision than hedge words, and a ranking full of "could" is
 *      still a ranking. Calling a hot-take column a rumor also implies
 *      someone anonymously sourced an opinion, which reads as broken.
 *   2. `rumor` only when nothing says the thing already happened. So
 *      "Sources: Michigan has fired its OC" is *reported* — the firing
 *      happened, it is merely single-sourced, and how much to trust a
 *      single source is the tier badge's job. Conflating those two axes is
 *      the mistake docs/source-reliability.md exists to prevent.
 *   3. `reported` otherwise — as the default, not as a finding.
 */
export function classifyClaimDetailed(
  article: Pick<Article, 'title' | 'description'>,
): LocalClaim {
  const title = typeof article.title === 'string' ? article.title : '';
  const description = typeof article.description === 'string' ? article.description : '';
  if (!title.trim()) return { type: 'reported', basis: 'default' };

  const stripped = stripQuotes(title);

  if (looksLikeTake(title, stripped)) return { type: 'take', basis: 'evidence' };

  // Evidence that something happened wins over everything below, including
  // a question mark. Measured against a live corpus: without this, "1st AP
  // Poll of 2026 is here. Where does Penn State rank?" — a published result
  // — came back as a rumor purely because of its trailing question.
  //
  // Except when an evaluative phrase reaches here (which means it was
  // attributed — the unattributed form already returned take above): its
  // verb is a verdict, not an event, so it must not count as one. See
  // EVALUATIVE. The headline falls to the default instead, where the
  // remote classifier decides who-is-speaking cases.
  if (!EVALUATIVE.test(stripped) && hasCompletedEvidence(title)) {
    return { type: 'reported', basis: 'evidence' };
  }

  if (looksLikeRumor(stripped, description)) return { type: 'rumor', basis: 'evidence' };

  // A trailing question mark, with nothing speculative in the text.
  //
  // The plan assumed Betteridge's law here and defaulted these to rumor.
  // A live corpus of 193 headlines said otherwise: essentially every
  // question headline in this feed is a *column framing device* — "What
  // does a bigger Quinton Martin mean for Penn State's offense?", "What Can
  // We Believe About Nebraska?" — not a rumor. Betteridge describes
  // national clickbait; team blogs ask questions to open analysis.
  //
  // Genuine rumor-questions ("Is Ohio State hiring Hartline?") still land as
  // rumors, because the rumor lexicon above catches them first. So this is
  // the fallthrough for questions with nothing speculative in them, and
  // those are takes.
  if (ENDS_IN_QUESTION.test(title.trim())) {
    const endsInsideQuote = /["“”'’]\s*\?*\s*$/.test(title.trim());
    if (!endsInsideQuote && !SERVICE_JOURNALISM.test(title)) {
      return { type: 'take', basis: 'evidence' };
    }
  }

  return { type: 'reported', basis: 'default' };
}

/** The classification alone, for callers with no use for the basis. */
export function classifyClaim(article: Pick<Article, 'title' | 'description'>): ClaimType {
  return classifyClaimDetailed(article).type;
}

/** `'all'` is the unfiltered case — the bar always offers a way back. */
export type ClaimFilter = 'all' | ClaimType;

export const CLAIM_FILTER_TABS: { key: ClaimFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'reported', label: 'Reported' },
  { key: 'rumor', label: 'Rumor' },
  { key: 'take', label: 'Take' },
  { key: 'unlabeled', label: 'Unlabeled' },
];

/** An article with its claim type attached, so it is computed once. */
export type Classified<T> = T & { claimType: ClaimType };

/**
 * Classifies a list once. Every consumer — the badge, the filter, the
 * brief — needs the same answer for the same article, and classifying is a
 * few hundred regex tests each; doing it per consumer would repeat that
 * work three times per render for no benefit.
 *
 * ## The merge policy: local evidence first, then the remote verdict
 *
 * `remoteClaim` is the verdict service's classification, attached in
 * team-news-pool.ts when one resolved (see `Article.remoteClaim`). It is
 * deliberately **not** preferred over a positive lexicon match:
 *
 * 1. A local `evidence` result wins. The lexicons are curated,
 *    precision-tuned rules — and this is what keeps MUST_STAY_REPORTED
 *    (claim-type.test.ts) protecting what users actually see. It also
 *    covers the model's known blind spots: tested live, the worker calls
 *    "Opponent Preview" reported the same way the old lexicon did.
 * 2. When the local result is only the default, the remote claim decides.
 *    That is the fix for the errors a regex fundamentally can't reach —
 *    "PSU legend says Green Bay won trade" is a take because of who is
 *    speaking, which is a semantic call.
 * 3. Neither → `unlabeled`, worn honestly instead of a guessed REPORTED.
 *
 * The local classifier stays permanently as the offline path
 * (docs/deferred-work.md) — this is merge policy, not replacement.
 */
export function withClaimTypes<
  T extends Pick<Article, 'title' | 'description'> & { remoteClaim?: ClaimType },
>(articles: T[]): Classified<T>[] {
  return articles.map((article) => {
    const local = classifyClaimDetailed(article);
    const claimType =
      local.basis === 'evidence' ? local.type : (article.remoteClaim ?? 'unlabeled');
    return { ...article, claimType };
  });
}

export function filterByClaimType<T extends { claimType: ClaimType }>(
  articles: T[],
  filter: ClaimFilter,
): T[] {
  if (filter === 'all') return articles;
  return articles.filter((article) => article.claimType === filter);
}
