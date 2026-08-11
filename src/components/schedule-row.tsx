import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ScheduledGame } from '@/lib/schedule';

function moneylineLabel(value: number | null): string {
  if (value === null) return '—';
  return value > 0 ? `+${value}` : `${value}`;
}

export function ScheduleRow({ game }: { game: ScheduledGame }) {
  const theme = useTheme();
  const vsAt = game.homeAway === 'away' ? '@' : game.homeAway === 'neutral' ? 'vs' : 'vs';

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        {game.opponentLogoUrl ? (
          <Image source={{ uri: game.opponentLogoUrl }} style={styles.logo} contentFit="contain" />
        ) : (
          <View style={[styles.logo, styles.placeholder, { backgroundColor: theme.backgroundElement }]} />
        )}

        <View style={styles.textColumn}>
          <ThemedText type="default">
            {vsAt} {game.opponentShortName}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {game.statusDetail || 'Date TBD'}
            {game.network ? ` · ${game.network}` : ''}
          </ThemedText>
        </View>
      </View>

      {game.odds ? (
        <View style={[styles.oddsRow, { borderTopColor: theme.backgroundElement }]}>
          <ThemedText type="small" themeColor="textSecondary">
            {game.odds.details ?? 'Line'}
            {game.odds.overUnder ? ` · O/U ${game.odds.overUnder}` : ''}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            ML {moneylineLabel(game.homeAway === 'away' ? game.odds.awayMoneyline : game.odds.homeMoneyline)}
          </ThemedText>
        </View>
      ) : !game.completed ? (
        <View style={[styles.oddsRow, { borderTopColor: theme.backgroundElement }]}>
          <ThemedText type="small" themeColor="textSecondary">
            Odds not posted yet
          </ThemedText>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    gap: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  logo: {
    width: 32,
    height: 32,
  },
  placeholder: {
    borderRadius: 16,
  },
  textColumn: {
    flex: 1,
    gap: Spacing.half,
  },
  oddsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.two,
  },
});
