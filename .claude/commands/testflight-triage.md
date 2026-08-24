---
description: Pull TestFlight feedback, triage it against decisions this repo has already made, and write a proposals file to review.
---

# TestFlight triage

Pull the tester feedback that has accumulated, work out what each item
actually means for this codebase, and write up proposals.

**Propose only — do not edit application code in this run.** The whole
point is that the proposals get read before anything moves.

Optional argument: a build number to filter to (`/testflight-triage 4`).
$ARGUMENTS

## 1. Pull

Screenshot feedback and crashes are separate resources. Get both.

```bash
node scripts/testflight-feedback.mjs --limit 40 --new --download
```

```bash
node scripts/testflight-feedback.mjs --limit 40 --new --crashes
```

`--new` hides submissions already recorded in `docs/testflight-triaged.json`.
If it reports nothing new, stop and say so — don't drop `--new` to find
work. Re-run without it only if the user asks to see the whole history.

Credentials come from `~/.appstoreconnect/` — nothing to pass, nothing to
print. On a 401 the script's own error names the key and issuer to check;
don't go hunting for the `.p8`.

Screenshots land in `.testflight-feedback/` (gitignored). **Read every
one.** A tester's comment is usually a fragment — "this looks wrong" — and
the screenshot is the actual report.

Note the build on each item, and compare against `expo.ios.buildNumber` in
`app.json` — read it rather than assuming, it moves. Feedback lags builds.

## 2. Triage into four buckets

Before proposing anything, check what this repo has already decided. This
is the part that earns the most: a good share of tester feedback describes
behaviour that is deliberate, and re-proposing it wastes the review.

Read or grep as the feedback warrants:

- `AGENTS.md` — the design system and data-layer rules. Many "bugs" are
  documented intent: sharp corners, red reserved for links and the single
  outbound CTA, uppercase metadata, and the native header falling back to
  system sans on iOS 26 (known and accepted, in the fonts section).
- `docs/deferred-work.md` — what is deliberately unbuilt, and what unlocks
  it.
- `docs/data-retention.md`, `docs/source-reliability.md` — for feedback
  about what is stored, or which sources show up in the feed.

**Bug** — behaviour contradicting what the code intends. Name file:line.
Describe the wrong path, not just the symptom.

**Already decided** — matches a documented intent or a deferred item.
Quote the doc line. No proposal. If the feedback is *evidence the decision
is wrong*, say so explicitly and separately — a decision can be revisited,
but that is a different conversation from a bug and must not be smuggled
in as one.

**Already fixed** — reproduce against the current branch before proposing.

**New request** — out of scope for a fix. Record it, size it, don't design
it here.

## 3. Propose within the existing conventions

A proposal that violates `AGENTS.md` is not a proposal, it is rework.
Traps that feedback-driven changes hit specifically:

- `src/lib/` stays React-free (`no-restricted-imports` enforces it) and
  uses `fetchWithTimeout` / `mapWithConcurrency` / `createEntityCache`
  rather than hand-rolling any of the three.
- A new cache keyed by something that grows with *use* needs `maxEntries`
  plus a row in `docs/data-retention.md` in the same change.
- Leagues are data. A fix that adds a league constant to TypeScript is
  wrong by construction.
- Colour and type complaints go through the design system, never a
  call-site override — no `fontFamily` at call sites, no new
  `borderRadius` exceptions.

Each proposal gets: file:line, what changes, why the tester hit it, and
rough size. If it is one line, say so. If it needs a real rebuild rather
than a Metro reload — anything in `app.json` — flag it, and flag that
prebuild is destructive to `ios/` signing (`AGENTS.md` has the four keys
to save first).

## 4. Write it up

Write to `.testflight-feedback/triage-<YYYY-MM-DD>.md`.

That directory is gitignored on purpose, and this file should be too: once
a proposal is acted on, the commit is the record. `docs/deferred-work.md`
makes the case itself — a status note nobody updates on the event that
changes things is worse than none. So don't start a tracked
`docs/feedback/` archive. If something here deserves to outlive the day it
belongs as a line in `docs/deferred-work.md`, or as a commit.

Structure it to be read top to bottom in a few minutes:

- One-line summary: N items, M actionable, builds X–Y.
- **Actionable**, most severe first, each with file:line and size.
- **Already decided**, one line each with the doc reference.
- **Requests**, one line each.
- Anything unclassifiable, and what you would need to classify it.

Print the summary line and the file path in the chat response, so the
shape is readable without opening it.

## 5. Mark what you triaged

Only after the write-up exists:

```bash
node scripts/testflight-feedback.mjs --limit 40 --new --mark
```

```bash
node scripts/testflight-feedback.mjs --limit 40 --new --crashes --mark
```

This stamps each id with today's date in `docs/testflight-triaged.json` so
the next run skips them. It is two steps on purpose — pull, review, *then*
mark — so nothing gets marked that wasn't actually read.

**Never delete feedback from App Store Connect.** Apple has no archive and
no mark-as-read; its only management action is a permanent Delete that
takes the tester's report with it, and the API's
`DELETE /v1/betaFeedbackScreenshotSubmissions/{id}` is the same operation.
The ledger exists precisely so that nothing has to be destroyed to keep
track. If the user wants feedback actually gone, that's theirs to do in the
App Store Connect UI.
