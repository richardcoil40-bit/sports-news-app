import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAsync } from '@/hooks/use-async';
import { fetchGameSummary, GameSummary } from '@/lib/game-summary';
import { DEFAULT_LEAGUE, getLeague } from '@/lib/league-catalog';

/**
 * One game. The score band and the live line for now; the catch-up
 * section lands with the game-screen branch.
 */
export default function GameScreen() {
  const params = useLocalSearchParams<{ id: string; leagueId?: string; teamId?: string }>();
  // Required in practice — every push site has the league — with the
  // team screen's fallback for a deep link that arrives without one.
  const league = useMemo(() => getLeague(params.leagueId ?? '') ?? DEFAULT_LEAGUE, [params.leagueId]);

  const summary = useAsync<GameSummary>(() => fetchGameSummary(params.id, league));
  const { load } = summary;
  useEffect(() => {
    load();
  }, [load, params.id, league]);

  const header = summary.data?.header;

  return (
    <ThemedView style={styles.flex}>
      <Stack.Screen options={{ title: header ? `${header.away.abbreviation} at ${header.home.abbreviation}` : 'Game' }} />
      <SafeAreaView style={styles.flex} edges={['bottom']}>
        {header ? (
          <View style={styles.band}>
            <ThemedText font="mono" style={styles.score}>
              {header.away.abbreviation} {header.away.score} · {header.home.abbreviation} {header.home.score}
            </ThemedText>
            <ThemedText font="mono" themeColor="textSecondary" style={styles.meta}>
              {header.statusDetail}
            </ThemedText>
          </View>
        ) : summary.error ? (
          <ThemedText themeColor="textSecondary" style={styles.centered}>
            Couldn&apos;t load this game right now.
          </ThemedText>
        ) : (
          <ActivityIndicator style={styles.centered} />
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  band: { padding: Spacing.three, gap: Spacing.one, alignItems: 'center' },
  score: { fontSize: 22, lineHeight: 28, fontWeight: '700' },
  meta: { textTransform: 'uppercase', letterSpacing: 0.6, fontSize: 11 },
  centered: { marginTop: Spacing.five, textAlign: 'center' },
});
