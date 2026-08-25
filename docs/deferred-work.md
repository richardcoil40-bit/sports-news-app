# Deferred work

Things deliberately not built yet, why, and what it takes to pick them up.
Kept here rather than in a chat log or an issue tracker so that the reasoning
survives — the point of this file is that someone (or some future session)
can resume this without re-deriving the decision.

Last reviewed 2026-08-22.

---

## Status: the service is deployed and live, and unlocks less than it was scoped to

The backend service this file used to describe as the one missing piece is
built, deployed, and serving: `worker/` is a Cloudflare Worker exposing
`POST /v1/classify` (see `worker/README.md` for the wire contract),
`src/lib/verdicts.ts` is the app-side client, wired into
`team-news-pool.ts`'s enrichment step, and the tracked `.env` points the
app at it. So every build from this repo now calls it on every pool fetch.

An earlier version of this section said nobody had deployed it and that no
`EXPO_PUBLIC_VERDICT_URL` was set anywhere. That went stale without anyone
noticing, which is worth naming: the deploy is the event that changes what
this app *does at runtime*, and a status note nobody updates on that event
is worse than none. What's actually true as of 2026-08-20:

| | |
|---|---|
| Worker | Deployed — `GET /health` returns `{"ok": true}` |
| KV namespace | Created; id in `worker/wrangler.toml` |
| Anthropic API key | Set via `wrangler secret put`, never in this repo |
| `EXPO_PUBLIC_VERDICT_URL` | Set in the tracked `.env` — every build calls the service |
| `CLIENT_TOKEN` | Set; the client sends it from the gitignored `.env.local` |

Verify that last row rather than trusting it — an unauthenticated call
should be refused, and the endpoint was open to the internet for a while
before anyone checked:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  -H 'content-type: application/json' -d '{"items":[]}' \
  https://nofrills-verdicts.richard-coil40.workers.dev/v1/classify
```

`401` is correct. `400` means `CLIENT_TOKEN` is unset on the Worker and
anyone who reads the URL out of the app bundle can spend against the key —
capped by `DAILY_CALL_CAP`, but spend it they can.

The two brakes on cost are `DAILY_CALL_CAP` (40 model calls per UTC day, in
`wrangler.toml`) and a $5 spend limit on the Anthropic account itself. Past
the cap the endpoint keeps serving cached verdicts and reports `degraded`,
which the app reads as "use the local rules" — a bug or an abused endpoint
costs a capped amount and a slightly worse feed, never a surprise bill.

`docs/data-retention.md` describes what the service sees; read that one, not
this one, for the retention and privacy story.

What this unlocks is narrower than what was originally scoped, though — see
each numbered section below for which half of it actually landed:

- **Better claim tagging (§3)** is **delivered as of 2026-08-25** — with
  one caveat and one leftover. The verdict's `claim` now rides the pool
  onto each article (`Article.remoteClaim`) and the badge merges it in
  `withClaimTypes`: a positive local lexicon match wins (the curated rules
  and MUST_STAY_REPORTED stay in force), the remote claim decides when
  the lexicon only hit its default, and a headline neither has a signal
  for wears an honest fourth badge, `unlabeled`, instead of a guessed
  REPORTED. The caveat: no measured accuracy number exists — the labeling
  loop that would produce one was deliberately deferred (user's call,
  2026-08-25), so the claim here is "the known error classes are fixed
  and regression-tested", not a percentage. The leftover: the `teams`
  field is still paid for and discarded.
- **Sources that find themselves (§1)** only got the *filter* half — a
  headline verdict's `sport` and `kind` fields can refine what local rules
  already found. The *discovery* half (asking a news-search service what's
  being published about a team) is still unbuilt; nothing here finds a new
  outlet on its own.
- **Adding a league without an app release (§2)** is **done**, as of
  2026-08-22, and it turned out to need the Worker after all — not for the
  API key, but because it was already deployed and a static JSON route on it
  was cheaper than a second thing to operate. `GET /v1/leagues` serves
  `src/lib/__data__/leagues.json` (the Worker imports the app's copy, so the
  two can't drift), and `refreshLeagueCatalog` installs it over the bundled
  list at launch. Adding a league is now: edit that JSON, `wrangler deploy`.

The rest of this file's original reasoning is left as written below, marked
up with what's since landed.

---

## The one deferred block

Almost everything outstanding depended on a single missing piece: **a small
backend service holding an Anthropic API key.** That piece is now built —
see the status note above — but three-quarters of what it was meant to
unlock still isn't.

An API key cannot ship inside the app. A React Native bundle is extractable
from any installed device, so the key has to live server-side. That service
— realistically one file on Cloudflare Workers or Vercel, free tier — was
the only genuinely new infrastructure this project needed, and it now
exists as `worker/`.

It unlocks three separate things that have all been asked for:

### 1. Sources that find themselves

Today the app reads a hand-written list of 35 outlets. Nothing discovers new
ones; a site starts covering your team and the app can't see it until someone
edits code and ships a build.

Discovery itself is easy — ask a news search service what's being published
about a team. Probing Michigan returned 18 outlets not in the list, including
the Detroit Free Press, the Detroit News, Sports Illustrated, On3 and
247Sports.

**It cannot ship alone**, and this was measured rather than assumed. The same
probe also returned Facebook links, a gambling podcast and CableTV.com. Two
cheaper filters were tested and both failed:

- *Read the article and judge it* — there is no article. The feed gives a
  headline and nothing else.
- *Trust outlets that publish their own feed* — correctly rejected the junk,
  but also rejected freep.com, mlive.com, on3.com, clickondetroit.com and
  detroitnews.com. About 20% recall on real publishers.

So discovery and the AI check are one unit. Ship both or neither.

**Half of that unit is now built, half isn't.** The classify endpoint's
`sport` and `kind` fields are exactly the AI check this section describes —
`isRelevantVerdict` in `src/lib/verdicts.ts` applies them to whatever a
team's local rules already found (`off-topic.ts`, `off-sport.ts`,
`community-sources.ts`, `team-nicknames.ts`). But nothing calls a news
search service to find a URL that isn't already in
`community-sources.ts`; discovery — the part that would make the Detroit
Free Press and On3 show up without someone hand-adding them — is still
unbuilt. So this item is still deferred as originally scoped: a filter with
nothing new to filter *in* doesn't deliver "sources that find themselves,"
it only sharpens the sources already hand-written.

### 2. Adding a league without an app release

The *code* boundary is closed and proven, now for real rather than in a
trial: the SEC shipped as a catalog entry plus its research (a source table
and nicknames, both keyed the same way the Big Ten's are). No module
learned about a conference. The one thing that did need code was unrelated
to the catalog — resolving *followed* teams had to start spanning leagues,
because a favorite is stored league-qualified and every screen but the
picker was holding a single league's list.

But that file is bundled **inside** the app, so adding a league today still
means an App Store release. The requirement was explicitly that it shouldn't.

The remaining step is small because it was designed for: `league-catalog.ts`
already validates the list as if it came from a stranger, drops bad entries
individually, and falls back to the bundled copy. Switching the source from
bundled to fetched is a change of one input, not a rewrite.

**Done, 2026-08-22, and the estimate above held exactly.** It was a change
of one input: `parseLeagues` did not change a line. What was added around it
is the fetch (`fetchLeagueCatalog`), the install-or-keep wrapper
(`refreshLeagueCatalog`), and a `GET /v1/leagues` route on the Worker that
serves the very same `__data__/leagues.json` the app bundles — imported
across, not copied, so the served copy and the offline fallback cannot
disagree at deploy time.

The one thing worth reading the code for is the failure posture, because it
is the opposite of the rest of `src/lib/`. Every other remote source degrades
to empty; this one **throws**, per `teams.ts`'s exception, and the caller
catches and keeps the list already in force. A league catalog that degrades
to empty is an app with no tabs, no filters and no favorites that renders as
though it loaded fine.

Note what this does *not* unlock on its own: a league in the catalog with no
source table and no nicknames is a league whose teams have no local coverage.
The catalog is the cheap half. See the review gate in the scaling plan for
the half that isn't.

### 3. Better claim tagging

`claim-type.ts` sorts headlines into reported / rumor / take by pattern
matching. Measured at roughly 82/3/15 across a live 193-headline corpus. Its
known ceiling: it reads grammar, not meaning, so a column with a flat
declarative headline ("Michigan's defense has a problem") is invisible to it,
and December's coaching carousel makes real news and rumor share every word.

The upgrade is one extra question on a request the service is already making
about the same headlines. **No screen changes** — same labels, same
filter, same chips. Only the answer gets better.

**Wired up as of 2026-08-25.** The verdict's `claim` is attached to each
surviving article in `withVerdictRefinement` (`Article.remoteClaim`) and
merged into the badge in `withClaimTypes` — local lexicon evidence first,
remote claim when the lexicon only hit its default, and an honest
`unlabeled` badge when neither had a signal (`classifyClaimDetailed`'s
`basis` is what makes the default distinguishable from a match). The
migration cost less than this file predicted: only three call sites
actually *compute* claim types (`(tabs)/index.tsx`, `team/[id].tsx`,
`player/[id].tsx`); `article-card.tsx` takes the result as a prop and
`article.tsx` as a route param, so neither moved. `claim-type.ts` stays
permanently as the offline classifier and pre-filter (see "Why waiting
costs nothing" below) — this was a merge, not a replacement. Still open:
a measured accuracy number (the labeling loop is deferred by choice), and
the `teams` field, which remains paid for and discarded.

#### 3a. The byline signal — same blind spot, different fix, no service needed

The flat-declarative-column problem above has a second possible fix that is
worth recording separately, because **it is the one item in this file that
does not depend on the backend service at all.** A column and a report can
be identical as sentences and still differ in who wrote them: if the byline
is a known columnist, "Michigan's defense has a problem" is a take
regardless of its grammar. That's metadata the headline text can't provide
and the verdicts service is never given.

The plumbing for it already exists. `feeds.ts` parses bylines from both
formats — `dc:creator` with a plain `<author>` fallback for RSS,
`<author><name>` for Atom — onto `Article.author`, and it survives all the
way to a screen today (`src/app/team/[id].tsx` uses it to build the source
label). Nothing reads it for classification.

A first step at this once existed and was deleted on 2026-08-20:
`src/lib/journalists.ts` held 24 hand-written reporter names and a
substring match over them. It was removed as dead code — **nothing ever
imported it**, so the matching half existed while the half that would have
called it never got written. Recover it from git history if picking this
up; it is not worth retyping, but it is also not the hard part.

**The hard part, and why this stayed unbuilt:** coverage. The writers a
list like that most needs to recognise — The Athletic's staff, Yahoo's
Pete Thamel — publish behind paywalls with no public RSS, so their bylines
never enter the app at all. Against the free ESPN/CBS/Yahoo feeds the
signal is real but partial, and a hand-maintained name list rots silently:
a writer changes outlet, and the list gets quietly worse with no failing
test to say so. That decay is why the file was deleted rather than left
sitting unused, and it's the thing to solve before rebuilding it — an
`author`-derived signal that degrades honestly (unknown byline ⇒ no
opinion, never a wrong one) is fine; a stale allow-list presented as
authoritative is not.

Cheap, local, and orthogonal to everything else here: it needs no API key,
no network call, and no deploy, so it can be picked up whenever without
waiting on §§1–3.

---

## Why waiting costs nothing

Nothing built so far becomes rework. Each piece was shaped for this:

| Already in place | Why it matters later |
|---|---|
| **Unrated tier (0)** | Discovered outlets need an honest "not assessed" rating. This was the actual blocker, and it's done. |
| **Per-league, optional source lists** | Discovery slots in as another source provider rather than a special case. |
| **League catalog validation** | Written for untrusted input already; no new trust code needed when it goes remote. |
| **Local claim classifier** | Stays permanently as the offline path and pre-filter, so a service outage degrades to the previous version of the feature rather than to nothing. |
| **Atom parsing** | Discovered feeds arrive in either format; both already work. |

**The one real refactor, now done for both halves:** classification
becomes asynchronous. `team-news-pool.ts` has a pool-level enrichment
step (`withVerdictRefinement`) that races `classifyHeadlines` against a 3s
budget and falls through to the unrefined list on a miss — see the comment
there for why the race is shorter than `verdicts.ts`'s own 6s timeout. As
of 2026-08-25 it also carries `verdict.claim` onto the articles it keeps,
so the screens' render-time `useMemo`s (still `withClaimTypes`, still
synchronous) merge a value that was computed asynchronously upstream —
the screens never had to become async themselves, which is why this cost
three call sites instead of a refactor.

---

## What it costs to run

**Users pay nothing, ever.** No paywall, no subscription, no ads. The only
money is the project's own API usage.

The governing rule: **cost must scale with how much news exists, not with how
many people use the app.** Get that right and a thousand users cost the same
as one.

- **Cache verdicts on the server, not the device.** This is the whole game. Two
  people following Michigan see the same headlines; per-device caching pays for
  the same answer twice, and a thousand times at a thousand users. Hash the
  headline text on the worker and the first request pays while every other
  request forever is free.
- **Cluster before classifying** — the same wire story from six outlets is one
  question, not six. **Not yet done.** `team-news-pool.ts`'s enrichment step
  classifies every deduped article individually; clustering (`cluster.ts`)
  runs downstream of this pool, in `brief.ts`, not before it. Six outlets on
  one story means six titles sent, not one — mitigated by the worker's own
  cross-user KV cache (a genuinely repeated headline is free after the
  first request) but not eliminated, since six outlets rarely phrase a
  story identically. Wiring clustering in ahead of classification is the
  next real cost lever, not yet pulled.
- **Skip what local rules already answer confidently.** Done as designed:
  local rules run first (cheap), and only what survives them reaches
  `withVerdictRefinement` — see `team-news-pool.ts`.
- **Domain verdicts are permanent**; batch ~100 headlines per request; cheapest
  capable model; single-enum output. All done — see `worker/README.md`.

Order of magnitude with those in place: **single-digit dollars per year, flat
regardless of user count.** Cloudflare's free tier covers the infrastructure.

Put two hard brakes on it anyway: a spend limit on the Anthropic account, and
a daily request cap in the worker that falls back to local classification when
hit. A bug or an abused endpoint should cost a capped amount and a slightly
worse feed, never a surprise bill.

---

## The one-way door — crossed

`docs/data-retention.md` used to state that nothing the app handles is
transmitted anywhere. That stopped being true the moment `worker/` and
`src/lib/verdicts.ts` were written, and the document was updated in the
same change (see its new "What the verdicts service sees" section) rather
than after, per this section's own rule when it was still a plan.

What actually goes out, once `EXPO_PUBLIC_VERDICT_URL` is configured, is
narrower than the original plan here assumed: **headline titles only** —
not outlet names, not links, not team or league identifiers. That was a
design choice made while building `worker/`, specifically to keep the
one-way door as narrow as it could be once it had to be crossed at all.

They are public news, not personal data, and no user identifier goes with
them — but the *pattern* of requests still reveals which teams a device
follows, and that residual is exactly what `data-retention.md` now
documents rather than glosses over. The service is configured not to log
request bodies, per the plan.

That door is open and walked through: the tracked `.env` has set
`EXPO_PUBLIC_VERDICT_URL` since 2026-08-20, so every build from this repo
sends headline titles to the Worker. This closing line used to say the room
was still empty and needed replacing the moment it stopped being true — the
same failure the status note at the top of this file records.

`EXPO_PUBLIC_CATALOG_URL` (2026-08-22) points at the same Worker for the
league catalog and does **not** widen that door. It is a GET with no body and
no query string: it sends nothing, and the only thing it reveals is that some
device launched the app. Unset it and the app runs on its bundled catalog
without touching the network, the same escape hatch the verdicts URL has.
