import { KEEP_MIXED_SPORT_ROUNDUPS } from '@/constants/flags';
import { League } from '@/lib/leagues';

/**
 * The client for the deferred verdicts service (`worker/`) — see
 * `docs/deferred-work.md` for why it exists and `worker/README.md` for the
 * wire contract this module speaks.
 *
 * ## The one rule that matters here
 *
 * With `EXPO_PUBLIC_VERDICT_URL` unset, this module never touches the
 * network. Every call resolves to `null` verdicts immediately, and
 * `isRelevantVerdict` treats `null` as "no basis to override the local
 * rules" — so an app with no verdicts URL configured behaves exactly as it
 * did before this file existed. That's a hard requirement, not a nicety:
 * the service is optional infrastructure most builds of this app won't
 * have configured, and a silent behavior change on an unset env var would
 * be exactly the kind of bug this codebase's testing discipline exists to
 * catch.
 *
 * ## Verdict shape is deliberately team- and league-agnostic
 *
 * The server reports what a headline *is* — sport, named teams, claim
 * type, kind — never whether it's relevant to any particular team. That
 * split is what lets one cached verdict (keyed on the worker's side by the
 * headline text alone) serve every team and every user who happens to see
 * the same wire story. Relevance is a policy question, and policy lives
 * here, in `isRelevantVerdict` — not on the server.
 */

/**
 * Mirrors `SPORTS` in `worker/src/index.ts`, which in turn mirrors the
 * lexicon keys in `off-sport.ts`. Keep the three lists in sync; there's no
 * shared source between the Worker (a separate deployable) and the app.
 */
export type VerdictSport =
  | 'football'
  | 'basketball'
  | 'volleyball'
  | 'baseball'
  | 'softball'
  | 'soccer'
  | 'hockey'
  | 'wrestling'
  | 'track-and-field'
  | 'swimming'
  | 'gymnastics'
  | 'tennis'
  | 'golf'
  | 'lacrosse'
  | 'rowing'
  | 'other'
  | 'multiple'
  | 'none';

export type VerdictClaim = 'reported' | 'rumor' | 'take';
export type VerdictKind = 'news' | 'promo' | 'institutional';

export interface Verdict {
  sport: VerdictSport;
  teams: string[];
  claim: VerdictClaim;
  kind: VerdictKind;
}

export interface ClassifyItem {
  id: string;
  title: string;
}

/** Mirrors MAX_ITEMS in worker/src/index.ts — a request over this is a 400. */
const BATCH_SIZE = 100;

// This call happens inside team-news-pool.ts's already-tight 15s hard cap
// (see HARD_CAP_MS there) as a nice-to-have enrichment step, not a source
// of truth for anything the pool needs to function. A slow or hung request
// should give up well before that budget runs out and let local rules
// answer instead — deliberately shorter than the shared 10s
// FETCH_TIMEOUT_MS in http.ts, which is why this doesn't reuse it.
const CLASSIFY_TIMEOUT_MS = 6000;

/**
 * In-process memoization only — **not** the cross-user cache. That one
 * lives in the worker's KV store, keyed by a hash of the normalized title
 * (see `worker/README.md`). This map just stops one process from asking
 * the worker about the same wire headline twice in a session, e.g. when it
 * surfaces in more than one team's pool during the same refresh. Keyed on
 * the raw title text, no TTL, no reset hook — same posture as every other
 * module-scope cache in `src/lib/` (see AGENTS.md's Tests section): tests
 * must use unique titles per case.
 */
const memo = new Map<string, Verdict | null>();

function verdictUrl(): string | undefined {
  const url = process.env.EXPO_PUBLIC_VERDICT_URL;
  return url && url.trim() ? url.replace(/\/+$/, '') : undefined;
}

function authHeaders(): Record<string, string> {
  const token = process.env.EXPO_PUBLIC_VERDICT_TOKEN;
  return token ? { authorization: `Bearer ${token}` } : {};
}

interface ClassifyResponseBody {
  results?: { id: string; verdict: Verdict | null }[];
}

async function classifyBatch(baseUrl: string, items: ClassifyItem[]): Promise<Map<string, Verdict | null>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CLASSIFY_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl}/v1/classify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ items: items.map(({ id, title }) => ({ id, title })) }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`verdicts service responded ${response.status}`);

    const body = (await response.json()) as ClassifyResponseBody;
    const byId = new Map<string, Verdict | null>();
    for (const entry of body?.results ?? []) {
      if (entry && typeof entry.id === 'string') byId.set(entry.id, entry.verdict ?? null);
    }
    return byId;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Classifies a batch of headlines through the verdicts service, memoizing
 * per process and resolving to `null` — never throwing — for anything it
 * couldn't get an answer for: the service unconfigured, unreachable, slow
 * past `CLASSIFY_TIMEOUT_MS`, over its daily cap, or returning a malformed
 * response. `null` is not an error state a caller has to branch on
 * specially; `isRelevantVerdict` already treats it as "defer to whatever
 * the local rules already decided."
 *
 * Batches at `BATCH_SIZE` and fetches batches concurrently, tolerating
 * partial failure the same way `fetchFeeds`/`fetchTeamNewsPool` do — one
 * bad batch resolves its own items to `null` rather than failing the rest.
 */
export async function classifyHeadlines(items: ClassifyItem[]): Promise<Map<string, Verdict | null>> {
  const results = new Map<string, Verdict | null>();
  if (items.length === 0) return results;

  const baseUrl = verdictUrl();
  if (!baseUrl) {
    for (const item of items) results.set(item.id, null);
    return results;
  }

  const toFetch: ClassifyItem[] = [];
  for (const item of items) {
    if (memo.has(item.title)) {
      results.set(item.id, memo.get(item.title) ?? null);
    } else {
      toFetch.push(item);
    }
  }
  if (toFetch.length === 0) return results;

  const batches: ClassifyItem[][] = [];
  for (let i = 0; i < toFetch.length; i += BATCH_SIZE) {
    batches.push(toFetch.slice(i, i + BATCH_SIZE));
  }

  const settled = await Promise.allSettled(batches.map((batch) => classifyBatch(baseUrl, batch)));

  settled.forEach((outcome, i) => {
    const batch = batches[i];
    if (outcome.status === 'fulfilled') {
      for (const item of batch) {
        const verdict = outcome.value.get(item.id) ?? null;
        results.set(item.id, verdict);
        // A real "no verdict" answer is worth remembering for the rest of
        // this process. A network/timeout failure is not — memoizing it
        // would turn one bad request into a permanent blind spot for that
        // headline, so only successful batches write to `memo`.
        memo.set(item.title, verdict);
      }
    } else {
      for (const item of batch) results.set(item.id, null);
    }
  });

  return results;
}

/**
 * Whether a verdict says an article belongs in `league`'s feed — the
 * client-side relevance policy `docs/deferred-work.md` describes. The
 * server never decides relevance; it only reports what a headline *is*,
 * and every caller applies its own policy to the same three fields.
 *
 * `null` means no verdict was available, and this function only ever
 * *tightens* what local rules (`off-topic.ts`, `off-sport.ts`) already let
 * through — it never loosens it. So `null` in means "keep": the caller's
 * local rules already ran and made their own call before a verdict was
 * ever requested.
 */
export function isRelevantVerdict(verdict: Verdict | null, league: League): boolean {
  if (!verdict) return true;
  if (verdict.kind !== 'news') return false;

  switch (verdict.sport) {
    // The headline names no identifiable sport at all — a golf story with
    // no golf vocabulary in it is exactly the miss local keyword rules
    // can't catch (see the "known gaps" note this module shipped
    // alongside), but a verdict that also can't tell isn't grounds to drop
    // something the local rules already kept.
    case 'none':
      return true;
    // A roundup or crossover story naming two or more sports. Policy, not
    // fact — see KEEP_MIXED_SPORT_ROUNDUPS in constants/flags.ts.
    case 'multiple':
      return KEEP_MIXED_SPORT_ROUNDUPS;
    // A real, identifiable sport that isn't in the enumerated list at all
    // — by construction that means it isn't this league's sport, since
    // `league.espnSport` is always one of the enumerated values.
    case 'other':
      return false;
    default:
      return verdict.sport === league.espnSport;
  }
}
