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
export const DEFAULT_BRIEF_CAP = 12;

export interface BriefWindow {
  now: Date;
  /** Start of the current morning/noon/night window. */
  periodStart: Date;
  /** When the reader last reached the end of a brief, if ever. */
  lastCaughtUpAt: Date | null;
}

/**
 * The moment the brief starts from.
 *
 * Takes whichever of the period start and the last catch-up is **further
 * back**, deliberately biased toward showing more. If you caught up at
 * 11:30 and the noon window opened at 11:00, you'll see 11:00 onward and
 * re-encounter half an hour you've already read. That's the right way round
 * — the opposite error hides something you never saw.
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
  const furtherBack = new Date(Math.min(periodStart.getTime(), mark.getTime()));

  return furtherBack < floor ? floor : furtherBack;
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
 */
export function caughtUpMessage(sections: BriefSections<unknown>, periodLabel: string): string {
  if (sections.truncated) {
    return `Showing ${sections.brief.length} of ${sections.briefTotal} since ${periodLabel}`;
  }
  if (sections.briefTotal === 0) return `Nothing new since ${periodLabel}`;
  const noun = sections.briefTotal === 1 ? 'story' : 'stories';
  return `${sections.briefTotal} ${noun} since ${periodLabel}`;
}
