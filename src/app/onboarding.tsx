import { router, Stack } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Logo } from '@/components/logo';
import { PickerRow } from '@/components/picker-row';
import { TeamRow } from '@/components/team-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing, fontFamilyFor } from '@/constants/theme';
import { useTeams } from '@/hooks/use-teams';
import { useTheme } from '@/hooks/use-theme';
import { favoriteKey } from '@/lib/favorite-keys';
import { markOnboarded, setFavorites } from '@/lib/favorites';
import { getLeague, getLeagues } from '@/lib/league-catalog';
import { Team } from '@/lib/teams';

/**
 * Shown once, on first launch. The app's premise is a feed of the teams
 * you follow, so asking up front is both the fastest way to explain that
 * and what stops a brand-new user landing on an empty home screen with
 * no idea what to do.
 *
 * Selection is kept in local state and only committed on "Done" — so
 * backing out mid-pick doesn't leave a half-chosen set of teams behind.
 *
 * ## Why a league picker rather than one list
 *
 * This screen used to open on every team in every league, sorted
 * together. That reads as a complete list at two conferences and as an
 * undifferentiated wall at forty-five, where "Georgia" and "Georgia
 * State" and "Georgia Tech" sit next to each other with nothing saying
 * which league is which. So the default is the leagues, one row each,
 * and the teams are a step in.
 *
 * The search box is the way back out of that hierarchy: with no league
 * open it looks across every team the catalog has, so someone who knows
 * exactly who they follow never has to find the conference first.
 */
export default function OnboardingScreen() {
  const theme = useTheme();
  // Every league, explicitly. This is the one screen that can't be scoped
  // by what you already follow, because on a first launch you follow
  // nothing — scoping here would offer an empty list to pick from.
  const { teams, loading, error } = useTeams('all');
  const [selected, setSelected] = useState<Team[]>([]);
  const [leagueId, setLeagueId] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const q = query.trim().toLowerCase();
  // Typing overrides the hierarchy rather than filtering within it, which
  // is what makes the search box a shortcut instead of a second control to
  // learn.
  const showingTeams = leagueId !== null || q.length > 0;

  // Derived from the teams that actually loaded rather than from the
  // catalog: fetchAllTeams settles per league, so a conference whose
  // standings request failed would otherwise offer a row that opens an
  // empty list. Catalog order, because that is the order the Favorites
  // picker walks too.
  const leagues = useMemo(() => {
    const counts = new Map<string, number>();
    for (const team of teams) counts.set(team.leagueId, (counts.get(team.leagueId) ?? 0) + 1);
    return getLeagues()
      .filter((league) => counts.has(league.id))
      .map((league) => ({ league, count: counts.get(league.id) ?? 0 }));
  }, [teams]);

  const visibleTeams = useMemo(() => {
    if (!showingTeams) return [];
    const scoped = leagueId ? teams.filter((team) => team.leagueId === leagueId) : teams;
    if (!q) return scoped;
    return scoped.filter(
      (team) => team.name.toLowerCase().includes(q) || team.abbreviation.toLowerCase().includes(q),
    );
  }, [teams, leagueId, q, showingTeams]);

  // With more than one conference on screen "Georgia" and "Michigan" sit
  // side by side with nothing saying which is which. Labelled only when
  // there is actually something to disambiguate, which inside a league
  // there never is.
  const showLeague = useMemo(
    () => new Set(visibleTeams.map((team) => team.leagueId)).size > 1,
    [visibleTeams],
  );

  const isSelected = (team: Team) =>
    selected.some((t) => t.id === team.id && t.leagueId === team.leagueId);

  const toggle = (team: Team) => {
    setSelected((current) =>
      current.some((t) => t.id === team.id && t.leagueId === team.leagueId)
        ? current.filter((t) => !(t.id === team.id && t.leagueId === team.leagueId))
        : [...current, team],
    );
  };

  // Backing out clears the search too, so "All leagues" always lands on
  // the league list rather than on whatever was typed before.
  const leaveLeague = () => {
    setLeagueId(null);
    setQuery('');
  };

  const finish = async () => {
    setFavorites(selected);
    await markOnboarded();
    router.replace('/(tabs)');
  };

  return (
    <ThemedView style={styles.flex}>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView style={styles.flex} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <Logo size={22} />
            <ThemedText type="title" style={styles.headerTitle}>
              Fieldwork
            </ThemedText>
          </View>
          <ThemedText style={styles.lede}>Pick the teams you actually follow.</ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.subtitle}>
            Their news — and nothing else — becomes your feed. You can change this any time.
          </ThemedText>
        </View>

        <View style={styles.searchWrap}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={leagueId ? 'Search this league' : 'Search all teams'}
            placeholderTextColor={theme.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
            style={[styles.searchInput, { borderColor: theme.text, color: theme.text }]}
          />
        </View>

        {/*
          The only way back up a level, since this screen has no nav bar of
          its own — it is shown before the tabs exist.
        */}
        {leagueId ? (
          <View style={[styles.scope, { borderBottomColor: theme.text }]}>
            <TouchableOpacity
              onPress={leaveLeague}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Back to all leagues">
              <ThemedText font="mono" style={styles.scopeBack}>
                ‹ All leagues
              </ThemedText>
            </TouchableOpacity>
            <ThemedText
              font="mono"
              themeColor="textSecondary"
              numberOfLines={1}
              style={styles.scopeLabel}>
              {getLeague(leagueId)?.displayName}
            </ThemedText>
          </View>
        ) : null}

        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator />
          </View>
        ) : error && teams.length === 0 ? (
          <View style={styles.centered}>
            <ThemedText themeColor="textSecondary" style={styles.centeredText}>
              {error}
            </ThemedText>
          </View>
        ) : showingTeams ? (
          <FlatList
            data={visibleTeams}
            // League-qualified, like the Teams tab's: an ESPN id is only
            // unique within a sport, and this list now spans conferences.
            keyExtractor={(item) => favoriteKey(item.leagueId, item.id)}
            renderItem={({ item }) => (
              <TeamRow
                team={item}
                onPress={() => toggle(item)}
                following={isSelected(item)}
                onToggleFollow={() => toggle(item)}
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
            contentContainerStyle={styles.listContent}
          />
        ) : (
          <FlatList
            data={leagues}
            keyExtractor={(item) => item.league.id}
            renderItem={({ item }) => (
              <PickerRow
                label={item.league.displayName}
                detail={`${item.count} teams`}
                onPress={() => setLeagueId(item.league.id)}
              />
            )}
            // PickerRow rules its own bottom edge, so the first row needs
            // the top one drawn for it.
            ListHeaderComponent={<View style={[styles.rule, { backgroundColor: theme.text }]} />}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.listContent}
          />
        )}

        <View style={[styles.footer, { borderTopColor: theme.text }]}>
          <TouchableOpacity
            style={[
              styles.button,
              { backgroundColor: selected.length > 0 ? theme.text : theme.backgroundElement },
            ]}
            onPress={finish}
            disabled={selected.length === 0}>
            <ThemedText
              type="smallBold"
              style={[
                styles.buttonText,
                { color: selected.length > 0 ? theme.background : theme.textSecondary },
              ]}>
              {selected.length > 0
                ? `Follow ${selected.length} team${selected.length === 1 ? '' : 's'}`
                : 'Pick at least one team'}
            </ThemedText>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  header: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
    gap: Spacing.two,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  headerTitle: {
    fontSize: 23,
    lineHeight: 28,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.2,
  },
  lede: {
    fontSize: 16,
    lineHeight: 22,
  },
  subtitle: {
    fontSize: 12,
    lineHeight: 18,
  },
  searchWrap: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
  },
  searchInput: {
    borderRadius: 0,
    borderWidth: 1.5,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 14,
    fontFamily: fontFamilyFor('mono'),
  },
  scope: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderBottomWidth: 1.5,
  },
  scopeBack: {
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontSize: 11,
  },
  scopeLabel: {
    flexShrink: 1,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontSize: 11,
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
    paddingBottom: Spacing.three,
  },
  rule: {
    height: 1.5,
  },
  separator: {
    height: 1.5,
    marginLeft: Spacing.three,
  },
  footer: {
    borderTopWidth: 1.5,
    padding: Spacing.three,
  },
  button: {
    paddingVertical: Spacing.three,
    borderRadius: 0,
    alignItems: 'center',
  },
  buttonText: {
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontSize: 12,
  },
});
