/**
 * NoFrills verdicts service.
 *
 * Two routes, and they share nothing but this file:
 *
 * - **POST /v1/classify** takes a batch of headline titles and returns a
 *   sport/team/claim/kind verdict for each. This is the one the app calls,
 *   on every feed refresh, for every user.
 * - **POST /v1/vet-source** scores a candidate news source against the
 *   criteria in docs/source-reliability.md. A developer calls it by hand,
 *   a few times per league, from scripts/review/vet.mjs --ai.
 *
 * See docs/deferred-work.md in the main repo for why this exists and
 * README.md here for the wire contract.
 *
 * **The two are deliberately isolated from each other**: separate daily
 * caps, separate counters, separate bearer tokens, and separate API keys.
 * Vetting is opt-in tooling that runs while somebody watches it; the app's
 * feed is not. Source vetting must never be able to exhaust the budget the
 * live app depends on, and the only way to guarantee that is for it not to
 * share one. `/v1/vet-source` answers 503 rather than borrowing the app's
 * key when its own is unset.
 *
 * Design points worth knowing before touching this file:
 *
 * - The cache key is derived from the **title alone** (normalized, hashed).
 *   No link, source, or team goes into it. That's what lets one cached
 *   verdict serve every team and every user asking about the same headline
 *   — the whole cost story in docs/deferred-work.md depends on this.
 * - The daily cap counts **Anthropic calls**, not HTTP requests. A single
 *   request classifying 80 uncached headlines is one call; two requests of
 *   40 cached headlines each are zero calls.
 * - KV writes (cache + call counter) are wrapped in try/catch and pushed
 *   through `ctx.waitUntil` so a KV hiccup degrades to "not cached" rather
 *   than failing the request — see the KV free-tier write-limit note in
 *   wrangler.toml.
 * - No prompt caching: Haiku 4.5's minimum cacheable prefix is 4,096 tokens
 *   and this system prompt is far shorter, so cache_control would silently
 *   do nothing.
 */
import Anthropic from '@anthropic-ai/sdk';

export interface Env {
  VERDICTS: KVNamespace;
  MODEL: string;
  DAILY_CALL_CAP: string;
  VERDICT_TTL_DAYS: string;
  ANTHROPIC_API_KEY: string;
  /** Optional. A speed bump, not security — see README. */
  CLIENT_TOKEN?: string;

  /** Source vetting. All separate from the four above, on purpose. */
  VET_MODEL: string;
  VET_DAILY_CALL_CAP: string;
  /**
   * Required for /v1/vet-source, and deliberately without a fallback to
   * ANTHROPIC_API_KEY. Unset means the endpoint is off, which is how it
   * ships — a second key is what keeps this spend separately attributable
   * and separately limitable on the Anthropic account.
   */
  VET_ANTHROPIC_API_KEY?: string;
  VET_TOKEN?: string;
}

const MAX_ITEMS = 100;
const CACHE_VERSION = 'v1';

/**
 * Mirrors off-sport.ts's SPORT_TERMS keys in the main app, plus three
 * classification-only values. "other" covers a real sport the local
 * lexicon doesn't have a word list for; "multiple" and "none" are the two
 * values the mixed-roundup and no-sport cases need — see
 * docs/deferred-work.md's note on KEEP_MIXED_SPORT_ROUNDUPS.
 */
const SPORTS = [
  'football',
  'basketball',
  'volleyball',
  'baseball',
  'softball',
  'soccer',
  'hockey',
  'wrestling',
  'track-and-field',
  'swimming',
  'gymnastics',
  'tennis',
  'golf',
  'lacrosse',
  'rowing',
  'other',
  'multiple',
  'none',
] as const;

type Sport = (typeof SPORTS)[number];
type Claim = 'reported' | 'rumor' | 'take';
type Kind = 'news' | 'promo' | 'institutional';

interface Verdict {
  sport: Sport;
  teams: string[];
  claim: Claim;
  kind: Kind;
}

/**
 * output_config.format schema. No minLength/minItems/minimum — structured
 * outputs doesn't support numeric or string-length constraints (see the
 * claude-api skill's "JSON Schema Limitations"), so validate shape here,
 * not size.
 */
const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          sport: { type: 'string', enum: SPORTS as unknown as string[] },
          teams: { type: 'array', items: { type: 'string' } },
          claim: { type: 'string', enum: ['reported', 'rumor', 'take'] },
          kind: { type: 'string', enum: ['news', 'promo', 'institutional'] },
        },
        required: ['sport', 'teams', 'claim', 'kind'],
        additionalProperties: false,
      },
    },
  },
  required: ['verdicts'],
  additionalProperties: false,
} as const;

const SYSTEM_PROMPT = `You classify sports-news headlines for a news app. You will receive a JSON array of headline strings. For each headline, in the same order, produce one verdict:

- sport: the single sport the headline is about. Use "multiple" if the headline names two or more sports (a roundup, or "recruit also plays basketball"). Use "none" if no sport is identifiable from the headline text alone.
- teams: school or team names actually named in the headline text — not inferred, not the league, not the sport. Empty array if none are named.
- claim: "reported" for a stated fact or event ("X signs with Y"), "rumor" for speculation, insider buzz, or unconfirmed reports ("sources say", "buzz", "insider"), "take" for opinion, analysis, prediction, or ranking content.
- kind: "news" for ordinary sports coverage, "promo" for ticket sales, merchandise, or schedule-release advertising, "institutional" for athletic-department or university administrative announcements unrelated to competition (hires unrelated to coaching, facility funding, compliance).

Judge only from the headline text given — you have no other context. Return exactly one verdict per headline, in input order.`;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, ' ');
}

async function cacheKeyFor(title: string): Promise<string> {
  return `${CACHE_VERSION}:${await sha256Hex(normalizeTitle(title))}`;
}

async function readCache(env: Env, key: string): Promise<Verdict | null> {
  try {
    const raw = await env.VERDICTS.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as Verdict;
  } catch {
    // A corrupt entry or a KV outage both degrade to "not cached" — never
    // let a cache read fail the request.
    return null;
  }
}

async function writeCache(env: Env, key: string, verdict: Verdict, ttlSeconds: number): Promise<void> {
  try {
    await env.VERDICTS.put(key, JSON.stringify(verdict), { expirationTtl: ttlSeconds });
  } catch {
    // KV's free tier caps writes at 1,000/day (see wrangler.toml). Losing a
    // cache write costs a future re-classification, not a broken response.
  }
}

/** `calls:` for the app, `vet-calls:` for the tooling. Never one counter. */
function todayKey(prefix: string): string {
  return `${prefix}:${new Date().toISOString().slice(0, 10)}`;
}

async function withinDailyCap(env: Env, prefix: string, capValue: string): Promise<boolean> {
  const cap = Number.parseInt(capValue, 10);
  if (!Number.isFinite(cap)) return true;
  try {
    const raw = await env.VERDICTS.get(todayKey(prefix));
    const count = raw ? Number.parseInt(raw, 10) : 0;
    return count < cap;
  } catch {
    // Can't read the counter — fail open rather than blocking classification
    // on a KV blip. The Anthropic-side spend limit is the real backstop.
    return true;
  }
}

async function recordCall(env: Env, prefix: string): Promise<void> {
  try {
    const key = todayKey(prefix);
    const raw = await env.VERDICTS.get(key);
    const count = raw ? Number.parseInt(raw, 10) : 0;
    // TTL 2 days: a day past midnight to cover clock skew, then it expires
    // on its own — nothing prunes old counters.
    await env.VERDICTS.put(key, String(count + 1), { expirationTtl: 172800 });
  } catch {
    // Losing a count is safe in the direction that matters less: it can
    // only under-count, letting a day slightly exceed the cap rather than
    // wrongly blocking one under it.
  }
}

async function classifyWithModel(env: Env, titles: string[]): Promise<Verdict[]> {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  // Haiku 4.5 does not support adaptive thinking or `effort` — both are
  // simply omitted here, not set to "off". See the claude-api skill's
  // Thinking & Effort table.
  const response = await client.messages.create({
    model: env.MODEL,
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: JSON.stringify(titles) }],
    output_config: {
      format: { type: 'json_schema', schema: VERDICT_SCHEMA },
    },
  });

  const textBlock = response.content.find(
    (block): block is Extract<(typeof response.content)[number], { type: 'text' }> =>
      block.type === 'text',
  );
  if (!textBlock) throw new Error('classify: model response had no text content');

  const parsed = JSON.parse(textBlock.text) as { verdicts?: unknown };
  if (!Array.isArray(parsed.verdicts) || parsed.verdicts.length !== titles.length) {
    throw new Error('classify: verdict count did not match input count');
  }
  return parsed.verdicts as Verdict[];
}

interface ClassifyItem {
  id: string;
  title: string;
}

function parseItems(body: unknown): ClassifyItem[] | null {
  const items = (body as { items?: unknown } | null)?.items;
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_ITEMS) return null;
  const result: ClassifyItem[] = [];
  for (const item of items) {
    const id = (item as { id?: unknown })?.id;
    const title = (item as { title?: unknown })?.title;
    if (typeof id !== 'string' || typeof title !== 'string' || !title.trim()) return null;
    result.push({ id, title });
  }
  return result;
}

async function handleClassify(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (env.CLIENT_TOKEN) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${env.CLIENT_TOKEN}`) {
      return json({ error: 'unauthorized' }, 401);
    }
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, 400);
  }

  const items = parseItems(body);
  if (!items) {
    return json({ error: `items must be a non-empty array of at most ${MAX_ITEMS} {id, title} pairs` }, 400);
  }

  const ttlDays = Number.parseInt(env.VERDICT_TTL_DAYS, 10);
  const ttlSeconds = (Number.isFinite(ttlDays) ? ttlDays : 90) * 86400;

  const cacheKeys = await Promise.all(items.map((item) => cacheKeyFor(item.title)));
  const cached = await Promise.all(cacheKeys.map((key) => readCache(env, key)));

  const results: (Verdict | null)[] = cached.slice();
  const uncachedIndices = cached.reduce<number[]>((acc, v, i) => {
    if (v === null) acc.push(i);
    return acc;
  }, []);

  let degraded = false;

  if (uncachedIndices.length > 0) {
    if (!(await withinDailyCap(env, 'calls', env.DAILY_CALL_CAP))) {
      // Past the cap: serve whatever was cached, tell the client the rest
      // is unclassified so it falls back to local rules.
      degraded = true;
    } else {
      try {
        const titles = uncachedIndices.map((i) => items[i].title);
        const verdicts = await classifyWithModel(env, titles);
        ctx.waitUntil(recordCall(env, 'calls'));
        uncachedIndices.forEach((i, j) => {
          results[i] = verdicts[j];
          ctx.waitUntil(writeCache(env, cacheKeys[i], verdicts[j], ttlSeconds));
        });
      } catch {
        // Model call failed (rate limit, malformed output, network). Leave
        // these results null and tell the client — it already has a local
        // fallback path for exactly this.
        degraded = true;
      }
    }
  }

  return json({
    results: items.map((item, i) => ({ id: item.id, verdict: results[i] })),
    degraded,
  });
}

/**
 * Source vetting — the second route, and a different kind of question.
 *
 * Classification asks for one enum per field about a string of text.
 * This asks whether an outlet clears the seven criteria in
 * docs/source-reliability.md, which is a judgment with reasons attached.
 * That is why the model is configurable separately and defaults to a
 * reasoning model where MODEL is deliberately the cheapest capable one:
 * the volume is a few dozen sources per league reviewed by hand, not
 * thousands of headlines a day.
 *
 * **Nothing here is cached, on purpose.** A verdict about a headline never
 * goes stale because the headline never changes. An outlet's independence
 * and business model change, which is exactly why the doc says to re-check
 * annually or whenever ownership moves — a cached tier would be the same
 * mistake as a nickname table nobody re-reads.
 *
 * **And nothing here writes anything.** The response is a proposal for the
 * worksheet. A tier is recorded when a person puts it in
 * community-sources.ts beside the reasoning, which is the same rule the
 * rest of the review gate runs on.
 */
const MAX_SOURCES = 20;

const VET_SCHEMA = {
  type: 'object',
  properties: {
    assessments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          // A string enum rather than an integer one, matching the verdict
          // schema above — see its note on what structured outputs will
          // and won't constrain.
          tier: { type: 'string', enum: ['0', '1', '2', '3', '4', 'excluded'] },
          scope: { type: 'string', enum: ['team', 'broad'] },
          accountability: { type: 'string' },
          attribution: { type: 'string' },
          independence: { type: 'string' },
          originalReporting: { type: 'string' },
          trackRecord: { type: 'string' },
          stability: { type: 'string' },
          businessModel: { type: 'string' },
          summary: { type: 'string' },
          uncertain: { type: 'boolean' },
        },
        required: [
          'tier',
          'scope',
          'accountability',
          'attribution',
          'independence',
          'originalReporting',
          'trackRecord',
          'stability',
          'businessModel',
          'summary',
          'uncertain',
        ],
        additionalProperties: false,
      },
    },
  },
  required: ['assessments'],
  additionalProperties: false,
} as const;

const VET_SYSTEM_PROMPT = `You assess news sources for a sports news app, against a fixed rubric. You will receive a JSON array of candidate sources, each with a name, a host, a feed URL, and what a feed probe found. For each source, in the same order, produce one assessment.

Score these seven criteria, one short sentence each, and say plainly when you do not know:
- accountability: is there a masthead, named editorial leadership, a corrections policy, a real physical newsroom?
- attribution: are sources named and claims attributed, or is it unsourced assertion?
- independence: who owns it, and does that ownership have a stake in what it covers? A school- or team-owned outlet is not independent.
- originalReporting: does it do its own reporting, or repackage others'?
- trackRecord: how long has it published, and are there known unretracted errors?
- stability: is it still publishing regularly, or a site coasting on old posts?
- businessModel: how is it funded, and does that funding conflict with the coverage — recruiting-service upsells, affiliate betting revenue, booster money?

Then assign:
- tier: "1" a professional newsroom (accountability, attribution and track record all clear). "2" a credible independent with named staff and real original reporting but thinner formal standards. "3" community or fan coverage with real editorial presence but fan-voiced and aggregation-heavy. "4" school-, conference- or team-owned. "0" you genuinely cannot assess it from what you were given — this is not a polite "3", it is an admission. "excluded" for no accountability at all, conflicted revenue, or a record of unretracted misses.
- scope: "team" if the outlet covers one program and nothing else, so everything it publishes is on-topic. "broad" if it is a metro sports section or similar that also covers other teams and other sports, and so has to be filtered by team name.
- summary: one sentence a reviewer can paste into a code comment.
- uncertain: true whenever your assessment rests on recognising the outlet rather than on evidence in the input.

You are judging from the name, host and probe result alone, plus whatever you already know about the outlet. You have no browsing. Prefer tier "0" and uncertain: true over a confident guess — a wrong tier that reads as researched is worse than an honest "not assessed", which is what tier 0 exists to say.`;

interface VetCandidate {
  id: string;
  name: string;
  host: string;
  url: string;
  owner?: string;
  format?: string;
  items?: number;
}

function parseCandidates(body: unknown): VetCandidate[] | null {
  const sources = (body as { sources?: unknown } | null)?.sources;
  if (!Array.isArray(sources) || sources.length === 0 || sources.length > MAX_SOURCES) return null;

  const parsed: VetCandidate[] = [];
  for (const raw of sources) {
    const source = raw as Record<string, unknown>;
    if (
      typeof source?.id !== 'string' ||
      typeof source?.name !== 'string' ||
      typeof source?.host !== 'string' ||
      typeof source?.url !== 'string'
    ) {
      return null;
    }
    parsed.push({
      id: source.id,
      name: source.name,
      host: source.host,
      url: source.url,
      owner: typeof source.owner === 'string' ? source.owner : undefined,
      format: typeof source.format === 'string' ? source.format : undefined,
      items: typeof source.items === 'number' ? source.items : undefined,
    });
  }
  return parsed;
}

async function handleVetSource(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (!env.VET_ANTHROPIC_API_KEY) {
    return json(
      {
        error:
          'source vetting is not configured — set the VET_ANTHROPIC_API_KEY secret. ' +
          'It deliberately does not fall back to the app key.',
      },
      503,
    );
  }

  if (env.VET_TOKEN) {
    if (request.headers.get('authorization') !== `Bearer ${env.VET_TOKEN}`) {
      return json({ error: 'unauthorized' }, 401);
    }
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, 400);
  }

  const sources = parseCandidates(body);
  if (!sources) {
    return json(
      { error: `sources must be a non-empty array of at most ${MAX_SOURCES} {id, name, host, url} objects` },
      400,
    );
  }

  if (!(await withinDailyCap(env, 'vet-calls', env.VET_DAILY_CALL_CAP))) {
    // No cached half to serve and no local fallback to degrade to, unlike
    // classify. Say so with a status the caller can act on rather than
    // returning an empty success.
    return json({ error: 'daily vetting cap reached — see VET_DAILY_CALL_CAP' }, 429);
  }

  const client = new Anthropic({ apiKey: env.VET_ANTHROPIC_API_KEY });

  try {
    const response = await client.beta.messages.create({
      // Server-side fallback: on a policy decline the same request re-runs
      // on a fallback model inside this call, rather than the tool getting
      // an empty answer it cannot interpret.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      model: env.VET_MODEL,
      max_tokens: 16000,
      system: VET_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: JSON.stringify(sources) }],
      output_config: {
        format: { type: 'json_schema', schema: VET_SCHEMA },
      },
    });
    ctx.waitUntil(recordCall(env, 'vet-calls'));

    if (response.stop_reason === 'refusal') {
      return json({ error: 'the model declined this request', stop_details: response.stop_details }, 502);
    }

    const textBlock = response.content.find(
      (block): block is Extract<(typeof response.content)[number], { type: 'text' }> => block.type === 'text',
    );
    if (!textBlock) throw new Error('vet: model response had no text content');

    const parsed = JSON.parse(textBlock.text) as { assessments?: unknown };
    const assessments = parsed.assessments;
    if (!Array.isArray(assessments) || assessments.length !== sources.length) {
      throw new Error('vet: assessment count did not match input count');
    }

    return json({
      model: response.model,
      results: sources.map((source, i) => ({ id: source.id, assessment: assessments[i] })),
    });
  } catch (error) {
    // Nothing partial is worth returning here — a half-vetted batch read as
    // a full one is how an unassessed source acquires a tier.
    return json({ error: `vetting failed: ${(error as Error).message}` }, 502);
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/health') {
      return json({ ok: true });
    }

    if (request.method === 'POST' && url.pathname === '/v1/classify') {
      return handleClassify(request, env, ctx);
    }

    if (request.method === 'POST' && url.pathname === '/v1/vet-source') {
      return handleVetSource(request, env, ctx);
    }

    return json({ error: 'not found' }, 404);
  },
};
