import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';

import { playerTabStyles } from '@/components/player-tabs/shared';
import { StatCategoryCard } from '@/components/player-tabs/stat-category-card';
import { Centered, tabStyles } from '@/components/team-tabs/shared';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { PlayerSeasonStats } from '@/lib/player-stats';

export function StatsTab({
  stats,
  error,
}: {
  /** The categories and the season they're from — null until they land. */
  stats: PlayerSeasonStats | null;
  error: boolean;
}) {
  if (stats === null && !error) {
    return (
      <Centered>
        <ActivityIndicator />
      </Centered>
    );
  }

  if (error || !stats || stats.categories.length === 0) {
    return (
      <Centered>
        <ThemedText themeColor="textSecondary" style={tabStyles.centeredText}>
          {error || !stats
            ? "Couldn't load stats right now. Try again later."
            : `No ${stats.season} stats recorded for this player.`}
        </ThemedText>
      </Centered>
    );
  }

  return (
    <FlatList
      data={stats.categories}
      keyExtractor={(item) => item.name}
      renderItem={({ item }) => <StatCategoryCard category={item} />}
      // Plain spacing between cards, not the house 1.5px Separator — the
      // cards are already bordered, so a rule between them would read as a
      // double line.
      ItemSeparatorComponent={() => <View style={styles.categoryGap} />}
      ListHeaderComponent={
        <ThemedText type="small" themeColor="textSecondary" style={styles.statsNote}>
          {stats.season} season
        </ThemedText>
      }
      contentContainerStyle={[tabStyles.listContent, playerTabStyles.fillHeight, styles.statsContent]}
    />
  );
}

const styles = StyleSheet.create({
  categoryGap: {
    height: Spacing.two,
  },
  statsContent: {
    paddingHorizontal: Spacing.three,
  },
  statsNote: {
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontSize: 11,
    paddingBottom: Spacing.two,
  },
});
