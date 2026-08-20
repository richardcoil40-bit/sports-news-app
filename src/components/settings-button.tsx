import { router } from 'expo-router';
import { StyleSheet, TouchableOpacity } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * The way into Settings from the two tab screens.
 *
 * Originally this was the wordmark itself, on the reasoning that the
 * logo was otherwise a dead element. Seen on a device that failed
 * plainly: a small flag beside a title reads as decoration, because
 * that is exactly what a logo normally is. Nothing about it said
 * "tap me", so nobody would.
 *
 * A bordered chip in the metadata style instead — same 1.5px rule and
 * sharp corners as every other control here, so it announces itself as
 * one without introducing a new visual idea. The mark stays tappable
 * too, for anyone who does try it.
 */
export function SettingsButton() {
  const theme = useTheme();

  return (
    <TouchableOpacity
      onPress={() => router.push('/settings')}
      activeOpacity={0.6}
      accessibilityRole="button"
      accessibilityLabel="Settings"
      hitSlop={8}
      style={[styles.button, { borderColor: theme.text }]}>
      <ThemedText font="mono" style={styles.label}>
        Settings
      </ThemedText>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    borderWidth: 1.5,
    borderRadius: 0,
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
  },
  label: {
    fontSize: 10.5,
    lineHeight: 15,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    fontWeight: '700',
  },
});
