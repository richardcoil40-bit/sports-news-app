import { router } from 'expo-router';
import { useMemo } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Logo } from '@/components/logo';
import { TeamSquare } from '@/components/team-square';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useFavorites } from '@/hooks/use-favorites';
import { useTeams } from '@/hooks/use-teams';
import { useTheme } from '@/hooks/use-theme';
import { Team } from '@/lib/teams';

/**
 * A way in to each team you follow, and nothing else.
 *
 * This tab used to be the whole conference with a search box and a star
 * on every row, which made it two screens wearing one coat: a directory
 * and a settings surface. Managing the set moved to Settings →
 * Favorites, leaving this as pure navigation — which is what lets it be
 * a grid of blocks rather than a list of rows.
 */
export default function TeamsScreen() {
  const theme = useTheme();
  const { teams, loading, error } = useTeams();
  const { hydrated, isFavorite } = useFavorites();

  const followed = useMemo(() => teams.filter((team) => isFavorite(team)), [teams, isFavorite]);

  // Padded to an even count so an odd last team doesn't stretch across
  // both columns: the squares are flex:1, so a row holding one of them
  // gives it the whole width, and aspectRatio then makes it double
  // height. The filler is an empty cell, not a rendered square.
  const cells = useMemo<(Team | null)[]>(
    () => (followed.length % 2 === 1 ? [...followed, null] : followed),
    [followed],
  );

  const openTeam = (team: Team) => {
    router.push({
      pathname: '/team/[id]',
      params: {
        id: team.id,
        name: team.name,
        shortName: team.shortName,
        logoUrl: team.logoUrl ?? '',
      },
    });
  };

  // Both, or the empty state flashes on every cold launch before the
  // persisted favorites have been read back off disk.
  const settling = loading || !hydrated;

  return (
    <ThemedView style={styles.flex}>
      <SafeAreaView style={styles.flex} edges={['top']}>
        <View style={styles.header}>
          <Logo
            size={22}
            onPress={() => router.push('/settings')}
            accessibilityLabel="Settings"
          />
          <ThemedText type="title" style={styles.headerTitle}>
            Teams
          </ThemedText>
        </View>

        {settling ? (
          <View style={styles.centered}>
            <ActivityIndicator />
          </View>
        ) : error && followed.length === 0 ? (
          <View style={styles.centered}>
            <ThemedText themeColor="textSecondary" style={styles.centeredText}>
              {error}
            </ThemedText>
          </View>
        ) : followed.length === 0 ? (
          <View style={styles.centered}>
            <ThemedText themeColor="textSecondary" style={styles.centeredText}>
              You&apos;re not following any teams yet.
            </ThemedText>
            <TouchableOpacity
              style={[styles.button, { backgroundColor: theme.text }]}
              onPress={() => router.push('/settings/favorites')}>
              <ThemedText font="mono" style={[styles.buttonText, { color: theme.background }]}>
                Pick your teams
              </ThemedText>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList
            data={cells}
            keyExtractor={(item, index) => (item ? `${item.leagueId}:${item.id}` : `filler-${index}`)}
            numColumns={2}
            renderItem={({ item }) =>
              item ? (
                <TeamSquare team={item} onPress={() => openTeam(item)} />
              ) : (
                <View style={styles.filler} />
              )
            }
            columnWrapperStyle={styles.column}
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.three,
  },
  headerTitle: {
    fontSize: 23,
    lineHeight: 28,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.2,
  },
  column: {
    gap: Spacing.two,
  },
  filler: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.five,
    gap: Spacing.two,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.five,
    gap: Spacing.three,
  },
  centeredText: {
    textAlign: 'center',
  },
  button: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.four,
    borderRadius: 0,
  },
  buttonText: {
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    fontSize: 12,
    fontWeight: '700',
  },
});
