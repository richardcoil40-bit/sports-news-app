# If this machine died tomorrow

Written 2026-08-25, after shipping build 26. Everything the app *is* lives in
git and rebuilds from a clone. This file is about the handful of things that
don't — the ones that exist in one copy, on one Mac, with **no Time Machine
destination configured** (`tmutil destinationinfo` → "No destinations
configured", checked 2026-08-25).

None of this is theoretical bookkeeping. Two of the three items below cannot
be re-read from the service that holds them.

## The three that can't be recovered from anywhere else

| What | Where it lives | If it's lost |
|---|---|---|
| `AuthKey_WC95VKU2RK.p8` | `~/.appstoreconnect/private_keys/` | Apple lets you download a key **once**. Revoke it, generate a new one, update `~/.appstoreconnect/config.json`. |
| `EXPO_PUBLIC_VERDICT_TOKEN` | `.env.local` (gitignored) | **Not readable back from Cloudflare** — `wrangler secret put` is write-only. Rotate `CLIENT_TOKEN` in three places (below). |
| `ANTHROPIC_API_KEY`, `VET_ANTHROPIC_API_KEY` | Cloudflare secrets only | Also write-only. Mint new keys in the Anthropic console and `wrangler secret put` them. |

**These belong in a password manager, not in a backup of this repo.** They are
secrets; `.gitignore` keeps them out of git deliberately, and that same
property is what makes them the only things here with no second copy.

Note the asymmetry that makes the token worse than it looks: it is inlined
into every shipped bundle at build time, so anyone holding an `.ipa` has it —
but *you* cannot read it back off the Worker. It is not secret from an
attacker and it is unrecoverable to you. Both at once.

## Rotating the client token, if it comes to that

Three places have to agree or the app degrades silently to local verdict rules
with nothing on screen to say so:

```bash
cd worker && npx wrangler secret put CLIENT_TOKEN    # 1. the Worker
```

2. `.env.local` in this repo — `EXPO_PUBLIC_VERDICT_TOKEN=<same value>`
3. Xcode Cloud → the workflow's secret environment variable of the same name

Then prove all three agree before trusting a build:

```bash
node --env-file=.env --env-file=.env.local scripts/worker-smoke.mjs
```

That script's third assertion exists for exactly this. `ci_post_clone.sh`
fails a build when the token is *unset*, but a token that is set and **wrong**
passes that gate.

## What is already safe

- **The app, the Worker, the catalog, every doc** — all in git.
- **Signing** — `ios/` is gitignored and prebuild wipes it, but the four keys
  needed are written down in AGENTS.md ("Environment-specific constraints"),
  and Xcode rewrites them from Team selection. `DEVELOPMENT_TEAM` is
  `3CR7KR8AX5`.
- **`ios/NoFrills/Info.plist`** — regenerable with `expo prebuild` in a
  throwaway clone. Don't prebuild in place; see AGENTS.md.
- **Which commit shipped as which build** — tagged from 2026-08-25:

  | tag | commit | build |
  |---|---|---|
  | `v1.0.0` | `a1c5e18` | 1.0.0 (1) |
  | `build-25` | `69acd27` | 1.0.1 (25) |
  | `build-26` | `17cebc2` | 1.0.1 (26) |

  Builds 2, 3 and 4 predate the convention and are not tagged. Before this,
  the mapping was *derived* from Xcode Cloud's per-run source commit — which
  works right up until Apple is the thing you cannot reach. **Tag each build
  as you release it.**

## Crash symbolication: the real gap

**Xcode Cloud builds leave no archive on this machine.** Local archives cover
builds 1, 2 and 3 (7 dSYMs each, from manual `xcodebuild` archives). Builds 4,
25 and 26 have none here — their dSYMs exist only in App Store Connect.

The App Store Connect API route is closed: `GET /v1/builds/{id}/buildBundles`
returns **403 Forbidden** with the current key, on every build tried
(4, 25, 26). That is the key's role, not a bug — so there is no scripted way
to pull dSYMs today, and writing one would need a wider key first.

The working route is **Xcode → Window → Organizer**, which can download the
archive and its debug symbols for an Xcode Cloud run. Do it while Apple still
holds them; Xcode Cloud artifacts are not kept indefinitely.

Zero crash submissions have ever arrived (`--crashes` has always been empty),
which is why this is a gap worth noting rather than an emergency. It becomes
urgent the first time a tester's app dies.

## Rebuilding from a clean Mac

1. `git clone`, `npm ci`.
2. Restore `.env.local` with `EXPO_PUBLIC_VERDICT_TOKEN` (or rotate, above).
3. Restore `~/.appstoreconnect/` — `config.json` plus `private_keys/AuthKey_*.p8`
   (or generate a new key).
4. `npx expo prebuild --platform ios`, then open Xcode and set the Team so it
   writes all four signing keys.
5. Verify before trusting anything: `npm run lint && npm test && npx tsc --noEmit`,
   then `node --env-file=.env --env-file=.env.local scripts/worker-smoke.mjs`.
6. `wrangler login` for the Worker; its secrets are already set server-side and
   survive independently of this machine.

The Worker keeps running throughout. It is deployed to Cloudflare, not from
here, so losing this Mac does not take the service down — it only takes away
your ability to change it.
