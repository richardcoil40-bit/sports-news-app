# Evidence

Output from `scripts/check-feeds.sh` — the record of when each source was
last verified to be returning real items.

These are kept in version control on purpose. Feeds rot quietly: a publisher
retires RSS, a path changes, a CDN starts refusing programmatic requests. None
of that fails loudly in the app — the source just stops contributing. Having
dated reports means you can diff against the last one instead of re-deriving
the whole picture from scratch.

## Two reports, two questions

`feed-status-*.txt` answers **is this URL still returning items** —
`scripts/check-feeds.sh`, described below.

`source-yield-*.txt` answers **does any of it reach the reader** —
`node scripts/review/yield.mjs [leagueId ...]`. A feed can pass every
check the first report makes and contribute nothing, because the
team-name match, `off-topic.ts` and `off-sport.ts` all run afterwards. It
prints `items → named → kept` per source and flags a team whose feed ends
below `--min` (default 3).

That gap was not hypothetical. Four sources in the shipping catalog were
live, healthy and contributing nothing when the report was first run on
2026-08-24: the Tulsa World, the St. Louis Post-Dispatch, The Eagle and
the Waco Tribune-Herald were all subscribed to the TownNews root
`c=sports` category, which serves syndicated wire and daily agate rather
than the beat. Cincinnati — the report that prompted this — was showing
one article about the dance team. See `docs/source-reliability.md` for
the write-up and the fix.

Run it from a laptop, like `check-feeds.sh`: it makes the same requests to
the same rate-limiting papers.

## Re-running

```
bash scripts/check-feeds.sh              # in-app sources only
bash scripts/check-feeds.sh --candidates # also re-probe the rejected candidates
```

Each run writes two files here and echoes the text one to stdout:
`feed-status-<UTC timestamp>.txt` to read, and `.json` beside it to diff and
to parse. The table below stops being scannable somewhere around 450 lines,
which is where this catalog is heading, and "diff against the last one" only
survives that if something other than a pair of eyes can do the diffing. The
CI workflow already reads the JSON rather than the text columns — the text
report pads the name field to 26 characters, so a long enough publisher name
would shift every column after it.

A source that answers, but slower than `FETCH_TIMEOUT_MS`, is flagged
`SLOW` and still counted as passing — it is a real feed that no device
will ever wait for. curl gets 20s here because the question is whether a
feed exists; the app gets 10s because a phone cannot wait, and anything
between the two reads as healthy while contributing nothing. That is the
Atom problem's shape exactly, and WV MetroNews spent a day in it.

Requests run **grouped by operator**: concurrent across operators, sequential
and paced within one. That is a 5x speedup (60 sources in ~35s rather than
~3min) and nobody receives requests any faster than before — see the long
comment in the script for why the unit is the operator and not the host, and
for the measured runs that say not to touch the pacing itself.

The in-app list is read out of `src/lib/source-catalog.ts` and
`src/lib/community-sources.ts` rather than duplicated in the script, so it
can't drift from what the app actually fetches. The per-team half is
*imported* rather than parsed — a regex over the source literals silently
missed every source built by a helper, which is a report that checks two
thirds of the catalog and looks exactly like a clean one.

`scripts/review/propose.mjs` probes on identical terms, per team, while
building a league's review worksheet — same user agent, same timeout, same
single 429 retry, same "200 with no items is a failure". A worksheet that
graded a feed more generously than this would approve sources the report
then fails.

There's no fixed schedule. Worth doing when a source looks quiet in the app,
before adding a source, and periodically otherwise.

## Liveness is not correctness

This report answers "is the source returning items", and that is all it
answers. A feed can pass every check here and still hand the app a field it
cannot read.

Eleven Warriors did, from the day it was added until 2026-08-23. Its
`<pubDate>` is `Sunday, August 23, 2026 - 14:30` — a rendered date rather
than the RFC 822 one RSS specifies, and `new Date()` rejects it outright.
Every item still had a headline, a link and an image, so the source was
green in every run above. What it actually did was strip the dateline from
every one of its cards *and* sink the whole feed to the bottom of the sort,
because `sortByDate` puts undated items last — so the day's Ohio State
stories ranked below a month-old one. It surfaced as two separate bug
reports from a TestFlight tester, neither of which named the real cause.

`parsePubDate` now falls back to a relaxed parse, and `feeds.test.ts` has a
case on each side of it. The sweep that established the scope is worth
repeating if a publisher ever looks oddly ordered: of all 82 feed URLs in
the catalog on 2026-08-23, 81 parse strictly and Eleven Warriors was the
only one that needed the fallback.

The general lesson is the Atom one restated. **Whenever a check is added
here, ask what it would still miss** — the columns tell you a source
answered, not that the app understood the answer.

## Reports

| File | What it is |
| --- | --- |
| `feed-status-20260811-103300.txt` | First pass, 2026-08-11. The original survey: controls, the full SB Nation network, and guessed newspaper URLs. |
| `feed-status-20260811-104400.txt` | Second pass, 2026-08-11. Retries of everything that failed the first pass, plus alternates for the programs left with no local newsroom. Produced by a since-removed `check-feeds-round2.sh`. |
| `feed-status-20260813-024254.txt` | First run of the unified script, 2026-08-13. 34 of 35 in-app sources returning items. |
| `feed-status-20260818-130515.txt` | 2026-08-18, first run printing the detected feed format. The run that made the Atom problem visible: **17 of 35 sources are `atom`**, and the app could only read `rss`. |
| `feed-status-20260821-011451.txt` | 2026-08-21, the run that cleared the SEC's 24 new sources before they went in. 59 of 60 returning items; the one failure is ESPN's long-standing 202. |
| `feed-status-20260822-232959.txt` | 2026-08-22, the run confirming the script still sees the whole catalog after the extractor stopped parsing `community-sources.ts` and started importing it. Same 60 sources, same 59/1. |
| `feed-status-20260823-015042.txt` | 2026-08-23, the first run of the parallelized script. Same 60 sources, same 59/1 as the two runs before it — which is the point of it: grouping by operator and running the groups concurrently changed the runtime from ~3min to ~35s and changed nothing else. First run with a `.json` sidecar. |
| `feed-status-20260823-022754.txt` | 2026-08-23, the same script against the catalog the NFL and the Big 12 left behind: **83 sources, 82/1**, in ~61s. Identical line for line to the serial run earlier that day. The runtime is now the largest operator group rather than the list — SB Nation is 36 of the 83, and 36 paced requests is what the minute is. |
| `feed-status-20260823-024250.txt` | 2026-08-23, first run that times each fetch and flags a source the app would give up on. 82 sources, 81/1, no SLOW flags — the one that would have tripped it, WV MetroNews at 16-20s, was removed in the same change. The `.json` carries `ms` per source; the slowest thing left in the catalog is under a second. |
| `feed-status-20260825-132750.txt` | 2026-08-25, the run after ESPN's RSS entry left the catalog for the JSON news API (which this script doesn't probe — see the addendum below). **82 passing, 0 failing** — the first clean report, because the one perpetual failure was ESPN's 202. |

The two 2026-08-11 files predate the timestamping in the current script — those
timestamps come from the files' modification times, which is exactly the
ambiguity the new naming avoids.

## `ci-unreachable.txt`

Not a report — the list of sources that fail from a GitHub Actions runner but
not from a laptop, used by `.github/workflows/feed-check.yml` to tell a new
failure apart from the runner's address.

Nineteen sources are on it, and sixteen of those nineteen are one
story: the local papers sharing the TownNews/BLOX CMS (the `search/?f=rss`
URLs) refuse datacenter IPs with a 429. Pacing requests ten times further
apart was measured across four dispatch runs and changed nothing outside noise
— the measurements are in `scripts/check-feeds.sh`, so don't spend the
afternoon rediscovering them.

A `~` prefix marks an entry as intermittent, which all sixteen of those are:
which subset fails moves run to run. The workflow never suggests pruning those.
It does flag an unmarked entry that passes, so the list can't quietly turn into
a set of permanent excuses.

The practical consequence is worth stating plainly: **CI cannot watch the
local-paper tier at all** — the hardest sources to replace and the likeliest to
die quietly. That is why the workflow has no schedule and why running this
script from a laptop is still the real check.

## Silent failures — resolved 2026-08-18

Two problems here, one much larger than the other, both now fixed in
`src/lib/feeds.ts`. Recorded because the *shape* of the mistake is worth
remembering, not just the fix.

**The small one: ESPN's 202.** `https://www.espn.com/espn/rss/ncf/news`
intermittently answers HTTP 202 with an empty body (202 on 2026-08-18; 19
items on 2026-08-17 — it is flaky, not dead). 202 satisfies `response.ok`, so
the status check passed, the parser got nothing out of an empty body, and
`fetchFeed` returned zero articles without ever naming ESPN in
`failedSources`.

**The large one: seventeen Atom feeds.** Feeds come in two shapes and the
parser only read one. It looked for `rss.channel.item`; every SB Nation blog
plus Off Tackle Empire serve Atom, where the path is `feed.entry`. That is
**17 of 35 in-app sources** — every fan-community source in the app —
discarded silently since the beginning. They had never once appeared.

Both were the same bug wearing different clothes: *a source that answers
politely and hands over nothing was indistinguishable from a healthy one.*
The check script made it worse rather than catching it, because it counted
`<entry>` as a fallback and so reported all seventeen as `OK` — it was more
tolerant than the app it was checking.

What changed:

- The parser detects the document shape and reads Atom as well as RSS.
- A body that is not well-formed XML, or is well-formed but not a feed, now
  **throws**, so the source reaches `failedSources` and surfaces in the app.
  Validation runs before parsing, because the parser is lenient enough to turn
  a truncated document into a plausible-looking empty channel.
- A well-formed feed with **zero items is still a success**. A publisher having
  a quiet day is not a broken source, and conflating those two is what created
  this whole class of problem.
- The script prints the detected format (`rss` / `atom`) on every OK line, so
  any future gap between "the script can read it" and "the app can read it" is
  visible in the report rather than hidden by it.

**Addendum, 2026-08-25: the 202 source is out of the catalog.** Detection
was the 2026-08-18 fix; this is the curation decision it left open. The RSS
entry (`espn-cfb`) answered 202 in every report below since 2026-08-11,
while the JSON news API on `site.api.espn.com` — the family every other
ESPN fetch in the app uses — stayed healthy the whole time. So the RSS
entry is gone, and ESPN reaches the national pools through that JSON
endpoint instead (`fetchLeagueArticles` in `team-news.ts`, merged into the
pool in `source-catalog.ts`) — for all four leagues, including the NFL,
which had shipped with no ESPN at all because its RSS path 202s the same
way. Two consequences worth knowing: the endpoint sits outside
`check-feeds.sh`'s liveness report, exactly as the per-team JSON news
always has; and a well-formed 200 whose shape has drifted degrades to
empty rather than reporting, per the contract every ESPN JSON parser holds
(`espn-parsers.test.ts`). An empty body still reports loudly — 
`response.json()` throws on it — so the failure mode this section is about
cannot go quiet again.

Still open: nothing here rates the outlets *inside* an aggregating feed. Yahoo
Sports' 50 items came from 31 different outlets on 2026-08-18 (HEAVY, SB
Nation, USA TODAY, Detroit Free Press…), all currently attributed to Yahoo and
carrying Yahoo's Tier 1. Reading the item-level `<source>` would fix the name
but would then stamp an unassessed outlet with Yahoo's rating, so it waits for
a source registry that can rate those domains.
