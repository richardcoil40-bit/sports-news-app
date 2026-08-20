import { ScrollView, StyleSheet, TouchableOpacity } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * A scrolling row of chips for narrowing a list, with `null` meaning "no
 * narrowing" — the always-present first chip.
 *
 * The scrolling counterpart to FilterBar, and deliberately a different
 * object rather than a variant of it. FilterBar is one bordered box with
 * dividers and `flex: 1` segments, which is right for a fixed axis of
 * three or four known values and cannot hold a list whose length is the
 * user's business. This holds separate chips instead, so it can scroll
 * past the screen edge without the segments becoming unreadably narrow.
 *
 * Keeping the two visually distinct is the same point FilterBar makes
 * about itself: two identical-looking rows stacked on each other read as
 * one confusing block, so the two filter axes have to look like two
 * different kinds of control.
 */
export function ChipRow<T extends string>({
  items,
  active,
  onChange,
  allLabel = 'All',
}: {
  items: readonly { key: T; label: string }[];
  /** `null` selects `allLabel`. */
  active: T | null;
  onChange: (next: T | null) => void;
  allLabel?: string;
}) {
  const theme = useTheme();

  const chip = (key: T | null, label: string) => {
    const isActive = key === active;
    return (
      <TouchableOpacity
        key={key ?? '__all__'}
        onPress={() => onChange(key)}
        activeOpacity={0.6}
        accessibilityRole="button"
        accessibilityState={{ selected: isActive }}
        style={[
          styles.chip,
          {
            borderColor: theme.text,
            backgroundColor: isActive ? theme.text : 'transparent',
          },
        ]}>
        <ThemedText
          font="mono"
          numberOfLines={1}
          style={[styles.label, { color: isActive ? theme.background : theme.text }]}>
          {label}
        </ThemedText>
      </TouchableOpacity>
    );
  };

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.content}
      // Chips are a filter, not the list: a tap should narrow the feed
      // rather than first having to dismiss a scroll momentum.
      keyboardShouldPersistTaps="handled">
      {chip(null, allLabel)}
      {items.map((item) => chip(item.key, item.label))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
    gap: Spacing.one,
  },
  chip: {
    borderWidth: 1.5,
    borderRadius: 0,
    paddingHorizontal: Spacing.two,
    paddingVertical: 3,
  },
  label: {
    fontSize: 10.5,
    lineHeight: 15,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    fontWeight: '700',
  },
});
