# Data retention

What this app keeps, where, and for how long. Written so the answer to "how
long do you retain X" is something you can point to rather than reconstruct
from the code each time someone asks.

## Current state: three small persisted values, everything else in memory

The app persists three things: which teams you follow, whether you've
completed onboarding, and when you last reached the end of a brief. Nothing
else. No analytics SDK, no user accounts, no article content, no usage or
behavioral history. See "Persisted stores" below for the detail, including
why the third one is a single overwritten timestamp rather than a log.

Every other cache in the codebase is in-memory only and exists for the
lifetime of the running app process. They're all created through
`createEntityCache` in `lib/cache.ts` — one helper,
so what's cached and for how long is visible in one place rather than
hand-rolled per module:

| Cache | File | Bound | TTL |
|---|---|---|---|
| National feed pool | `lib/feeds.ts` | Single entry, replaced (not appended) every fetch | 3 minutes |
| Per-team news pool | `lib/team-news-pool.ts` | Keyed by team ID — max 18 entries (Big Ten only) | 3 minutes |
| Team list | `lib/teams.ts` | Keyed by league — 1 entry today | 30 minutes |
| Rosters | `lib/roster.ts` | Keyed by team ID — max 18 entries | None (process lifetime) |
| Stat leaders | `lib/team-leaders.ts` | Keyed by team ID — max 18 entries | None (process lifetime) |
| Team colors | `lib/team-color.ts` | Keyed by team ID — max 18 entries | None (process lifetime) |
| Player season stats | `lib/player-stats.ts` | Keyed by athlete ID — one per player screen opened | None (process lifetime) |
| Verdict classifications | `lib/verdicts.ts` | Keyed by headline title — one per unique headline seen; no-op (empty) unless `EXPO_PUBLIC_VERDICT_URL` is set | None (process lifetime) |

Force-quitting the app clears all of it. None of these can grow without
limit, but they aren't all bounded the same way. The team-keyed caches are
capped by the number of teams that exist — 18 entries no matter how long the
app has been open or how much you've browsed — and the national pool is
overwritten rather than accumulated. **Player season stats are the one cache
that does grow with use**: it gains an entry per player detail screen opened,
so its ceiling is the number of athletes across all 18 rosters (order of
1,800 entries of a few stat lines each) rather than 18. Still bounded, still
cleared on quit, but worth stating precisely rather than filing it under
"capped at 18" with the others. **Verdict classifications are the other
one**, for the same reason (an entry per unique headline the app has ever
asked about, not per team) — but only where `EXPO_PUBLIC_VERDICT_URL` is
configured; otherwise this cache never gains an entry, since `lib/
verdicts.ts` never makes the network call that would populate it.

The auto-refresh added for the morning/noon/night cycle (`lib/refresh-
schedule.ts`) doesn't change this: it just forces one of these same bounded
caches to re-fetch on a schedule. It doesn't create a new store or a
history of past pulls.

Article content itself is never stored beyond what's needed to render a
list and link out: title, description, source, byline, publish date, image
URL, and the link to the original. No full article bodies are scraped or
retained — every article click hands off to the source's own site. That's
also the right posture for not overstepping a fair-use "excerpt and link"
model with publishers whose content is being aggregated.

No personal data is collected in the sense that matters here: there's no
login, no user profile, no tracking identifiers, no crash/analytics
reporting. None of the three persisted values ever leaves the device —
they're read by the app to decide what to fetch and what to show, and
that's all.
Network calls out are to ESPN's public endpoints, the RSS feeds listed in
`lib/community-sources.ts` and `lib/feeds.ts`, made directly from the
device the same way any RSS reader would, and — only where
`EXPO_PUBLIC_VERDICT_URL` is configured — the verdicts service described
below.

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

**Retention on the worker side:** verdicts are cached in Cloudflare KV,
keyed by a SHA-256 hash of the normalized headline text, for
`VERDICT_TTL_DAYS` (90, set in `worker/wrangler.toml`) — a storage bound,
not a freshness one, since a verdict about a fixed piece of text never goes
stale. Nothing else about a request is persisted on the worker: no logs of
which title mapped to which app instance, no per-request history beyond
KV's own bounded write pattern.

**The default is still "nothing is transmitted."** `EXPO_PUBLIC_VERDICT_URL`
is unset in every build that hasn't explicitly configured it, and
`lib/verdicts.ts` never makes a network call when it's unset — this whole
section describes what happens only once someone deliberately points the
app at a running instance of `worker/`.

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

All three are written and read only through `lib/storage.ts`, which is the
single chokepoint for anything touching disk — deliberately, so this
table can't silently drift from reality. If a future feature needs
persistence, it goes through that module, and it gets a row here at the
same time it gets written, per the rule above.

None of the three is transmitted off the device, and none contains
anything identifying — team IDs are ESPN's public identifiers, the same
for every user who follows that team.

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
