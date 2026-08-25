import { Stack, router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PickerRow } from '@/components/picker-row';
import { TeamRow } from '@/components/team-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing, fontFamilyFor } from '@/constants/theme';
import { useFavorites } from '@/hooks/use-favorites';
import { useLeagueCatalog } from '@/hooks/use-league-catalog';
import { useTeams } from '@/hooks/use-teams';
import { useTheme } from '@/hooks/use-theme';
import { favoriteKey } from '@/lib/favorite-keys';
import { getLeague } from '@/lib/league-catalog';
import { allPlanned, leaguesIn, levelsIn, sportsIn } from '@/lib/league-taxonomy';

/**
 * The top of the Sport → Level → League → Team picker.
 *
 * Every step is shown, including ones with a single option — with one
 * narrow exception below. The original plan had every step auto-skip
 * itself when it held only one choice, which with today's catalog would
 * collapse Sport and League to nothing and leave a bare list of levels —
 * the hierarchy would exist but never be visible. Showing it is what
 * makes the shape of the app legible: this is a football app today, and
 * it is built to not stay one.
 *
 * The exception: a level holding exactly one league goes straight to
 * that league's teams (see levels.tsx). A screen titled "NFL" whose
 * entire content is one row reading "NFL" showed the hierarchy by
 * charging a tap for no information — a tester called it out, fairly.
 * This screen and multi-league levels still render every step.
 *
 * The search box spans every team in the catalog, for the same reason
 * onboarding's does: the walk assumes you know which league your team
 * plays in, and a tester who didn't was stuck one step short of the only
 * search box, which is scoped to the league it sits in. Typing overrides
 * the hierarchy rather than filtering within it, so the box is a way out
 * of the walk, not a second control to learn. `useTeams('all')` is the
 * sanctioned width for a picker showing what you *could* follow; it
 * costs one standings request per available league, cached for the
 * process.
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
  const { teams, loading, error } = useTeams('all');
  const { isFavorite, toggleFavorite } = useFavorites();
  const [query, setQuery] = useState('');

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

  const q = query.trim().toLowerCase();
  const searching = q.length > 0;

  const matches = useMemo(() => {
    if (!searching) return [];
    return teams.filter(
      (team) => team.name.toLowerCase().includes(q) || team.abbreviation.toLowerCase().includes(q),
    );
  }, [teams, q, searching]);

  // "Georgia" next to "Georgia Tech" needs the league said; a list from a
  // single league never does. Same rule as onboarding's picker.
  const showLeague = useMemo(
    () => new Set(matches.map((team) => team.leagueId)).size > 1,
    [matches],
  );

  return (
    <ThemedView style={styles.flex}>
      <Stack.Screen options={{ title: 'Favorites', headerBackTitle: 'Back' }} />
      <SafeAreaView style={styles.flex} edges={['bottom']}>
        <View style={styles.searchWrap}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search all teams"
            placeholderTextColor={theme.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
            style={[styles.searchInput, { borderColor: theme.text, color: theme.text }]}
          />
        </View>

        {searching ? (
          loading ? (
            <View style={styles.centered}>
              <ActivityIndicator />
            </View>
          ) : error && matches.length === 0 ? (
            <View style={styles.centered}>
              <ThemedText themeColor="textSecondary" style={styles.centeredText}>
                {error}
              </ThemedText>
            </View>
          ) : (
            <FlatList
              data={matches}
              // League-qualified: the list spans conferences, and an ESPN id
              // is only unique within a sport.
              keyExtractor={(item) => favoriteKey(item.leagueId, item.id)}
              renderItem={({ item }) => (
                <TeamRow
                  team={item}
                  onPress={() => toggleFavorite(item)}
                  following={isFavorite(item)}
                  onToggleFollow={() => toggleFavorite(item)}
                  detail={showLeague ? getLeague(item.leagueId)?.displayName : undefined}
                />
              )}
              ItemSeparatorComponent={() => (
                <View style={[styles.separator, { backgroundColor: theme.text }]} />
              )}
              ListEmptyComponent={
                <View style={styles.centered}>
                  <ThemedText themeColor="textSecondary" style={styles.centeredText}>
                    No teams match “{query.trim()}”.
                  </ThemedText>
                </View>
              }
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.resultsContent}
            />
          )
        ) : (
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
            keyboardShouldPersistTaps="handled"
          />
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  searchWrap: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  searchInput: {
    borderRadius: 0,
    borderWidth: 1.5,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 14,
    fontFamily: fontFamilyFor('mono'),
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.five,
    paddingVertical: Spacing.five,
  },
  centeredText: {
    textAlign: 'center',
  },
  resultsContent: {
    flexGrow: 1,
    paddingBottom: Spacing.five,
  },
  separator: {
    height: 1.5,
    marginLeft: Spacing.three,
  },
  rule: {
    height: 1.5,
  },
});
