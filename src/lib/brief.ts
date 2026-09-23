/**
 * Splits a feed into a finishable session.
 *
 * The premise: an endless feed can't tell you when you're done, so it never
 * lets you be. The brief is every story you haven't opened, newest first,
 * and it ends. What you have opened sits beneath the finish line behind one
 * tap, rather than scrolling on forever above it.
 *
 *   unread — not yet opened. What you came for.
 *   read   — opened on this device. Collapsed, not deleted.
 *
 * Nothing is hidden and nothing is ranked: the split is read state and the
 * order within each half is the order the feed arrived in.
 *
 * **This used to be a window and a claim split.** The brief was the last two
 * days of *reported* news capped at twelve unread, with rumors and takes in
 * one collapsed section and everything older in another. That put a story
 * the reader hadn't seen below the fold for reasons of age or grammar, and
 * put the claim labels in charge of layout. The only question the sections
 * answer now is the one the reader can check for themselves: have I opened
 * this? The older split is in git history if it is ever wanted back.
 *
 * The feed stays bounded without a window: the on-device store ages
 * articles out after a week and keeps at most 60 per team (see
 * article-retention.ts).
 */

export interface BriefSections<T> {
  /** Not yet opened, in feed order. */
  unread: T[];
  /** Opened, in feed order. */
  read: T[];
  /** Everything, both halves together. */
  total: number;
}

/**
 * `isRead` is asked per item rather than read off the article, because
 * whether a story has been opened is device state that lives in a store
 * (read-articles.ts) rather than a property of the article — and this file
 * has to stay free of anything that touches disk or React.
 */
export function splitBrief<T>(articles: T[], isRead: (article: T) => boolean): BriefSections<T> {
  const unread: T[] = [];
  const read: T[] = [];

  for (const article of articles) {
    (isRead(article) ? read : unread).push(article);
  }

  return { unread, read, total: articles.length };
}

/**
 * What the finish line says.
 *
 * Two lines, because the heading has a job the detail can't do: it is the
 * thing the reader sees from the corner of their eye, so it must not claim
 * they are caught up while unread stories remain. "You're caught up" is
 * reserved for when it is literally true.
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
  const unread = sections.unread.length;

  if (sections.total === 0) {
    return { title: "You're caught up", detail: `Nothing new${forScope}` };
  }

  if (unread === 0) {
    // Singular reads as a list rather than a sentence — "The 1 story read"
    // is the shape the plural form wants, and it isn't English.
    return {
      title: "You're caught up",
      detail:
        sections.total === 1
          ? `1 story${forScope}, read`
          : `All ${sections.total} stories${forScope} read`,
    };
  }

  const noun = sections.total === 1 ? 'story' : 'stories';
  return {
    title: 'End of the brief',
    detail: `${unread} unread of ${sections.total} ${noun}${forScope}`,
  };
}
