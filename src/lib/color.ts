/**
 * Colour math for making a colour we don't control legible against a ground
 * we do.
 *
 * This exists for one problem: a team's real colour comes from ESPN, and
 * ESPN picked it to sit on white. `fetchTeamColor` already rejects a team
 * whose colour is pure white, because white-on-cream was invisible — this
 * is the same rule generalised, and the mirror of it is what dark mode
 * needs. Measured against the shipping catalogue on 2026-08-23, 55 of 82
 * teams fell below 3:1 on the dark ground and 24 were under 1.5:1: Penn
 * State navy, Vanderbilt black, Kansas State purple and the Raiders all
 * rendered as a mark you could not see. On the cream ground the same
 * measurement puts 10 teams under 3:1, at the other end — Arizona State's
 * gold, Colorado's, the Saints' beige.
 *
 * So the floor is symmetric by construction rather than a dark-mode
 * special case: push lightness *away from the ground* until the mark
 * clears the floor. On a dark ground that lightens, on a light ground it
 * darkens, and a colour that already clears is returned untouched.
 *
 * `inkOn` is the same measurement pointed the other way: the text is ours
 * but the ground under it — the badge disc, the header band — is theirs.
 * `visibleOn` floors the mark against the page; nothing floors the text
 * against the mark, and a colour light enough to pass the page untouched
 * is exactly the one white text drowns on.
 *
 * Everything here is pure and synchronous. It deliberately does not know
 * the colour scheme — `src/lib/` cannot import react-native (see the
 * `no-restricted-imports` rule), and more importantly `team-color.ts`
 * caches for the life of the process, so a scheme baked in at fetch time
 * would survive the user switching themes. Callers pass the ground they
 * are actually painting on, at render time.
 *
 * Adjustment happens in OKLCH because that is the space the palette was
 * authored in (every token in `constants/theme.ts` carries its OKLCH
 * original), and because moving L there preserves hue — a lightened navy
 * still reads as that team's navy, where blending toward white would wash
 * it toward grey.
 */

/**
 * WCAG 2.1 SC 1.4.11 (Non-text Contrast): 3:1 for a graphic you need to
 * perceive. The accent bar and the team badge are exactly that — small
 * marks whose whole job is to be identifiable — so this is the floor, not
 * an aspiration.
 */
export const MIN_GRAPHIC_CONTRAST = 3;

interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** OKLCH: lightness 0-1, chroma, hue in radians. */
interface Oklch {
  l: number;
  c: number;
  h: number;
}

const HEX_PATTERN = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i;

/**
 * Parses `#RGB` / `#RRGGBB`, with or without the hash, to 0-1 channels.
 *
 * Returns `null` on anything else rather than throwing. ESPN's colour
 * field is read straight into `#${raw}` without validation, so a shape
 * nobody expected reaches here as a matter of course — the same
 * degrade-to-nothing posture the rest of the data layer takes.
 */
export function parseHex(value: string): Rgb | null {
  const match = HEX_PATTERN.exec(value.trim());
  if (!match) return null;
  const digits = match[1];
  const full =
    digits.length === 3
      ? digits
          .split('')
          .map((d) => d + d)
          .join('')
      : digits;
  return {
    r: parseInt(full.slice(0, 2), 16) / 255,
    g: parseInt(full.slice(2, 4), 16) / 255,
    b: parseInt(full.slice(4, 6), 16) / 255,
  };
}

function toHex({ r, g, b }: Rgb): string {
  const channel = (v: number) =>
    Math.round(Math.min(1, Math.max(0, v)) * 255)
      .toString(16)
      .padStart(2, '0')
      .toUpperCase();
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

/** WCAG relative luminance. */
function luminance({ r, g, b }: Rgb): number {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

const WHITE: Rgb = { r: 1, g: 1, b: 1 };
const BLACK: Rgb = { r: 0, g: 0, b: 0 };

/** WCAG contrast ratio, 1:1 to 21:1. Order of arguments doesn't matter. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// Björn Ottosson's OKLab matrices — https://bottosson.github.io/posts/oklab/
function rgbToOklch(rgb: Rgb): Oklch {
  const r = toLinear(rgb.r);
  const g = toLinear(rgb.g);
  const b = toLinear(rgb.b);

  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;

  return { l: lightness, c: Math.hypot(a, bb), h: Math.atan2(bb, a) };
}

/** May land outside sRGB; `gamutMap` is what keeps a returned colour real. */
function oklchToRgb({ l, c, h }: Oklch): Rgb {
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);

  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;

  return {
    r: fromLinear(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_),
    g: fromLinear(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_),
    b: fromLinear(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_),
  };
}

const inGamut = ({ r, g, b }: Rgb) =>
  r >= -1e-4 && r <= 1 + 1e-4 && g >= -1e-4 && g <= 1 + 1e-4 && b >= -1e-4 && b <= 1 + 1e-4;

/**
 * The most saturated in-gamut colour at this lightness and hue.
 *
 * Raising L on an already-saturated colour walks it out of sRGB — a deep
 * purple at L 0.7 simply doesn't exist in this space. Reducing chroma
 * until it fits keeps the hue, which is the part that carries the team's
 * identity; clamping the channels instead would shift it.
 */
function gamutMap(target: Oklch): Rgb {
  const direct = oklchToRgb(target);
  if (inGamut(direct)) return direct;

  let lo = 0;
  let hi = target.c;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(oklchToRgb({ ...target, c: mid }))) lo = mid;
    else hi = mid;
  }
  return oklchToRgb({ ...target, c: lo });
}

/**
 * The memo matters more than it looks: every row on a screen shares one
 * accent colour, so the first row pays for the search and the rest are a
 * map lookup. Bounded because it is keyed by colours *seen*, which grows
 * with teams visited rather than with the catalogue — the same reasoning
 * as the `maxEntries` bounds in `cache.ts`. Clearing wholesale rather
 * than evicting one entry is fine here: the values are cheap to rebuild
 * and the cap is far above any single session's working set.
 */
const MEMO_LIMIT = 512;
const memo = new Map<string, string | null>();

/**
 * `color`, adjusted if necessary so it clears `minRatio` against `ground`.
 *
 * Returns `null` for a colour that can't be parsed, so callers keep the
 * same "no usable colour" branch they already have for a team ESPN has no
 * colour for. Passing `null` through returns `null`.
 *
 * A colour that already clears the floor is returned **unchanged**, not
 * re-encoded — so light mode, where all but ten of the catalogue's teams
 * already pass, is almost entirely untouched.
 */
export function visibleOn(
  color: string | null | undefined,
  ground: string,
  minRatio: number = MIN_GRAPHIC_CONTRAST,
): string | null {
  if (!color) return null;

  const key = `${color}|${ground}|${minRatio}`;
  const hit = memo.get(key);
  if (hit !== undefined) return hit;

  const result = solve(color, ground, minRatio);
  if (memo.size >= MEMO_LIMIT) memo.clear();
  memo.set(key, result);
  return result;
}

function solve(color: string, ground: string, minRatio: number): string | null {
  const source = parseHex(color);
  if (!source) return null;
  // An unreadable ground is a caller bug, not data — but there is no
  // sensible adjustment to make against it, so hand back what we were
  // given rather than inventing one.
  const base = parseHex(ground);
  if (!base) return color;

  if (contrastRatio(source, base) >= minRatio) return color;

  // Direction is a property of the *ground*, not of where the colour
  // currently sits: a light ground has no headroom above it, so the only
  // way to separate from it is downward, and vice versa. Choosing by
  // which endpoint the ground contrasts with more handles a mid-tone
  // ground too, rather than assuming one of the app's two.
  const target = contrastRatio(WHITE, base) >= contrastRatio(BLACK, base) ? 1 : 0;
  const start = rgbToOklch(source);

  // Smallest move along L that clears the floor. Contrast is monotonic in
  // L once the ground is fixed and we are travelling away from it, so
  // bisection finds the *least* change that works — the point is to keep
  // as much of the team's colour as legibility allows.
  //
  // The floor is checked against the *quantised* colour, because an 8-bit
  // hex is what actually gets painted: solving in float and rounding
  // afterwards lands a few thousandths under the line often enough to
  // matter.
  let lo = 0;
  let hi = 1;
  let best: string | null = null;
  for (let i = 0; i < 24; i++) {
    const t = (lo + hi) / 2;
    const hex = toHex(gamutMap({ ...start, l: start.l + (target - start.l) * t }));
    if (contrastRatio(parseHex(hex)!, base) >= minRatio) {
      best = hex;
      hi = t;
    } else {
      lo = t;
    }
  }

  // Nothing along the axis cleared it — only possible against a mid-tone
  // ground, which neither theme has. The endpoint is the best available.
  return best ?? toHex(gamutMap({ ...start, l: target }));
}

/**
 * The palette's ink — `Colors.light.text`. Restated rather than imported:
 * `constants/theme.ts` pulls in react-native, which this layer must stay
 * clear of (see the header). Nothing enforces the match, so a retune of
 * the ink token belongs here too.
 */
const INK_HEX = '#1B1410';
const INK = parseHex(INK_HEX)!;
const WHITE_HEX = '#FFFFFF';

/**
 * The more legible of white and ink for text sitting on `ground` — the
 * team-colour marks: the badge disc and the team screen's header band.
 *
 * White is what every team colour has always worn, and for most of the
 * catalogue it is also the measured winner, so most marks don't change.
 * The exception is a colour light enough that `visibleOn` leaves it
 * untouched against the dark ground: the Saints' beige clears that floor
 * at 10:1, and the white text hardcoded on it measured 1.85:1. The mark's
 * own colour — not the app's scheme — is the ground that matters here, so
 * unlike `visibleOn` there is no ground parameter to get wrong.
 *
 * Ties and an unparseable ground fall back to white, the status quo.
 */
export function inkOn(ground: string): string {
  const base = parseHex(ground);
  if (!base) return WHITE_HEX;
  return contrastRatio(WHITE, base) >= contrastRatio(INK, base) ? WHITE_HEX : INK_HEX;
}
