# Source reliability standard

How this app decides what counts as a trustworthy source. The goal is a rule
that can be applied consistently by someone who isn't a college football fan,
and defended to someone who disagrees with the result.

## Why not just "reputable outlets"

"Reputable" collapses two separate questions that behave differently:

1. **Is the source generally reliable?** A property of the outlet — its
   staffing, standards, and track record. Changes slowly.
2. **Is this particular claim credible?** A property of the story — whether
   it's named-source reporting, an anonymous scoop, or speculation. Changes
   article to article.

A normally-reliable outlet publishes shaky rumors; a small independent blog
breaks a story that holds up. Grading them separately is what keeps the
standard honest. (This is the same split the NATO/Admiralty intelligence
grading system makes — source reliability A–F on one axis, information
credibility 1–6 on the other.)

This app can only really assess axis 1 automatically. Axis 2 is noted here
because it's the reason we surface bylines and link to originals rather than
flattening everything into "the news."

## The criteria

Each is written so you can actually check it in a few minutes, not just
assert it.

### 1. Accountability

Can you find out who is responsible for a claim, and tell them they're wrong?

- Named masthead or staff page — real people, not just "Staff."
- Bylines on articles, not anonymous posts.
- A published corrections or editorial standards policy.
- A working way to contact the newsroom.

*Check:* look for `/about`, `/staff`, `/ethics`, `/corrections`. A site with
none of these gets no better than Tier 3, regardless of how good it reads.

### 2. Attribution transparency

Does the reporting show its work?

- Sources named where possible; anonymous sourcing characterized
  ("a person with direct knowledge of the negotiations") rather than bare
  "sources say."
- Opinion, analysis, and reporting visually distinguishable.
- When aggregating, the original reporter and outlet are credited and linked.

*Check:* read three recent non-opinion articles. Count how many claims trace
to something you could independently verify.

### 3. Independence

Who pays, and what do they want?

- **Independent** — subscriber- or ad-funded, no institutional tie to the
  program covered. Strongest.
- **Affiliated** — team/school/conference-owned (athletic department sites,
  Big Ten Network). Useful for primary facts (rosters, injury statements,
  schedules), weak for evaluative claims about the program itself.
- **Access-dependent** — depends on continued credentials from the program.
  Not disqualifying, and it's most beat reporting, but it explains why
  criticism is sometimes muted.
- **Conflicted** — revenue depends on the thing being reported (sportsbook
  affiliate content, "insider" subscriptions sold on recruiting hype).

*Check:* who owns it, how does it make money, is that disclosed.

This mirrors the audit evidence hierarchy: evidence obtained from an
independent external party outranks evidence produced by the entity being
examined. A school's own press release is a fine source for *what the school
said* and a poor source for *whether it's true*.

### 4. Original reporting vs. aggregation

Aggregators inherit the reliability of whatever they're repackaging, plus
their own transcription error rate. They can't be more reliable than their
source, and are usually slightly less.

*Check:* over a week of output, roughly what share is first-hand
(interviews, documents, on-site) vs. rewritten from elsewhere?

### 5. Track record

College football is unusually good for this because a lot of reporting
resolves publicly and quickly. Recruiting commitments, coaching hires, and
transfer decisions all become verifiably true or false within weeks.

*Check:* pick five past scoops. Did they happen as reported? Were misses
acknowledged?

### 6. Stability

Longevity, consistent publishing cadence, and editorial continuity. A site
that has covered a program for a decade with the same staff is a different
proposition from one that launched last spring.

### 7. Business-model hygiene

Flag anything where the revenue model rewards being interesting over being
right — engagement-bait recruiting rumor mills, betting-affiliate content
presented as analysis, paywalled "insider" tiers whose value proposition is
exclusivity rather than accuracy.

## Tiers

Rather than a pass/fail, sources get a tier. This drives how the app
presents them, not whether they're allowed in.

| Tier | Meaning | Criteria | Treatment in app |
|---|---|---|---|
| 0 | Not assessed | Nobody has applied the criteria below to this outlet | Show, labeled "Unrated" |
| 1 | Professional newsroom | Accountability + attribution + track record all clear; independent or access-dependent | Show freely; eligible for "trusted only" filter |
| 2 | Credible independent | Named staff, real original reporting, thinner formal standards (good team blogs, established newsletters) | Show freely |
| 3 | Community / fan perspective | Real editorial presence but fan-voiced, mostly reaction and aggregation | Show, labeled as community |
| 4 | Affiliated / primary source | School, conference, or team-owned | Show only for factual primary info (schedules, official statements) |
| — | Excluded | No accountability, conflicted revenue, or a track record of unretracted misses | Not ingested |

Tier is a property of the *source*, stored alongside the feed definition, so
it can be shown in the UI and used as a filter without re-deriving it.

### Tier 0 is not a bad rating

Tier 0 says *the app has not assessed this outlet*, which is a different
statement from any of the ratings below it. In particular it is not a
politer Tier 3: Tier 3 describes what a source is (fan-voiced, real
editorial presence), while Tier 0 admits what the app doesn't know.
Collapsing the two would put a description on an outlet nobody has looked
at, which is the failure the whole tier exists to prevent.

**Where it comes from today: syndication.** An RSS item can name the outlet
it was republished from, via `<source url="…">Name</source>`. Surveyed
across all 35 in-app feeds on 2026-08-18, exactly one uses it — Yahoo
Sports, which is an aggregator: 50 items drawn from 27 different outlets
(SB Nation, Trojans Wire, Detroit Free Press, HEAVY…), none written by
Yahoo.

Those articles used to be attributed to "Yahoo Sports" and to inherit
Yahoo's Tier 1, so a HEAVY piece displayed as a professional newsroom. The
app now credits the outlet that actually wrote it and drops the tier to 0.
A rating is earned by the source that was assessed; passing it along to 27
outlets that weren't is a false claim on the one axis this document exists
to keep honest.

Renaming without re-rating would have been worse than doing neither, which
is why the rename waited for this tier rather than shipping on its own.

Tier 0 is also the fallback for an unrecognised tier value, for the same
reason: not knowing should never render as a claim.

## Candidate sources

All entries below were checked with `scripts/check-feeds.sh`. Only the ones
marked live are in the app.

### Tier 1 — local/regional newsrooms

The strongest reliability category. Professional staffs, corrections
policies, named beat reporters with credentialed access. Most are paywalled,
which is acceptable: their RSS carries headline plus teaser and the app links
out to the source.

| Program | Outlet | Status |
|---|---|---|
| Ohio State | Cleveland.com | live |
| Michigan, Michigan St | MLive | live |
| Penn State | PennLive | live |
| Rutgers | NJ.com | live |
| Oregon | OregonLive | live |
| Nebraska | Lincoln Journal Star | live |
| Nebraska | Omaha World-Herald | live |
| Wisconsin | Wisconsin State Journal | live |
| Illinois | The News-Gazette | live |
| Minnesota | Star Tribune | live |
| Washington | The Seattle Times | live |
| UCLA, USC | Los Angeles Times | live |
| Iowa | Des Moines Register | no feed (Gannett) |
| Indiana, Purdue | Indianapolis Star | no feed (Gannett) |
| Illinois, Northwestern | Chicago Tribune | blocked (403) |
| Maryland | Baltimore Sun | blocked (403) |

Ownership drives the pattern, which is why failures come in matched pairs:

- **Advance** (Cleveland.com, MLive, PennLive, NJ.com, OregonLive) — all
  live on the same `/arc/outboundfeeds/rss/category/sports/` path.
- **Lee** (Lincoln Journal Star, Wisconsin State Journal, Omaha World-Herald,
  News-Gazette) — all live on the same `/search/?f=rss` query form.
- **Gannett** (Des Moines Register, Indianapolis Star, and their Hawk Central
  and Journal & Courier siblings) — every documented path returns HTTP 200
  with an empty body. This is a retired feature, not a wrong URL.
- **Tribune** (Chicago Tribune, Baltimore Sun) — HTTP 403 to any
  programmatic request regardless of path or user agent.

Iowa, Indiana, and Purdue therefore have no local newsroom coverage
available, and Northwestern and Maryland lose their metro paper. Revisit if
those chains restore feeds; there's nothing to fix on our end.

### Tier 2 — independent team coverage

- **Eleven Warriors** (Ohio State) — live. Independent, named staff, original
  reporting, long track record. The model for what a Tier 2 entry looks like.
- **Extra Points** (Matt Brown) — live, via `extrapoints.substack.com/feed`
  rather than the custom domain. College sports business, governance, and
  realignment; independent and subscriber-funded. Conference-wide, so it sits
  in the national pool rather than under one team.

Worth finding: the equivalent of Eleven Warriors for other programs,
especially Iowa, Indiana, and Purdue, which have no Tier 1 option. These
exist but vary in quality and need individual assessment against the
criteria above.

### Tier 3 — SB Nation network

Near-complete Big Ten coverage — one site per program, free, no paywall.
Fan-voiced and aggregation-heavy, but with real editorial presence and
consistent cadence. 16 of 18 are live.

The exceptions are **UCLA (Bruins Nation)** and **USC (Conquest
Chronicles)**, the conference's two California schools. SB Nation ended its
California contributor arrangements after AB5, the state's freelancer law,
capped how much a freelancer could publish for one outlet; Vox subsequently
wound those sites down. The LA Times covers both programs instead.

| Program | Site | Domain |
|---|---|---|
| Illinois | The Champaign Room | thechampaignroom.com |
| Indiana | The Crimson Quarry | crimsonquarry.com |
| Iowa | Black Heart Gold Pants | blackheartgoldpants.com |
| Maryland | Testudo Times | testudotimes.com |
| Michigan | Maize n Brew | maizenbrew.com |
| Michigan State | The Only Colors | theonlycolors.com |
| Minnesota | The Daily Gopher | thedailygopher.com |
| Nebraska | Corn Nation | cornnation.com |
| Northwestern | Inside NU | insidenu.com |
| Ohio State | Land-Grant Holy Land | landgrantholyland.com |
| Oregon | Addicted to Quack | addictedtoquack.com |
| Penn State | Black Shoe Diaries | blackshoediaries.com |
| Purdue | Hammer and Rails | hammerandrails.com |
| Rutgers | On the Banks | onthebanks.com |
| UCLA | Bruins Nation | bruinsnation.com |
| USC | Conquest Chronicles | conquestchronicles.com |
| Washington | UW Dawg Pound | uwdawgpound.com |
| Wisconsin | Bucky's 5th Quarter | buckys5thquarter.com |
| Conference-wide | Off Tackle Empire | offtackleempire.com |

All are Vox Media properties following the same platform conventions, so
they stand or fall together on RSS.

### Tier 4 — affiliated

School athletics sites and Big Ten Network. Only appropriate for primary
facts. Not currently ingested; noted so the boundary is explicit.

### Excluded / needs care

- **Rivals, 247Sports, On3 team boards** — login-gated, so out of reach on
  technical grounds regardless of merit. Their national free content is a
  separate question.
- **The Athletic** — genuinely Tier 1 reporting, but no reliable public RSS
  and hard paywall. Verify before assuming it's usable.
- **Aggregators and rumor accounts** with no masthead — excluded under
  criterion 1.

## Verifying feeds

`scripts/check-feeds.sh` requests every candidate and reports which URLs
actually return items. Run it before adding any source, and re-run
periodically — feeds move and get retired.

Three cautions learned the hard way:

- **Don't trust a single client.** During research, feeds that are
  demonstrably live returned empty or unreadable responses to one fetching
  tool while ESPN and CBS came back clean through the same tool. An empty
  response is evidence about the client as much as the server. The SB
  Nation network was written off on that basis and had to be reinstated.
- **Read the failure mode.** HTTP 403 means actively blocked, 404 means
  wrong path, and 200-with-no-items usually means the feature was retired.
  They call for different responses: give up, guess again, and give up
  respectively. And a non-200 isn't automatically fatal: The Seattle Times
  answers 202 to a datacenter address and 200 to a laptop. (ESPN's RSS
  answered 202 to everyone, laptop included, which is why it's no longer in
  the catalog — see the addendum in `../evidence/README.md`.)
- **Liveness is not usefulness.** A feed can answer 200 with fifty items
  and contribute *nothing* to the team it was added for. That is not a
  hypothetical: it was true of four sources in the shipping catalog for
  months. `scripts/review/yield.mjs` is the report that asks the second
  question — see below.

### A live feed that contributes nothing

`check-feeds.sh` asks whether a URL returns items. Everything that decides
whether an item reaches the reader — the team-name match, `off-topic.ts`,
`off-sport.ts` — runs afterwards, so a source can pass every check here and
still be invisible in the app. Run
`node scripts/review/yield.mjs [leagueId ...]` for that question; it runs
the app's own filters over the app's own parser and reports
`items → named → kept` per source.

Two causes found so far, and they want different fixes:

- **The wrong section of the right paper.** The TownNews/BLOX root
  `c=sports` category is where the syndicated wire lands — AP copy, daily
  agate, Little League regionals, sportsbook affiliate posts — and at
  `l=50` it fills the entire response, pushing the beat writer's work off
  the end. The Tulsa World, the St. Louis Post-Dispatch and The Eagle each
  returned **zero** articles naming their team; the Waco Tribune-Herald
  returned one. Reading the paper's own section instead
  (`sports/college/mizzou`, `sports/college/aggiesports`,
  `k_state_sports/football`) took those four from 0/0/0/1 to 43/25/19/30.
  The section is research per paper, not a pattern: find it in the paper's
  navigation, and note The Manhattan Mercury files K-State *outside*
  `sports/` altogether. The same failure exists off this CMS — the LA Times
  sports front gave USC two articles where `sports/usc/rss2.0.xml` gives 18.
- **The outlet is gone and the domain isn't.** The CU Independent stopped
  being the CU Boulder student paper: its news feed ends in July 2024, the
  site now describes itself as covering "celebrity news, art, sexuality,
  sports, and lifestyle", and its sports category is casino-affiliate and
  listicle copy. It answered 200 with ten items throughout, so no liveness
  check would ever have flagged it. This is criterion 7
  (business-model hygiene) failing after admission, which is the case for
  re-reading the criteria against a source periodically and not only once.
  Removed rather than retuned — there was no section of it left to point at.

### Owners already ruled out

Failures come in matched pairs, because a paper is usually dead for its
owner's reason rather than its own. Check this table before verifying
anything — the point of writing it down is that Gannett does not get
re-tested once per team it owns.

| Owner | Failure mode | Verdict |
| --- | --- | --- |
| Gannett | 200 with an empty body on every documented path | Retired the feature. Give up. |
| Tribune | 403 to any programmatic request, any path or agent | Actively blocked. Give up. |
| McClatchy | Connection reset to any programmatic request | Actively blocked. Give up. |
| Vox / SB Nation (California) | Sites shut down after AB5 | Gone. UCLA and USC have no blog. |
| Vox / SB Nation (elsewhere) | Domain resets rather than 404s | Gone, not moved. |
| USA Today "Wire" | 404 including the control site | Network folded in. |
| Advance | Live on `/arc/outboundfeeds/rss/category/sports/` | Works, and that is the only category it serves. |
| Lee / TownNews | Live on `/search/?f=rss&t=article&c=<section>&l=50` | Works. Probe with `c=sports`, then **subscribe to a section below it**. |

The dead ones are also `DEAD_FEED_OWNERS` in
`src/lib/community-sources.ts`, composed into the per-team reason each
league's table carries, so the finding is reachable from the code as well
as from here. The two live ones are `OWNER_FEED_URL` in the same file —
builders rather than prose, since a paper on one of these chains has a
feed URL that is purely a function of its host, and the review tooling
probes a candidate through the same builder the table would use.

## Applying this

Start with `node scripts/review/propose.mjs <leagueId>`, which does steps
1 and 2 below for a whole league and writes them into a worksheet — see
`docs/review/README.md`. The steps are still the steps; the script is
what stops them being done from memory at 900 teams.

1. Check the ruled-out table above before spending time on a paper — most
   metro papers in a new league belong to a chain already tested. The dead
   ones are `DEAD_FEED_OWNERS` in `src/lib/community-sources.ts`, and a
   candidate host tagged with one is skipped without a request.
2. Run the feed checker; keep only what actually returns items. The two
   live chains have URL builders — `OWNER_FEED_URL` in the same file — so
   a candidate is probed at the exact path the table would give it rather
   than at a second guess.
3. For each survivor, spend a few minutes on criteria 1–3 and assign a tier.
   `scripts/review/vet.mjs --ai` will propose one against these criteria if
   the Worker's vetting endpoint is deployed; it is a proposal, it is off by
   default, and tier 0 with `uncertain: true` is the answer it is supposed
   to give when it is recognising a name rather than assessing one.
4. Record the tier with the feed definition in
   `src/lib/community-sources.ts`, alongside a `scope` of `team` or `broad` —
   a metro sports section carries pro teams and other sports, so it has to be
   filtered down to the program by name, while a team blog can be taken whole.
5. Record the outcome either way: a team key present in that league's table
   is what marks it reviewed, and anything ruled out goes in the reasons
   table beside it. An absent key means nobody has looked, and
   `team-review.test.ts` fails a shipped league that still has one.
6. Re-check annually, or whenever a source's ownership or business model
   changes.

## Coverage as it stands

### Big Ten

| Program | Tier 1 | Tier 2 | Tier 3 |
|---|---|---|---|
| Illinois | News-Gazette | — | The Champaign Room |
| Indiana | — | — | The Crimson Quarry |
| Iowa | — | — | Black Heart Gold Pants |
| Maryland | — | — | Testudo Times |
| Michigan | MLive | — | Maize n Brew |
| Michigan State | MLive | — | The Only Colors |
| Minnesota | Star Tribune | — | The Daily Gopher |
| Nebraska | Journal Star, World-Herald | — | Corn Nation, Daily Nebraskan |
| Northwestern | — | — | Inside NU |
| Ohio State | Cleveland.com | Eleven Warriors | Land-Grant Holy Land |
| Oregon | OregonLive | — | Addicted To Quack |
| Penn State | PennLive | — | Black Shoe Diaries |
| Purdue | — | — | Hammer and Rails |
| Rutgers | NJ.com | — | On the Banks |
| UCLA | LA Times | — | — |
| USC | LA Times | — | — |
| Washington | Seattle Times | — | UW Dawg Pound |
| Wisconsin | Wisconsin State Journal | — | Bucky's 5th Quarter |

### SEC

| Program | Tier 1 | Tier 2 | Tier 3 |
|---|---|---|---|
| Alabama | AL.com | — | Roll Bama Roll |
| Arkansas | Democrat-Gazette | — | The Arkansas Traveler |
| Auburn | Opelika-Auburn News, AL.com | — | — |
| Florida | — | Gator Country | — |
| Georgia | — | — | Dawg Sports, The Red & Black |
| Kentucky | — | — | A Sea of Blue |
| LSU | The Advocate | — | And The Valley Shook |
| Mississippi State | Starkville Daily News | — | — |
| Missouri | Post-Dispatch | — | Rock M Nation, Columbia Missourian |
| Ole Miss | — | — | Red Cup Rebellion |
| Oklahoma | Tulsa World | — | The OU Daily |
| South Carolina | The Post and Courier | — | — |
| Tennessee | — | — | Rocky Top Talk |
| Texas | — | — | Burnt Orange Nation |
| Texas A&M | The Eagle | — | Good Bull Hunting |
| Vanderbilt | — | — | Anchor Of Gold |

Plus ESPN (Tier 1, via its JSON news API rather than RSS — see below), CBS
Sports and Yahoo (Tier 1) and Extra Points (Tier 2) across college
football, and one conference-wide blog each: Off Tackle Empire (Tier 3)
for the Big Ten, Saturday Down South (Tier 3) for the SEC.

The NFL has no per-team table at all yet and runs on ESPN's team feed plus
CBS Sports, Yahoo Sports and ProFootballTalk (all Tier 1), with ESPN's
league-wide news merged into the national pool. Neither of ESPN's RSS
paths is anywhere in the catalog anymore: both answered 202 with an empty
body — the college one in every report in `../evidence/` from 2026-08-11
until it was removed on 2026-08-25 — so ESPN's league-wide coverage
arrives through the same JSON news API its team feed already uses. The
write-up is the addendum in `../evidence/README.md`.
Backfilling the 32 local newsrooms is the largest single piece of source
research outstanding, and none of it blocks the league: names were reviewed,
sources were not, and only the first of those is a gate.

Weakest coverage: Iowa, Indiana, Purdue, Northwestern, and Maryland run on a
single Tier 3 source each, as do Kentucky, Ole Miss, Tennessee and Texas.
Mississippi State and South Carolina run on a single Tier 1 newsroom each,
which is the same thinness from the other direction. Those are the programs
to target next.

### What the SEC cost, and why it was research and not code

Checked 2026-08-21, and worth recording because the answer was different
from the Big Ten's:

- **SB Nation is half gone here.** Auburn, Arkansas, South Carolina,
  Oklahoma and Mississippi State lost their blogs, as did Team Speed Kills,
  the conference-wide one. Those six domains now reset the connection
  rather than 404 — dead, not moved. Ten SEC blogs survive and are in.
- **Alligator Army (Florida) still advertises a feed it no longer serves.**
  The site is live and its own `<link rel="alternate">` points at
  `/rss/index.xml`, which 404s. That is a broken feed on a working site,
  so it is worth re-checking rather than writing off.
- **Gannett is retired here too.** The Gainesville Sun, Knoxville News
  Sentinel, Austin American-Statesman, Athens Banner-Herald, The Oklahoman,
  Clarion Ledger, Tennessean, Montgomery Advertiser and Tuscaloosa News all
  return 200 with an empty body — the same finding as the Big Ten's Des
  Moines Register and IndyStar. McClatchy (Lexington Herald-Leader, The
  State) resets the connection to any programmatic request, like the
  Tribune papers do.
- **The USA Today "Wire" team sites are gone.** Roll Tide Wire, Gators
  Wire, Longhorns Wire and the rest all 404 — including the control
  (Fighting Irish Wire), so this is the network being folded in, not a
  path change.

Three student papers went in and four did not, on the rule already
established above: a whole-site WordPress `/feed/` carries campus news and
opinion, so only sports-scoped feeds qualify. The Red & Black, The OU Daily
and The Arkansas Traveler publish `?c=sports` feeds and are in; the Daily
Texan, Vanderbilt Hustler, Daily Mississippian and The Maneater publish
whole-site feeds and are deferred, exactly like The Lantern and the
Michigan Daily.

### Deferred

Student papers — The Lantern, Michigan Daily, Daily Northwestern, The
Diamondback, Daily Illini — all have live feeds, but the working URLs are
whole-site feeds carrying campus news and opinion, not just sports. They'd
need a sports-section path before they're worth ingesting into a football
app. Daily Nebraskan is already in because its feed is sports-scoped.
