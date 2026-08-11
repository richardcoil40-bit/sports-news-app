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
