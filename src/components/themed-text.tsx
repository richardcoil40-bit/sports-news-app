import { StyleSheet, Text, type TextProps, type TextStyle } from 'react-native';

import { FontFamily, fontFamilyFor, ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ThemedTextType =
  | 'default'
  | 'title'
  | 'small'
  | 'smallBold'
  | 'subtitle'
  | 'link'
  | 'linkPrimary'
  | 'code';

export type ThemedTextProps = TextProps & {
  type?: ThemedTextType;
  themeColor?: ThemeColor;
  /**
   * Overrides the family the type would otherwise pick. Needed in one
   * direction far more than the other: a handful of `title`s are stat
   * numbers and jersey digits rather than headlines, and those want the
   * mono's fixed-width figures so a column of them lines up.
   */
  font?: FontFamily;
};

/**
 * Serif for prose, mono for everything you scan. `default`, `title` and
 * `subtitle` carry headlines, names and body copy, so they're serif; the
 * `small` pair, links and `code` are the app's chips, timestamps, source
 * lines and section labels, so they stay monospace.
 */
const FAMILY_BY_TYPE: Record<ThemedTextType, FontFamily> = {
  default: 'serif',
  title: 'serif',
  subtitle: 'serif',
  small: 'mono',
  smallBold: 'mono',
  link: 'mono',
  linkPrimary: 'mono',
  code: 'mono',
};

export function ThemedText({ style, type = 'default', themeColor, font, ...rest }: ThemedTextProps) {
  const theme = useTheme();

  // Each weight is a separately bundled face with its own family name, so
  // the family can only be resolved once the caller's own overrides have
  // been folded in — a `style={{ fontWeight: '700' }}` on a `default`
  // would otherwise silently render the regular face.
  const flattened = StyleSheet.flatten<TextStyle>([styles[type], style]);
  const fontFamily = fontFamilyFor(font ?? FAMILY_BY_TYPE[type], flattened.fontWeight);

  return (
    <Text
      style={[
        { color: theme[themeColor ?? 'text'] },
        type === 'linkPrimary' && { color: theme.accent },
        flattened,
        { fontFamily },
      ]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  small: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: 500,
  },
  smallBold: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: 700,
  },
  default: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: 400,
  },
  title: {
    fontSize: 48,
    fontWeight: 700,
    lineHeight: 52,
  },
  subtitle: {
    fontSize: 27,
    lineHeight: 33,
    fontWeight: 700,
  },
  link: {
    lineHeight: 30,
    fontSize: 14,
  },
  linkPrimary: {
    lineHeight: 30,
    fontSize: 14,
  },
  code: {
    fontWeight: 500,
    fontSize: 12,
  },
});
