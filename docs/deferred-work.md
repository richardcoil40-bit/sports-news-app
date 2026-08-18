# Deferred work

Things deliberately not built yet, why, and what it takes to pick them up.
Kept here rather than in a chat log or an issue tracker so that the reasoning
survives — the point of this file is that someone (or some future session)
can resume this without re-deriving the decision.

Last reviewed 2026-08-18.

---

## The one deferred block

Almost everything outstanding depends on a single missing piece: **a small
backend service holding an Anthropic API key.**

An API key cannot ship inside the app. A React Native bundle is extractable
from any installed device, so the key has to live server-side. That service
— realistically one file on Cloudflare Workers or Vercel, free tier — is the
only genuinely new infrastructure this project needs.

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

### 3. Better claim tagging

`claim-type.ts` sorts headlines into reported / rumor / take by pattern
matching. Measured at roughly 82/3/15 across a live 193-headline corpus. Its
known ceiling: it reads grammar, not meaning, so a column with a flat
declarative headline ("Michigan's defense has a problem") is invisible to it,
and December's coaching carousel makes real news and rumor share every word.

The upgrade is one extra question on a request the service is already making
about the same headlines. **No screen changes** — same three labels, same
filter, same chips. Only the answer gets better.

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

**The one real refactor** when this lands: classification becomes
asynchronous. It currently runs in a render-time `useMemo`; with a service it
moves into a pool-level enrichment step. That actually *simplifies* the
screens — they stop classifying and just read the field — but it does touch
`team-news-pool.ts` and the screens that call it.

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
  question, not six.
- **Skip what local rules already answer confidently.**
- **Domain verdicts are permanent**; batch ~100 headlines per request; cheapest
  capable model; single-enum output.

Order of magnitude with those in place: **single-digit dollars per year, flat
regardless of user count.** Cloudflare's free tier covers the infrastructure.

Put two hard brakes on it anyway: a spend limit on the Anthropic account, and
a daily request cap in the worker that falls back to local classification when
hit. A bug or an abused endpoint should cost a capped amount and a slightly
worse feed, never a surprise bill.

---

## The one-way door

`docs/data-retention.md` currently states that nothing the app handles is
transmitted anywhere. The moment this ships, headlines and outlet names go to
the service and to Anthropic.

They are public news, not personal data, and no user identifier goes with
them — but the *pattern* of requests would reveal which teams a user follows,
and that document's claim stops being true. Update it in the same change, not
after. Configure the service not to log request bodies.

This is the only part of the block that can't be undone by reverting a branch,
and it is worth thinking about before starting rather than during.
