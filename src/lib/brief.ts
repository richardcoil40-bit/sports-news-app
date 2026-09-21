import { ClaimType } from '@/lib/claim-type';
import { Article } from '@/lib/feeds';

/**
 * Splits a feed into a finishable session.
 *
 * The premise: an endless feed can't tell you when you're done, so it never
 * lets you be. The brief is the last two days of reported news, it ends, and
 * everything else stays reachable behind a deliberate tap.
 *
 *   brief   — reported news in the window. What you came for.
 *   chatter — rumors and takes in the same window. Collapsed, not deleted.
 *   earlier — everything older. Collapsed too.
 *
 * Nothing is hidden; infinite scroll just stops being the default gesture.
 *
 * **The window no longer moves on its own.** It used to start at whichever
 * was later of the current morning/noon/night boundary and the last time
 * the reader reached the finish line, which meant opening a story and
 * coming back — a focus, which recomputed the window — dropped everything
 * that had just been on screen into "earlier". Nothing was deleted and the
 * reader still watched the feed empty itself several times a day. So the
 * cutoff is a plain two days now, and the app marks the stories you opened
 * instead: a read story stays exactly where it is, wearing a mark, and only
 * unread ones count against the cap. See read-history.ts.
 */

/** Two days back, so returning after a week is a readable brief, not 400 items. */
export const MAX_BRIEF_AGE_MS = 48 * 60 * 60 * 1000;

/** Enough to be worth reading, few enough to finish. */
const DEFAULT_BRIEF_CAP = 12;

/**
 * The moment the brief starts from.
 *
 * A floor and nothing else. Callers still freeze it per focus rather than
 * deriving it live (see use-brief.ts), but only so the memo below has a
 * stable input — there is no longer anything here that could retire a story
 * while the reader is looking at it.
 */
export function briefCutoff(now: Date): Date {
  return new Date(now.getTime() - MAX_BRIEF_AGE_MS);
}

export interface BriefSections<T> {
  brief: T[];
  chatter: T[];
  earlier: T[];
  /** Every reported item in the window, read or not. */
  briefTotal: number;
  /** How many of those are unread, before the cap. */
  unread: number;
  /** How many unread ones the cap left room for. */
  unreadShown: number;
  /** True when the cap held some unread ones back. */
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

/**
 * `isRead` is asked per item rather than read off the article, because
 * whether a story has been opened is device state that lives in a store
 * (read-articles.ts) rather than a property of the article — and this file
 * has to stay free of anything that touches disk or React.
 *
 * The cap counts **unread only**. A story you have already read can't push
 * anything out of the brief: it is occupying a slot you have finished with,
 * and having it shove a story you haven't seen down into "earlier" would
 * recreate, one card at a time, exactly the disappearing act this rewrite
 * removed.
 */
export function splitBrief<T extends Splittable>(
  articles: T[],
  cutoff: Date,
  isRead: (article: T) => boolean,
  cap: number = DEFAULT_BRIEF_CAP,
): BriefSections<T> {
  const brief: T[] = [];
  const chatter: T[] = [];
  const earlier: T[] = [];
  const overflow: T[] = [];

  let briefTotal = 0;
  let unread = 0;
  let unreadShown = 0;

  for (const article of articles) {
    if (!isWithin(article, cutoff)) {
      earlier.push(article);
      continue;
    }
    switch (article.claimType) {
      case 'rumor':
      case 'take':
        chatter.push(article);
        continue;
      case 'reported':
      // Unlabeled surfaces with reported on purpose: the no-signal pile is
      // mostly ordinary news, and demoting it to chatter would recreate
      // the misfiled-scoop error the asymmetry doctrine exists to prevent
      // (see claim-type.ts). The badge's honesty changes; placement
      // doesn't.
      case 'unlabeled':
        break;
      default:
        // Exhaustiveness: a fifth ClaimType must decide its routing here.
        article.claimType satisfies never;
        break;
    }

    briefTotal += 1;

    if (isRead(article)) {
      // In place, always. The mark is what tells the reader they've been
      // here; moving the row as well would make it a retirement with extra
      // steps.
      brief.push(article);
      continue;
    }

    unread += 1;
    if (cap < 0 || unreadShown < cap) {
      unreadShown += 1;
      brief.push(article);
    } else {
      overflow.push(article);
    }
  }

  // The overflow goes to Earlier rather than being dropped, at the front so
  // it stays ahead of genuinely older news. The cap limits how much the
  // brief *shows*, never how much the app keeps.
  if (overflow.length > 0) earlier.unshift(...overflow);

  return {
    brief,
    chatter,
    earlier,
    briefTotal,
    unread,
    unreadShown,
    truncated: unread > unreadShown,
  };
}

/**
 * What the finish line says.
 *
 * Two lines, because the heading has a job the detail can't do: it is the
 * thing the reader sees from the corner of their eye, so it must not claim
 * they are caught up while a dozen unread stories sit one tap below.
 * "End of the brief" is the honest version of that, and "You're caught up"
 * is reserved for when it is literally true.
 *
 * `scope` names what is being counted, for when the marker sits over a
 * narrowed list. The counts always come from what is actually on screen, so
 * an unqualified line is never *false* — but "9 unread of 14 stories" above
 * one team's feed reads as a claim about the whole feed, and the caller is
 * what knows the difference. Omitted when the reader hasn't narrowed, where
 * naming the scope is noise rather than precision.
 */
export function briefEndCopy(
  sections: BriefSections<unknown>,
  scope?: string,
): { title: string; detail: string } {
  const forScope = scope ? ` for ${scope}` : '';

  if (sections.truncated) {
    return {
      title: 'End of the brief',
      detail: `Showing ${sections.unreadShown} of ${sections.unread} unread${forScope}`,
    };
  }

  if (sections.briefTotal === 0) {
    return {
      title: "You're caught up",
      detail: `Nothing new${forScope} in the last two days`,
    };
  }

  if (sections.unread === 0) {
    // Singular reads as a list rather than a sentence — "The 1 story read"
    // is the shape the plural form wants, and it isn't English.
    return {
      title: "You're caught up",
      detail:
        sections.briefTotal === 1
          ? `1 story${forScope}, read`
          : `All ${sections.briefTotal} stories${forScope} read`,
    };
  }

  const noun = sections.briefTotal === 1 ? 'story' : 'stories';
  return {
    title: 'End of the brief',
    detail: `${sections.unread} unread of ${sections.briefTotal} ${noun}${forScope}`,
  };
}
