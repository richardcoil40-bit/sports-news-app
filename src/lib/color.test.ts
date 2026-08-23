import { describe, expect, it } from 'vitest';

import { contrastRatio, inkOn, MIN_GRAPHIC_CONTRAST, parseHex, visibleOn } from '@/lib/color';

/** The two grounds the app actually paints on — see `constants/theme.ts`. */
const DARK = '#16100C';
const CREAM = '#FAF4EE';

function ratio(a: string, b: string): number {
  const ra = parseHex(a);
  const rb = parseHex(b);
  if (!ra || !rb) throw new Error(`unparseable: ${a} / ${b}`);
  return contrastRatio(ra, rb);
}

function hue(hex: string): number {
  const rgb = parseHex(hex);
  if (!rgb) throw new Error(`unparseable: ${hex}`);
  // Plain HSL hue in degrees is enough to assert "still the same colour
  // family" without importing the OKLCH internals.
  const { r, g, b } = rgb;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return ((h * 60) % 360 + 360) % 360;
}

describe('parseHex', () => {
  it('reads six-digit hex with and without the hash', () => {
    expect(parseHex('#FF8800')).toEqual({ r: 1, g: 0x88 / 255, b: 0 });
    expect(parseHex('FF8800')).toEqual({ r: 1, g: 0x88 / 255, b: 0 });
  });

  it('expands three-digit shorthand', () => {
    expect(parseHex('#F80')).toEqual(parseHex('#FF8800'));
  });

  it('is case-insensitive and tolerates surrounding space', () => {
    expect(parseHex('  #ff8800 ')).toEqual(parseHex('#FF8800'));
  });

  // The parser contract this repo protects everywhere else: junk degrades
  // to nothing rather than throwing. ESPN's colour field is interpolated
  // into `#${raw}` with no validation, so these do reach us.
  it.each([
    '',
    '#',
    'not a colour',
    '#12345',
    '#1234567',
    '#GGGGGG',
    'rgb(1,2,3)',
    '#12 34 56',
    'null',
  ])('returns null for junk input %o', (junk) => {
    expect(parseHex(junk)).toBeNull();
  });
});

describe('visibleOn', () => {
  it('passes null and undefined straight through', () => {
    expect(visibleOn(null, DARK)).toBeNull();
    expect(visibleOn(undefined, DARK)).toBeNull();
  });

  it('returns null for a colour it cannot parse, so callers keep one empty branch', () => {
    expect(visibleOn('nonsense', DARK)).toBeNull();
    expect(visibleOn('#12345', CREAM)).toBeNull();
  });

  it('leaves a colour that already clears the floor byte-for-byte unchanged', () => {
    // Nebraska scarlet measures 4.01:1 on the dark ground.
    expect(visibleOn('#E31937', DARK)).toBe('#E31937');
    // Penn State navy is fine on cream; it is dark mode that breaks it.
    expect(visibleOn('#061440', CREAM)).toBe('#061440');
  });

  describe('on the dark ground', () => {
    // The teams the device pass showed disappearing.
    const invisible = [
      ['Kansas State', '#330A57'],
      ['Penn State', '#061440'],
      ['Vanderbilt', '#000000'],
      ['Houston Texans', '#021018'],
      ['Michigan', '#00274C'],
      ['Iowa', '#231F20'],
      ['Texas A&M', '#500000'],
      ['Baltimore Ravens', '#29126F'],
    ] as const;

    it.each(invisible)('lifts %s (%s) to clear the floor', (_name, color) => {
      const before = ratio(color, DARK);
      expect(before).toBeLessThan(MIN_GRAPHIC_CONTRAST);

      const after = visibleOn(color, DARK);
      expect(after).not.toBeNull();
      expect(ratio(after!, DARK)).toBeGreaterThanOrEqual(MIN_GRAPHIC_CONTRAST);
    });

    it.each(invisible)('keeps %s (%s) recognisably the same hue', (_name, color) => {
      const after = visibleOn(color, DARK)!;
      // Black and near-neutrals have no meaningful hue to preserve.
      if (color === '#000000' || color === '#231F20') return;
      const drift = Math.abs(hue(after) - hue(color));
      expect(Math.min(drift, 360 - drift)).toBeLessThan(12);
    });

    it('lightens rather than darkens', () => {
      const after = parseHex(visibleOn('#330A57', DARK)!)!;
      const before = parseHex('#330A57')!;
      expect(after.r + after.g + after.b).toBeGreaterThan(before.r + before.g + before.b);
    });

    it('moves the least it can get away with', () => {
      // Solving to the floor, not to white: a lifted colour should sit
      // near 3:1, nowhere near the 18.9:1 that pure white would give.
      expect(ratio(visibleOn('#00274C', DARK)!, DARK)).toBeLessThan(4);
    });
  });

  describe('on the cream ground', () => {
    // The mirror case: light colours are the ones that fail on paper.
    const washedOut = [
      ['Arizona State', '#FFC627'],
      ['Colorado', '#CFB87C'],
      ['New Orleans Saints', '#D3BC8D'],
    ] as const;

    it.each(washedOut)('darkens %s (%s) to clear the floor', (_name, color) => {
      expect(ratio(color, CREAM)).toBeLessThan(MIN_GRAPHIC_CONTRAST);

      const after = visibleOn(color, CREAM)!;
      expect(ratio(after, CREAM)).toBeGreaterThanOrEqual(MIN_GRAPHIC_CONTRAST);

      const before = parseHex(color)!;
      const lifted = parseHex(after)!;
      expect(lifted.r + lifted.g + lifted.b).toBeLessThan(before.r + before.g + before.b);
    });
  });

  it('handles pure white and pure black at either extreme', () => {
    expect(ratio(visibleOn('#FFFFFF', CREAM)!, CREAM)).toBeGreaterThanOrEqual(
      MIN_GRAPHIC_CONTRAST,
    );
    expect(ratio(visibleOn('#000000', DARK)!, DARK)).toBeGreaterThanOrEqual(MIN_GRAPHIC_CONTRAST);
  });

  it('hands back the original colour when the ground itself is unreadable', () => {
    expect(visibleOn('#330A57', 'not-a-colour')).toBe('#330A57');
  });

  it('honours a custom floor', () => {
    const strict = visibleOn('#00274C', DARK, 7)!;
    expect(ratio(strict, DARK)).toBeGreaterThanOrEqual(7);
    // And a higher floor should move it further than the default does.
    expect(ratio(strict, DARK)).toBeGreaterThan(ratio(visibleOn('#00274C', DARK)!, DARK));
  });

  it('is stable — the same input always gives the same answer', () => {
    const once = visibleOn('#330A57', DARK);
    const twice = visibleOn('#330A57', DARK);
    expect(twice).toBe(once);
    // And a colour already at the floor is a fixed point.
    expect(visibleOn(once!, DARK)).toBe(once);
  });

  it('always returns something in-gamut', () => {
    for (const color of ['#330A57', '#061440', '#500000', '#29126F', '#0021A5']) {
      const rgb = parseHex(visibleOn(color, DARK)!)!;
      for (const channel of [rgb.r, rgb.g, rgb.b]) {
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('inkOn', () => {
  it('keeps white on the dark colours that have always worn it', () => {
    expect(inkOn('#061440')).toBe('#FFFFFF'); // Penn State navy
    expect(inkOn('#330A57')).toBe('#FFFFFF'); // Kansas State purple
    // Nebraska scarlet: ink clears 3:1 here too — white still wins the
    // measurement, so a mid-dark colour doesn't churn.
    expect(inkOn('#E31937')).toBe('#FFFFFF');
  });

  it('switches to ink on a light colour, where white washes out', () => {
    // The finding that prompted this: the Saints' beige passes the dark
    // ground's floor untouched, and white text on it measured 1.85:1.
    expect(inkOn('#D3BC8D')).toBe('#1B1410');
    expect(inkOn('#FFC627')).toBe('#1B1410'); // Arizona State gold
    expect(inkOn('#CFB87C')).toBe('#1B1410'); // Colorado
  });

  it('clears the graphic floor with whichever ink it picks', () => {
    const grounds = ['#D3BC8D', '#FFC627', '#CFB87C', '#061440', '#330A57', '#E31937', '#000000'];
    for (const ground of grounds) {
      expect(ratio(inkOn(ground), ground)).toBeGreaterThanOrEqual(MIN_GRAPHIC_CONTRAST);
    }
  });

  it('does not flip once visibleOn has adjusted the mark', () => {
    // The badge paints the lifted colour and the header re-derives from the
    // same value, so both compute inkOn of the same hex — but the lift
    // itself must not change the answer. A lift solves to just past 3:1 on
    // the dark ground, well below the white/ink crossover.
    for (const color of ['#061440', '#330A57', '#000000', '#231F20']) {
      expect(inkOn(visibleOn(color, DARK)!)).toBe(inkOn(color));
    }
  });

  it('defaults to white when the ground is unreadable', () => {
    expect(inkOn('not a colour')).toBe('#FFFFFF');
  });
});
