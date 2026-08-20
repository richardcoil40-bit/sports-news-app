import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PickerRow } from '@/components/picker-row';
import { ThemedView } from '@/components/themed-view';
import { useTheme } from '@/hooks/use-theme';
import { getCatalogLeagues } from '@/lib/league-catalog';
import { allPlanned, leaguesIn, levelsIn } from '@/lib/league-taxonomy';

/** The levels within one sport — today, College and the NFL under Football. */
export default function FavoritesLevelsScreen() {
  const theme = useTheme();
  // The primitive, not the params object: that object is a new reference
  // every render, and depending on it re-runs forever.
  const { sport } = useLocalSearchParams<{ sport: string }>();
  const catalog = getCatalogLeagues();
  const levels = useMemo(() => levelsIn(catalog, sport), [catalog, sport]);

  return (
    <ThemedView style={styles.flex}>
      <Stack.Screen options={{ title: sport }} />
      <SafeAreaView style={styles.flex} edges={['bottom']}>
        <View style={[styles.rule, { backgroundColor: theme.text }]} />
        {levels.map((level) => {
          const under = leaguesIn(catalog, sport, level);
          const planned = allPlanned(under);
          return (
            <PickerRow
              key={level}
              label={level}
              detail={planned ? 'Not available yet' : under.map((l) => l.displayName).join(' · ')}
              disabled={planned}
              onPress={() =>
                router.push({
                  pathname: '/settings/favorites/leagues',
                  params: { sport, level },
                })
              }
            />
          );
        })}
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
