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
  - **A useless response counts as a failure — keep it that way.**
    "Failed" used to mean only a rejected promise or a non-OK status, so
    a source that answered politely with nothing usable reported nothing
    and contributed nothing. That hid two real bugs for months (ESPN's
    202-with-empty-body, and seventeen Atom feeds the parser couldn't
    read at all — see `docs/evidence/README.md`). `fetchFeed` now throws
    on a body that isn't well-formed XML, and on well-formed XML that
    isn't a feed.
  - **But a feed with zero items is still a success.** A publisher having
    a quiet day is not a broken source. That distinction is the whole
    point — conflating the two is what created the problem above — and
    `feeds.test.ts` has a test on each side of it. Don't collapse them.
  - **Validate before parsing.** `XMLValidator` runs first because the
    parser is deliberately lenient: hand it a truncated document and it
    nests the unclosed elements into a plausible-looking channel with no
    items, which is indistinguishable from a healthy quiet feed.
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

## Feature flags

`src/constants/flags.ts` holds compile-time booleans for changes big
enough that you'd want to see the app both ways before committing.
`BRIEF_MODE` is the current one: off, the home screen is the endless
chronological feed it always was; on, it's the brief with a finish line
and collapsed sections below.

They're JS-only constants on purpose — flipping one is a Metro reload
rather than a rebuild, so rejecting an idea costs a boolean instead of a
revert.

**Delete a flag once the question is settled, along with the branch it
isn't taking.** A flag nobody flips is dead code with extra steps.

## Design system

Established and intentional — don't drift from it without discussing:

- **Two typefaces, split by job.** Newsreader (serif) for anything you
  *read* — headlines, body copy, team and player names. IBM Plex Mono for
  anything you *scan* — chips, timestamps, sources, section labels, stat
  figures. The app used to be monospace everywhere; that changed with the
  newsprint redesign, and reverting a headline to mono is a drift, not a
  fix.
  - Both are chosen in exactly one place: `ThemedText` maps each `type`
    to a family and calls `fontFamilyFor`. Don't set `fontFamily` at a
    call site. When a `type`'s default is wrong for one instance —
    a `title` that is a jersey number rather than a name, a `default`
    that is an uppercase label — pass `font="mono"` rather than
    introducing a new type.
  - Each weight is a **separately bundled face with its own family
    name**, so `fontWeight` alone cannot pick one. That's why
    `ThemedText` flattens the caller's style before resolving the
    family, and why the four weights per family in `_layout.tsx` are the
    only ones that exist. Adding a fifth means loading it there too.
  - Fonts load asynchronously and are deliberately *not* gated behind a
    loading screen — see the comment on `FONTS`. One consequence is
    known and accepted: the native header ignores `headerTitleStyle`'s
    family on iOS 26, so nav-bar text is the system sans. Anything the
    design must control belongs in-screen, not in header options.
- **Newsprint palette, one accent.** Warm cream paper, near-black ink,
  and brick red used *only* for links and the single outbound CTA — not
  for emphasis, not for state. `Colors.light` carries the OKLCH original
  beside each hex; retune there. `Colors.dark` was out of scope for the
  redesign and is still the old neutral scale.
- Sharp corners. `borderRadius: 0` on every card, thumbnail, and logo.
- Metadata text (sources, dates, positions) is uppercase, ~10.5–11px,
  with slight letter-spacing. Keep tracking near 0.2 on *serif* caps:
  iOS measures the run without the trailing letter-space and clips the
  last glyph, which is what a wide-tracked serif screen title did.
- Separators are bold — 1.5px using `theme.text`, not a hairline, and
  full-bleed rather than inset. The team tabs share a `Separator`
  component (`src/components/team-tabs/shared.tsx`) rather than
  re-declaring the style; use it where it fits.
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
- `docs/deferred-work.md` — what was deliberately left unbuilt and why.
  Almost everything outstanding depends on one missing piece (a small
  service holding an API key), and that file records what it unlocks,
  why nothing built meanwhile becomes rework, and the one decision in it
  that can't be reverted. Read it before concluding something is simply
  missing.
- `docs/evidence/` — dated output from `scripts/check-feeds.sh`, the
  record of when each source was last verified to be returning items.
  Re-run it rather than assuming; feeds rot silently. Reports print the
  detected format (`rss` / `atom`) per source — that column is what made
  the seventeen-dead-Atom-feeds problem visible, and its README writes up
  that whole episode, which is worth reading before trusting any source
  that merely *looks* healthy.

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
- **CocoaPods needs a UTF-8 locale, and fails obscurely without one.**
  If `pod install` dies with `Unicode Normalization not appropriate for
  ASCII-8BIT (Encoding::CompatibilityError)`, Ruby's default external
  encoding is US-ASCII (check with
  `ruby -e 'puts Encoding.default_external'`). Prefix the build:

  ```
  LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 npx expo run:ios
  ```

  The traceback points into `Pod::Config#installation_root` and looks
  like a corrupt Podfile, which it isn't.
- **`expo run:ios` does not exit.** After building, installing and
  launching, it stays in the foreground streaming device logs. Piping it
  to `tail` therefore shows nothing and looks like a hang — the build
  has usually finished long before. To check, look at what it's actually
  doing: a child process of `simctl spawn … log stream` means the build
  succeeded and it's only tailing logs.

## Scope

Built for Big Ten college football today, with an explicit intent to
expand to other sports and leagues. Favor sport-agnostic naming and
structure where it doesn't cost real effort now, so that expansion is
additive later rather than a rewrite.

**Leagues are data, not code.** The catalog lives in
`src/lib/__data__/leagues.json` and is read through
`src/lib/league-catalog.ts`. Adding a league is a JSON entry — never a
new constant, and never an edit to a module. The goal it serves is that
adding the NFL should not require shipping a new build of the app, so
resist anything that puts a league back into TypeScript.

`League` itself (the type, plus the pure URL/season helpers) stays in
`src/lib/leagues.ts`. That file holds no league data at all, and
shouldn't gain any.

- **Build ESPN URLs with the helpers**, never by interpolating the
  descriptor fields directly. `espnSitePath` gives
  `football/college-football`; `espnCorePath` gives
  `football/leagues/college-football`. The extra `leagues` segment is
  the single easiest thing here to get wrong — only two callers use it,
  so grepping for the site path silently misses them.
- **Key per-entity caches with `espnCacheKey`.** ESPN ids are unique
  only within a sport: NBA team 13 is the Lakers, and college-football
  team 13 is someone else entirely. Keyed on the raw id they would share
  a roster cache entry. It intentionally keys on sport + league path
  rather than league id, so two conferences of the same sport still
  share one cached roster.
- **Anything calendar-shaped belongs on the descriptor.**
  `seasonStartMonth` exists because college football's August-to-January
  season is wrong for nearly every other sport. Note it means "the month
  from which the new season's year is worth querying", which for college
  football is September, not the late-August opener — ESPN has no stats
  until games are played, and setting it a month early silently returns
  zero stat leaders all preseason.
- **`parseLeagues` validates as if the data were hostile**, dropping bad
  entries individually and falling back to the bundled catalog. That is
  deliberate groundwork: the day the catalog is fetched instead of
  bundled, no new trust code should be needed.

Two tables are still conference-shaped and deliberately left alone. Both
are keyed by team slug through `team-slug.ts`, which owns the one alias
table reconciling ESPN's abbreviations ("Michigan St") with how a school
is normally written — add a third table and key it the same way rather
than re-deriving slugs:

- `community-sources.ts` is a Big Ten–only source table. The *shape* is
  league-agnostic; only the contents are Big Ten. The real cost of a
  second conference is the research — every URL in there was verified
  live — not the code.
- `team-nicknames.ts` is what each team's local paper calls it
  ("Huskers", "Buckeye Talk"), used to filter that paper's broad sports
  feed down to the program. Same story: research, not code.

  **These are only safe against a source covering that team's own
  region.** "Wildcats" is four schools and "Bruins" is also an NHL team,
  so the national pool and ESPN's feed stay matched on the school name
  alone. Don't widen the callers without doing the per-nickname
  disambiguation research first.

No second league is shipped, and basketball appears only as a test
descriptor in `leagues.test.ts` plus a fixture trimmed from ESPN's live
NBA standings. Those exercise the two paths one league cannot: a league
with no conference filter, and the nested `children[]` standings shape
that comes back when you omit the filter. Adding a real second league is
a product decision, not a code one.
