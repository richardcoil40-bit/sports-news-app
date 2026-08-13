# Working in this repo

This is NoFrills — see `README.md` for what the app is. This file is
about *how* the code here is built, so changes stay consistent with
what's already established rather than introducing a second pattern for
something that already has one.

## Expo version

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/
before writing any code — APIs drift between versions and training data
goes stale.

## The data-layer pattern (`src/lib/`)

Every remote data source follows the same shape. Match it rather than
inventing a new one:

- **Timeout every fetch.** Import `fetchWithTimeout` from
  `src/lib/http.ts` — don't hand-roll another one. It wraps `fetch` in
  an `AbortController` + `setTimeout(..., FETCH_TIMEOUT_MS)` (10s).
  Nothing hits the network without a hard timeout — a hung request
  should fail loud within 10s, not hang the caller forever. If a call
  site needs its own fetch logic (see `feeds.ts`, which times each feed
  for debugging), still import `FETCH_TIMEOUT_MS` rather than
  redeclaring the number.
- **Cache with `createEntityCache` from `src/lib/cache.ts`.** Don't
  hand-roll another resolved-`Map`-plus-in-flight-`Map` pair; the helper
  encapsulates that, so concurrent callers for the same key share a
  single request instead of firing duplicates. Pass `{ ttlMs }` for
  pools that should go stale (`feeds.ts` and `team-news-pool.ts` use 3
  minutes, since those are shared and re-fetched more often); omit it to
  cache for the life of the process (`roster.ts`, `team-color.ts`,
  `team-leaders.ts`, `player-stats.ts`). `force: true` on a `get`
  bypasses the read and refetches — that's what pull-to-refresh uses.
  `peek(key)` is a TTL-ignoring stale read, for fallback paths that
  would rather serve something old than nothing (`team-news-pool.ts`'s
  hard cap). Sources that cache one global result rather than one per
  entity use `createSingletonCache` from the same file.
  - **Error policy stays at the call site.** The helper caches whatever
    the loader resolves to and caches nothing when it rejects. If a
    source should degrade to empty *and* remember that, catch inside
    the loader you pass (`team-leaders.ts`, `player-stats.ts`); if it
    should stay uncached so the next call retries, let it throw
    (`roster.ts`).
- **Tolerate partial failure.** Multi-source fetches (`fetchFeeds`,
  `fetchTeamNewsPool`) use `Promise.allSettled`, not `Promise.all` — one
  dead feed should never take down the others. Failed sources get
  collected and surfaced, not silently dropped and not thrown.
  - **Known gap:** "failed" currently means a rejected promise or a
    non-OK status. A source that returns a *successful* response with
    nothing usable in it — ESPN's feed answers 202 with an empty body —
    parses to zero articles and is never added to `failedSources`. It
    contributes nothing and reports nothing. See
    `docs/evidence/README.md`; unresolved, and worth fixing if you're
    touching this code.
- **Defensive parsing.** External JSON is always read with optional
  chaining and a fallback (`json?.field ?? []`), never assumed to have
  the shape you expect. A malformed response should degrade to empty,
  not crash.
  - **One deliberate exception: `teams.ts` throws on a non-OK
    response.** Every other source is supplementary — a screen missing
    stat leaders or a team color still works. The team list isn't: the
    tab bar, the filters, and every per-team fetch key off it, so
    degrading to empty produces an empty app that looks like it loaded
    correctly. Throwing surfaces a retryable error instead. Don't
    "fix" this to match the rule; if you add another source the app
    genuinely can't function without, it belongs in this exception too.

## React effect safety

Three failure modes have actually happened in this codebase — guard
against all three:

- **Don't depend on a whole object from `useLocalSearchParams()`.**
  It returns a new object every render, so `useEffect(..., [params])`
  re-fires on every render forever. Depend on the specific primitive
  fields the effect actually uses instead.
- **Guard against out-of-order responses.** If an effect's async call
  can be re-triggered before the previous call resolves (pull-to-
  refresh, fast navigation), a slow first response landing after a
  fast second one will silently overwrite newer state with stale data.
  Either a `cancelled` flag (for unmount safety, see the team-color
  effect in `src/app/team/[id].tsx`) or a `requestId` ref (for
  out-of-order safety within a hook, see `use-teams.ts`,
  `use-articles.ts`, `use-async.ts`) — use whichever the existing file
  already uses as its pattern.
- **Don't put the `setLoading(false)` inside a `cancelled` guard when
  the flag flips on anything other than unmount.** The team screen's
  effect re-ran per tab, so its cleanup set `cancelled = true` on every
  tab change; the `finally` block then skipped clearing `loading`, and
  the load-once re-entry guard saw a load still "in flight" and refused
  to retry. Switching tabs mid-load left a permanent spinner. If an
  effect can be torn down for reasons other than unmount, prefer a
  `requestId` — it stops stale writes without discarding a live result.

There's a top-level `ErrorBoundary` (`src/components/error-boundary.tsx`)
wrapping the whole app in `_layout.tsx`. It's the last line of defense,
not a substitute for the two points above.

For a plain data/loading/error triple, use `src/hooks/use-async.ts`
rather than writing the three `useState`s again — it has the `requestId`
guard built in. Two things about it are load-bearing and shouldn't be
"simplified": the loader receives a `publish` callback so results can
land in stages (the team schedule renders its games before its odds
finish loading), and `load()` is idempotent while `reload()` forces, so
it can be called from an effect that re-runs on every tab change. A
*failed* load deliberately doesn't count as done, so revisiting a tab
after an error retries.

## Tests

`npm test` runs Vitest (`npm run test:watch` to watch). It's scoped to
`src/lib/**/*.test.ts` by `vitest.config.mts` and runs in a plain Node
environment — no jest-expo, no Metro transform, no React Native mocks.
That's only possible because the data layer has no React or React Native
imports, which the `no-restricted-imports` rule in `eslint.config.js`
enforces (see **Lint** below). Testing components or hooks
would need that heavier harness; add it alongside this rather than
folding these tests into it.

- **No live network calls.** Tests stub `fetch` and serve a fixture from
  `src/lib/__fixtures__/` (see the README there for what each file
  covers and why it's shaped that way).
- **Import fixtures, don't read them.** JSON via a plain import
  (`resolveJsonModule` is on), text via Vite's `?raw`. Node's `fs` isn't
  available to the type-checker: Expo's `tsconfig.base` sets
  `customConditions: ["react-native"]`, under which `node:*` types don't
  resolve.
- **Use a unique entity id per call.** Every module here caches at module
  scope with no reset hook, so tests that reuse an id will serve each
  other's cached values. `teams.ts` caches per *league*, so its tests
  pass `{ force: true }` instead.
- **The contract worth protecting** is that a malformed or
  unexpected-shape response degrades to empty rather than throwing.
  `espn-parsers.test.ts` asserts it for every parser against a shared
  list of junk shapes. That list found five real crashes when it was
  written — add to it rather than narrowing it.

## Lint

`npm run lint` runs `expo lint` against `eslint.config.js`
(`eslint-config-expo`, flat config). It passes clean — keep it that way.

The rule worth knowing about is `no-restricted-imports` scoped to
`src/lib/**`: importing `react` or `react-native` from the data layer is
an error, because that layer is plain TypeScript and staying that way is
what lets it be tested under Vitest without a React Native harness.
`@react-native-async-storage/async-storage` is blocked there too, with a
single declared exception for `src/lib/storage.ts` — the one file that
touches disk. Add UI code to `src/hooks/` or `src/components/` instead
of relaxing the rule.

Four `react-hooks/set-state-in-effect` errors are suppressed inline,
each with a reason: three are ordinary fetch-on-mount (`use-teams`,
`use-articles`, `use-feed`) and one is Expo's own web hydration
boilerplate. They're per-line rather than a rule-level "off" so the rule
still fails the build on new code.

## Design system

Established and intentional — don't drift from it without discussing:

- Monospace font everywhere, applied once at the base of `ThemedText`.
- Sharp corners. `borderRadius: 0` on every card, thumbnail, and logo.
- Metadata text (sources, dates, positions) is uppercase, 11px, with
  slight letter-spacing.
- Separators are bold — 1.5px using `theme.text`, not a hairline. The
  team tabs share a `Separator` component
  (`src/components/team-tabs/shared.tsx`) rather than re-declaring the
  style; use it where it fits.
- Each team's real color (from `fetchTeamColor`) is the only per-screen
  accent, applied as a left-edge bar via `AccentRow` rather than
  reskinning components.
- No gradients, no shadows-as-decoration. Flat surfaces only.

## Source reliability and data retention

Anything that decides what counts as a trustworthy source, or what gets
stored and for how long, is documented in `docs/`, not just left in
code comments:

- `docs/source-reliability.md` — the tiering criteria a source has to
  clear, and why. There's also a generalized, portable version of this
  saved as a Claude skill (`source-reliability`) usable outside this
  project.
- `docs/data-retention.md` — what's kept and for how long. One small
  persisted store (followed teams, via `lib/storage.ts`); everything
  else is in-memory and dies with the process. It carries the table of
  every cache and its TTL, so update it when you add or retime one, and
  it has the rule any future persistent store has to follow.
- `docs/evidence/` — dated output from `scripts/check-feeds.sh`, the
  record of when each source was last verified to be returning items.
  Re-run it rather than assuming; feeds rot silently. Its README also
  documents a standing failure worth knowing about (ESPN's feed returns
  202 with an empty body and the app doesn't count that as a failure).

## Environment-specific constraints

These apply if you're working from a sandboxed agent environment
without direct network/git access — not necessarily true if you're
running locally with full access:

- **Committing may fail with a `.git/index.lock` error** if another
  process (Xcode, a running `expo` dev server, another agent session)
  has the repo open. If so, ask the person to run the commit themselves
  from their own terminal rather than retrying blindly.
- **`npm`/`npx expo install` may be blocked by a network allowlist.**
  If a package install fails with a registry 403, ask the person to run
  it themselves — don't assume the package can't be installed at all.
- **Native config changes need a real rebuild, not a reload.** Changes
  to `app.json` (icon, name, splash, native plugins) don't take effect
  from a Metro reload once `ios/`/`android/` already exist — those
  folders are generated once and reused. Regenerate with
  `npx expo prebuild --clean` before rebuilding, or the change silently
  won't show up and will look like a bug.

## Scope

Built for Big Ten college football today, with an explicit intent to
expand to other sports and leagues. Favor sport-agnostic naming and
structure where it doesn't cost real effort now, so that expansion is
additive later rather than a rewrite.

A league's identity lives in `src/lib/leagues.ts` as a `League`
descriptor (`id`, `displayName`, and the `espn*` fields its URLs are
built from). `BIG_TEN` is the only one wired up today.
`fetchTeams(league)` in `teams.ts` takes one and defaults to it, and
each league's team list caches under its own `id`. When you add a
league, add a constant — don't hardcode a group number or a conference
name into a module.

Two things are still conference-shaped and deliberately left alone:

- `community-sources.ts` is a Big Ten–only source table keyed by team
  slug. The *shape* is league-agnostic; only the contents are Big Ten.
  The real cost of a second conference is the research — every URL in
  there was verified live — not the code.
- Six modules still hardcode the sport and league in their URLs:
  `roster.ts`, `schedule.ts`, `team-color.ts`, `team-news.ts`,
  `player-stats.ts` and `team-leaders.ts`. Note the last one is easy to
  miss when grepping — it uses `football/leagues/college-football`
  rather than the `football/college-football` the others use. So the
  `League` descriptor closes the *conference* boundary but not yet the
  *sport* one; those six each need it threaded through.

Both are additive to fix later, not blockers.
