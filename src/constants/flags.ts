/**
 * Feature flags, for changes big enough that you'd want to see the app
 * both ways before committing.
 *
 * These are compile-time constants, not settings — flipping one is a
 * JS-only edit, so a Metro reload (Cmd+D → Reload) shows the other
 * behaviour in a few seconds without a rebuild. That's the whole value:
 * rejecting an idea should cost a boolean, not a revert.
 *
 * **Delete a flag once the question is settled**, along with the branch it
 * isn't taking. A flag nobody flips is dead code with extra steps.
 */

/**
 * The finishable session: a brief of what's new since you last looked,
 * ending in a "you're caught up" line, with rumors/takes and older stories
 * collapsed beneath it.
 *
 * Off, the home screen is exactly what it was before — one endless
 * chronological feed. Everything else added alongside it (the claim
 * labels, the team tags, clustering, the filter) is unaffected either way;
 * this flag governs only the sectioning.
 */
export const BRIEF_MODE = true;

/**
 * Whether a headline naming two or more sports ("Corn Flakes: Volleyball
 * Red-White Game and Fall Football Camp") stays in a team's feed once the
 * verdicts service (`worker/`, see `docs/deferred-work.md`) can actually
 * tell that case apart from ordinary single-sport coverage.
 *
 * Off, `off-sport.ts`'s local fail-open rule is the last word: any mention
 * of the league's own sport rescues the article, roundups included. On, a
 * verdict of `sport: "multiple"` is dropped instead — see
 * `isRelevantVerdict` in `src/lib/verdicts.ts`. Only takes effect where
 * `EXPO_PUBLIC_VERDICT_URL` is configured; with the service unset this flag
 * has nothing to act on.
 *
 * Not yet chosen — see the mixed-roundup note in the source-reliability
 * work this shipped alongside. Flip it, look at a week of real mixed
 * roundups both ways, then delete the flag once the question is settled.
 */
export const KEEP_MIXED_SPORT_ROUNDUPS = true;
