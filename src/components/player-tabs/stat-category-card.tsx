import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { PlayerStatCategory } from '@/lib/player-stats';

/** One bordered card per stat category (passing, rushing, receiving, ...). */
export function StatCategoryCard({ category }: { category: PlayerStatCategory }) {
  const theme = useTheme();

  return (
    <View style={[styles.statCard, { borderColor: theme.text }]}>
      <ThemedText type="smallBold" style={styles.statCardTitle}>
        {category.displayName.toUpperCase()}
      </ThemedText>
      <View style={styles.statTiles}>
        {category.labels.map((label, index) => (
          <View key={label + index} style={styles.statTile}>
            {/* Mono for the figures: a row of stat tiles only reads as a
                row if the digits are the same width in every one. */}
            <ThemedText type="title" font="mono" style={styles.statValue}>
              {category.values[index] ?? '—'}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.statLabel}>
              {label}
            </ThemedText>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  statCard: {
    borderWidth: 1.5,
    padding: Spacing.three,
  },
  statCardTitle: {
    fontSize: 13,
    letterSpacing: 0.5,
    paddingBottom: Spacing.three,
  },
  statTiles: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.three,
  },
  statTile: {
    minWidth: 72,
    alignItems: 'center',
    gap: Spacing.half,
  },
  statValue: {
    fontSize: 26,
    lineHeight: 30,
  },
  statLabel: {
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontSize: 10,
  },
});
