# Test fixtures

Saved sample responses for the `src/lib/` tests. Nothing here hits the
network — every test stubs `fetch` and serves one of these files.

These are **hand-trimmed representative samples**, not verbatim captures. Real
ESPN responses are tens of kilobytes of fields this app never reads, so each
file keeps only the fields the corresponding parser touches, plus at least one
deliberate edge case:

| File | Parser | Edge case it carries |
| --- | --- | --- |
| `espn-standings.json` | `teams.ts` | Third team has no `logos` array |
| `espn-standings-nested.json` | `teams.ts` | The *other* standings shape — a whole-league query with no `group` filter, which nests entries under `children[]` instead of a root `standings`. Trimmed from ESPN's live NBA response so the alternate shape is real rather than imagined; one team has no `logos`. Not a sign the app supports basketball — it's the fixture that proves the league boundary is closed. |
| `espn-roster.json` | `roster.ts` | A `coaches` group that must be filtered out |
| `espn-team-leaders.json` | `team-leaders.ts` | A `$ref` with no extractable athlete id |
| `espn-player-stats.json` | `player-stats.ts` | An all-zero category, and an off-season year |
| `espn-schedule.json` | `schedule.ts` | A neutral-site game, and an event with no opponent |
| `espn-team-news.json` | `team-news.ts` — both the team-scoped and league-wide fetchers, which share one endpoint shape | An unparseable date, and an article with no web link |
| `espn-team.json` | `team-color.ts` | — (the white-color case is inline in the test) |
| `rss-valid.xml` | `feeds.ts` | CDATA with pre-encoded entities, and an item with no link |
| `rss-malformed.xml` | `feeds.ts` | Truncated mid-document, as a dying CDN returns |
| `cluster-corpus.json` | `cluster.ts` | **Not an API response** — 90 real headlines captured from four teams' live pools on 2026-08-18, trimmed to the fields the clusterer reads. Clustering weights words by how common they are *in the batch*, so it cannot be tested against a handful of invented headlines: synthetic filler gives synthetic statistics, and early attempts passed or failed depending on how the filler was worded rather than on the code. Deliberately retains three real over-merges that had to be fixed (a numbered series, an offensive/defensive pair, and one story about two different teams) alongside the five merges that are correct. |
| `atom-valid.xml` | `feeds.ts` | A `link` array whose first entry is `rel="replies"`; an entry with a `rel`-less link; an entry with no resolvable `href` (dropped); a bare-string title alongside `type="html"` CDATA titles; an entry with `<updated>` but no `<published>`; `media:thumbnail` |
| `news-sitemap-valid.xml` | `feeds.ts` | Trimmed from azcentral's live news sitemap (2026-08-24). A non-sports URL whose headline word-boundary-matches a team name ("Arizona State Fair" — the case the `/story/sports/` path filter exists for); a pretty-printed `<loc>` wrapped in whitespace; a pre-encoded entity in `news:title`; an entry with neither `news:publication_date` nor `image:image` |

Malformed *shapes* (null bodies, wrong types, missing keys) are generated in
the tests rather than saved as files — they're one-liners and reading them
next to the assertion is clearer than opening a file.

If a parser starts reading a new field, add it to the relevant fixture rather
than loosening the assertion. If ESPN changes a response shape for real,
that's worth re-capturing from a live call and re-trimming by hand.
