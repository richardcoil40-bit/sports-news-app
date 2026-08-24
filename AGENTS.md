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
- **Bound every fan-out.** `mapWithConcurrency(items, limit, fn)` in
  `src/lib/http.ts` is a drop-in for `Promise.allSettled(items.map(fn))`
  — same result shape, same order, same tolerate-partial-failure posture
  — with a ceiling on how many run at once. Use it wherever the list
  being mapped grows with the catalog or with what the user follows
  (`feeds.ts`, `multi-team-feed.ts`, `teams.ts`, `refresh-schedule.ts`).
  These limits **multiply**: followed teams → source groups → feeds is
  three levels deep, so an unbounded `map` at any one of them is
  hundreds of sockets on one phone. `DEFAULT_CONCURRENCY` (6) is above
  the width of every list the app has today, so it costs no latency
  until one of them actually grows.
  - **The exception is a fixed, heterogeneous fan-out.**
    `team-news-pool.ts`'s four source groups stay on plain
    `Promise.allSettled`: four is not a number that grows, the sockets
    come from each group's own expansion (which `fetchFeeds` already
    bounds), and serializing groups would trip that file's 15s hard cap.
    The comment there says so — don't "finish the job" by routing it.
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
  hard cap). There is no singleton variant: the national feed pool is the
  one caller that ever looked like one, and it's keyed per league in
  `source-catalog.ts`, so every cache here is an entity cache.
  - **`ttlMs` bounds staleness; `maxEntries` bounds size. They are not
    the same knob.** An expired entry keeps its payload resident until
    something overwrites it — that residency is exactly what `peek()`
    serves from — so a TTL alone never reclaims a byte. Any cache keyed
    by something that grows with *use* rather than with the catalog
    (teams visited, players opened, headlines seen) needs a
    `maxEntries` too; it evicts least-recently-used on insert, and a
    cache *hit* counts as a use. The current bounds and the reasoning
    behind each are the table in `docs/data-retention.md` — add a row
    there in the same change, since that doc is the one that has to
    answer "how long do you keep X".
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

## Cost scales with follows, not with the catalog

The catalog is heading from 3 leagues to roughly 45. **Catalog size must
not appear in a hot path** — a cold launch should cost what the user
follows, not what exists. This is a per-device cost, so it is exactly as
bad with fifty users as with a million, and it is the reason for
`fetchTeamsForLeagues`, the followed-league filter in
`refresh-schedule.ts`, `mapWithConcurrency`, and the `maxEntries` bounds
above.

Two habits keep it true:

- **Derive the scope from favorites, don't fetch to discover it.**
  Favorites are stored league-qualified precisely so the set of leagues
  worth asking about is known before any network call. `leagueIdsFrom`
  is the one place that derivation lives.
- **A per-league `map()` over `getLeagues()` is the smell.** It reads
  as free at two leagues and is forty-five requests at forty-five. If
  something genuinely needs breadth, it should be a picker — see the
  Scope section's note on `useTeams('all')`.

`use-feed.ts` hands `teams` back rather than leaving the home screen to
call `useTeams()` for itself. The underlying fetch was always shared
(`createEntityCache`'s in-flight map saw to that), but a second copy of
the hook is a second state tree and a second render pass over the same
list on every change. One instance, passed down.

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

## Reading what the service did

The Worker is the one component with live users and no screen to look at.
`[observability]` in `worker/wrangler.toml` turns Workers Logs on at full
sampling; `scripts/worker-logs.mjs` pulls a window into `.worker-logs/`;
`/log-triage` is the workflow that reads one.

Two things to hold onto:

- **Three days, then gone.** Free-plan retention, not tunable from here.
  A window nobody pulled is not recoverable, which is why the script
  writes to disk rather than only printing.
- **Metadata only, and that's a published claim.** `docs/data-retention.md`
  states that no request body is logged and that events carry method,
  path, status, outcome and timings. A `console.log` of a title or an id
  in `worker/src/index.ts` contradicts a document — if it's genuinely
  needed, that document gets updated in the same change, per its own rule.

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
- **Newsprint palette, two accents with separate jobs.** Warm cream
  paper, near-black ink, and brick red used *only* for links and the
  single outbound CTA — not for emphasis, not for state. State is the
  second accent's job: `accentControl` (teal) marks a control that is
  actively narrowing something — a filter pill, a checked row — and
  nothing else. Keeping them apart is what lets the rule about red hold.
  `Colors.light` carries the OKLCH original beside each hex; retune
  there. `Colors.dark` was out of scope for the redesign and is still the
  old neutral scale, plus lightened accents.
  - Translucent control fills are derived with `withAlpha(theme.text, …)`
    rather than written as the blended grey. Same call, both themes.
- **Claim badges are the one colour that means "what kind of thing".**
  `claimBadgeColors` in `theme.ts`: reported stays ink-on-paper and
  inverts with the theme, rumor and take carry fixed hues with cream text
  in both modes. Two screens draw that badge (`article-card.tsx` and
  `article.tsx`) — neither should hard-code the hues.
- Sharp corners. `borderRadius: 0` on every card, thumbnail, and logo.
  - **Two exceptions, both from design handoffs, both scoped to a single
    component.** `DropdownPill` — a 20pt pill and an 8pt panel: rounding
    is what makes the pills read as controls floating over the page
    rather than as more newsprint boxes, which is the entire point of
    moving them into the header. `TeamBadgeRow` — a 12pt row and a
    circular 38pt badge: the row is a container for a name, not a card of
    content, and the badge is round because a team crest is.
  - A rounded article card or thumbnail is still a drift. If a third
    exception starts to look necessary, that's the point to reopen the
    rule rather than to add to this list.
- Metadata text (sources, dates, positions) is uppercase, ~10.5–11px,
  with slight letter-spacing. Keep tracking near 0.2 on *serif* caps:
  iOS measures the run without the trailing letter-space and clips the
  last glyph, which is what a wide-tracked serif screen title did.
- Separators are bold — 1.5px using `theme.text`, not a hairline, and
  full-bleed rather than inset. The team tabs share a `Separator`
  component (`src/components/team-tabs/shared.tsx`) rather than
  re-declaring the style; use it where it fits. `DropdownPill`'s internal
  row dividers are the exception: 1px at 14% ink, because inside a small
  panel the bold rule reads as a border rather than a divider.
- Each team's real color (from `fetchTeamColor`) is the only per-screen
  accent, applied as a left-edge bar via `AccentRow` rather than
  reskinning components.
  - **It goes through `visibleOn` from `src/lib/color.ts` before it is
    painted, against the ground it is painted on.** ESPN picks these
    colors to sit on white: measured across the shipping catalog, 55 of
    82 teams fall below 3:1 on the dark ground and 24 below 1.5:1, so
    Penn State navy or Kansas State purple is a mark nobody can see. The
    function raises lightness in OKLCH — hue preserved, so a lifted navy
    still reads as that team's navy — by the *smallest* amount that
    clears 3:1, and returns a color that already clears it untouched.
    It is symmetric rather than dark-mode-only, which is what also
    catches Arizona State's gold on cream. `fetchTeamColor`'s existing
    rejection of pure white is the same rule, from before there was a
    second ground to worry about.
  - The adjustment belongs at **render** time, never at fetch time: the
    color cache is process-lifetime, so a scheme baked in at fetch would
    outlive the user switching themes — and `src/lib/` can't read the
    scheme anyway. Callers pass `theme.background`.
  - The team screen's header band is adjusted too, even though a large
    field reads at any lightness. The bars on the same screen are the
    same color, and lifting only those puts two shades of one team's
    color on one screen.
  - **Text painted on the team's colour picks its ink the same way.**
    `inkOn` measures white and the palette ink against the mark and takes
    the winner — the floor above can leave a light colour untouched (the
    Saints' beige passes the dark ground at 10:1), and hardcoded white on
    it was 1.85:1. Two call sites, the badge disc and the team screen's
    header title; both compute it from the same adjusted colour, so the
    badge that grows into the screen always agrees with the screen.
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
  - **A live feed is not a contributing one, and only the second report
    can tell you which you have.** `scripts/review/yield.mjs` runs the
    app's own filters over the app's own parser and prints
    `items → named → kept` per source, because everything that decides
    whether an item reaches the reader — the team-name match,
    `off-topic.ts`, `off-sport.ts` — runs *after* the liveness question is
    settled. Four sources sat in the catalog for months answering 200 with
    fifty items and contributing nothing: the TownNews/BLOX root
    `c=sports` category is syndicated wire and daily agate, and at `l=50`
    it fills the whole response before the beat writer's work gets in.
    That is why `LEE()` now takes a required `section`. Run it after
    adding a source, not just `check-feeds.sh`, and write the report next
    to the others.
- `docs/dependency-risk.md` — the advisories in the dependency tree that
  are knowingly accepted rather than fixed, and the scope of that
  acceptance. Read it before acting on an `npm audit` result: the current
  16 are build-time only, and npm's proposed "fix" is a major *downgrade*
  to Expo 53. Anything critical, or anything reaching a runtime dependency
  (`fast-xml-parser` especially — it parses hostile input by design), is
  explicitly outside that acceptance and needs its own assessment.

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
- **`prebuild` deletes your code signing setup — with or without
  `--clean`.** This entry used to say `--clean`, and dropping the flag to
  stay safe was tried on 2026-08-23: `npx expo prebuild --platform ios`
  printed `Clearing ios` / `✔ Cleared ios code` and wiped signing exactly
  the same way. Under SDK 57 there is no "gentle" prebuild for this
  purpose. Treat every prebuild as destructive to `ios/`.

  `ios/` and `android/` are gitignored, so the Apple Development Team
  that Xcode writes into `ios/*.xcodeproj/project.pbxproj` as
  `DEVELOPMENT_TEAM` exists in exactly one place — the folder prebuild
  removes. Nothing in any tracked config can restore it, and there is no
  `app.json` field that survives the round trip. The next build then
  fails on signing, pointing at a certificate problem rather than at the
  prebuild that actually caused it.

  **Copy the whole file out first**, not just the team id — four keys go
  missing from *both* the Debug and Release configs of the app target,
  and only the first is the one people remember:

  ```
  cp ios/NoFrills.xcodeproj/project.pbxproj /tmp/pbxproj.before
  grep -o 'DEVELOPMENT_TEAM = [^;]*' ios/*.xcodeproj/project.pbxproj | sort -u
  ```

  | key | value here |
  |---|---|
  | `DEVELOPMENT_TEAM` | `3CR7KR8AX5` |
  | `CODE_SIGN_IDENTITY` | `"Apple Development"` |
  | `CODE_SIGN_STYLE` | `Automatic` |
  | `PROVISIONING_PROFILE_SPECIFIER` | `""` |

  Restore them in Xcode (project → Signing & Capabilities → Team), which
  writes all four. The entitlements file and `PrivacyInfo.xcprivacy`
  regenerate correctly on their own; signing is the only thing that
  doesn't.

  **If Xcode is open, it will ask about the vanished workspace.** The
  dialog says `NoFrills.xcworkspace` "has disappeared" and offers
  *Re-save* or *Close*. **Close.** Re-save writes Xcode's stale in-memory
  copy back over the one prebuild just generated, putting the project out
  of sync with the freshly installed Pods. Archives are unaffected either
  way — they live in `~/Library/Developer/Xcode/Archives`, outside the
  project.
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
- **`ios/Podfile.lock` drifts out of sync with `node_modules`, and says so
  in the least useful way.** They are two locks over one dependency set, so
  any `npm install` — including one that only *removes* a package — can
  leave a pod's podspec at a version the lock doesn't know. `pod install`
  then fails with `could not find compatible versions for pod "X" … It
  seems like you've changed the version of the dependency`, naming whichever
  pod it happened to reach first rather than the change that caused it.
  Running the `pod update X` it suggests just moves the error to the next
  pod. Re-resolve the whole thing instead:

  ```
  rm ios/Podfile.lock && (cd ios && LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 pod install)
  ```

  That is safe in a way `prebuild --clean` is not: `Podfile.lock` is a
  generated file inside gitignored `ios/`, and regenerating it doesn't touch
  `project.pbxproj`, so `DEVELOPMENT_TEAM` survives. Worth doing after any
  dependency change, because the drift is invisible until the next *native*
  build — which can easily be the release archive.
- **`expo run:ios` does not exit.** After building, installing and
  launching, it stays in the foreground streaming device logs. Piping it
  to `tail` therefore shows nothing and looks like a hang — the build
  has usually finished long before. To check, look at what it's actually
  doing: a child process of `simctl spawn … log stream` means the build
  succeeded and it's only tailing logs.

## Scope

Built for football today — the Big Ten, the SEC and the NFL — with an
explicit intent to expand to other sports and leagues. Favor
sport-agnostic naming and structure where it doesn't cost real effort
now, so that expansion is additive later rather than a rewrite.

**Leagues are data, not code.** The catalog lives in
`src/lib/__data__/leagues.json` and is read through
`src/lib/league-catalog.ts`. Adding a league is a JSON entry — never a
new constant, and never an edit to a module. The goal it serves is that
adding the NFL should not require shipping a new build of the app, so
resist anything that puts a league back into TypeScript.

**And it is hosted, so it doesn't require shipping a build at all.**
`GET /v1/leagues` on the Worker in `worker/` serves that same JSON file —
imported across from the app repo rather than copied, so the served copy and
the bundled one can't drift. `refreshLeagueCatalog()` fires once from
`_layout.tsx` and installs the result over the bundled list; the bundled file
stays as the shipped default and the offline fallback. Adding a league is now
an edit to that JSON plus a `wrangler deploy`.

Three things about that are load-bearing:

- **The fetch throws; it never degrades to empty.** This is `teams.ts`'s
  exception, for `teams.ts`'s reason, and it is the easiest thing here to get
  backwards. `fetchLeagueCatalog` rejects on a non-OK response, on a body that
  isn't JSON, and on JSON that yields no *available* league — an empty array,
  an array of junk, or a catalog of nothing but planned entries.
  `refreshLeagueCatalog` catches that and keeps whatever list is in force. A
  catalog that degrades to `[]` is an app with no tabs, no filters and no
  favorites, rendering as though it loaded fine. A document that yields
  *some* leagues alongside junk is a success — `parseLeagues` drops bad
  entries individually, the same line the feed layer draws between a quiet
  publisher and a broken source.
- **`DEFAULT_LEAGUE` stays pinned to the bundled catalog** while
  `getLeagues()` / `getCatalogLeagues()` / `getLeague()` follow whatever is
  installed. Its callers resolve an *absent* league id — a favorite written
  before keys were league-qualified, a deep link that arrived without one —
  and those are questions about what this build shipped with. A remote
  reorder silently changing which league a legacy favorite migrates into
  would be worse, and invisible.
- **Screens that render the catalog use `useLeagueCatalog()`**, not
  `getCatalogLeagues()` directly, so a remote list landing a moment after a
  picker mounts re-renders it instead of sitting unseen until the screen
  remounts. Everything else reads `getLeagues()` at fetch time, which is
  already whatever is in force by then. `getLeagues()` memoizes its filtered
  array and `install` invalidates it — don't reintroduce a fresh
  `.filter()` per call, it's read from three render paths.

With `EXPO_PUBLIC_CATALOG_URL` unset, none of this touches the network and
the catalog is exactly the bundled file — the same hard requirement
`verdicts.ts` holds itself to for `EXPO_PUBLIC_VERDICT_URL`.

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
  - **Read the cache with the same key you wrote it with.** The one
    place that didn't — `team-news-pool.ts`'s 15s hard-cap fallback
    peeked on the bare team id while the write used `espnCacheKey` — so
    the fallback never found anything and always served empty. It looked
    correct on the page; the two lines are 40 apart.
- **A fetcher that takes a `League` takes it as a required argument.**
  Nine of them used to default to `DEFAULT_LEAGUE`, and neither detail
  screen passed one, so an NFL team id silently built
  `football/college-football` URLs and cached under a college-football
  key — a wrong screen that looks like a working one. `DEFAULT_LEAGUE`
  still exists for resolving an *absent* league id (`favorites.ts`,
  `multi-team-feed.ts`, the two detail screens' deep-link fallback), but
  never as a parameter default: a required argument is what turns the
  next occurrence of this into a type error. Screens get theirs from a
  `leagueId` route param — `Team.leagueId` is in scope at every push
  site.
- **Anything calendar-shaped belongs on the descriptor.**
  `seasonStartMonth` exists because college football's August-to-January
  season is wrong for nearly every other sport. Note it means "the month
  from which the new season's year is worth querying", which for college
  football is September, not the late-August opener — ESPN has no stats
  until games are played, and setting it a month early silently returns
  zero stat leaders all preseason.
- **`parseLeagues` validates as if the data were hostile**, dropping bad
  entries individually and falling back to the bundled catalog. That was
  written as groundwork for the day the catalog arrived over the network,
  and when that day came it needed no new trust code: not a line of it
  changed. Keep it that way — validation belongs at that one gate, not
  spread across the callers.

Two modules are still conference-shaped. Both are keyed by team slug
through `team-slug.ts`, which owns the one alias table reconciling
ESPN's abbreviations ("Michigan St", "Mississippi St") with how a school
is normally written — add another table and key it the same way rather
than re-deriving slugs:

- `community-sources.ts` holds **one source table per conference**, and
  the SEC's arrival is what proved the point: it was a day of verifying
  URLs and about ten lines of code. Keep them as separate tables. Slugs
  are unique per *school*, not per league, and realignment moves schools
  between conferences — one merged map would eventually serve a school
  another school's feeds.
- `team-nicknames.ts` is what each team's local paper calls it
  ("Huskers", "Buckeye Talk"), used to filter that paper's broad sports
  feed down to the program. Same story: research, not code. Unlike the
  sources, this is **one table across conferences on purpose** — the key
  is a school, and a school's nicknames don't change when it changes
  conference.

  **These are only safe against a source covering that team's own
  region.** "Wildcats" is four schools and "Bruins" is also an NHL team,
  so the national pool and ESPN's feed stay matched on the school name
  alone. Don't widen the callers without doing the per-nickname
  disambiguation research first. The SEC made that rule bite harder, not
  less: "Tigers" is Auburn, LSU *and* Missouri, so none of the three
  claims it, and "Bulldogs" belongs to Mississippi State (whose only
  paper is in Starkville) but not to Georgia.

  **`nickname-safety.ts` is where that rule stopped being prose.** The
  thing to keep straight is that it splits in two, and the halves work
  differently on purpose:

  - **A college mascot collision is decided by the sources.** Two schools
    can share "Bulldogs" indefinitely as long as each is only matched
    against its own city's paper. It becomes a defect the moment they
    share a `scope: 'broad'` source — that is the `shared-source` hazard,
    and the gate fails on it. A collision without a shared source is
    `contested`: a note, because whether two papers overlap in region is
    not derivable from anything in this repo.
  - **A professional team's name is decided by the word.** No region
    resolves it — every metro sports section covers the NFL — so those
    are `reserved` outright. `RESERVED_NICKNAMES` in `team-nicknames.ts`
    is the curated floor, and every name in a snapshotted pro league is
    added to it, so reviewing the NFL once reserves its 32 mascots
    without anyone maintaining a list.

  That list used to be nine words hardcoded in `team-nicknames.test.ts`
  alongside a hardcoded 34-team roster. Both were right and neither
  scales; more to the point, a flat word list asks the wrong question.

**In both tables, a present key is a decision and an absent key is a
gap.** `[]` used to answer two different questions — "researched, nothing
here is worth adding" and "nobody has ever looked at this league" — and
at 34 teams you catch that by reading the file, at 900 you never catch it
at all. So `lsu: []` is a nickname ruling, and a slug that appears in
neither table has not been ruled on. `team-review.ts` reads that second
question off the same tables (`createTeamReview`, `nicknameReviewFor`,
`bigTenSourceReviewFor`); the lookups still return `?? []`, so nothing
about what the app fetches changed.

Every empty entry needs a line in that file's reasons table saying what
was ruled out, and a *partial* entry may carry one too — that's where the
ownership research lives (`DEAD_FEED_OWNERS`: Gannett retired RSS,
Tribune 403s, McClatchy resets, Vox shut the blogs down, USA Today folded
the Wire sites in). It is composed per team rather than restated, so a
new league running into Gannett reads the finding instead of spending an
afternoon rediscovering it. `team-review.test.ts` fails on an empty entry
with no reason and on a reason orphaned from its entry — both of which
read as research still in force.

**And the gate is what makes that convention cost something.**
`scripts/review/propose.mjs <leagueId>` writes a worksheet to
`docs/review/` and a roster snapshot to `__data__/reviewed-teams.json`;
`team-review.test.ts` reads the snapshot and fails a league the catalog
serves that has no snapshot, or that has a team missing from either
table. So flipping a league off `"status": "planned"` without doing the
research fails `npm test`. `docs/review/README.md` is the workflow.

Three things about the tooling that are easy to undo by accident:

- **The scripts import the app's modules; they do not parse them.** Node
  24 strips types on import, and `scripts/lib/app-modules.mjs` resolves
  the `@/` alias, so `check-feeds.sh` and the review scripts read the
  real tables. That is only possible while nothing they reach imports
  JSON or an npm package at runtime, and while type-only imports carry
  the `type` keyword — Node cannot tell otherwise and emits a real
  import that fails. Both constraints are why `loadAppModule` throws with
  an explanation instead of letting a resolution error surface.
- **A source helper is not cosmetic.** `SB_NATION`, `ADVANCE` and `LEE`
  name the owner at the call site, which is the unit these papers fail
  in — and `check-feeds.sh` used to regex adjacent `name:`/`url:` lines
  plus a special case for `SB_NATION(...)`, so adding the other two would
  have silently dropped 22 sources from the liveness report while the app
  kept fetching them. It imports the table now, so it can't.
- **`vet.mjs --ai` is off by default and stays that way.** The free steps
  eliminate most candidates first, and the Worker's `/v1/vet-source` has
  its own cap, counter, token and API key — deliberately with no fallback
  to the app's. Source vetting must not be able to spend the budget the
  live feed runs on.

**Anything resolving *followed* teams must span every league the user
follows — and stop there.** A favorite is stored league-qualified
(`"sec:333"`), so a screen holding one league's team list silently drops
every favorite outside it; that was invisible while the Big Ten was the
only league. But the fix is not "fetch everything": the league ids are
readable straight off the stored keys (`leagueIdsFrom` in
`favorite-keys.ts`), so the right width is exactly the leagues the user
follows something in. `useTeams()` with no argument is that, via
`fetchTeamsForLeagues`. The two deliberate widenings:

- **Naming a league** (`useTeams(league)`) scopes to one. The Favorites
  picker wants it because it walks Sport → Level → League; the team
  screen wants it because a deep link can land on a league the user
  doesn't follow, and arriving with no team list means every story on
  the screen renders untagged.
- **`useTeams('all')`** fetches every available league, and costs a
  standings request per league to do it. Onboarding is the honest case:
  on a first launch there are no favorites to scope by, so scoping would
  offer an empty list to pick from. Reach for it only when the screen is
  showing what you *could* follow rather than what you do.

Basketball appears only as a test descriptor in `leagues.test.ts` plus a
fixture trimmed from ESPN's live NBA standings. Those exercise the two
paths a conference cannot: a league with no conference filter, and the
nested `children[]` standings shape that comes back when you omit the
filter. Adding a league in a *new sport* is still a product decision,
not a code one.
