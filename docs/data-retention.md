# Data retention

What this app keeps, where, and for how long. Written so the answer to "how
long do you retain X" is something you can point to rather than reconstruct
from the code each time someone asks.

## Current state: four small persisted values, everything else in memory

The app persists four things: which teams you follow, whether you've
completed onboarding, when you last reached the end of a brief, and which
refresh window it last pulled fresh news for. Nothing else. No analytics SDK,
no user accounts, no article content, no usage or behavioral history. See
"Persisted stores" below for the detail, including why the last two are each
a single overwritten value rather than a log.

Every other cache in the codebase is in-memory only and exists for the
lifetime of the running app process. All but two are created through
`createEntityCache` in `lib/cache.ts` — one helper,
so what's cached and for how long is visible in one place rather than
hand-rolled per module. One exception is the league catalog, which isn't
keyed by anything: it's a single fetched list held in a module variable and
replaced at most once per launch, so there is no key to evict and nothing
for that helper to do. The other is `lib/diagnostics.ts` (below), whose three
logs aren't a resolved-value-per-key cache at all — they're bounded arrays
and a map, capped by splicing off the oldest entries rather than by LRU
eviction, since nothing about them is ever "refetched."

Two independent limits apply, and the distinction matters: **`ttlMs` bounds
staleness, `maxEntries` bounds size.** An expired entry keeps its payload
resident until something overwrites it — that residency is what `peek()`
serves stale reads from — so a TTL alone never reclaims a byte. Caches keyed
by something that grows with *use* rather than with the catalog (teams
visited, players opened, headlines seen) carry a `maxEntries` and evict
least-recently-used on insert.

| Cache | File | Key | `maxEntries` | TTL |
|---|---|---|---|---|
| National feed pool | `lib/source-catalog.ts` | League — one entry per league that has curated feeds, 2 today (Big Ten, SEC). The NFL has none yet, and `fetchLeagueFeeds` returns without caching in that case, so it takes no slot | 50 | 3 minutes |
| Per-team news pool | `lib/team-news-pool.ts` | Sport + league path + team ID | 50 | 3 minutes |
| Team schedules | `lib/schedule.ts` | Sport + league path + team ID | 100 | 3 minutes |
| Team list | `lib/teams.ts` | League — 3 entries today | None needed (see below) | 30 minutes |
| Rosters | `lib/roster.ts` | Sport + league path + team ID | 100 | None (process lifetime) |
| Stat leaders | `lib/team-leaders.ts` | Sport + league path + team ID | 100 | None (process lifetime) |
| Team colors | `lib/team-color.ts` | Sport + league path + team ID | 100 | None (process lifetime) |
| Player season stats | `lib/player-stats.ts` | Athlete ID — one per player screen opened | 500 | None (process lifetime) |
| Verdict classifications | `lib/verdicts.ts` | Headline title — one per unique headline seen; empty only if `EXPO_PUBLIC_VERDICT_URL` is cleared | 2000 | None (process lifetime) |
| League catalog | `lib/league-catalog.ts` | Not a keyed cache — a single list, fetched at most once per launch and held in a module variable. Bounded by the catalog itself, a few KB | n/a | None (process lifetime) |
| Diagnostics: verdict disagreements | `lib/diagnostics.ts` | Not keyed — a flat log, oldest entries spliced off once full | 200 | None (process lifetime) |
| Diagnostics: source-group yield | `lib/diagnostics.ts` | Not keyed — a flat log, oldest entries spliced off once full | 300 | None (process lifetime) |
| Diagnostics: nickname usefulness | `lib/diagnostics.ts` | Team + nickname — one entry per curated nickname that has ever rescued an article this session | Bounded by the curated nickname table itself, a few hundred entries at most | None (process lifetime) |

The three diagnostics rows exist for a dev-gated screen
(`src/app/settings/diagnostics.tsx`, reachable only when `__DEV__` is true)
that reads runtime signals the review gate (`docs/review/README.md`,
`team-review.ts`) can't see: a nickname the classifier disagrees with, a
source group whose filter has stopped filtering, and a nickname that's
never rescued anything. Same posture as everything else here — per-device,
in-memory, gone on force-quit — just collected unconditionally rather than
only when the screen is open, since it's cheap arithmetic on work the news
pool already does. The one part of it that isn't free — sampling a few
rejected articles for an extra classify call to catch false negatives — is
itself gated on `__DEV__` at its call site in `team-news-pool.ts`, since
that one *does* cost against the verdicts service's daily cap.

Force-quitting the app clears all of it. **The team list is the one cache
with no size bound, and deliberately: its key is a league, so the catalog
itself is the ceiling.** Every other key above is something the user reaches
for — a team visited, a player opened, a headline seen — which is exactly the
class that grows with a session rather than with the catalog. Those all carry
an explicit cap.

The caps used to be implicit, and that was fine while every one of them was
"the number of teams that exist" (66 across the Big Ten, SEC and NFL). Two
things broke that. Player season stats and verdict classifications never had
it in the first place: the first has a ceiling of every athlete across every
roster and the second has no natural ceiling at all, one entry per unique
headline the app has ever asked about. And the catalog is on its way from 3
leagues to roughly 45, which turns "capped by the number of teams that exist"
from a small number into a large one. An explicit `maxEntries` says what the
ceiling is instead of leaving it to be inferred from the league list.

Note the verdict cap is not the one that matters for cost. The cross-user
cache is the worker's KV store, keyed by a hash of the normalized title;
evicting locally only means re-asking the worker, which answers from KV
without spending a model call. That service is live as of 2026-08-20 — it is
deployed and the tracked `.env` points at it. Clear
`EXPO_PUBLIC_VERDICT_URL` and the local cache never gains an entry, since
`lib/verdicts.ts` then never makes the network call that would populate
it.

The auto-refresh for the morning/noon/night cycle (`lib/refresh-schedule.ts`)
doesn't change this: it just forces one of these same bounded caches to
re-fetch on a schedule. It persists a single value — which window it last
pulled for — and that is a marker, overwritten in place, not a history of
past pulls. See "Persisted stores" below.

Article content itself is never stored beyond what's needed to render a
list and link out: title, description, source, byline, publish date, image
URL, and the link to the original. No full article bodies are scraped or
retained — every article click hands off to the source's own site. That's
also the right posture for not overstepping a fair-use "excerpt and link"
model with publishers whose content is being aggregated.

No personal data is collected in the sense that matters here: there's no
login, no user profile, no tracking identifiers, no crash/analytics
reporting. None of the four persisted values ever leaves the device —
they're read by the app to decide what to fetch and what to show, and
that's all.
Network calls out are to ESPN's public endpoints, the RSS feeds listed in
`lib/community-sources.ts` and `lib/feeds.ts`, made directly from the
device the same way any RSS reader would, and — wherever
`EXPO_PUBLIC_VERDICT_URL` is configured, which as of 2026-08-20 is every
build from this repo — the verdicts service described below. Since
2026-08-22 there is one more, to the same Worker: a single
`GET /v1/leagues` per launch for the league catalog, wherever
`EXPO_PUBLIC_CATALOG_URL` is set. It sends no body and no query string, so
unlike the verdicts calls it carries nothing at all — see below.

## What the verdicts service sees

This section exists because a claim in the previous version of this
document — "nothing is transmitted anywhere" — stopped being true the
moment `lib/verdicts.ts` and `worker/` shipped, and that claim needs to be
corrected in the same change that made it false, not after. See
`docs/deferred-work.md` for why this service exists.

**What actually crosses the wire:** headline titles, batched, sent to a
Cloudflare Worker the project operates, which forwards uncached titles to
Anthropic's API for classification. That's the complete list. No article
link, no source name, no team, no league, and no device or user identifier
of any kind goes with a title — `lib/verdicts.ts` builds the request body
from title text alone, and the worker's own request handling never reads
the parts of the app's request it isn't given (see `worker/README.md`'s
"What this service never sees").

**What that doesn't cover, and why it's still worth saying out loud:**
headlines are public news, already published by outlets with no
expectation of privacy in the text itself — this isn't personal data by
any reasonable definition. But **the request pattern is data**: which
headlines a device asks about, and when, is a reasonable proxy for which
teams that device follows, and the worker's request logs (to whatever
extent Cloudflare's platform logging captures them) carry that pattern
even though no field in the request names a team or a user. The mitigating
facts: the worker is configured not to log request bodies (see
`worker/src/index.ts`), verdicts are cached by a hash of the title text so
a repeat request for the same headline doesn't even reach the model, and
there is no user identifier anywhere in the request to correlate a pattern
back to a person. But "no identifier" is not the same claim as "no
transmission," and this file exists to keep those two claims from getting
conflated again.

**The catalog request is a different shape and worth separating:** the
`GET /v1/leagues` call added on 2026-08-22 goes to the same Worker but sends
no request body, no query string and no header the app invented — it is a
plain GET for a static public list. There is no pattern in it to reveal: one
request per launch, identical from every device, regardless of which teams
that device follows. What Cloudflare sees is what any web server sees of any
visitor (an IP and a timestamp), and nothing about it distinguishes one
user's app from another's. It is mentioned here rather than omitted because
the rule this file was rewritten to hold is that *any* new outbound call gets
documented in the change that adds it, not after.

**Retention on the worker side:** verdicts are cached in Cloudflare KV,
keyed by a SHA-256 hash of the normalized headline text, for
`VERDICT_TTL_DAYS` (90, set in `worker/wrangler.toml`) — a storage bound,
not a freshness one, since a verdict about a fixed piece of text never goes
stale. Nothing else about a request is persisted on the worker: no logs of
which title mapped to which app instance, no per-request history beyond
KV's own bounded write pattern.

**This section is no longer describing a hypothetical.** It originally
ended by saying the default is "nothing is transmitted," on the grounds
that `EXPO_PUBLIC_VERDICT_URL` is unset unless someone deliberately
configures it. That stopped being true when the Worker was deployed and
the URL was committed to the tracked `.env`: **every build from this repo
now sends headline text to the verdicts service.** Everything above
describes what the app actually does, not what it would do if someone
switched it on.

Note the shape of that mistake, because it is the same one this section
was written to correct the first time. The claim was accurate when
written and went false through a change somewhere else — a deploy and a
one-line `.env` edit, neither of which looks like it touches privacy
posture. The trigger to re-read this file is "the app started talking to
something new," and that trigger fires in commits that don't mention this
document.

The escape hatch is unchanged and still one line: clear
`EXPO_PUBLIC_VERDICT_URL` (in `.env`, or override it to empty in
`.env.local`) and `lib/verdicts.ts` makes no network call at all, exactly
as before the service existed. What changed is only which way the default
points.

## Why this is worth stating explicitly

This is the same question SOC 2 (CC6.5, secure disposal) and GDPR's
storage limitation principle are getting at: don't keep data longer than
you have a reason to, and be able to say why for whatever you do keep.
Right now the honest answer is "we don't keep it past the running
process" — worth writing down while it's true and trivial, rather than
only when someone asks and it's no longer obvious from the code.

## The rule for whenever persistence gets added

The first time this app writes anything to disk — offline reading, a
bookmarks/saved-articles list, a "recently viewed" history, or true
background refresh (which would need to cache results somewhere to be
worth anything) — that feature needs an explicit retention rule alongside
it, decided at the same time as the feature, not bolted on later:

- **Cap by count or age.** e.g. "keep the last 200 articles" or "purge
  anything older than 30 days," not "keep everything forever."
- **Eviction policy.** LRU (least recently used) is usually the simplest
  correct default for a cache; FIFO by fetch date for anything meant to
  behave like a history.
- **State it in this file.** Add a row to a running list below — what's
  stored, where, the cap, and why that cap — so this document stays the
  actual source of truth instead of drifting from the code.

### Persisted stores

| What | Where | Cap | Why that cap |
|---|---|---|---|
| Followed teams (`nofrills.favoriteTeamIds`) | AsyncStorage, via `lib/storage.ts` | An array of short `"<leagueId>:<teamId>"` strings — bounded by the number of teams in the leagues the app ships, a few hundred bytes at most | No eviction policy needed: a user can only follow teams that exist, so this grows with the league catalog, never with use. Revisit if the catalog ever spans many sports |
| Onboarding-complete flag (`nofrills.hasOnboarded`) | AsyncStorage, via `lib/storage.ts` | A single boolean | Nothing to cap |
| Last caught-up mark (`nofrills.lastCaughtUpAt`) | AsyncStorage, via `lib/storage.ts` | A single ISO-8601 timestamp, overwritten in place | Deliberately **not** a history. Only the most recent mark is kept, so this can't accumulate into a log of when you read. It has to persist at all because a brief that means "since you last looked" would otherwise reset to a fixed window on every relaunch — see `lib/caught-up.ts` |
| Last refreshed window (`nofrills.lastRefreshedPeriod`) | AsyncStorage, via `lib/storage.ts` | A single `"<date>-<morning\|noon\|night>"` string, overwritten in place | Same shape and the same rule as the row above: a marker, not a log. Only the current window is kept, so it can't accumulate into a record of when you opened the app. It persists because it was memory-only, which meant every cold launch read `null` and forced a full cache-bypassing pull of every national feed — the real cadence was "every cold start", not "3x a day". See `lib/refresh-schedule.ts` |

All four are written and read only through `lib/storage.ts`, which is the
single chokepoint for anything touching disk — deliberately, so this
table can't silently drift from reality. If a future feature needs
persistence, it goes through that module, and it gets a row here at the
same time it gets written, per the rule above.

None of the four is transmitted off the device, and none contains
anything identifying — team IDs are ESPN's public identifiers, the same
for every user who follows that team, and the refresh marker is a
time-of-day bucket the app derives for itself rather than a record of
anything the user did.

The caught-up mark is the one persisted value that is *behavioral* rather
than a preference: it records something about when the app was used, not
just how it's configured. That's worth naming explicitly rather than
filing it alongside the other two. What keeps it proportionate is that
it's a single timestamp replaced on each write — the app can tell "was
there anything new since your last read", and cannot reconstruct a reading
history from it, because no prior value survives.

### Format change: followed teams became league-qualified

Entries were bare ESPN ids (`"130"`) and are now qualified with the
league (`"big-ten:130"`). ESPN ids are unique only within a sport — id 13
is the Los Angeles Lakers in the NBA and a different team entirely in
college football — so bare ids are correct with exactly one league and
silently wrong with two.

`hydrateFavorites` upgrades the old format on read and writes the result
back once, so the migration runs once rather than on every launch. It is
idempotent and it collapses a bare id against its qualified equivalent,
because those are the same team and keeping both would show the row
twice.

**The migration has no expiry.** This value lives on the device with no
server behind it, so a user who skips many versions still arrives with
the old shape. Nothing here should ever assume the migration has already
run everywhere; see `lib/favorite-keys.ts` and its tests.
