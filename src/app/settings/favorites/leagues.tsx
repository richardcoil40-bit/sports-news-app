import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PickerRow } from '@/components/picker-row';
import { ThemedView } from '@/components/themed-view';
import { useLeagueCatalog } from '@/hooks/use-league-catalog';
import { useTheme } from '@/hooks/use-theme';
import { leaguesIn } from '@/lib/league-taxonomy';

/**
 * The leagues within one level — today, the Big Ten and the SEC under
 * College. This is the step the hosted catalog grows: college football alone
 * is ten conferences, so it is the one of the three most likely to outrun a
 * screen.
 */
export default function FavoritesLeaguesScreen() {
  const theme = useTheme();
  const { sport, level } = useLocalSearchParams<{ sport: string; level: string }>();
  const catalog = useLeagueCatalog();
  const leagues = useMemo(() => leaguesIn(catalog, sport, level), [catalog, sport, level]);

  return (
    <ThemedView style={styles.flex}>
      <Stack.Screen options={{ title: level , headerBackTitle: 'Back' }} />
      <SafeAreaView style={styles.flex} edges={['bottom']}>
        <FlatList
          data={leagues}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <PickerRow
              label={item.displayName}
              detail={item.status === 'planned' ? 'Not available yet' : undefined}
              disabled={item.status === 'planned'}
              onPress={() =>
                router.push({
                  pathname: '/settings/favorites/teams',
                  params: { league: item.id },
                })
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
