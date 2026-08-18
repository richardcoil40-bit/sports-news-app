import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';

import { playerTabStyles } from '@/components/player-tabs/shared';
import { StatCategoryCard } from '@/components/player-tabs/stat-category-card';
import { Centered, tabStyles } from '@/components/team-tabs/shared';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { PLAYER_STATS_SEASON, PlayerStatCategory } from '@/lib/player-stats';

export function StatsTab({
  categories,
  error,
}: {
  categories: PlayerStatCategory[] | null;
  error: boolean;
}) {
  if (categories === null && !error) {
    return (
      <Centered>
        <ActivityIndicator />
      </Centered>
    );
  }

  if (error || !categories || categories.length === 0) {
    return (
      <Centered>
        <ThemedText themeColor="textSecondary" style={tabStyles.centeredText}>
          {error
            ? "Couldn't load stats right now. Try again later."
            : `No ${PLAYER_STATS_SEASON} stats recorded for this player.`}
        </ThemedText>
      </Centered>
    );
  }

  return (
    <FlatList
      data={categories}
      keyExtractor={(item) => item.name}
      renderItem={({ item }) => <StatCategoryCard category={item} />}
      // Plain spacing between cards, not the house 1.5px Separator — the
      // cards are already bordered, so a rule between them would read as a
      // double line.
      ItemSeparatorComponent={() => <View style={styles.categoryGap} />}
      ListHeaderComponent={
        <ThemedText type="small" themeColor="textSecondary" style={styles.statsNote}>
          {PLAYER_STATS_SEASON} season
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
