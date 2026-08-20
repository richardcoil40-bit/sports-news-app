import { Image } from 'expo-image';
import { StyleSheet, TouchableOpacity } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

const FLAG_ASPECT_RATIO = 566 / 720; // width / height of the source mark

export type LogoProps = {
  /** Height in points; width is derived from the mark's aspect ratio. */
  size?: number;
  /**
   * Override the automatic light/dark tint (e.g. to force white on a
   * colored team header). Defaults to whatever reads correctly against the
   * current theme's background — black on light, white on dark.
   */
  color?: string;
  /**
   * Makes the mark the app's settings button. Left off wherever there is
   * nowhere sensible to go — the mark is the wordmark first and a control
   * second, so a press target it doesn't need would be a lie about it.
   */
  onPress?: () => void;
  /** Overrides the label; only meaningful alongside `onPress`. */
  accessibilityLabel?: string;
};

/**
 * The black-flag brand mark, recolored to whichever of black/white will
 * actually read against the current background. `theme.text` is already
 * chosen as the readable opposite of `theme.background` (see
 * constants/theme.ts), so tinting with it is all "opposite color per page"
 * requires for the app's own light/dark surfaces.
 */
export function Logo({ size = 22, color, onPress, accessibilityLabel }: LogoProps) {
  const theme = useTheme();
  const tint = color ?? theme.text;

  const image = (
    <Image
      source={require('@/assets/images/logo-flag.png')}
      style={[styles.image, { height: size, width: size * FLAG_ASPECT_RATIO }]}
      tintColor={tint}
      contentFit="contain"
      accessible={!onPress}
      accessibilityLabel={onPress ? undefined : 'App logo'}
    />
  );

  if (!onPress) return image;

  // The mark is small by design, so the tap target is grown with hitSlop
  // rather than by padding it out and moving the wordmark beside it.
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.6}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? 'Settings'}>
      {image}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  image: {
    // aspect ratio is set per-instance via width/height above
  },
});
