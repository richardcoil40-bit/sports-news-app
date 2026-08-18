# Evidence

Output from `scripts/check-feeds.sh` — the record of when each source was
last verified to be returning real items.

These are kept in version control on purpose. Feeds rot quietly: a publisher
retires RSS, a path changes, a CDN starts refusing programmatic requests. None
of that fails loudly in the app — the source just stops contributing. Having
dated reports means you can diff against the last one instead of re-deriving
the whole picture from scratch.

## Re-running

```
bash scripts/check-feeds.sh              # in-app sources only
bash scripts/check-feeds.sh --candidates # also re-probe the rejected candidates
```

Each run writes `feed-status-<UTC timestamp>.txt` here and echoes to stdout.
The in-app list is read out of `src/lib/source-catalog.ts` and
`src/lib/community-sources.ts` rather than duplicated in the script, so it
can't drift from what the app actually fetches.

There's no fixed schedule. Worth doing when a source looks quiet in the app,
before adding a source, and periodically otherwise.

## Reports

| File | What it is |
| --- | --- |
| `feed-status-20260811-103300.txt` | First pass, 2026-08-11. The original survey: controls, the full SB Nation network, and guessed newspaper URLs. |
| `feed-status-20260811-104400.txt` | Second pass, 2026-08-11. Retries of everything that failed the first pass, plus alternates for the programs left with no local newsroom. Produced by a since-removed `check-feeds-round2.sh`. |
| `feed-status-20260813-024254.txt` | First run of the unified script, 2026-08-13. 34 of 35 in-app sources returning items. |
| `feed-status-20260818-130515.txt` | 2026-08-18, first run printing the detected feed format. The run that made the Atom problem visible: **17 of 35 sources are `atom`**, and the app could only read `rss`. |

The two 2026-08-11 files predate the timestamping in the current script — those
timestamps come from the files' modification times, which is exactly the
ambiguity the new naming avoids.

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

Still open: nothing here rates the outlets *inside* an aggregating feed. Yahoo
Sports' 50 items came from 31 different outlets on 2026-08-18 (HEAVY, SB
Nation, USA TODAY, Detroit Free Press…), all currently attributed to Yahoo and
carrying Yahoo's Tier 1. Reading the item-level `<source>` would fix the name
but would then stamp an unassessed outlet with Yahoo's rating, so it waits for
a source registry that can rate those domains.
