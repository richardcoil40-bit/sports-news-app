import { describe, expect, it } from 'vitest';

import { briefCutoff, briefEndCopy, MAX_BRIEF_AGE_MS, splitBrief } from '@/lib/brief';
import { ClaimType } from '@/lib/claim-type';

const NOW = new Date('2026-08-18T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const HOUR = 60 * 60 * 1000;

const item = (claimType: ClaimType, hoursAgo: number, id = '') => ({
  claimType,
  publishedAt: ago(hoursAgo * HOUR).toISOString(),
  id,
});

/** The common case: nothing has been opened. */
const unread = () => false;

describe('briefCutoff', () => {
  // All that is left of a rule that used to take the later of a period
  // boundary and a catch-up mark. Both are gone: the window stopped moving
  // when read marks took over, so a story can no longer leave the brief
  // because the reader came back to it.
  it('is two days back and nothing else', () => {
    expect(briefCutoff(NOW)).toEqual(ago(MAX_BRIEF_AGE_MS));
  });
});

describe('splitBrief', () => {
  const cutoff = ago(6 * HOUR);

  it('separates reported news from chatter inside the window', () => {
    const sections = splitBrief(
      [
        item('reported', 1, 'a'),
        item('rumor', 2, 'b'),
        item('take', 3, 'c'),
        item('reported', 4, 'd'),
      ],
      cutoff,
      unread,
    );

    expect(sections.brief.map((a) => a.id)).toEqual(['a', 'd']);
    expect(sections.chatter.map((a) => a.id)).toEqual(['b', 'c']);
    expect(sections.earlier).toEqual([]);
  });

  it('puts everything older in earlier, whatever its claim type', () => {
    const sections = splitBrief(
      [item('reported', 20, 'old'), item('reported', 1, 'new')],
      cutoff,
      unread,
    );

    expect(sections.brief.map((a) => a.id)).toEqual(['new']);
    expect(sections.earlier.map((a) => a.id)).toEqual(['old']);
  });

  // Treating unknown dates as recent would let a feed with bad timestamps
  // fill the brief with arbitrary content.
  it('treats a missing timestamp as older', () => {
    const sections = splitBrief(
      [{ claimType: 'reported' as const, publishedAt: null, id: 'x' }],
      cutoff,
      unread,
    );
    expect(sections.earlier.map((a) => a.id)).toEqual(['x']);
  });

  it('treats an unparseable timestamp as older', () => {
    const sections = splitBrief(
      [{ claimType: 'reported' as const, publishedAt: 'not a date', id: 'x' }],
      cutoff,
      unread,
    );
    expect(sections.earlier.map((a) => a.id)).toEqual(['x']);
  });

  describe('read marks', () => {
    const isRead = (ids: string[]) => (a: { id: string }) => ids.includes(a.id);

    // The whole point of the rewrite: opening a story must not move it.
    it('leaves a read story exactly where it was', () => {
      const sections = splitBrief(
        [item('reported', 1, 'a'), item('reported', 2, 'b'), item('reported', 3, 'c')],
        cutoff,
        isRead(['b']),
      );

      expect(sections.brief.map((a) => a.id)).toEqual(['a', 'b', 'c']);
      expect(sections.earlier).toEqual([]);
    });

    it('counts unread separately from the total', () => {
      const sections = splitBrief(
        [item('reported', 1, 'a'), item('reported', 2, 'b'), item('reported', 3, 'c')],
        cutoff,
        isRead(['b']),
      );

      expect(sections.briefTotal).toBe(3);
      expect(sections.unread).toBe(2);
      expect(sections.unreadShown).toBe(2);
      expect(sections.truncated).toBe(false);
    });

    // A story you finished can't push one you haven't seen out of the
    // brief — that would be the old disappearing act, one card at a time.
    it('does not count read stories against the cap', () => {
      const articles = [
        ...Array.from({ length: 12 }, (_, i) => item('reported', 1, `read-${i}`)),
        ...Array.from({ length: 12 }, (_, i) => item('reported', 2, `new-${i}`)),
      ];

      const sections = splitBrief(
        articles,
        cutoff,
        isRead(articles.slice(0, 12).map((a) => a.id)),
        12,
      );

      expect(sections.brief).toHaveLength(24);
      expect(sections.earlier).toEqual([]);
      expect(sections.truncated).toBe(false);
    });
  });

  describe('the cap', () => {
    const many = Array.from({ length: 20 }, (_, i) => item('reported', 1, `a${i}`));

    it('limits how many unread the brief shows', () => {
      const sections = splitBrief(many, cutoff, unread, 5);
      expect(sections.brief).toHaveLength(5);
      expect(sections.briefTotal).toBe(20);
      expect(sections.unread).toBe(20);
      expect(sections.unreadShown).toBe(5);
      expect(sections.truncated).toBe(true);
    });

    // The cap limits what the brief *shows*, never what the app keeps.
    it('moves the overflow into earlier rather than dropping it', () => {
      const sections = splitBrief(many, cutoff, unread, 5);
      expect(sections.earlier).toHaveLength(15);
      expect(sections.brief.length + sections.earlier.length).toBe(20);
    });

    it('overflows the unread ones past the cap, in order', () => {
      const sections = splitBrief(
        Array.from({ length: 13 }, (_, i) => item('reported', 1, `a${i}`)),
        cutoff,
        unread,
        12,
      );

      expect(sections.brief).toHaveLength(12);
      expect(sections.earlier.map((a) => a.id)).toEqual(['a12']);
    });

    it('is not truncated when everything fits', () => {
      const sections = splitBrief([item('reported', 1)], cutoff, unread, 5);
      expect(sections.truncated).toBe(false);
    });
  });

  it('handles an empty feed', () => {
    const sections = splitBrief([], cutoff, unread);
    expect(sections).toMatchObject({
      brief: [],
      chatter: [],
      earlier: [],
      briefTotal: 0,
      unread: 0,
      unreadShown: 0,
    });
  });
});

describe('briefEndCopy', () => {
  const sections = (briefTotal: number, unread: number, unreadShown = unread) => ({
    brief: [],
    chatter: [],
    earlier: [],
    briefTotal,
    unread,
    unreadShown,
    truncated: unread > unreadShown,
  });

  it('counts the unread against the total', () => {
    expect(briefEndCopy(sections(14, 9))).toEqual({
      title: 'End of the brief',
      detail: '9 unread of 14 stories',
    });
  });

  it('says so when everything in the window has been read', () => {
    expect(briefEndCopy(sections(14, 0))).toEqual({
      title: "You're caught up",
      detail: 'All 14 stories read',
    });
  });

  it('uses the singular for one read story', () => {
    expect(briefEndCopy(sections(1, 0))).toEqual({
      title: "You're caught up",
      detail: '1 story, read',
    });
  });

  it('says so when there is nothing at all', () => {
    expect(briefEndCopy(sections(0, 0))).toEqual({
      title: "You're caught up",
      detail: 'Nothing new in the last two days',
    });
  });

  // The heading is what the reader catches from the corner of their eye, so
  // it must not say "caught up" over a dozen unread stories one tap below.
  it('never claims completeness when the cap truncated the list', () => {
    expect(briefEndCopy(sections(20, 20, 12))).toEqual({
      title: 'End of the brief',
      detail: 'Showing 12 of 20 unread',
    });
  });

  describe('scope', () => {
    it('names it in the unread form', () => {
      expect(briefEndCopy(sections(14, 9), 'Michigan').detail).toBe(
        '9 unread of 14 stories for Michigan',
      );
    });

    it('names it when everything is read', () => {
      expect(briefEndCopy(sections(14, 0), 'Michigan').detail).toBe(
        'All 14 stories for Michigan read',
      );
    });

    it('names it in the singular form', () => {
      expect(briefEndCopy(sections(1, 0), 'Michigan').detail).toBe('1 story for Michigan, read');
    });

    it('names it when there is nothing', () => {
      expect(briefEndCopy(sections(0, 0), 'Michigan').detail).toBe(
        'Nothing new for Michigan in the last two days',
      );
    });

    it('names it in the truncated form too', () => {
      expect(briefEndCopy(sections(20, 20, 12), 'Michigan').detail).toBe(
        'Showing 12 of 20 unread for Michigan',
      );
    });
  });
});
