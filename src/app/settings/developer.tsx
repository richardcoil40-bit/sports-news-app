import { Stack } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Logo } from '@/components/logo';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Where a tip goes, if you want to leave one. Set it to '' and the whole
 * section below hides itself — a dead donate button is worse than none.
 *
 * A plain external hand-off, the same shape as opening an article: no
 * payment SDK, no card details, nothing new collected. That keeps
 * `docs/data-retention.md` true as written.
 *
 * **Before any external TestFlight build or App Store submission, this
 * has to go back to '' or become an Apple in-app purchase** — see the
 * donation note in `docs/legal-notes.md`. Sideloading and *internal*
 * TestFlight (App Store Connect team members only) don't go through
 * review; anything else does, and "external" includes a build emailed to
 * a dozen friends. That is the specific trap here: this constant and the
 * tester invite are two harmless-looking changes that are only a problem
 * together, and they'd be made weeks apart by someone not thinking about
 * the other one.
 */
const DONATION_URL = 'https://venmo.com/code?user_id=2013094037422080726';

const PARAGRAPHS = [
  "I'm a GRC consultant and former IT auditor. Building software isn't my day job — understanding how systems get built, secured, and governed is. NoFrills started as a way to close that gap: real hands-on depth to go alongside a career that's mostly been policy, compliance, and audit, rather than just reading about how software gets made.",
  "It also exists because the sports app I wanted didn't. I wanted headlines about the teams I follow — not what an algorithm decided was a top story. No ads, no subscription, and nothing quietly collecting my data to sell on later.",
  "That's the whole thing. Plain on purpose, small on purpose, built for one job: find out what's happening with your teams, and get out.",
];

export default function DeveloperScreen() {
  const theme = useTheme();

  const openDonation = () => {
    if (!/^https?:\/\//i.test(DONATION_URL)) return;
    WebBrowser.openBrowserAsync(DONATION_URL).catch(() => {});
  };

  return (
    <ThemedView style={styles.flex}>
      <Stack.Screen options={{ title: 'Developer Info', headerBackTitle: 'Back' }} />
      <SafeAreaView style={styles.flex} edges={['bottom']}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.masthead}>
            <Logo size={20} />
            <ThemedText font="mono" style={styles.mastheadText}>
              Why this exists
            </ThemedText>
          </View>
          <View style={[styles.rule, { backgroundColor: theme.text }]} />

          {PARAGRAPHS.map((paragraph) => (
            <ThemedText key={paragraph.slice(0, 24)} style={styles.body}>
              {paragraph}
            </ThemedText>
          ))}

          {DONATION_URL ? (
            <View style={styles.tipSection}>
              <View style={[styles.rule, { backgroundColor: theme.text }]} />
              <ThemedText font="mono" style={styles.tipHeading}>
                Tip the developer
              </ThemedText>
              <ThemedText themeColor="textSecondary" style={styles.tipNote}>
                Entirely optional, and nothing in the app changes either way — there&apos;s no
                paid tier and never will be.
              </ThemedText>
              <TouchableOpacity
                style={[styles.button, { backgroundColor: theme.accent }]}
                onPress={openDonation}
                accessibilityRole="button"
                accessibilityLabel="Tip the developer on Venmo, opens in a browser">
                <ThemedText font="mono" style={[styles.buttonText, { color: theme.background }]}>
                  Venmo ↗
                </ThemedText>
              </TouchableOpacity>
            </View>
          ) : null}
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
    gap: Spacing.three,
  },
  masthead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  mastheadText: {
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    fontSize: 11,
    fontWeight: '700',
  },
  rule: {
    height: 1.5,
  },
  // The longest prose in the app after an article body, and set to match it.
  body: {
    fontSize: 17,
    lineHeight: 26,
  },
  tipSection: {
    gap: Spacing.three,
  },
  tipHeading: {
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    fontSize: 11,
    fontWeight: '700',
  },
  tipNote: {
    fontSize: 15,
    lineHeight: 22,
  },
  button: {
    marginTop: Spacing.two,
    paddingVertical: 13,
    paddingHorizontal: Spacing.three,
    borderRadius: 0,
    alignItems: 'center',
  },
  buttonText: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
});
