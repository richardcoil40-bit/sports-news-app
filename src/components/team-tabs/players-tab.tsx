import { ActivityIndicator, FlatList, StyleSheet } from 'react-native';

import { AccentRow } from '@/components/accent-row';
import { PlayerRow } from '@/components/player-row';
import { Centered, Separator, tabStyles } from '@/components/team-tabs/shared';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { RankedPlayer } from '@/lib/notable-players';
import { Player } from '@/lib/roster';

export function PlayersTab({
  players,
  loading,
  error,
  onOpenPlayer,
  accentColor,
}: {
  players: RankedPlayer[];
  loading: boolean;
  error: boolean;
  onOpenPlayer: (p: Player) => void;
  accentColor: string | null;
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
      data={players}
      keyExtractor={(item) => item.player.id}
      renderItem={({ item }) => (
        <AccentRow color={accentColor}>
          <PlayerRow
            player={item.player}
            detail={item.detail}
            onPress={() => onOpenPlayer(item.player)}
          />
        </AccentRow>
      )}
      ItemSeparatorComponent={Separator}
      ListHeaderComponent={
        <ThemedText type="small" themeColor="textSecondary" style={styles.playersNote}>
          Most talked about — ranked by recent coverage and last season&apos;s stat leaders.
        </ThemedText>
      }
      ListEmptyComponent={
        <Centered>
          <ThemedText themeColor="textSecondary" style={tabStyles.centeredText}>
            {error
              ? "Couldn't load the roster right now. Try again later."
              : 'No players stand out in recent coverage yet.'}
          </ThemedText>
        </Centered>
      }
      contentContainerStyle={tabStyles.listContent}
    />
  );
}

const styles = StyleSheet.create({
  playersNote: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontSize: 11,
  },
});
