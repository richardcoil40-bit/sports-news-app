import { Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TeamRow } from '@/components/team-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing, fontFamilyFor } from '@/constants/theme';
import { useFavorites } from '@/hooks/use-favorites';
import { useTeams } from '@/hooks/use-teams';
import { useTheme } from '@/hooks/use-theme';
import { DEFAULT_LEAGUE, getLeague } from '@/lib/league-catalog';

/**
 * The last step of Sport → Level → League → Team, and where following
 * and unfollowing actually happens. The Teams tab shows only the teams
 * you already follow, so this is the one screen that lists every team
 * in a league.
 *
 * Changes commit immediately rather than behind a Done button — unlike
 * onboarding, which holds its selection locally so backing out of a
 * first run doesn't leave half a set of teams behind. Here there is
 * always an existing set to fall back to, so a star is just a star.
 *
 * Scoped to the league it was opened for. It falls back to the default
 * league rather than erroring on a missing or unknown id: this screen is
 * reachable directly by URL, and a bad one should land somewhere real.
 */
export default function FavoritesTeamsScreen() {
  const theme = useTheme();
  // The primitive, not the params object — that is a new reference every
  // render, and depending on it re-runs forever.
  const { league: leagueId } = useLocalSearchParams<{ league?: string }>();
  const league = (leagueId ? getLeague(leagueId) : null) ?? DEFAULT_LEAGUE;
  const { teams, loading, error } = useTeams(league);
  const { isFavorite, toggleFavorite } = useFavorites();
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matching = q
      ? teams.filter(
          (t) => t.name.toLowerCase().includes(q) || t.abbreviation.toLowerCase().includes(q),
        )
      : teams;

    // Followed teams float to the top, so the list doubles as a view of
    // who you follow rather than needing a separate screen for it.
    return [...matching.filter((t) => isFavorite(t)), ...matching.filter((t) => !isFavorite(t))];
  }, [teams, query, isFavorite]);

  return (
    <ThemedView style={styles.flex}>
      <Stack.Screen options={{ title: league.displayName }} />
      <SafeAreaView style={styles.flex} edges={['bottom']}>
        <View style={styles.searchWrap}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search teams"
            placeholderTextColor={theme.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
            style={[styles.searchInput, { borderColor: theme.text, color: theme.text }]}
          />
        </View>

        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator />
          </View>
        ) : error && filtered.length === 0 ? (
          <View style={styles.centered}>
            <ThemedText themeColor="textSecondary" style={styles.centeredText}>
              {error}
            </ThemedText>
          </View>
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <TeamRow
                team={item}
                onPress={() => toggleFavorite(item)}
                following={isFavorite(item)}
                onToggleFollow={() => toggleFavorite(item)}
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
            contentContainerStyle={styles.listContent}
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
  listContent: {
    flexGrow: 1,
    paddingBottom: Spacing.five,
  },
  separator: {
    height: 1.5,
    marginLeft: Spacing.three,
  },
});
