import { describe, expect, it } from 'vitest';

import { BriefSections, briefEndCopy, splitBrief } from '@/lib/brief';

const items = (...ids: string[]) => ids.map((id) => ({ id }));
const readSet =
  (...ids: string[]) =>
  (item: { id: string }) =>
    ids.includes(item.id);

describe('splitBrief', () => {
  it('puts unopened stories in the brief and opened ones in read', () => {
    const sections = splitBrief(items('a', 'b', 'c', 'd'), readSet('b', 'd'));

    expect(sections.unread.map((i) => i.id)).toEqual(['a', 'c']);
    expect(sections.read.map((i) => i.id)).toEqual(['b', 'd']);
    expect(sections.total).toBe(4);
  });

  // The input is already newest first; the split must not re-sort either half.
  it('keeps feed order within both halves', () => {
    const sections = splitBrief(items('e', 'd', 'c', 'b', 'a'), readSet('a', 'd'));

    expect(sections.unread.map((i) => i.id)).toEqual(['e', 'c', 'b']);
    expect(sections.read.map((i) => i.id)).toEqual(['d', 'a']);
  });

  it('places every story in exactly one half', () => {
    const input = items('a', 'b', 'c', 'd', 'e', 'f');
    const sections = splitBrief(input, readSet('a', 'c', 'f'));

    expect([...sections.unread, ...sections.read]).toHaveLength(input.length);
    expect(new Set([...sections.unread, ...sections.read])).toEqual(new Set(input));
  });

  it('has no cap: a long unread feed stays in the brief', () => {
    const input = items(...Array.from({ length: 40 }, (_, n) => `s${n}`));
    const sections = splitBrief(input, () => false);

    expect(sections.unread).toHaveLength(40);
    expect(sections.read).toHaveLength(0);
  });

  it('handles an empty feed', () => {
    expect(splitBrief([], () => false)).toEqual({ unread: [], read: [], total: 0 });
  });
});

describe('briefEndCopy', () => {
  const sections = (total: number, unread: number): BriefSections<unknown> => ({
    unread: Array.from({ length: unread }),
    read: Array.from({ length: total - unread }),
    total,
  });

  it('counts the unread against the total', () => {
    expect(briefEndCopy(sections(14, 9))).toEqual({
      title: 'End of the brief',
      detail: '9 unread of 14 stories',
    });
  });

  it('uses the singular for a feed of one unread story', () => {
    expect(briefEndCopy(sections(1, 1))).toEqual({
      title: 'End of the brief',
      detail: '1 unread of 1 story',
    });
  });

  it('says so when everything has been read', () => {
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
      detail: 'Nothing new',
    });
  });

  // The heading is what the reader catches from the corner of their eye, so
  // it must not say "caught up" while a single unread story remains.
  it('never claims completeness while anything is unread', () => {
    expect(briefEndCopy(sections(30, 1)).title).toBe('End of the brief');
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
      expect(briefEndCopy(sections(0, 0), 'Michigan').detail).toBe('Nothing new for Michigan');
    });
  });
});
