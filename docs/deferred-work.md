# Deferred work

Things deliberately not built yet, why, and what it takes to pick them up.
Kept here rather than in a chat log or an issue tracker so that the reasoning
survives — the point of this file is that someone (or some future session)
can resume this without re-deriving the decision.

Last reviewed 2026-08-20.

---

## Status: the service is built, not yet deployed or wired for everything it unlocks

The backend service this file used to describe as the one missing piece now
exists as code: `worker/` is a complete Cloudflare Worker exposing
`POST /v1/classify` (see `worker/README.md` for the wire contract), and
`src/lib/verdicts.ts` is the app-side client, wired into
`team-news-pool.ts`'s enrichment step. **Nobody has deployed it** — no
Cloudflare account, no KV namespace, no Anthropic API key, no
`EXPO_PUBLIC_VERDICT_URL` set anywhere — so today this changes nothing
about how the app behaves; `classifyHeadlines` sees the unset URL and never
makes a network call. `docs/data-retention.md` was updated in the same
change, per the one-way-door note at the bottom of this file.

What this unlocks is narrower than what was originally scoped, though — see
each numbered section below for which half of it actually landed:

- **Better claim tagging (§3)** is the one item this genuinely delivers on,
  once deployed: the verdict already carries a `claim` field.
- **Sources that find themselves (§1)** only got the *filter* half — a
  headline verdict's `sport` and `kind` fields can refine what local rules
  already found. The *discovery* half (asking a news-search service what's
  being published about a team) is still unbuilt; nothing here finds a new
  outlet on its own.
- **Adding a league without an app release (§2)** is entirely unbuilt —
  the league catalog is still bundled JSON, untouched by this work.

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

The *code* boundary is closed and proven: an NFL entry was added to
`src/lib/__data__/leagues.json`, nothing else was changed, and the team list,
roster, schedule and colors all loaded correctly against the live API. (It was
then removed — no second league ships.)

But that file is bundled **inside** the app, so adding a league today still
means an App Store release. The requirement was explicitly that it shouldn't.

The remaining step is small because it was designed for: `league-catalog.ts`
already validates the list as if it came from a stranger, drops bad entries
individually, and falls back to the bundled copy. Switching the source from
bundled to fetched is a change of one input, not a rewrite.

**Untouched by the backend work.** Nothing about `worker/` or
`src/lib/verdicts.ts` changes where the league catalog lives; this is still
entirely deferred, and the remaining step above is still exactly what it
takes.

### 3. Better claim tagging

`claim-type.ts` sorts headlines into reported / rumor / take by pattern
matching. Measured at roughly 82/3/15 across a live 193-headline corpus. Its
known ceiling: it reads grammar, not meaning, so a column with a flat
declarative headline ("Michigan's defense has a problem") is invisible to it,
and December's coaching carousel makes real news and rumor share every word.

The upgrade is one extra question on a request the service is already making
about the same headlines. **No screen changes** — same three labels, same
filter, same chips. Only the answer gets better.

**The question is already being asked — the answer isn't wired up yet.**
Every verdict `worker/` returns already carries a `claim` field
(`reported`/`rumor`/`take`, same three labels), for free, on the same
request the sport/kind filtering above uses. What's still deferred is the
migration this file's intro describes: `claim-type.ts` runs in a
render-time `useMemo` in five call sites (`src/app/team/[id].tsx`,
`src/app/(tabs)/index.tsx`, `src/app/player/[id].tsx`,
`article-card.tsx`, and the tab components that read it), and none of them
read a verdict's `claim` field yet. That migration is explicitly **later**
even once the service is deployed — `claim-type.ts` stays permanently as
the offline classifier and pre-filter (see "Why waiting costs nothing"
below), so switching a screen over is a follow-up, not a blocker on
anything in this file.

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

**The one real refactor, done for the sport/kind half:** classification
becomes asynchronous. `team-news-pool.ts` now has a pool-level enrichment
step (`withVerdictRefinement`) that races `classifyHeadlines` against a 3s
budget and falls through to the unrefined list on a miss — see the comment
there for why the race is shorter than `verdicts.ts`'s own 6s timeout. The
*screens*, though, are the other half of this refactor and haven't moved:
they still call `classifyClaim` in a render-time `useMemo`, per §3 above.
That part "simplifies the screens" only once it's actually done.

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

Nothing about this changes until a build actually sets
`EXPO_PUBLIC_VERDICT_URL` — the door was built, but it's still standing
open onto an empty room until that happens.
