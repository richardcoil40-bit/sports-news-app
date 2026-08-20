# Dependency risk

Known advisories in this project's dependency tree that are **accepted
rather than fixed**, why, and what would reverse that decision.

Kept here for the same reason `data-retention.md` exists: so the answer to
"you have 8 high-severity vulnerabilities, what are you doing about them"
is something you can point to, rather than reconstruct under pressure. An
accepted risk with no written reasoning and no re-evaluation trigger is
indistinguishable from an ignored one.

Last assessed 2026-08-20 against `expo@57.0.14`.

## Current state

`npm audit` reports **16 advisories: 0 critical, 8 high, 8 moderate.**

All 16 trace to three root advisories. The other thirteen entries are the
same three surfacing again at each package that depends on them.

| Severity | Package | Advisory | CVSS | Reached via |
|---|---|---|---|---|
| High | `image-size@1.2.1` | [GHSA-w3rx-r6r6-pgpr](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr) — ICNS parser DoS, infinite loop (CWE-835) | 7.5 | `expo` → `@expo/metro` → `metro` |
| High | `image-size@1.2.1` | [GHSA-5p2g-fcmc-qvqq](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq) — JXL/HEIF parser DoS, infinite loops (CWE-835) | 7.5 | same |
| Moderate | `uuid@7.0.3` | [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq) — missing buffer bounds check in v3/v5/v6 (CWE-787) | 7.5 | `expo` → `@expo/metro`; also `@expo/config-plugins` → `xcode` |

## Why these are accepted

**Neither package ships in the app.** Metro is the bundler and `xcode` is a
prebuild config tool; both run on a developer's machine or in CI and
neither has a runtime path in a built app. Nothing in `src/` imports
either — verified, not assumed:

```bash
npm ls image-size          # expo → @expo/metro → metro → image-size
```

The realistic attack for the `image-size` pair is a hostile ICNS/JXL/HEIF
file entering the bundle and hanging the bundler. Every image asset in this
repo is committed and authored in-house, so that requires an attacker who
can already write to the repo — at which point hanging a build is far from
the worst thing available to them. The ceiling on all three is **a stalled
or failed build on a machine we control**, not user data and not anything
on a device.

That is a real bound, but state it honestly: "build-time only" means the
blast radius is a developer machine or CI runner, not that the risk is
zero. It is accepted because the impact ceiling is low, not because the
finding is bogus.

## Why the available "fix" is worse than the finding

`npm audit` reports a fix is available. It is not an upgrade — it is a
**major downgrade**. For twelve of the sixteen entries npm's proposed
remediation is:

```
{"name": "expo", "version": "53.0.27", "isSemVerMajor": true}
```

A thirteenth is offered `expo-splash-screen@55.0.24`, also a major
downgrade. That is Expo SDK 53, four majors *behind* the installed
57.0.14. npm's resolver is not finding a patched newer release; it is
finding an older tree that predates the advisory. Taking it would mean giving up React
19.2 / React Native 0.86, every Expo 57 API this app is built on, and
whatever has been fixed in Expo between 53 and 57 — to remove a
build-time DoS. That trade is not worth making, and `npm audit fix`
without `--force` will correctly decline to make it.

Overriding Metro's pinned `image-size` with a `resolutions` / `overrides`
entry was also considered and rejected: Metro pins that version
deliberately, and forcing a different one is likelier to break bundling
than to protect anything that was ever exposed.

**The real remediation is upstream.** These clear when Expo ships an SDK
whose Metro depends on a patched `image-size`. Nothing in this repo can
pull that forward.

## What would reverse this decision

This acceptance is scoped. Any of the following puts an advisory **outside**
it and it must be assessed on its own:

- **Any `critical` advisory**, regardless of where it sits in the tree.
- **Any advisory reaching a runtime dependency** — anything under `react`,
  `react-native`, `expo-*` runtime modules, `fast-xml-parser`, or
  `@react-native-async-storage/async-storage`. `fast-xml-parser` deserves
  particular attention: it is the one dependency that parses hostile
  input by design, since it reads XML from 35 third-party feeds. An
  advisory there is a runtime finding, not a build-time one, and nothing
  in this file applies to it.
- **A fix that does not require a downgrade** — re-check on every Expo SDK
  upgrade, which is the event most likely to clear these.
- **A change in exposure** — if Metro or a config plugin ever processes
  untrusted third-party assets, the "we author every asset" argument
  above stops holding.

## Re-checking

```bash
npm audit
```

Re-run on every dependency change and every Expo SDK upgrade, and update
the table and the "last assessed" date above. If the counts have moved,
the change is what needs assessing — a stable 16 is not news, and a new
entry should never be waved through on the strength of this file.
