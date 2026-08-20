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
 * `Colors.dark` was explicitly out of scope for that pass and keeps the
 * neutral scale it always had, plus a lightened accent so the one accent
 * colour still reads against black.
 */

import '@/global.css';

import { Platform, type TextStyle } from 'react-native';

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
  },
  dark: {
    text: '#ffffff',
    background: '#000000',
    backgroundElement: '#212225',
    backgroundSelected: '#2E3135',
    textSecondary: '#B0B4BA',
    accent: '#C8664E',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

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

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
