import { Stack } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { DEFINITION_SECTIONS } from '@/lib/definitions';

/**
 * A flat glossary of every label the app puts on a story. The content —
 * and the rule that it may only describe words the app actually shows —
 * lives in `lib/definitions.ts`.
 */
export default function DefinitionsScreen() {
  const theme = useTheme();

  return (
    <ThemedView style={styles.flex}>
      <Stack.Screen options={{ title: 'Definitions' }} />
      <SafeAreaView style={styles.flex} edges={['bottom']}>
        <ScrollView contentContainerStyle={styles.content}>
          <ThemedText themeColor="textSecondary" style={styles.lede}>
            Every story carries two labels: what the headline is doing, and who it came from.
            They&apos;re meant to be read together.
          </ThemedText>

          {DEFINITION_SECTIONS.map((section) => (
            <View key={section.label} style={styles.section}>
              <View style={[styles.rule, { backgroundColor: theme.text }]} />
              <ThemedText font="mono" themeColor="textSecondary" style={styles.sectionLabel}>
                {section.label}
              </ThemedText>

              {section.entries.map((entry) => (
                <View key={entry.term} style={styles.entry}>
                  <ThemedText font="mono" style={styles.term}>
                    {entry.term}
                  </ThemedText>
                  <ThemedText style={styles.body}>{entry.body}</ThemedText>
                </View>
              ))}
            </View>
          ))}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.six,
  },
  lede: {
    fontSize: 15,
    lineHeight: 22,
    paddingBottom: Spacing.three,
  },
  section: {
    gap: Spacing.three,
    paddingBottom: Spacing.four,
  },
  rule: {
    height: 1.5,
  },
  sectionLabel: {
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    fontSize: 11,
    fontWeight: '700',
  },
  entry: {
    gap: Spacing.half,
  },
  // The term scans, the definition reads — the app's whole type split.
  term: {
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontSize: 12,
    fontWeight: '700',
  },
  body: {
    fontSize: 16,
    lineHeight: 24,
  },
});
