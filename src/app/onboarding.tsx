import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Logo } from '@/components/logo';
import { TeamRow } from '@/components/team-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTeams } from '@/hooks/use-teams';
import { useTheme } from '@/hooks/use-theme';
import { markOnboarded, setFavorites } from '@/lib/favorites';

/**
 * Shown once, on first launch. The app's premise is a feed of the teams
 * you follow, so asking up front is both the fastest way to explain that
 * and what stops a brand-new user landing on an empty home screen with
 * no idea what to do.
 *
 * Selection is kept in local state and only committed on "Done" — so
 * backing out mid-pick doesn't leave a half-chosen set of teams behind.
 */
export default function OnboardingScreen() {
  const theme = useTheme();
  const { teams, loading, error } = useTeams();
  const [selected, setSelected] = useState<string[]>([]);

  const toggle = (teamId: string) => {
    setSelected((current) =>
      current.includes(teamId) ? current.filter((id) => id !== teamId) : [...current, teamId],
    );
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
              NoFrills
            </ThemedText>
          </View>
          <ThemedText style={styles.lede}>Pick the teams you actually follow.</ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.subtitle}>
            Their news — and nothing else — becomes your feed. You can change this any time.
          </ThemedText>
        </View>

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
        ) : (
          <FlatList
            data={teams}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <TeamRow
                team={item}
                onPress={() => toggle(item.id)}
                following={selected.includes(item.id)}
                onToggleFollow={() => toggle(item.id)}
              />
            )}
            ItemSeparatorComponent={() => (
              <View style={[styles.separator, { backgroundColor: theme.text }]} />
            )}
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
    paddingBottom: Spacing.three,
    gap: Spacing.two,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  headerTitle: {
    fontSize: 24,
    lineHeight: 30,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  lede: {
    fontSize: 16,
    lineHeight: 22,
  },
  subtitle: {
    fontSize: 12,
    lineHeight: 18,
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
    paddingBottom: Spacing.three,
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
