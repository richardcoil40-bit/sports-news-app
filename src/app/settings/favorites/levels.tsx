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
            const names = item.under.map((l) => l.displayName).join(' · ');
            return (
              <PickerRow
                label={item.level}
                // A lone league sharing the level's name ("NFL" under NFL)
                // would only repeat the label.
                detail={planned ? 'Not available yet' : names === item.level ? undefined : names}
                disabled={planned}
                onPress={() =>
                  // One league is not a choice: the screen between would be
                  // a title over a single row repeating it. A level that
                  // also holds a *planned* league keeps the screen — what's
                  // coming is part of the hierarchy being legible. See the
                  // picker root for the rule this is the one exception to.
                  item.under.length === 1
                    ? router.push({
                        pathname: '/settings/favorites/teams',
                        params: { league: item.under[0].id },
                      })
                    : router.push({
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
