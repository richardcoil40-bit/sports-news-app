import { StyleSheet, View } from 'react-native';

import { PlayerRow } from '@/components/player-row';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { LeaderBoard, LeaderEntry } from '@/lib/leader-boards';

/**
 * One bordered card per stat category, the same frame as the player
 * screen's `StatCategoryCard` so the tab you tap from and the screen you
 * land on read as one thing.
 *
 * No `AccentRow` on the rows: a team-colour bar inside a bordered card reads
 * as a second frame, and the header band above already carries the colour.
 */
export function LeaderBoardCard({
  board,
  onOpenPlayer,
}: {
  board: LeaderBoard;
  onOpenPlayer: (entry: LeaderEntry) => void;
}) {
  const theme = useTheme();

  return (
    <View style={[styles.card, { borderColor: theme.text }]}>
      <ThemedText type="smallBold" style={styles.title}>
        {board.title.toUpperCase()}
      </ThemedText>
      {board.entries.map((entry) => (
        <PlayerRow
          key={entry.player.id}
          player={entry.player}
          detail={entry.detail}
          onPress={() => onOpenPlayer(entry)}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1.5,
    paddingTop: Spacing.three,
    // Each row carries Spacing.two of its own below it, so this plus that
    // matches the top.
    paddingBottom: Spacing.two,
  },
  title: {
    fontSize: 13,
    letterSpacing: 0.5,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.one,
  },
});
