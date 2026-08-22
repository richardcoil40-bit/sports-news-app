import { Stack, router } from 'expo-router';
import { useMemo } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PickerRow } from '@/components/picker-row';
import { ThemedView } from '@/components/themed-view';
import { useLeagueCatalog } from '@/hooks/use-league-catalog';
import { useTheme } from '@/hooks/use-theme';
import { allPlanned, leaguesIn, levelsIn, sportsIn } from '@/lib/league-taxonomy';

/**
 * The top of the Sport → Level → League → Team picker.
 *
 * Every step is shown, including ones with a single option. The original
 * plan had a step auto-skip itself when it held only one choice, which
 * with today's catalog would collapse Sport and League to nothing and
 * leave a bare list of levels — the hierarchy would exist but never be
 * visible. Showing it is what makes the shape of the app legible: this
 * is a football app today, and it is built to not stay one.
 *
 * Everything here is derived from the league catalog, which is no longer
 * bundled — `useLeagueCatalog` is what re-renders these three screens if a
 * remote list lands while one of them is open. A `.map()` into a plain View
 * was fine while the catalog shipped inside the app and its length was a
 * fact about this build; a hosted catalog can grow without one, so all
 * three are FlatLists.
 */
export default function FavoritesSportsScreen() {
  const theme = useTheme();
  const catalog = useLeagueCatalog();
  const sports = useMemo(
    () =>
      sportsIn(catalog).map((sport) => {
        const levels = levelsIn(catalog, sport);
        return {
          sport,
          levels,
          under: levels.flatMap((level) => leaguesIn(catalog, sport, level)),
        };
      }),
    [catalog],
  );

  return (
    <ThemedView style={styles.flex}>
      <Stack.Screen options={{ title: 'Favorites', headerBackTitle: 'Back' }} />
      <SafeAreaView style={styles.flex} edges={['bottom']}>
        <FlatList
          data={sports}
          keyExtractor={(item) => item.sport}
          renderItem={({ item }) => (
            <PickerRow
              label={item.sport}
              detail={item.levels.join(' · ')}
              disabled={allPlanned(item.under)}
              onPress={() =>
                router.push({ pathname: '/settings/favorites/levels', params: { sport: item.sport } })
              }
            />
          )}
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
