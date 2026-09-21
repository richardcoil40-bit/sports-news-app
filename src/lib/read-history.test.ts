import { describe, expect, it } from 'vitest';

import {
  addReadEntry,
  MAX_READ_AGE_MS,
  MAX_READ_ENTRIES,
  parseReadEntries,
  pruneReadEntries,
  ReadEntry,
} from '@/lib/read-history';

const NOW = new Date('2026-09-20T12:00:00.000Z');
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

const entry = (link: string, msAgo = 0): ReadEntry => ({ link, readAt: ago(msAgo) });

describe('parseReadEntries', () => {
  it('reads what it wrote', () => {
    const entries = [entry('https://a.example/1'), entry('https://b.example/2', HOUR)];
    expect(parseReadEntries(JSON.stringify(entries))).toEqual(entries);
  });

  // Nothing stored yet is the ordinary first-launch case, not an error.
  it('treats nothing stored as nothing read', () => {
    expect(parseReadEntries(null)).toEqual([]);
    expect(parseReadEntries('')).toEqual([]);
  });

  it('degrades to empty on junk rather than throwing', () => {
    expect(parseReadEntries('not json')).toEqual([]);
    expect(parseReadEntries('{"link":"x"}')).toEqual([]);
    expect(parseReadEntries('42')).toEqual([]);
  });

  // The whole-file-fails posture would lose a week of marks to one bad
  // record written by some future version.
  it('drops bad entries individually', () => {
    const raw = JSON.stringify([
      entry('https://good.example/1'),
      null,
      'a string',
      { readAt: ago(0) },
      { link: 'https://x.example/2' },
      { link: '', readAt: ago(0) },
      { link: 'https://y.example/3', readAt: '' },
      { link: 42, readAt: ago(0) },
      { link: 'https://z.example/4', readAt: 42 },
      entry('https://good.example/5', HOUR),
    ]);

    expect(parseReadEntries(raw).map((e) => e.link)).toEqual([
      'https://good.example/1',
      'https://good.example/5',
    ]);
  });
});

describe('pruneReadEntries', () => {
  const now = NOW.getTime();

  it('keeps marks inside the week', () => {
    const entries = [entry('a', DAY), entry('b', 6 * DAY)];
    expect(pruneReadEntries(entries, now)).toEqual(entries);
  });

  it('drops marks older than the age cap', () => {
    const entries = [entry('fresh', DAY), entry('stale', MAX_READ_AGE_MS + HOUR)];
    expect(pruneReadEntries(entries, now).map((e) => e.link)).toEqual(['fresh']);
  });

  // A mark that can't age would otherwise be immortal — article-retention
  // makes the same call for the same reason.
  it('drops an unparseable readAt rather than keeping it forever', () => {
    const entries = [{ link: 'bad', readAt: 'whenever' }, entry('good')];
    expect(pruneReadEntries(entries, now).map((e) => e.link)).toEqual(['good']);
  });

  it('keeps the newest when over the count cap', () => {
    // Oldest first on the way in, so the cap can only be right if it sorts.
    // Spaced in minutes so every one of them is inside the age cap — this
    // test is about the count bound, not that one.
    const entries = Array.from({ length: MAX_READ_ENTRIES + 10 }, (_, i) =>
      entry(`link-${i}`, (MAX_READ_ENTRIES + 10 - i) * MINUTE),
    );

    const pruned = pruneReadEntries(entries, now);

    expect(pruned).toHaveLength(MAX_READ_ENTRIES);
    expect(pruned[0].link).toBe(`link-${MAX_READ_ENTRIES + 9}`);
    expect(pruned.map((e) => e.link)).not.toContain('link-0');
  });

  it('orders newest first whatever order arrived from disk', () => {
    const entries = [entry('old', 3 * DAY), entry('new', HOUR), entry('middle', DAY)];
    expect(pruneReadEntries(entries, now).map((e) => e.link)).toEqual(['new', 'middle', 'old']);
  });

  it('handles an empty list', () => {
    expect(pruneReadEntries([], now)).toEqual([]);
  });
});

describe('addReadEntry', () => {
  it('records a newly opened story', () => {
    const entries = addReadEntry([], 'https://a.example/1', NOW.toISOString());
    expect(entries).toEqual([{ link: 'https://a.example/1', readAt: NOW.toISOString() }]);
  });

  // Reopening must refresh the mark, not stack a second one — that is what
  // keeps this a set of links rather than a log of when you read.
  it('replaces an existing mark for the same link', () => {
    const before = [entry('https://a.example/1', 3 * DAY), entry('https://b.example/2', DAY)];
    const after = addReadEntry(before, 'https://a.example/1', NOW.toISOString());

    expect(after.filter((e) => e.link === 'https://a.example/1')).toHaveLength(1);
    expect(after[0]).toEqual({ link: 'https://a.example/1', readAt: NOW.toISOString() });
    expect(after.map((e) => e.link)).toContain('https://b.example/2');
  });

  it('prunes as it writes, so the caps hold without a separate sweep', () => {
    const before = [entry('stale', MAX_READ_AGE_MS + HOUR), entry('fresh', HOUR)];
    const after = addReadEntry(before, 'new', NOW.toISOString());

    expect(after.map((e) => e.link)).toEqual(['new', 'fresh']);
  });

  it('holds the count cap', () => {
    const before = Array.from({ length: MAX_READ_ENTRIES }, (_, i) =>
      entry(`link-${i}`, i * MINUTE),
    );
    const after = addReadEntry(before, 'new', NOW.toISOString());

    expect(after).toHaveLength(MAX_READ_ENTRIES);
    expect(after[0].link).toBe('new');
    expect(after.map((e) => e.link)).not.toContain(`link-${MAX_READ_ENTRIES - 1}`);
  });
});
