import { Stack, router } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TRUST_LABELS } from '@/constants/flags';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { clearStoredArticles } from '@/lib/article-store';
import { clearReadArticles } from '@/lib/read-articles';

/**
 * The three things there are to say about this app: which teams it's
 * for, what its labels mean, and who made it. Deliberately not a list of
 * toggles — there is nothing to configure, because the app collects
 * nothing and has no account. The one action below the list is the
 * escape hatch for the one thing the app now stores beyond your teams:
 * the on-device article cache (see docs/data-retention.md), whose
 * clear-all storage.ts always promised a place for.
 */
const ITEMS = [
  {
    href: '/settings/favorites' as const,
    label: 'Favorites',
    detail: 'The teams your feed is built from',
  },
  // Only while the labels it defines are on screen: definitions.ts's first
  // rule is that every term in the glossary is one the app actually shows.
  ...(TRUST_LABELS
    ? [
        {
          href: '/settings/definitions' as const,
          label: 'Definitions',
          detail: 'What the labels on each story mean',
        },
      ]
    : []),
  {
    href: '/settings/developer' as const,
    label: 'Developer Info',
    detail: 'Why this app exists',
  },
  // Dev builds only — a runtime-detection screen for the review gate
  // (AGENTS.md's Scope section, "the gate catches unreviewed teams; this
  // catches reviewed-but-wrong ones"). Gated at the row rather than only
  // in the screen so it doesn't even show up as a dead end in a shipped
  // build.
  ...(__DEV__
    ? [
        {
          href: '/settings/diagnostics' as const,
          label: 'Diagnostics',
          detail: 'Nickname and verdict signals, this session',
        },
      ]
    : []),
];

export default function SettingsScreen() {
  const theme = useTheme();
  const [clearedNote, setClearedNote] = useState<string | null>(null);

  const confirmClearArticles = () => {
    Alert.alert(
      'Clear cached articles?',
      'Removes the stored copies of your followed teams’ recent articles and the record of which stories you’ve opened. Articles rebuild as feeds are fetched again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => {
            // Both stores, because both are "what this device remembers
            // about your reading" — leaving the read marks behind would
            // make the one clear-all half a clear-all.
            Promise.all([clearStoredArticles(), clearReadArticles()])
              // The count is still the article store's — teams are what
              // that one is keyed by, and "cleared 3 teams" is the part
              // there is anything to say about.
              .then(([count]) =>
                setClearedNote(
                  count === 0 ? 'Nothing was stored' : `Cleared ${count} team${count === 1 ? '' : 's'}`,
                ),
              )
              .catch(() => setClearedNote('Could not clear — try again'));
          },
        },
      ],
    );
  };

  return (
    <ThemedView style={styles.flex}>
      <Stack.Screen options={{ title: 'Settings', headerBackTitle: 'Back' }} />
      <SafeAreaView style={styles.flex} edges={['bottom']}>
        <View style={[styles.rule, { backgroundColor: theme.text }]} />
        {ITEMS.map((item) => (
          <View key={item.href}>
            <TouchableOpacity
              style={styles.row}
              activeOpacity={0.7}
              accessibilityRole="button"
              onPress={() => router.push(item.href)}>
              <View style={styles.rowText}>
                <ThemedText style={styles.rowLabel}>{item.label}</ThemedText>
                <ThemedText font="mono" themeColor="textSecondary" style={styles.rowDetail}>
                  {item.detail}
                </ThemedText>
              </View>
              <ThemedText font="mono" style={styles.chevron}>
                ›
              </ThemedText>
            </TouchableOpacity>
            <View style={[styles.rule, { backgroundColor: theme.text }]} />
          </View>
        ))}

        {/* An action rather than a destination, so no chevron. */}
        <TouchableOpacity
          style={styles.row}
          activeOpacity={0.7}
          accessibilityRole="button"
          onPress={confirmClearArticles}>
          <View style={styles.rowText}>
            <ThemedText style={styles.rowLabel}>Clear cached articles</ThemedText>
            <ThemedText font="mono" themeColor="textSecondary" style={styles.rowDetail}>
              {clearedNote ?? 'Stored articles and what you’ve opened'}
            </ThemedText>
          </View>
        </TouchableOpacity>
        <View style={[styles.rule, { backgroundColor: theme.text }]} />
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  rowText: {
    flex: 1,
    gap: Spacing.half,
  },
  rowLabel: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '600',
  },
  rowDetail: {
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontSize: 10.5,
    lineHeight: 15,
  },
  chevron: {
    fontSize: 20,
    lineHeight: 24,
  },
  // Full-bleed rather than inset, matching every other separator here.
  rule: {
    height: 1.5,
  },
});
