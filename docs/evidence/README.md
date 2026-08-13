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
The in-app list is read out of `src/lib/feeds.ts` and
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

The two 2026-08-11 files predate the timestamping in the current script — those
timestamps come from the files' modification times, which is exactly the
ambiguity the new naming avoids.

## Standing known failure

**ESPN (`https://www.espn.com/espn/rss/ncf/news`) returns HTTP 202 with an
empty body.** It shows as failing in every report here, including the original
2026-08-11 pass, so it has never worked from a programmatic client.

This one is worth understanding rather than just noting, because the app does
*not* treat it as a failure: 202 satisfies `response.ok`, the XML parser
returns nothing useful for an empty body, and `fetchFeed` yields zero articles
without adding ESPN to `failedSources`. So the national pool is quietly running
on CBS, Yahoo, Off Tackle Empire and Extra Points, and no error surfaces
anywhere. Deciding what to do about that — drop the source, find a working URL,
or make an empty parse count as a failed source — is an open question, not a
settled one.
