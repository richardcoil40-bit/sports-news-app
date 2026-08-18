import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Logo } from '@/components/logo';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TeamRow } from '@/components/team-row';
import { Fonts, Spacing } from '@/constants/theme';
import { useFavorites } from '@/hooks/use-favorites';
import { useTeams } from '@/hooks/use-teams';
import { useTheme } from '@/hooks/use-theme';
import { Team } from '@/lib/teams';

export default function TeamsScreen() {
  const theme = useTheme();
  const { teams, loading, error } = useTeams();
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
    // Alphabetical within each group, preserving the order from lib/teams.
    return [
      ...matching.filter((t) => isFavorite(t)),
      ...matching.filter((t) => !isFavorite(t)),
    ];
  }, [teams, query, isFavorite]);

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

  return (
    <ThemedView style={styles.flex}>
      <SafeAreaView style={styles.flex} edges={['top']}>
        <View style={styles.header}>
          <Logo size={22} />
          <ThemedText type="title" style={styles.headerTitle}>
            Teams
          </ThemedText>
        </View>

        <View style={styles.searchWrap}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search teams"
            placeholderTextColor={theme.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
            style={[
              styles.searchInput,
              { borderColor: theme.text, color: theme.text },
            ]}
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
                onPress={() => openTeam(item)}
                following={isFavorite(item)}
                onToggleFollow={() => toggleFavorite(item)}
              />
            )}
            ItemSeparatorComponent={() => (
              <View style={[styles.separator, { backgroundColor: theme.text }]} />
            )}
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
  },
  headerTitle: {
    fontSize: 24,
    lineHeight: 30,
    textTransform: 'uppercase',
    letterSpacing: 1,
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
    fontFamily: Fonts.mono,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.five,
  },
  centeredText: {
    textAlign: 'center',
  },
  listContent: {
    paddingBottom: Spacing.five,
  },
  separator: {
    height: 1.5,
    marginLeft: Spacing.three,
  },
});
