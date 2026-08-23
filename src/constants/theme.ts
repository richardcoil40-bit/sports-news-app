/**
 * The design tokens the whole app reads from: the newsprint palette and
 * the two typefaces. Colors are defined for light and dark mode.
 *
 * `Colors.light` is the "newsprint" scale from the redesign handoff —
 * warm cream paper, near-black ink, one brick-red accent. The values are
 * the sRGB conversions of the handoff's OKLCH tokens; the OKLCH original
 * is kept in the comment beside each one so a future retune can be done
 * in the space the design was authored in.
 *
 * `Colors.dark` is derived from it rather than authored separately: the
 * same warm hues (the old scale was cool — hues near 260, which is why it
 * read as a different app), lightness inverted, and each token solved so
 * its contrast against the dark ground matches what the light token has
 * against paper. text 16.66:1 vs light's 16.67, textSecondary 5.99 vs
 * 6.00, accent 5.85 vs 5.85, accentControl 5.46 vs 5.50. Retune either
 * side in OKLCH and re-solve rather than nudging hex.
 */

import '@/global.css';

import { Platform, type TextStyle } from 'react-native';

import type { ClaimType } from '@/lib/claim-type';

export const Colors = {
  light: {
    /** ink — oklch(0.2 0.014 50) */
    text: '#1B1410',
    /** paper — oklch(0.97 0.01 70) */
    background: '#FAF4EE',
    /** placeholder / inset surfaces — oklch(0.92 0.014 70) */
    backgroundElement: '#EBE3DB',
    /** pressed & selected rows — oklch(0.9 0.016 68) */
    backgroundSelected: '#E5DCD3',
    /** meta text — oklch(0.48 0.022 55) */
    textSecondary: '#685B52',
    /** brick red — oklch(0.5 0.13 35). Links and the primary CTA only. */
    accent: '#9F422B',
    /**
     * Teal, for the *state* of a control — an active filter, a checked
     * row — and nothing else.
     *
     * A second accent, which the palette otherwise doesn't allow. It
     * exists precisely so the rule about the first one can hold: brick
     * red stays reserved for links and the outbound CTA, so "this
     * filter is narrowing your feed" needed a colour that isn't red and
     * isn't ink. Introduced with the dropdown filter controls.
     */
    accentControl: '#2D6B7A',
    /**
     * The REPORTED claim badge's fill. Ink here, so in light mode it is
     * the solid near-black block it has always been — see the dark
     * entry for why this is a token rather than just `text`.
     */
    claimReported: '#1B1410',
  },
  dark: {
    /** ink, inverted — oklch(0.957 0.012 70) */
    text: '#F6F0E8',
    /** paper at night — oklch(0.18 0.012 60) */
    background: '#16100C',
    /** placeholder / inset surfaces — oklch(0.24 0.014 62) */
    backgroundElement: '#241E19',
    /** pressed & selected rows — oklch(0.28 0.016 62) */
    backgroundSelected: '#2F2721',
    /** meta text — oklch(0.658 0.02 58) */
    textSecondary: '#9B8F86',
    /** brick red, lifted to clear the dark ground — oklch(0.663 0.12 36) */
    accent: '#D1775E',
    /** teal, lifted to match — oklch(0.628 0.07 216) */
    accentControl: '#5393A4',
    /**
     * Not `text`, which would make this a solid near-white block.
     * Reported is the commonest claim by a wide margin, and inverted
     * alongside the two fixed hues it drowned them out. This warm grey
     * is tuned so all three badges sit at comparable weight against the
     * page — 3.08:1 here, between rumor's 3.53:1 and take's 2.62:1 — so
     * they read as three variants of one thing rather than one shout and
     * two murmurs. It also clears 4.5:1 against the cream badge text.
     *
     * oklch(0.495 0.01 58)
     */
    claimReported: '#66615C',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

/**
 * A palette colour at partial opacity.
 *
 * The dropdown controls are specified as translucent ink over the paper
 * — a 4% fill inside a 16% border — rather than as their own opaque
 * greys. Deriving them from `theme.text` instead of hard-coding the
 * blended result is what makes them survive dark mode: the same call
 * gives warm grey on cream and dim white on black.
 *
 * Every value in `Colors` is a 6-digit hex, which is the only form this
 * appends an alpha byte to correctly. Don't hand it an `rgba()`.
 */
export function withAlpha(color: string, alpha: number): string {
  const byte = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `${color}${byte}`;
}

/** Every claim badge's text, in both themes — see below. */
const BADGE_INK = Colors.light.background;

/**
 * The claim badge's two colours, per claim type.
 *
 * All three are a solid block of colour with cream text; only the
 * reported block's fill follows the theme, through `claimReported`.
 * Rumor and take carry their own fixed hues — a story is no more a rumor
 * at night — so neither may follow `background` to black, which is why
 * the text is a constant rather than a theme lookup.
 *
 * These are the one place a colour means "what kind of thing this is".
 * The accents above mean "what state this control is in"; keep the two
 * vocabularies apart.
 */
export function claimBadgeColors(
  type: ClaimType,
  theme: { claimReported: string },
): { background: string; text: string } {
  if (type === 'rumor') return { background: '#B5482E', text: BADGE_INK };
  if (type === 'take') return { background: '#3A5A78', text: BADGE_INK };
  return { background: theme.claimReported, text: BADGE_INK };
}

/**
 * Two families, split by job: serif for anything you *read* (headlines,
 * body copy, names), mono for anything you *scan* (chips, timestamps,
 * sources, labels, stat numbers). That split is the redesign's single
 * biggest typographic change — the app used to be monospace everywhere.
 *
 * React Native has no synthetic weight matching worth relying on: each
 * weight is its own bundled face with its own family name, so the family
 * has to be chosen per weight rather than left to `fontWeight`. Nothing
 * should reach for these maps directly — call `fontFamilyFor`, which
 * ThemedText already does once for every piece of text in the app.
 */
const Families = {
  serif: {
    400: 'Newsreader_400Regular',
    500: 'Newsreader_500Medium',
    600: 'Newsreader_600SemiBold',
    700: 'Newsreader_700Bold',
  },
  mono: {
    400: 'IBMPlexMono_400Regular',
    500: 'IBMPlexMono_500Medium',
    600: 'IBMPlexMono_600SemiBold',
    700: 'IBMPlexMono_700Bold',
  },
} as const;

export type FontFamily = keyof typeof Families;

/**
 * The concrete bundled face for a family plus a `fontWeight`, snapped to
 * the nearest of the four weights actually loaded in `_layout.tsx`.
 * Anything lighter than 450 reads as regular, anything above 650 as bold.
 */
export function fontFamilyFor(family: FontFamily, weight?: TextStyle['fontWeight']): string {
  const faces = Families[family];
  if (weight === 'bold') return faces[700];
  const numeric = typeof weight === 'number' ? weight : Number(weight);
  if (!Number.isFinite(numeric)) return faces[400];
  if (numeric > 650) return faces[700];
  if (numeric > 550) return faces[600];
  if (numeric > 450) return faces[500];
  return faces[400];
}

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

/**
 * Bottom padding a scrolling tab screen needs so its last row clears the
 * tab bar.
 *
 * iOS 26 draws `NativeTabs` as a pill floating *over* the content instead
 * of docking it, and nothing in `expo-router/unstable-native-tabs` reports
 * its height. Left at the ordinary page padding, the final row renders
 * behind it — which put the home feed's "N earlier" header half under the
 * pill, where it was still a tap target and no longer readable. Measured
 * off the pill's top edge on a 402x874pt device, plus room to breathe.
 *
 * Android docks its tab bar, so content is already inset there and the
 * ordinary padding is right. That half is unverified on a device; if a
 * list turns out to be clipped on Android too, this is the knob.
 */
export const BottomTabInset = Platform.select({ ios: 96, android: Spacing.five }) ?? Spacing.five;

