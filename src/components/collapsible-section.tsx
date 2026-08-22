import { StyleSheet, TouchableOpacity } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * A header you have to tap to see what's under it.
 *
 * Used for both "rumors & takes" and "earlier", because they're the same
 * affordance and one component is better than two that drift apart.
 *
 * It renders the header **only**, and is told whether it is open rather
 * than remembering: the rows it reveals are rows of the feed's own list,
 * so that this stays virtualized when Earlier holds two hundred stories.
 * Wrapping them as children would have put them all inside one list item,
 * which is the whole problem — mounting every card at once is exactly what
 * a FlatList exists to avoid.
 *
 * Open state therefore lives on the screen, and still lasts only as long
 * as the screen is mounted. That part is deliberate: the point of the
 * brief is that the default path through it ends, and remembering that you
 * opened Earlier yesterday would quietly turn the endless feed back on.
 */
export function CollapsibleSectionHeader({
  label,
  count,
  open,
  onToggle,
}: {
  label: string;
  count: number;
  open: boolean;
  onToggle: () => void;
}) {
  const theme = useTheme();

  return (
    <TouchableOpacity
      onPress={onToggle}
      activeOpacity={0.6}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      accessibilityLabel={`${count} ${label}`}
      style={[styles.header, { borderBottomColor: theme.text }]}>
      <ThemedText type="smallBold" style={styles.label}>
        {open ? '▾' : '▸'} {count} {label}
      </ThemedText>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderBottomWidth: 1.5,
  },
  label: {
    textTransform: 'uppercase',
    letterSpacing: 1,
    fontSize: 12,
    fontWeight: '600',
  },
});
