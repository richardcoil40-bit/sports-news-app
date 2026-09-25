import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';

import { playerTabStyles } from '@/components/player-tabs/shared';
import { LeaderBoardCard } from '@/components/team-tabs/leader-board-card';
import { Centered, tabStyles } from '@/components/team-tabs/shared';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { LeaderBoard, LeaderEntry } from '@/lib/leader-boards';

export function PlayersTab({
  boards,
  season,
  loading,
  error,
  onOpenPlayer,
}: {
  boards: LeaderBoard[];
  /** The season the leaders are from, for the header — see `lastCompletedSeason`. */
  season: number;
  loading: boolean;
  error: boolean;
  /**
   * The whole entry, not just the player: the screen it opens has to be told
   * whether this player's surname is safe to match on alone.
   */
  onOpenPlayer: (entry: LeaderEntry) => void;
}) {
  if (loading) {
    return (
      <Centered>
        <ActivityIndicator />
      </Centered>
    );
  }

  return (
    <FlatList
      data={boards}
      keyExtractor={(item) => item.name}
      renderItem={({ item }) => <LeaderBoardCard board={item} onOpenPlayer={onOpenPlayer} />}
      // Plain spacing between cards, not the house 1.5px Separator — the
      // cards are already bordered, so a rule between them would read as a
      // double line. Same call as the player screen's stats tab.
      ItemSeparatorComponent={() => <View style={styles.cardGap} />}
      ListHeaderComponent={
        boards.length > 0 ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.note}>
            {season} season leaders
          </ThemedText>
        ) : null
      }
      ListEmptyComponent={
        <Centered>
          <ThemedText themeColor="textSecondary" style={tabStyles.centeredText}>
            {error
              ? "Couldn't load stat leaders right now. Try again later."
              : 'No stat leaders yet this season.'}
          </ThemedText>
        </Centered>
      }
      contentContainerStyle={[tabStyles.listContent, playerTabStyles.fillHeight, styles.content]}
    />
  );
}

const styles = StyleSheet.create({
  cardGap: {
    height: Spacing.two,
  },
  content: {
    paddingHorizontal: Spacing.three,
  },
  note: {
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontSize: 11,
    paddingBottom: Spacing.two,
  },
});
