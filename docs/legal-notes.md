# Legal notes

Not legal advice — nobody involved in writing this is a lawyer. This is
the factual landscape worth understanding, written down while it's
still simple, so decisions about where this app goes next are made
with eyes open rather than reconstructed from memory later.

## Content aggregation

The app pulls RSS feeds and ESPN's site data and shows a headline,
description, image, and a link to the original — never full article
text. That's the same shape as Apple News, Feedly, or any RSS reader,
and meaningfully lower-risk than republishing full stories.

That said, a feed being technically fetchable doesn't mean every
publisher's terms of service explicitly welcome a third-party app being
built on top of it. Some do, some are silent, some restrict
"systematic" or commercial use. At the current scale — private, a
handful of people, no ads or subscriptions — this is very low
realistic risk. Publishers pursue this kind of thing when there's money
or real scale involved, not a closed friend group.

## ESPN's API specifically

It's unofficial and undocumented, which also means it's almost
certainly outside what ESPN's own terms of service contemplate for
third-party use. Same risk logic as above applies today. Of everything
this app depends on, this is the one most likely to draw attention if
usage ever got large or public, since it's ESPN's own proprietary data
feed rather than a publisher's public RSS output — worth remembering as
the single point of highest exposure, separate from the availability
risk already noted in `AGENTS.md`.

## Team names and logos

The app displays real team names, colors, and logos throughout. This is
generally protected by *nominative fair use* — referencing a trademark
to identify what you're talking about (a Michigan news app has to say
"Michigan") is allowed, as long as it doesn't imply official
endorsement or affiliation.

The app name matters here: "NoFrills" doesn't suggest any league or
team partnership, which keeps this comfortably in fair-use territory.
This calculus changes if the marks themselves ever became the basis for
revenue — e.g. team-branded merchandise or anything implying a
licensing relationship. Purely informational use (news, scores,
schedules) staying low-risk; commercial use of the marks themselves
would not.

## Donations

There is a "Tip the developer" section on the Developer Info screen in
Settings, with a Venmo link. **As of 2026-08-20 it is live** — the URL
is set in `src/app/settings/developer.tsx` and the section renders, and
as of 2026-08-23 it is deliberately staying that way for internal
TestFlight (see "Which one we are actually doing" below).

An earlier version of this paragraph said the URL was deliberately unset
and that what existed was "the surface, not a live ask." That was true
when written and stopped being true the same day. Anyone reading this
file to decide whether the app solicits money needs the current answer,
so: it does, via an external link, today.

The mechanism, when it is switched on, is a plain external link handed
to `WebBrowser.openBrowserAsync`, the same hand-off the Article screen
already uses. No payment SDK, no card details, nothing new stored or
collected — the zero-collection posture in `docs/data-retention.md`
holds unchanged, which is why that document needs no edit for this.

**The trigger point is Apple App Review, and nothing before it.** The
app isn't on the App Store or public TestFlight, so Apple's guidelines
don't apply — and that stays true for *internal* TestFlight testing
(up to 100 named testers via App Store Connect), which isn't reviewed
at all. What changes the picture is an external/public TestFlight beta
or a full App Store submission.

### What review would actually make of the link — checked 2026-08-23

An earlier version of this section said the link **must** be removed or
converted to in-app purchase before any reviewed build. That was the
right summary of the rules when it was written, and it is now too
absolute: the ground shifted in 2025, in this app's favor, without
becoming safe. Three rules are in play, read from the live guidelines
(developer.apple.com/app-store/review/guidelines) on 2026-08-23:

- **Guideline 3.1.1** is the baseline — digital content and features
  must use in-app purchase — and it contains the sentence a reviewer
  reaches for on tips specifically: apps "may use in-app purchase
  currencies to enable customers to 'tip' the developer." Apple's
  sanctioned path for developer tips is IAP.
- **Guideline 3.1.1(a)** is the post-*Epic v. Apple* carve-out. After
  the May 2025 contempt ruling, a failed appeal, and a denied Supreme
  Court stay, the guidelines now say entitlements "are not required for
  developers to include buttons, external links, or other calls to
  action in their United States storefront apps," and the prohibition
  on linking to non-IAP purchasing mechanisms "does not apply" to the
  US storefront.
- **Guideline 3.2.1(vii)** allows monetary gifts to "another
  individual" without IAP when giving is fully optional, 100% of the
  funds go to the receiver, and the gift is never tied to content or
  features. A personal Venmo link that changes nothing in the app is a
  fair fit for all three clauses.

On the plain text, a US-only listing has a defensible case for keeping
the link. Enforcement has not caught up with the text: developer-forum
threads from the post-injunction era still show 3.1.1 rejections for
exactly this pattern — "Donate to the Project", "Support the
Developer" — with Apple staff declining to name any acceptable wording
when asked directly. So the honest odds, which are not a clearance:

- **External TestFlight with the link in.** Beta App Review is the
  lighter pass and may well let it through — but every build is a
  fresh roll, and passing it establishes nothing for App Store review.
- **App Store submission with the link in.** Genuinely arguable; treat
  it as a coin flip that costs a rejection-and-appeal cycle if it goes
  badly. An appeal citing 3.1.1(a)'s US-storefront sentence and
  3.2.1(vii) is a legitimate fight to pick, not a formality.
- **The near-certain routes.** An IAP tip jar (sanctioned outright;
  Apple takes 15% under the Small Business Program), or pointing the
  in-app link at a website the developer owns and letting the Venmo
  ask live there — Apple doesn't review the website, and a link to
  your own site is uncontroversial.

Two bounds on how far to lean on this. The US carve-out exists because
of a court order Apple complied with under protest, so the text could
regress if the litigation shifts — re-check the live guidelines at
submission time rather than trusting this snapshot. And it is
US-storefront only; every other storefront is still under the old
rule.

### "Internal" is narrower than it sounds — check which one you're doing

The word doing the work above is *internal*, and it does not mean "a
private group of people I chose." Apple's two TestFlight modes split on
who the testers are, not on whether the build is publicly advertised:

- **Internal** — testers must be members of your App Store Connect team,
  each added individually with a role (Admin, App Manager, Developer,
  Marketing). Up to 100 people, 30 devices each. **No Beta App Review.**
- **External** — anyone else: friends, family, testers invited by email
  or public link. Up to 10,000 people. **Requires Beta App Review**, a
  lighter pass than full App Store review but a review by Apple all the
  same.

A build handed to a dozen friends who are not on the App Store Connect
team is **external testing**, however unadvertised it is. That crosses
the trigger point named above, even though nothing about it feels
public. If the testers are going to be added as team members, it's
internal and the trigger hasn't fired; if they're going to be invited by
email, it has.

**This is now the live configuration, so the sequencing matters.**
`DONATION_URL` is set, the tip section renders, and the next planned
step is TestFlight. Switching the URL on and inviting external testers
are two changes that are individually harmless and jointly the thing
this section exists to catch — and they are now half done.

Concretely, before a build goes to anyone who is not an App Store
Connect team member, the link stops being a default and becomes a
decision — one of:

- leave it in and accept the review odds above,
- set `DONATION_URL` back to `''` for that build,
- replace the link with an Apple in-app purchase, or
- point it at a developer-owned website that carries the ask.

Sideloading to your own devices and internal TestFlight are unaffected;
the link can stay for both without any decision. The checkpoint is the
first external invite, not the first upload.

### Which one we are actually doing — answered 2026-08-23

**Every current tester is an App Store Connect team member, so this is
internal testing and the trigger has not fired.** The link stays for
1.0.0 (1) and for 1.0.1 (2). Richard confirmed the tester list; it is
not derivable from anything in this repo, which is why it is recorded
here rather than re-asked each time.

That is a statement about *today's tester list*, not a clearance. The
determination expires the moment either of these happens, and neither
produces a warning:

- **Anyone is invited by email or public link.** That is external
  testing, it needs Beta App Review, and the link in that build has to
  have been through the decision list above rather than ridden along as
  a default. Adding one person to a build that already has 99 team
  members is enough.
- **The app is submitted to the App Store**, whatever the TestFlight
  history. Full review applies and internal-vs-external stops mattering.

So the pre-flight before any upload is a question about the *audience*,
not about the code: if the answer isn't "team members only", the link
question gets decided for that build first — with the odds above in
front of whoever decides.

Worth reading alongside the team-name/logo question above if this ever
gets a real legal review before a public launch. A donation link is a
small step away from framing this as a purely non-commercial passion
project, though it doesn't monetize team content directly, which keeps
it low risk. It also interacts with the next section: money entering
the picture at all is the thing that moves this out of the lowest-risk
category, so switching the URL on is a decision worth making
deliberately rather than incidentally.

## The pattern underneath all of this

Risk scales with distribution and money, not with what the code does.
The same app is:

- **Very low risk** as a private build shared with a few people.
- **Modestly higher, still low in practice** as a free public App Store
  listing — plenty of small free fan-made sports apps exist without
  issue.
- **Meaningfully higher** the moment ads, subscriptions, or in-app
  purchases enter the picture, because that's when a publisher or
  league has an actual damages argument instead of a theoretical one.

The "no ads, no subscriptions" product decision isn't just philosophy —
it's doing real work to keep this in the lowest-risk category. If that
ever changes, this document needs revisiting before the change ships,
not after.

## Privacy

No user data is collected today — see `docs/data-retention.md`. That
keeps the app out of privacy-law territory entirely (App Store privacy
labels, GDPR/CCPA considerations). The tripwire: the moment accounts,
crash reporting, or analytics get added, that stops being true and both
this section and the retention doc need updating as part of that
change, not as an afterthought.

## When to actually get a lawyer

Not now. For a private build shared with a few people and no
monetization, this is closer to a personal project than a company with
legal exposure. The actual trigger point is a public App Store listing
or any form of monetization — that's when it's worth a real
conversation with someone qualified. Treat that as a hard gate: don't
cross it without having had that conversation first.
