import { StyleSheet, View } from 'react-native';

import { AccentRow } from '@/components/accent-row';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { TeamContext } from '@/hooks/use-context-strip';

/**
 * What's going on with your teams, at the top of the feed.
 *
 * Two modes, chosen per team from the schedule rather than the calendar:
 *
 *  - **In season** — the game. Kickoff, network, or the result.
 *  - **Out of season** — that team's most recent roster or staff move,
 *    passed in by the screen from news it already has.
 *
 * A team with neither is omitted entirely rather than rendering an empty
 * row. Seven months of "next game in 214 days" is dead furniture, and this
 * strip is supposed to be the reason to open the app on a Tuesday.
 */
export function ContextStrip({
  contexts,
  offseasonHeadlines,
}: {
  contexts: TeamContext[];
  /** Latest program move per team, keyed by `leagueId:teamId`. */
  offseasonHeadlines: Record<string, string | undefined>;
}) {
  const theme = useTheme();

  const rows = contexts
    .map((context) => {
      const key = `${context.team.leagueId}:${context.team.id}`;
      const detail = context.game
        ? [context.game.statusDetail, context.game.network].filter(Boolean).join(' · ')
        : offseasonHeadlines[key];
      const opponent = context.game
        ? `${context.game.homeAway === 'away' ? '@' : 'vs'} ${context.game.opponentShortName}`
        : null;
      return detail ? { key, context, detail, opponent } : null;
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  if (rows.length === 0) return null;

  return (
    <View style={[styles.wrap, { borderBottomColor: theme.text }]}>
      {rows.map(({ key, context, detail, opponent }) => (
        <AccentRow key={key} color={null}>
          <View style={styles.row}>
            <View style={styles.headline}>
              <ThemedText type="smallBold" style={styles.team}>
                {context.team.shortName}
              </ThemedText>
              {opponent ? (
                <ThemedText type="smallBold" style={styles.opponent}>
                  {opponent}
                </ThemedText>
              ) : null}
            </View>
            <ThemedText
              themeColor="textSecondary"
              style={styles.detail}
              numberOfLines={opponent ? 1 : 2}>
              {detail}
            </ThemedText>
          </View>
        </AccentRow>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderBottomWidth: 1.5,
  },
  row: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    gap: Spacing.half,
  },
  headline: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: Spacing.two,
  },
  team: {
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  opponent: {
    fontSize: 12,
  },
  detail: {
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontSize: 11,
  },
});
