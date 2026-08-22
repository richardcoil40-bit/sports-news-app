import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PickerRow } from '@/components/picker-row';
import { ThemedView } from '@/components/themed-view';
import { useLeagueCatalog } from '@/hooks/use-league-catalog';
import { useTheme } from '@/hooks/use-theme';
import { allPlanned, leaguesIn, levelsIn } from '@/lib/league-taxonomy';

/** The levels within one sport — today, College and the NFL under Football. */
export default function FavoritesLevelsScreen() {
  const theme = useTheme();
  // The primitive, not the params object: that object is a new reference
  // every render, and depending on it re-runs forever.
  const { sport } = useLocalSearchParams<{ sport: string }>();
  const catalog = useLeagueCatalog();
  const levels = useMemo(
    () =>
      levelsIn(catalog, sport).map((level) => ({
        level,
        under: leaguesIn(catalog, sport, level),
      })),
    [catalog, sport],
  );

  return (
    <ThemedView style={styles.flex}>
      <Stack.Screen options={{ title: sport , headerBackTitle: 'Back' }} />
      <SafeAreaView style={styles.flex} edges={['bottom']}>
        <FlatList
          data={levels}
          keyExtractor={(item) => item.level}
          renderItem={({ item }) => {
            const planned = allPlanned(item.under);
            return (
              <PickerRow
                label={item.level}
                detail={
                  planned ? 'Not available yet' : item.under.map((l) => l.displayName).join(' · ')
                }
                disabled={planned}
                onPress={() =>
                  router.push({
                    pathname: '/settings/favorites/leagues',
                    params: { sport, level: item.level },
                  })
                }
              />
            );
          }}
          // PickerRow rules its own bottom edge, so the first row needs the
          // top one drawn for it.
          ListHeaderComponent={<View style={[styles.rule, { backgroundColor: theme.text }]} />}
        />
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
