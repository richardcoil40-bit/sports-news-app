import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PickerRow } from '@/components/picker-row';
import { ThemedView } from '@/components/themed-view';
import { useTheme } from '@/hooks/use-theme';
import { getCatalogLeagues } from '@/lib/league-catalog';
import { leaguesIn } from '@/lib/league-taxonomy';

/** The leagues within one level — today, the Big Ten under College. */
export default function FavoritesLeaguesScreen() {
  const theme = useTheme();
  const { sport, level } = useLocalSearchParams<{ sport: string; level: string }>();
  const catalog = getCatalogLeagues();
  const leagues = useMemo(() => leaguesIn(catalog, sport, level), [catalog, sport, level]);

  return (
    <ThemedView style={styles.flex}>
      <Stack.Screen options={{ title: level }} />
      <SafeAreaView style={styles.flex} edges={['bottom']}>
        <View style={[styles.rule, { backgroundColor: theme.text }]} />
        {leagues.map((league) => (
          <PickerRow
            key={league.id}
            label={league.displayName}
            detail={league.status === 'planned' ? 'Not available yet' : undefined}
            disabled={league.status === 'planned'}
            onPress={() =>
              router.push({
                pathname: '/settings/favorites/teams',
                params: { league: league.id },
              })
            }
          />
        ))}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  rule: {
    height: 1.5,
  },
});
