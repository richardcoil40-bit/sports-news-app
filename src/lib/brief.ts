import { ClaimType } from '@/lib/claim-type';
import { Article } from '@/lib/feeds';

/**
 * Splits a feed into a finishable session.
 *
 * The premise: an endless feed can't tell you when you're done, so it never
 * lets you be. The brief is what arrived since you last looked, it ends, and
 * everything else stays reachable behind a deliberate tap.
 *
 *   brief   — reported news in the window. What you came for.
 *   chatter — rumors and takes in the same window. Collapsed, not deleted.
 *   earlier — everything older. Collapsed too.
 *
 * Nothing is hidden; infinite scroll just stops being the default gesture.
 */

/** Two days back, so returning after a week is a readable brief, not 400 items. */
export const MAX_BRIEF_AGE_MS = 48 * 60 * 60 * 1000;

/** Enough to be worth reading, few enough to finish. */
const DEFAULT_BRIEF_CAP = 12;

export interface BriefWindow {
  now: Date;
  /** Start of the current morning/noon/night window. */
  periodStart: Date;
  /** When the reader last reached the end of a brief, if ever. */
  lastCaughtUpAt: Date | null;
}

/**
 * The moment the brief starts from: the **later** of the period start and
 * the last catch-up.
 *
 * An earlier version took whichever was further back, reasoning that
 * re-showing something is a smaller error than hiding it. Running it proved
 * that wrong in a way the reasoning missed: the period start is almost
 * always the earlier of the two, so it always won, and catching up could
 * never shrink the brief. Read everything at 11:30 and come back at 12:00
 * and the whole 11:00 window is still sitting there — the finish line was
 * honest but "since you last looked" never actually engaged.
 *
 * Taking the later of the two hides nothing unseen, because the mark is
 * only written once the reader has reached the end of the brief. It moves
 * forward within a period, and the period start takes over again whenever
 * the mark is older than it — which is what makes a new morning bring back
 * a full window.
 *
 * With no catch-up recorded, the floor does the work: a first launch gets a
 * full two days rather than whatever happens to have landed since the
 * window opened, which at 5:01am would be nothing.
 */
export function briefCutoff({ now, periodStart, lastCaughtUpAt }: BriefWindow): Date {
  const floor = new Date(now.getTime() - MAX_BRIEF_AGE_MS);
  if (!lastCaughtUpAt) return floor;

  // Clock skew, or a device whose time moved backwards: a mark in the
  // future would otherwise produce a permanently empty brief.
  const mark = lastCaughtUpAt.getTime() > now.getTime() ? now : lastCaughtUpAt;
  const start = new Date(Math.max(periodStart.getTime(), mark.getTime()));

  return start < floor ? floor : start;
}

export interface BriefSections<T> {
  brief: T[];
  chatter: T[];
  earlier: T[];
  /** Reported items in the window before the cap, so the marker can be honest. */
  briefTotal: number;
  /** True when the cap hid some of them. */
  truncated: boolean;
}

type Splittable = Pick<Article, 'publishedAt'> & { claimType: ClaimType };

/**
 * Anything without a timestamp counts as older rather than newer.
 *
 * The alternative — treating unknown as recent — would let a feed with bad
 * dates fill the brief with arbitrary content, which is worse than it
 * sitting in Earlier where it can still be found.
 */
function isWithin(article: Splittable, cutoff: Date): boolean {
  if (!article.publishedAt) return false;
  const t = Date.parse(article.publishedAt);
  return !Number.isNaN(t) && t >= cutoff.getTime();
}

export function splitBrief<T extends Splittable>(
  articles: T[],
  cutoff: Date,
  cap: number = DEFAULT_BRIEF_CAP,
): BriefSections<T> {
  const reported: T[] = [];
  const chatter: T[] = [];
  const earlier: T[] = [];

  for (const article of articles) {
    if (!isWithin(article, cutoff)) {
      earlier.push(article);
      continue;
    }
    if (article.claimType === 'reported') reported.push(article);
    else chatter.push(article);
  }

  const briefTotal = reported.length;
  const brief = cap >= 0 ? reported.slice(0, cap) : reported;

  // The overflow goes to Earlier rather than being dropped. The cap limits
  // how much the brief *shows*, never how much the app keeps.
  if (briefTotal > brief.length) earlier.unshift(...reported.slice(brief.length));

  return {
    brief,
    chatter,
    earlier,
    briefTotal,
    truncated: briefTotal > brief.length,
  };
}

/**
 * What the finish line says.
 *
 * Never claims you're caught up when the cap truncated the list — the
 * marker is worth having only if it's true, and one overstatement teaches
 * the reader to stop believing it.
 *
 * `scope` names what is being counted, for when the marker sits over a
 * narrowed list. The counts always come from what is actually on screen, so
 * an unqualified line is never *false* — but "3 stories since you last
 * looked" above one team's feed reads as a claim about the whole feed, and
 * the caller is what knows the difference. Omitted when the reader hasn't
 * narrowed, where naming the scope is noise rather than precision.
 */
export function caughtUpMessage(
  sections: BriefSections<unknown>,
  periodLabel: string,
  scope?: string,
): string {
  const forScope = scope ? ` for ${scope}` : '';
  if (sections.truncated) {
    return `Showing ${sections.brief.length} of ${sections.briefTotal}${forScope} since ${periodLabel}`;
  }
  if (sections.briefTotal === 0) return `Nothing new${forScope} since ${periodLabel}`;
  const noun = sections.briefTotal === 1 ? 'story' : 'stories';
  return `${sections.briefTotal} ${noun}${forScope} since ${periodLabel}`;
}
