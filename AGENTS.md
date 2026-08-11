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

- **Timeout every fetch.** `AbortController` + `setTimeout(..., 10000)`,
  wrapped in a small `fetchWithTimeout` per file. Nothing hits the
  network without a hard timeout — a hung request should fail loud
  within 10s, not hang the caller forever.
- **Cache with a `Map` + an in-flight `Map`.** Per-entity caches (keyed
  by team ID, for example) use two module-level `Map`s: one for
  resolved results, one for in-progress promises, so concurrent callers
  for the same key share a single request instead of firing duplicates.
  See `roster.ts`, `team-color.ts`, `team-leaders.ts` for the plainest
  examples; `feeds.ts` and `team-news-pool.ts` add a TTL on top (3
  minutes) since those are shared pools re-fetched more often.
- **Tolerate partial failure.** Multi-source fetches (`fetchFeeds`,
  `fetchTeamNewsPool`) use `Promise.allSettled`, not `Promise.all` — one
  dead feed should never take down the others. Failed sources get
  collected and surfaced, not silently dropped and not thrown.
- **Defensive parsing.** External JSON is always read with optional
  chaining and a fallback (`json?.field ?? []`), never assumed to have
  the shape you expect. A malformed response should degrade to empty,
  not crash.

## React effect safety

Two failure modes have actually happened in this codebase — guard
against both:

- **Don't depend on a whole object from `useLocalSearchParams()`.**
  It returns a new object every render, so `useEffect(..., [params])`
  re-fires on every render forever. Depend on the specific primitive
  fields the effect actually uses instead.
- **Guard against out-of-order responses.** If an effect's async call
  can be re-triggered before the previous call resolves (pull-to-
  refresh, fast navigation), a slow first response landing after a
  fast second one will silently overwrite newer state with stale data.
  Either a `cancelled` flag (for unmount safety, see any screen in
  `src/app/`) or a `requestId` ref (for out-of-order safety within a
  hook, see `use-teams.ts` / `use-articles.ts`) — use whichever the
  existing file already uses as its pattern.

There's a top-level `ErrorBoundary` (`src/components/error-boundary.tsx`)
wrapping the whole app in `_layout.tsx`. It's the last line of defense,
not a substitute for the two points above.

## Design system

Established and intentional — don't drift from it without discussing:

- Monospace font everywhere, applied once at the base of `ThemedText`.
- Sharp corners. `borderRadius: 0` on every card, thumbnail, and logo.
- Metadata text (sources, dates, positions) is uppercase, 11px, with
  slight letter-spacing.
- Separators are bold — 1.5px using `theme.text`, not a hairline.
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
- `docs/data-retention.md` — current posture (nothing persists) and the
  rule for whenever a persistent store gets added.

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
