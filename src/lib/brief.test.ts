import { describe, expect, it } from 'vitest';

import {
  briefCutoff,
  caughtUpMessage,
  MAX_BRIEF_AGE_MS,
  splitBrief,
} from '@/lib/brief';
import { ClaimType } from '@/lib/claim-type';

const NOW = new Date('2026-08-18T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const HOUR = 60 * 60 * 1000;

const item = (claimType: ClaimType, hoursAgo: number, id = '') => ({
  claimType,
  publishedAt: ago(hoursAgo * HOUR).toISOString(),
  id,
});

describe('briefCutoff', () => {
  // The rule that makes "since you last looked" mean anything. Taking the
  // *earlier* of the two, as an earlier version did, meant the period start
  // always won and catching up never shrank the brief.
  it('moves forward to the last catch-up within a period', () => {
    const cutoff = briefCutoff({
      now: NOW,
      periodStart: ago(5 * HOUR),
      lastCaughtUpAt: ago(1 * HOUR),
    });
    expect(cutoff).toEqual(ago(1 * HOUR));
  });

  // A new period brings back a full window even though the mark is older.
  it('falls back to the period start once the mark predates it', () => {
    const cutoff = briefCutoff({
      now: NOW,
      periodStart: ago(1 * HOUR),
      lastCaughtUpAt: ago(4 * HOUR),
    });
    expect(cutoff).toEqual(ago(1 * HOUR));
  });

  // A first launch at 5:01am would otherwise get a brief covering one
  // minute.
  it('falls back to the age floor when nothing has been caught up', () => {
    const cutoff = briefCutoff({
      now: NOW,
      periodStart: ago(1 * HOUR),
      lastCaughtUpAt: null,
    });
    expect(cutoff).toEqual(ago(MAX_BRIEF_AGE_MS));
  });

  // Both inputs older than the floor — e.g. an overnight window plus a mark
  // from last week — must still clamp.
  it('never reaches back further than the floor', () => {
    const cutoff = briefCutoff({
      now: NOW,
      periodStart: ago(90 * HOUR),
      lastCaughtUpAt: ago(30 * 24 * HOUR),
    });
    expect(cutoff).toEqual(ago(MAX_BRIEF_AGE_MS));
  });

  // A device whose clock moved backwards would otherwise show an
  // permanently empty brief.
  it('tolerates a mark in the future', () => {
    const cutoff = briefCutoff({
      now: NOW,
      periodStart: ago(2 * HOUR),
      lastCaughtUpAt: new Date(NOW.getTime() + 10 * HOUR),
    });
    // Clamped to now, not ten hours ahead — otherwise the brief would be
    // permanently empty on a device whose clock ran fast.
    expect(cutoff).toEqual(NOW);
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
    );

    expect(sections.brief.map((a) => a.id)).toEqual(['a', 'd']);
    expect(sections.chatter.map((a) => a.id)).toEqual(['b', 'c']);
    expect(sections.earlier).toEqual([]);
  });

  it('puts everything older in earlier, whatever its claim type', () => {
    const sections = splitBrief([item('reported', 20, 'old'), item('reported', 1, 'new')], cutoff);

    expect(sections.brief.map((a) => a.id)).toEqual(['new']);
    expect(sections.earlier.map((a) => a.id)).toEqual(['old']);
  });

  // Treating unknown dates as recent would let a feed with bad timestamps
  // fill the brief with arbitrary content.
  it('treats a missing timestamp as older', () => {
    const sections = splitBrief([{ claimType: 'reported' as const, publishedAt: null, id: 'x' }], cutoff);
    expect(sections.earlier.map((a) => a.id)).toEqual(['x']);
  });

  it('treats an unparseable timestamp as older', () => {
    const sections = splitBrief(
      [{ claimType: 'reported' as const, publishedAt: 'not a date', id: 'x' }],
      cutoff,
    );
    expect(sections.earlier.map((a) => a.id)).toEqual(['x']);
  });

  describe('the cap', () => {
    const many = Array.from({ length: 20 }, (_, i) => item('reported', 1, `a${i}`));

    it('limits what the brief shows', () => {
      const sections = splitBrief(many, cutoff, 5);
      expect(sections.brief).toHaveLength(5);
      expect(sections.briefTotal).toBe(20);
      expect(sections.truncated).toBe(true);
    });

    // The cap limits what the brief *shows*, never what the app keeps.
    it('moves the overflow into earlier rather than dropping it', () => {
      const sections = splitBrief(many, cutoff, 5);
      expect(sections.earlier).toHaveLength(15);
      expect(sections.brief.length + sections.earlier.length).toBe(20);
    });

    it('is not truncated when everything fits', () => {
      const sections = splitBrief([item('reported', 1)], cutoff, 5);
      expect(sections.truncated).toBe(false);
    });
  });

  it('handles an empty feed', () => {
    const sections = splitBrief([], cutoff);
    expect(sections).toMatchObject({ brief: [], chatter: [], earlier: [], briefTotal: 0 });
  });
});

describe('caughtUpMessage', () => {
  const sections = (brief: number, briefTotal: number) => ({
    brief: Array.from({ length: brief }),
    chatter: [],
    earlier: [],
    briefTotal,
    truncated: briefTotal > brief,
  });

  it('counts what it showed', () => {
    expect(caughtUpMessage(sections(6, 6), 'this morning')).toBe('6 stories since this morning');
  });

  it('uses the singular for one', () => {
    expect(caughtUpMessage(sections(1, 1), 'midday')).toBe('1 story since midday');
  });

  it('says so when there is nothing', () => {
    expect(caughtUpMessage(sections(0, 0), 'this evening')).toBe('Nothing new since this evening');
  });

  // The marker is only worth having if it's true. One overstatement teaches
  // the reader to stop believing it.
  it('never claims completeness when the cap truncated the list', () => {
    expect(caughtUpMessage(sections(12, 30), 'this morning')).toBe(
      'Showing 12 of 30 since this morning',
    );
  });

  // Sectioning now survives a team filter, so the marker can sit above a
  // narrowed list. The counts were always taken from what is on screen; the
  // scope is what says so out loud.
  it('names the scope it was given', () => {
    expect(caughtUpMessage(sections(3, 3), 'you last looked', 'Michigan')).toBe(
      '3 stories for Michigan since you last looked',
    );
  });

  it('names the scope when there is nothing', () => {
    expect(caughtUpMessage(sections(0, 0), 'midday', 'Michigan')).toBe(
      'Nothing new for Michigan since midday',
    );
  });

  it('names the scope in the truncated form too', () => {
    expect(caughtUpMessage(sections(12, 30), 'this morning', 'Michigan')).toBe(
      'Showing 12 of 30 for Michigan since this morning',
    );
  });

  // An unscoped call is the unfiltered feed, and must read exactly as it did
  // before the parameter existed.
  it('is unchanged when no scope is given', () => {
    expect(caughtUpMessage(sections(2, 2), 'midday')).toBe('2 stories since midday');
  });
});
