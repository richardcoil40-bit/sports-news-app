# NoFrills

A plain, ad-free, subscription-free feed of news for the teams you care
about. No editorializing, no "top stories" algorithm, no clutter — just
headlines from a curated set of sources, filtered to your teams.

Currently scoped to football — the Big Ten, the SEC and the NFL — while
the core is being proven out, with the explicit intent to expand to
other sports and leagues later. The NFL runs on ESPN's own team feeds
for now: the curated community, independent and local sources in
`src/lib/community-sources.ts` are per-conference research that hasn't
been done for it yet, and a league without them is a normal state
rather than a broken one.

Code and naming choices favor sport-agnostic terms where reasonable, so
that expansion doesn't mean a rewrite.

## What's actually here

- Per-team news, pulled from ESPN plus each team's community sites,
  independent outlets, and local newsroom sports sections — not just
  the big national outlets. See `docs/source-reliability.md` for how a
  source earns a place in the app and what tier it's given.
- Schedule and odds (where posted).
- A "most talked about" players list per team, ranked by how often
  they're actually named in recent coverage plus last season's
  statistical leaders — not roster order or depth-chart guesses.
- Recruiting news, filtered from the same article pool.
- A morning/noon/night refresh cycle — see `src/lib/refresh-schedule.ts`
  for why that's foreground-triggered rather than a true background job.

Nothing persists to disk — every cache is in-memory only. See
`docs/data-retention.md` for the full picture.

## Getting started

```bash
npm install
npx expo run:ios
```

That builds the native project and installs it to a connected simulator
or device. Subsequent JS-only changes just need a Metro reload
(Cmd+D → Reload in the simulator) — no rebuild required.

### When you *do* need a full rebuild

Anything that changes native config — the app icon, display name,
splash screen, or a new native dependency — won't show up from a reload
alone, because the native `ios/` project is generated once and then
reused. Regenerate it first:

```bash
npx expo prebuild --clean
npx expo run:ios
```

### Free Apple ID signing

Without a paid Apple Developer account, on-device builds are signed
with a certificate that expires every 7 days. After that, the app just
won't open until you re-run `npx expo run:ios` from this Mac. That's
Apple's policy, not a bug — see `docs/` or ask if this needs solving
properly (TestFlight, via `eas build`, is the real fix once this is
ready to share with other people).

## Project layout

- `src/app/` — screens, one file per route (Expo Router file-based
  routing).
- `src/lib/` — all data fetching, parsing, caching, and ranking logic.
  Nothing in here touches React; it's plain TypeScript that the screens
  call into.
- `src/components/` — shared UI pieces.
- `src/hooks/` — thin React wrappers around `lib/` calls.
- `docs/` — decisions worth having a paper trail for: source
  reliability criteria, data retention posture. Add to this rather than
  letting the reasoning live only in a chat history.
- `assets/brand/` — source SVGs for the app icon/logo, in case the mark
  needs to be re-exported at a different size later.

See `AGENTS.md` for the coding conventions established across this
codebase (caching pattern, effect-safety pattern, design system rules)
before making changes — they're consistent on purpose.
