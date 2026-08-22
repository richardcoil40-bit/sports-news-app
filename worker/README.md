# nofrills-verdicts

The one backend service NoFrills needs — see `docs/deferred-work.md` in the
main repo for why it exists and what it unlocks. This file is about running
and deploying it; that one is about the decision.

Three routes, with less in common than sharing a service suggests.

**`POST /v1/classify`** is the one the app calls on every feed refresh. It
classifies a batch of headline titles and returns a league-agnostic verdict
for each: what sport it's about, which teams are named, whether it's a
report/rumor/take, and whether it's news, promo, or institutional filler.
The client (`src/lib/verdicts.ts` in the main app) applies its own policy to
the verdict fields — that route never sees a team, a league, or a user.

**`GET /v1/leagues`** serves the league catalog, so that adding a league is
a deploy of this Worker rather than an App Store release.

**`POST /v1/vet-source`** is developer tooling, called by hand from
`scripts/review/vet.mjs --ai` a few times per league. It scores a candidate
news source against the criteria in `docs/source-reliability.md`. It is off
until you give it its own API key, and it has its own cap, counter and
token — see its section below for why none of that is shared.

## Deploy

```bash
cd worker
npm install
npx wrangler kv namespace create VERDICTS      # paste the returned id into wrangler.toml
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put CLIENT_TOKEN           # optional — see Auth below
npx wrangler deploy
```

Source vetting stays off unless you also set its key:

```bash
npx wrangler secret put VET_ANTHROPIC_API_KEY  # enables POST /v1/vet-source
npx wrangler secret put VET_TOKEN              # optional, same idea as CLIENT_TOKEN
```

Local dev: `npm run dev` (runs `wrangler dev`). `npm run typecheck` runs
`tsc --noEmit`.

## `POST /v1/classify`

Request:

```json
{
  "items": [
    { "id": "https://example.com/article-1", "title": "Ohio State tops the AP Top 25" },
    { "id": "https://example.com/article-2", "title": "Huskers volleyball sweeps road trip" }
  ]
}
```

- `items`: 1–100 entries. `id` is opaque — the client's own key (a URL works
  well); it's only used to map results back to inputs and never reaches the
  model. `title` is the headline text and **is** what reaches the model —
  nothing else about the article does.

Response:

```json
{
  "results": [
    {
      "id": "https://example.com/article-1",
      "verdict": { "sport": "football", "teams": ["Ohio State"], "claim": "reported", "kind": "news" }
    },
    {
      "id": "https://example.com/article-2",
      "verdict": { "sport": "volleyball", "teams": ["Nebraska"], "claim": "reported", "kind": "news" }
    }
  ],
  "degraded": false
}
```

- `verdict` is `null` when this request couldn't get a fresh classification
  for that item (daily cap reached, or the model call failed) and nothing
  cached was available either. Treat `null` the same way an unset
  `EXPO_PUBLIC_VERDICT_URL` is treated client-side: fall back to local rules.
- `degraded: true` means at least one item in this response has a `null`
  verdict for that reason. It's a hint, not a per-item flag — check each
  item's `verdict` if you need to know which ones.
- `sport` is one of the values in `SPORTS` in `src/index.ts` — the same list
  `off-sport.ts`'s lexicon covers in the main app, plus `"other"` (a real
  sport with no local word list), `"multiple"` (a roundup naming two or
  more sports), and `"none"` (no sport identifiable from the headline text
  alone).
- `claim` is `"reported"` / `"rumor"` / `"take"` — the same three labels
  `claim-type.ts` already produces locally.
- `kind` is `"news"` / `"promo"` / `"institutional"` — the off-topic axis;
  this is the field that answers "is this actually sports coverage."

## `GET /v1/leagues`

The league catalog, as the bare JSON array the app's `parseLeagues` expects:

```json
[
  {
    "id": "big-ten",
    "displayName": "Big Ten",
    "sport": "Football",
    "level": "College",
    "espnSport": "football",
    "espnLeaguePath": "college-football",
    "espnGroup": 5,
    "seasonStartMonth": 8
  }
]
```

- **The payload is `src/lib/__data__/leagues.json` from the app repo,
  imported directly** (`src/index.ts` line 1-ish) rather than copied into
  this directory. The same file is bundled into the app as its offline
  fallback, so the served copy and the shipped default cannot disagree at
  deploy time. **Adding a league is: edit that JSON, `wrangler deploy`.**
  Nobody has to update their app.
- **A bare array, not an envelope.** The wire shape is deliberately identical
  to the bundled file's, so the remote copy and the fallback are
  interchangeable and neither side needs an unwrapping step the other could
  disagree with.
- **Unauthenticated**, unlike `/v1/classify`, and that difference is the rule
  rather than an oversight: `CLIENT_TOKEN` guards the endpoint that spends
  money at Anthropic. This one is a static public list served without a KV
  read or a model call. Gating it would mean a build with
  `EXPO_PUBLIC_CATALOG_URL` set but no token silently running on its bundled
  catalog — a worse failure than anyone reading a list of league names.
- `cache-control: public, max-age=300`. Leagues are added on the order of
  days; the header is there to keep this from being a per-launch origin hit
  for every install, not to bound staleness.

The client is `src/lib/league-catalog.ts`, pointed here by
`EXPO_PUBLIC_CATALOG_URL` (the base URL, same as the verdicts one — kept as
its own variable so the two can be switched independently). It takes
`teams.ts`'s throw-on-failure posture rather than the usual degrade-to-empty:
anything it can't turn into at least one available league is a throw, caught
one level up, leaving the app on its bundled list. **An empty league list is
an empty app that looks like it loaded correctly**, which is the whole reason
that route exists in that shape.

`GET /health` returns `{"ok": true}` — nothing else to it, just a
liveness check for `wrangler dev` / uptime monitoring.

## Auth

`CLIENT_TOKEN` is optional. If set, `POST /v1/classify` needs
`Authorization: Bearer <token>` or gets a 401. It guards that route and only
that route — `GET /health` and `GET /v1/leagues` are open, because the thing
being guarded is spend at Anthropic and neither of those costs any. Be honest
with yourself about what this buys: a token baked into an app bundle is extractable by anyone
who wants it, same as an API key would be. It's a speed bump against casual
scraping of the endpoint, not access control. The actual brakes are:

- **`DAILY_CALL_CAP`** (`wrangler.toml`) — the most Anthropic calls this
  Worker will make in a UTC day, counted per model call, not per HTTP
  request (see below). Past the cap the endpoint keeps serving cached
  verdicts and returns `degraded: true` for the rest.
- **A spend limit on the Anthropic account itself.** This is the one that
  actually caps a worst-case bill, and it isn't in this repo — set it on
  the account.

## `POST /v1/vet-source`

Request — at most 20 sources:

```json
{
  "sources": [
    { "id": "nebraska:journalstar.com", "name": "Lincoln Journal Star",
      "host": "journalstar.com", "url": "https://journalstar.com/...",
      "owner": "lee", "format": "rss", "items": 50 }
  ]
}
```

Response: one assessment per source, in input order — a `tier`
(`"0"`–`"4"` or `"excluded"`), a `scope` (`"team"` / `"broad"`), one
sentence against each of the seven criteria in
`docs/source-reliability.md`, a `summary`, and `uncertain`.

`uncertain: true` means the answer rests on recognising the outlet rather
than on anything in the input, and the prompt asks for tier `"0"` — *not
assessed* — over a confident guess. That mirrors what tier 0 means in the
doc: an admission, not a politer tier 3.

### Why it shares nothing with `/v1/classify`

Separate model (`VET_MODEL`), separate daily cap
(`VET_DAILY_CALL_CAP`, currently 10), separate KV counter (`vet-calls:`
rather than `calls:`), separate bearer token, and — the important one —
a separate `VET_ANTHROPIC_API_KEY` **with no fallback to
`ANTHROPIC_API_KEY`**. Unset, the route answers 503.

The app's feed is a live dependency and this is a tool somebody runs while
watching it. If they shared a budget, vetting a conference's worth of
candidates could exhaust the app's daily cap, and the only symptom would be
verdicts silently degrading to local rules for everyone. Two keys is the
only version of this that can't happen.

Nothing here is cached, which is the opposite of the rule below and
deliberate: a verdict about a headline can't go stale because the headline
never changes, while an outlet's ownership and business model are exactly
what the doc says to re-check. Nothing here is written anywhere either —
the response is a proposal for a worksheet, and a tier is recorded when a
person puts it in `community-sources.ts` beside their reasoning.

## How it works

- **Cache key is the title alone.** Normalized (trim, lowercase, collapse
  whitespace) and SHA-256 hashed — `v1:<hex>` in KV. No link, source, team,
  or user goes into the key. That's deliberate: the same wire headline
  shows up in a dozen users' feeds across every team it's tagged for, and
  hashing only the title is what lets one classification serve all of them.
  KV's free tier caps writes at 1,000/day; cache writes are wrapped in
  `try/catch` and pushed through `ctx.waitUntil` so a write failure costs a
  future re-classification, never a broken response. If that cap is ever
  hit in practice, D1 (100k writes/day free) is the documented upgrade —
  swap the KV calls in `src/index.ts` for D1 queries, same key shape.
- **The daily cap counts Anthropic calls, not headlines or requests.** One
  HTTP request classifying 80 uncached headlines is one call to the model
  (they're batched into a single `messages.create`); a request that's
  entirely cache hits is zero calls. The counter lives at
  `calls:YYYY-MM-DD` in KV with a 2-day TTL, so nothing has to prune it.
- **Model is `claude-haiku-4-5`**, set in `wrangler.toml`'s `[vars]`, not
  hardcoded — override there if a quality problem ever justifies the cost.
  This is a deliberate downgrade from Opus-tier: the job is a single-enum
  classification per headline, not open-ended reasoning, and
  `docs/deferred-work.md` sizes the whole service at single-digit dollars a
  year on the cheapest capable model. Haiku 4.5 doesn't support adaptive
  thinking or the `effort` parameter — both are simply omitted from the
  request, not set to "off".
- **No prompt caching.** Haiku 4.5's minimum cacheable prefix is 4,096
  tokens; the system prompt here is a few hundred. A `cache_control`
  breakpoint would silently do nothing but complicate the code.
- **Structured output**, not free-text parsing: `output_config.format` with
  a `json_schema` constrains the response to exactly the verdict shape, and
  results map back to input items by array index (titles go in as a plain
  JSON array, verdicts come back the same length, same order) — never by
  echoing the `id` back through the model, since ids here are URLs and
  echoing them would cost output tokens for no reason.

## What this service never sees

Team names, league identity, user identity, and article links never reach
this Worker — only the headline text and an opaque id the caller invented.
`/v1/leagues` sends nothing at all: it's a GET with no body and no query, so
the only thing it reveals is that some device launched the app.
The request pattern (which teams a user's client asks about, and when)
still reveals something about who's using the app, which is why
`docs/data-retention.md` was updated in the same change that shipped this
service — read that file, not this one, for the retention story.
