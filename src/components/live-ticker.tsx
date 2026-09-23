import { useEffect, useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { AccentRow } from '@/components/accent-row';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { tickerLine } from '@/lib/game';
import { getLeague } from '@/lib/league-catalog';
import { FollowedGame } from '@/lib/scoreboard';
import { fetchTeamColor } from '@/lib/team-color';

/**
 * Three rows is a busy Saturday. Games arrive sorted live-first, so the
 * cap only ever drops an upcoming or finished game, never one being played.
 */
export const MAX_TICKER_ROWS = 3;

/**
 * The games your teams are playing today, above the feed.
 *
 * Stacked rows rather than a sideways scroller: nothing else in the app
 * scrolls horizontally, and a carousel inside the header would fight the
 * list's vertical gesture and hide the second game behind a swipe nobody
 * knows to make.
 *
 * Each row carries down and distance on its face, which is the point of it
 * — you can tell whether to open the game without opening the game. No red
 * and no teal: a live game isn't a link and isn't a filter, and those two
 * accents mean exactly those things. The team's own colour is the only
 * accent, on the leading edge, the same bar every other team row uses.
 */
export function LiveTicker({
  games,
  checkedAt,
  onOpen,
}: {
  games: readonly FollowedGame[];
  checkedAt: number;
  onOpen: (game: FollowedGame) => void;
}) {
  const theme = useTheme();
  if (games.length === 0) return null;

  return (
    <View style={[styles.block, { borderColor: theme.text }]}>
      {games.slice(0, MAX_TICKER_ROWS).map((game, index) => (
        <View key={game.id}>
          {index > 0 ? <View style={[styles.rule, { backgroundColor: theme.text }]} /> : null}
          <TickerRow game={game} checkedAt={checkedAt} onPress={() => onOpen(game)} />
        </View>
      ))}
    </View>
  );
}

function TickerRow({ game, checkedAt, onPress }: { game: FollowedGame; checkedAt: number; onPress: () => void }) {
  const [color, setColor] = useState<string | null>(null);

  useEffect(() => {
    const league = getLeague(game.leagueId);
    if (!league) return;
    let cancelled = false;
    fetchTeamColor(game.followedTeamId, league).then((value) => {
      if (!cancelled) setColor(value);
    });
    return () => {
      cancelled = true;
    };
  }, [game.followedTeamId, game.leagueId]);

  const line = tickerLine(game, checkedAt);

  return (
    <AccentRow color={color}>
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.6}
        accessibilityRole="button"
        accessibilityLabel={`${line}. Open the game.`}
        style={styles.row}>
        <ThemedText
          font="mono"
          themeColor={game.state === 'in' ? 'text' : 'textSecondary'}
          style={[styles.text, game.state === 'in' && styles.live]}
          numberOfLines={1}>
          {line}
        </ThemedText>
      </TouchableOpacity>
    </AccentRow>
  );
}

const styles = StyleSheet.create({
  block: {
    marginTop: Spacing.two,
    borderTopWidth: 1.5,
    borderBottomWidth: 1.5,
  },
  rule: {
    height: 1.5,
  },
  row: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.two,
  },
  // The subtitle's own metrics, so the ticker reads as part of the masthead.
  text: {
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    fontSize: 11,
  },
  live: {
    fontWeight: '600',
  },
});
