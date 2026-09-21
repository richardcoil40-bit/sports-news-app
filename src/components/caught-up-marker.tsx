import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * The finish line.
 *
 * The one element that makes the feed a session rather than a scroll. Ruled
 * top and bottom in the same bold 1.5px the rest of the app uses for
 * separators, so it reads as a harder stop than the lines between cards
 * without introducing a new visual idea.
 *
 * The heading is passed in rather than fixed here, because it used to say
 * "You're caught up" over a brief the cap had truncated. Which of the two
 * headings is true is a counting question — see briefEndCopy in brief.ts.
 */
export function CaughtUpMarker({ title, detail }: { title: string; detail: string }) {
  const theme = useTheme();

  return (
    <View
      style={[styles.band, { borderColor: theme.text }]}
      accessibilityRole="summary"
      accessibilityLabel={`${title}. ${detail}`}>
      <ThemedText type="smallBold" style={styles.title}>
        {title}
      </ThemedText>
      <ThemedText font="mono" themeColor="textSecondary" style={styles.detail}>
        {detail}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  band: {
    borderTopWidth: 1.5,
    borderBottomWidth: 1.5,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    alignItems: 'center',
    gap: Spacing.half,
  },
  title: {
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  detail: {
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontSize: 11,
  },
});
