import { Image } from 'expo-image';
import { StyleSheet } from 'react-native';

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
};

/**
 * The black-flag brand mark, recolored to whichever of black/white will
 * actually read against the current background. `theme.text` is already
 * chosen as the readable opposite of `theme.background` (see
 * constants/theme.ts), so tinting with it is all "opposite color per page"
 * requires for the app's own light/dark surfaces.
 */
export function Logo({ size = 22, color }: LogoProps) {
  const theme = useTheme();
  const tint = color ?? theme.text;

  return (
    <Image
      source={require('@/assets/images/logo-flag.png')}
      style={[styles.image, { height: size, width: size * FLAG_ASPECT_RATIO }]}
      tintColor={tint}
      contentFit="contain"
      accessible
      accessibilityLabel="App logo"
    />
  );
}

const styles = StyleSheet.create({
  image: {
    // aspect ratio is set per-instance via width/height above
  },
});
