import { Stack, router } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PickerRow } from '@/components/picker-row';
import { ThemedView } from '@/components/themed-view';
import { useTheme } from '@/hooks/use-theme';
import { getCatalogLeagues } from '@/lib/league-catalog';
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
 * Everything here is derived from `__data__/leagues.json`. Adding a
 * sport, a level, or a league is an edit to that file.
 */
export default function FavoritesSportsScreen() {
  const theme = useTheme();
  const catalog = getCatalogLeagues();
  const sports = useMemo(() => sportsIn(catalog), [catalog]);

  return (
    <ThemedView style={styles.flex}>
      <Stack.Screen options={{ title: 'Favorites' }} />
      <SafeAreaView style={styles.flex} edges={['bottom']}>
        <View style={[styles.rule, { backgroundColor: theme.text }]} />
        {sports.map((sport) => {
          const levels = levelsIn(catalog, sport);
          const under = levels.flatMap((level) => leaguesIn(catalog, sport, level));
          return (
            <PickerRow
              key={sport}
              label={sport}
              detail={levels.join(' · ')}
              disabled={allPlanned(under)}
              onPress={() =>
                router.push({ pathname: '/settings/favorites/levels', params: { sport } })
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
