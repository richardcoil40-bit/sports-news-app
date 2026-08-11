# Scaling plan

Not a todo list for today — a checklist to come back to if this ever
grows past a handful of friends. Written now, while the reasoning is
fresh, instead of reconstructed later under pressure. See also
`docs/legal-notes.md` (the legal landscape this plan is mitigating) and
`docs/data-retention.md`.

## The core problem to fix before opening this up

Every user's phone currently hits every source directly — ESPN's
unofficial API and every RSS feed in `community-sources.ts` and
`feeds.ts`. Traffic against those sources scales linearly with user
count: 5 users is 5x load, 5,000 users is 5,000x load. Past a small
number of people, that's the fastest way to get rate-limited or
blocked, and it risks putting real load on small sites (a local
newspaper's RSS feed, an independent blog) that never expected
thousands of requests. That's the difference between quietly reading
public feeds and behaving like something a publisher would actually
notice and object to.

**Fix: a backend that fetches each source once on a schedule, caches
it, and serves every app user from that cache.** Not optional past
friends-and-family scale — build it before opening up distribution, not
after something breaks. It's also the right place to:

- Set a proper identifying `User-Agent` and contact info on outbound
  requests, so a source that wants to reach out can find you instead of
  just blocking an anonymous traffic spike.
- Add rate limiting / backoff so the app is a good citizen against
  whatever it depends on.
- Centralize monitoring — one place to notice a source going dark or
  changing shape, instead of finding out from a friend's bug report.

## Have an exit path for ESPN ready before you need it

ESPN's endpoint is unofficial and free because nobody's paying
attention to a hobby app. It's the single dependency most likely to
break or get closed off at real scale. Legitimate sports-data API
vendors exist (Sportradar and similar) with actual commercial
licensing — nothing to sign today, but knowing the path exists turns a
sudden ESPN blockage into "switch to the backup," not "the app is
dead."

## Legal infrastructure that becomes mandatory at real distribution

- **Privacy policy URL.** Required by Apple in App Store Connect before
  a public listing, even if the app collects zero data — the policy can
  just say so.
- **Basic Terms of Service.** No warranty, no official team/league
  affiliation, limits liability if the app is ever wrong about a score
  or game time. Worth having in place before wide distribution.
- **LLC.** Separates personal assets from the app's liability. Not
  needed for a friends-and-family build. Worth doing before a public
  launch, and definitely before any revenue.
- **Trademark check on "NoFrills."** An existing grocery chain uses the
  name; different product category usually means no real conflict, but
  worth an actual search before wide public use rather than assuming.

## Trigger-based order of operations

Not "eventually" — tied to specific moments so it's actionable:

1. **Before opening past friends-and-family:** build the caching
   backend. This is the prerequisite, not a parallel task.
2. **At the same time as any App Store submission:** privacy policy and
   Terms of Service go live together with the listing, not after.
3. **Once there's a real, non-friend user base:** revisit the LLC
   question.
4. **Only if monetization enters the picture, or a publisher/league
   actually makes contact:** get an actual lawyer involved. Not before
   that — see `docs/legal-notes.md` for why the risk genuinely is low
   before that point.
