/**
 * NoFrills verdicts service.
 *
 * Two routes. POST /v1/classify takes a batch of headline titles and returns
 * a sport/team/claim/kind verdict for each — see docs/deferred-work.md in the
 * main repo for why this exists and README.md here for the wire contract.
 * GET /v1/leagues serves the league catalog, so that adding a league is a
 * deploy of this Worker rather than an App Store release.
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

/**
 * The league catalog, imported straight out of the app repo rather than
 * copied into this directory.
 *
 * That is deliberate and it is the one place this Worker shares source with
 * the app. The same file is bundled into the app as its offline fallback and
 * served from here as the live copy, so the two can't disagree at deploy
 * time — which is the failure a second copy in `worker/src/` would invite,
 * silently, on the day someone edits one and not the other. Note this is
 * unlike the SPORTS list below, which really is duplicated: that one mirrors
 * a *type* in the app, and a type can't cross a bundler boundary as data.
 *
 * Adding a league is therefore: edit that JSON, `wrangler deploy`. Nobody
 * updates their app.
 */
import leagueCatalog from '../../src/lib/__data__/leagues.json';

export interface Env {
  VERDICTS: KVNamespace;
  MODEL: string;
  DAILY_CALL_CAP: string;
  VERDICT_TTL_DAYS: string;
  ANTHROPIC_API_KEY: string;
  /** Optional. A speed bump, not security — see README. */
  CLIENT_TOKEN?: string;
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

function todayKey(): string {
  return `calls:${new Date().toISOString().slice(0, 10)}`;
}

async function withinDailyCap(env: Env): Promise<boolean> {
  const cap = Number.parseInt(env.DAILY_CALL_CAP, 10);
  if (!Number.isFinite(cap)) return true;
  try {
    const raw = await env.VERDICTS.get(todayKey());
    const count = raw ? Number.parseInt(raw, 10) : 0;
    return count < cap;
  } catch {
    // Can't read the counter — fail open rather than blocking classification
    // on a KV blip. The Anthropic-side spend limit is the real backstop.
    return true;
  }
}

async function recordCall(env: Env): Promise<void> {
  try {
    const key = todayKey();
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
    if (!(await withinDailyCap(env))) {
      // Past the cap: serve whatever was cached, tell the client the rest
      // is unclassified so it falls back to local rules.
      degraded = true;
    } else {
      try {
        const titles = uncachedIndices.map((i) => items[i].title);
        const verdicts = await classifyWithModel(env, titles);
        ctx.waitUntil(recordCall(env));
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
 * How long a client or an edge cache may hold the catalog. Leagues are added
 * on the order of days, so five minutes is already far tighter than the thing
 * it describes — it exists to keep this route from being a per-launch origin
 * hit for every install, not to bound staleness.
 */
const CATALOG_MAX_AGE_SECONDS = 300;

/**
 * The league catalog, served as the bare array the app's `parseLeagues`
 * expects — not wrapped in an envelope. The wire shape is deliberately the
 * *same shape as the bundled file*, so the remote copy and the offline
 * fallback are interchangeable and neither side needs an unwrapping step
 * that could disagree with the other.
 *
 * Unauthenticated, unlike /v1/classify, and that difference is the rule
 * rather than an oversight: `CLIENT_TOKEN` guards the endpoint that spends
 * money at Anthropic. This one is a static public list that costs a KV-free,
 * model-free response, and gating it would mean a build with the catalog URL
 * set but no token silently falling back to its bundled copy — a worse
 * failure than anyone reading a list of league names.
 */
function handleLeagues(): Response {
  return new Response(JSON.stringify(leagueCatalog), {
    headers: {
      'content-type': 'application/json',
      'cache-control': `public, max-age=${CATALOG_MAX_AGE_SECONDS}`,
      // CORS-open, which /v1/classify is deliberately not. React Native
      // ignores CORS entirely, so this is for `expo start --web` — a
      // supported way to run this app (see .claude/launch.json), and without
      // the header the browser blocks the request and the web build silently
      // runs on its bundled catalog forever. Safe on this route precisely
      // because it is the unauthenticated one: no credentials, no cookies,
      // and the payload is a public list of league names. Don't copy it onto
      // the classify route, which is token-gated for a reason.
      'access-control-allow-origin': '*',
    },
  });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/health') {
      return json({ ok: true });
    }

    if (request.method === 'GET' && url.pathname === '/v1/leagues') {
      return handleLeagues();
    }

    if (request.method === 'POST' && url.pathname === '/v1/classify') {
      return handleClassify(request, env, ctx);
    }

    return json({ error: 'not found' }, 404);
  },
};
