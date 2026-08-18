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
