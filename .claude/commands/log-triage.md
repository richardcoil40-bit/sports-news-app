---
description: Pull the Worker's runtime logs plus Apple's build state and TestFlight crashes, work out what the service actually did, and fix or propose from the evidence rather than from a guess.
---

# Log triage

The app has users now, which means the interesting failures happen on
someone else's phone against a service nobody is watching. This reads what
the service actually did.

Three places, because a failure shows up in whichever one you aren't
looking at: **Cloudflare** (what the Worker served), **Apple** (whether the
build reached testers at all), and **TestFlight crashes**. Tester feedback
is deliberately *not* part of this — that's `/testflight-triage`, which is
a different job with a different output. Keep them apart; a health check
you only run when you have time to read feedback is a health check you
stop running.

Optional argument: a window (`/log-triage 6h`), default 24h. Cloudflare
keeps 3 days and nothing keeps them after that, so a window older than
`3d` is not a thing you can ask for.
$ARGUMENTS

## 1. Pull

```bash
node scripts/worker-logs.mjs --since 5h
```

**Substitute the window argued above for `5h`** — the fence can't read
`$ARGUMENTS`, so it is an example, not the command to run verbatim. A
window nobody asked for is the one mistake here that produces a
confident, complete, wrong review.

Credentials come from `~/.cloudflare/config.json` or the environment —
nothing to pass, nothing to print. The script's own error names what's
missing and which single permission the token needs; don't go hunting.

It writes `.worker-logs/logs-<date>.json` (gitignored) with both a shaped
summary and the raw events. **Read the raw side too** when something looks
wrong — the shaped fields are the ones worth skimming, not the ones
guaranteed to hold the answer.

If it reports zero events, decide which of the two causes it is before
going further: no traffic, or observability not actually deployed.
`[observability]` is declared in `worker/wrangler.toml` but only takes
effect on the next `npx wrangler deploy`.

Then the Apple side. Both are read-only and neither needs the window —
build state is current, and crashes are few enough to read whole.

```bash
node scripts/testflight-feedback.mjs --builds --limit 5
```

```bash
node scripts/testflight-feedback.mjs --crashes --limit 20
```

`--crashes`, not the default screenshot feedback. Credentials resolve the
same way the script's header documents; nothing to pass.

## 1b. Join the two halves on the build number

This is the step that makes it one review rather than two.

Every app request in the Worker log carries a `NoFrills/<build>`
user-agent, and that number is the App Store Connect build number. So the
Cloudflare side tells you *which build the live traffic is actually coming
from*, and the Apple side tells you what state that build is in. Neither
answers it alone:

- **Traffic from an older build than the newest VALID one** means testers
  haven't updated — so a bug you fixed in the newest build is still live
  on someone's phone, and a fix you're about to make may already exist.
- **A newest build with no traffic at all** is the case that reads as
  "quiet day" and isn't. Check its state before concluding nobody opened
  the app: `PROCESSING` or `BETA_REVIEW_REJECTED` means it never reached
  anyone.
- **Zero crashes plus zero Worker events** is not a clean bill of health,
  it's an absence of evidence. Say so rather than reporting all-clear.

## 2. Know what normal looks like here

Most of what's in these logs is the service working. Check against this
before writing anything up — a "finding" that is documented behaviour
wastes the review, and this service has a lot of deliberate degradation in
it.

- **`degraded: true` in a `/v1/classify` response is not an error.** It
  means the daily cap bound or a model call failed, and the client falls
  back to local rules. `DAILY_CALL_CAP` is 750 (`worker/wrangler.toml`,
  which explains at length how a "call" is counted). Cap binding is a
  *budget* signal, not a fault — but if it binds regularly at this user
  count, that's a real finding, because the file sizes 750 as headroom
  over ~400/day at fifty users.
- **401 on `/v1/classify`** is the client missing `CLIENT_TOKEN`. Almost
  always `EXPO_PUBLIC_VERDICT_TOKEN` absent from the build — it lives in
  the gitignored `.env.local`, so any build made somewhere other than the
  usual machine ships without it. See `ci_scripts/ci_post_clone.sh`, which
  writes it from an Xcode Cloud secret and warns when it can't.
- **503 on `/v1/vet-source`** is correct and expected. That route fails
  closed until both `VET_ANTHROPIC_API_KEY` and `VET_TOKEN` are set, and
  they are not set on the deployed Worker. `worker/README.md` explains why
  it shares nothing with `/v1/classify`.
- **`/v1/leagues` served unauthenticated** is deliberate — it costs no
  model call, and gating it would silently drop builds back to the bundled
  catalog. Same file.
- **A KV write failure never surfaces as a failed request** by design:
  cache writes are wrapped and pushed through `ctx.waitUntil`, so they
  cost a future re-classification rather than a broken response. If the
  free tier's 1,000 writes/day is being hit, the symptom is a rising
  *rate* of model calls, not an error — and D1 is the documented upgrade
  path.
  - **A `canceled` outcome on `/v1/classify` is the client hanging up,**
    not a Worker fault, and `wallMs` will sit near 6000 because that's
    `CLASSIFY_TIMEOUT_MS` in `src/lib/verdicts.ts`. The degradation is
    intended. What isn't free is that the `ctx.waitUntil` cache writes are
    registered *after* the model call returns, so an abort mid-call spends
    the call and caches nothing — the same headlines cost again next time.
    Worth recording; only worth acting on if the rate climbs.
  - **`wallMs` includes `waitUntil` work.** An `ok` event reading longer
    than the client's 6s timeout did not exceed it — the response went out
    well before the KV write finished. Don't read those as near-misses.
- **`processingState=VALID` with `IN_BETA_TESTING` is the healthy pair.**
  `PROCESSING` on a build uploaded minutes ago is normal and resolves
  itself; `INVALID` or `FAILED` is real and means that build reached
  nobody.
- **`external=READY_FOR_BETA_SUBMISSION` on an older build is not a
  fault.** It means that build was never submitted for external review,
  which is the ordinary end state for one that got superseded. Only the
  newest build's external state is worth reading.
- **Zero crash submissions is the common case**, and TestFlight only
  reports crashes testers agreed to share — so it is weak evidence, not
  proof of stability. A crash count of zero alongside real Worker traffic
  is good news; alongside no traffic it says nothing at all.
- **Zero 401s across authenticated `/v1/classify` requests is positive
  evidence**, not just an absence: it means the build carries
  `EXPO_PUBLIC_VERDICT_TOKEN`. That's the one thing about an Xcode Cloud
  build that fails silently, so call it out when it's clean.

## 3. Triage

**Real fault** — a 5xx, an `exception` outcome, or a status the code has
no path to produce. Name `worker/src/index.ts:<line>` and the path
through it. These are the only items worth acting on same-day.

**Budget or capacity** — cap binding, KV write pressure, a climbing call
rate. Not a bug; a number that needs re-deriving against
`docs/scaling-plan.md`, which is where the sizing argument lives.

**Client-side** — a status that says the app is asking wrong (401, a
malformed body). The fix is in `src/lib/`, or in the build, not the
Worker.

**Documented behaviour** — matches section 2 or a decision in
`worker/README.md`, `docs/deferred-work.md`, or `AGENTS.md`. Say so and
stop. If the log is *evidence a decision is wrong*, say that separately —
it's a different conversation from a bug and must not be smuggled in as
one.

## 4. What you may fix, and what you may not

Fix, in the working tree, when the log is decisive about the cause:
anything in `src/lib/` or `worker/src/index.ts` where the failing path is
visible in the code and the change is small. Follow `AGENTS.md` — the
data-layer patterns bite hardest here (`fetchWithTimeout`,
`mapWithConcurrency`, `createEntityCache`, and the rule that a useless
response counts as a failure).

Do not, without asking:

- **`npx wrangler deploy`.** It replaces the service two live users are
  running against. Say the change is ready and let the person deploy it.
- **Add logging that widens what's recorded.** `docs/data-retention.md`
  states that no request body is logged and that events carry metadata
  only. A `console.log` of a title, an id, or anything user-shaped
  contradicts a published document — and if it's genuinely needed, that
  document gets updated in the same change, per its own rule.
- **Raise `DAILY_CALL_CAP`.** That's a spend decision, and the standing
  rule on this project is no changes that add dollar spend.
- **Touch anything in App Store Connect.** This review is read-only
  against Apple. Expiring a build, submitting one for review, or deleting
  feedback are all outward-facing and none of them are triage.

## 5. Write it up

Write to `.worker-logs/triage-<YYYY-MM-DD>.md`. Gitignored on purpose —
once something is acted on, the commit is the record, and a status file
nobody updates is worse than none (`docs/deferred-work.md` makes that case
itself).

- One-line summary: N events over the window, M worth acting on. Name the
  window in both UTC and local time — the logs are UTC and you are not.
- **Faults**, most severe first, each with file:line and what you did or
  propose.
- **Budget**, with the number and what it's tracking against.
- **Documented behaviour**, one line each with the reference.
- **Apple / TestFlight**, in two lines: build states, and the crash count.
  Include the build the live traffic actually came from, per 1b.
- Anything you couldn't classify, and what you'd need to classify it —
  including "the field that would answer this isn't in the log", which is
  itself a finding. `degraded` is the standing example: nothing in
  `worker/src/index.ts` logs it, so cap binding and model failures are
  indistinguishable from a healthy 200.

Print the summary line and the file path in the chat response.
