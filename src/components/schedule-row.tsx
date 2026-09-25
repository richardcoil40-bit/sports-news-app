import { Image } from 'expo-image';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { resultBadgeColors, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ScheduledGame } from '@/lib/schedule';

function moneylineLabel(value: number | null): string {
  if (value === null) return '—';
  return value > 0 ? `+${value}` : `${value}`;
}

const RESULT_WORD = { W: 'Won', L: 'Lost', T: 'Tied' } as const;

function accessibilityLabelFor(game: ScheduledGame, vsAt: string): string {
  const matchup = `${vsAt} ${game.opponentShortName}`;
  if (game.result && game.score) {
    return `${RESULT_WORD[game.result]} ${game.score.own} to ${game.score.opponent} ${matchup}. Open the recap.`;
  }
  return `${matchup}. Open the game.`;
}

/**
 * `onPress` is passed for any finished game — its game screen renders a
 * recap however old it is — and for an upcoming one close enough to now
 * that its screen has something to show (see `isRecentOrUpcoming`). A
 * game in November stays inert rather than opening an empty screen.
 */
export function ScheduleRow({ game, onPress }: { game: ScheduledGame; onPress?: () => void }) {
  const theme = useTheme();
  const vsAt = game.homeAway === 'away' ? '@' : game.homeAway === 'neutral' ? 'vs' : 'vs';
  const Container = onPress ? TouchableOpacity : View;
  const started = game.state !== 'pre';
  const final = game.result && game.score ? { result: game.result, score: game.score } : null;
  const badge = final ? resultBadgeColors(final.result, theme) : null;

  // Live, finished, canceled and postponed rows lead with ESPN's short status
  // ("3:12 - 3rd", "Final/OT", "Canceled") and, once a game is final, the
  // record it left the team with. Upcoming rows keep the long kickoff line,
  // which is the thing to read. A tappable row without a score column says
  // so in words; one with a score gets a chevron beside it instead, which
  // keeps the meta line short enough not to wrap against that column.
  const meta = started
    ? [game.statusShort, game.network, game.record]
    : [game.statusDetail || 'Date TBD', game.network];
  if (onPress && !final) meta.push(game.completed ? 'Recap ›' : 'Game day ›');

  return (
    <Container
      style={styles.container}
      {...(onPress
        ? {
            onPress,
            activeOpacity: 0.6,
            accessibilityRole: 'button' as const,
            accessibilityLabel: accessibilityLabelFor(game, vsAt),
          }
        : {})}>
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
          <ThemedText type="small" themeColor="textSecondary" style={styles.meta}>
            {meta.filter(Boolean).join(' · ')}
          </ThemedText>
        </View>

        {final ? (
          <View style={styles.result}>
            <View style={[styles.badge, { backgroundColor: badge?.background }]}>
              <ThemedText type="smallBold" style={[styles.badgeText, { color: badge?.text }]}>
                {final.result}
              </ThemedText>
            </View>
            <ThemedText type="smallBold">
              {final.score.own}–{final.score.opponent}
            </ThemedText>
            {onPress ? (
              <ThemedText type="smallBold" themeColor="textSecondary">
                ›
              </ThemedText>
            ) : null}
          </View>
        ) : null}
      </View>

      {game.odds ? (
        <View style={[styles.oddsRow, { borderTopColor: theme.text }]}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.meta}>
            {game.odds.details ?? 'Line'}
            {game.odds.overUnder ? ` · O/U ${game.odds.overUnder}` : ''}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.meta}>
            ML {moneylineLabel(game.homeAway === 'away' ? game.odds.awayMoneyline : game.odds.homeMoneyline)}
          </ThemedText>
        </View>
      ) : game.state === 'pre' ? (
        <View style={[styles.oddsRow, { borderTopColor: theme.text }]}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.meta}>
            Odds not posted yet
          </ThemedText>
        </View>
      ) : null}
    </Container>
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
    borderRadius: 0,
  },
  textColumn: {
    flex: 1,
    gap: Spacing.half,
  },
  meta: {
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontSize: 11,
  },
  result: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    // The opponent column gives way on a narrow phone, never the score.
    flexShrink: 0,
  },
  // The claim chip's shape (sharp, tight padding, solid fill) at a size
  // that sits level with the score beside it rather than the 9pt caption
  // a claim chip is.
  badge: {
    minWidth: 20,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 0,
    alignItems: 'center',
  },
  badgeText: {
    fontSize: 12,
    lineHeight: 16,
  },
  oddsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1.5,
    paddingTop: Spacing.two,
  },
});
