import { Stack, useFocusEffect } from 'expo-router';
import { ReactNode, useCallback, useState } from 'react';
import { ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import {
  DisagreementDirection,
  getNicknamesNeverRescued,
  getNicknameUsefulness,
  getVerdictDisagreements,
  GroupYieldSummary,
  NicknameUsefulness,
  summarizeYieldByGroup,
  VerdictDisagreement,
} from '@/lib/diagnostics';
import { useTheme } from '@/hooks/use-theme';

/**
 * The runtime half of the review gate — Phase 3d of the scaling plan.
 * `team-review.ts` catches a team nobody has *ruled on*; this catches a
 * ruling that's turned out wrong once real traffic runs through it, off
 * three signals `team-news-pool.ts` already computes (see diagnostics.ts
 * for where each is recorded):
 *
 *  - Yield per source group — a filter that's stopped filtering, or
 *    stopped matching.
 *  - Verdict disagreement — the classifier's own team list disagreeing
 *    with what a nickname match decided, the "Wildcats" hazard caught for
 *    free on a call the pool already makes.
 *  - Nickname usefulness — which curated nicknames are actually rescuing
 *    articles, and which are dead weight.
 *
 * Everything here is a snapshot of an in-memory, per-device log (see
 * docs/data-retention.md) — nothing is fetched, nothing is persisted, and
 * it only has data once you've actually opened a few team screens this
 * session. Reachable only in dev builds: see the `__DEV__` guard on the
 * Settings row that links here, in settings/index.tsx.
 */
export default function DiagnosticsScreen() {
  const theme = useTheme();
  const [yieldSummary, setYieldSummary] = useState<GroupYieldSummary[]>([]);
  const [disagreements, setDisagreements] = useState<readonly VerdictDisagreement[]>([]);
  const [usefulness, setUsefulness] = useState<readonly NicknameUsefulness[]>([]);
  const [neverRescued, setNeverRescued] = useState<{ teamShortName: string; nickname: string }[]>([]);

  const refresh = useCallback(() => {
    setYieldSummary(summarizeYieldByGroup());
    setDisagreements([...getVerdictDisagreements()].reverse());
    setUsefulness([...getNicknameUsefulness()].sort((a, b) => b.rescued - a.rescued));
    setNeverRescued(getNicknamesNeverRescued());
  }, []);

  // Fires on first focus too — this screen has nothing to hydrate, so a
  // redundant read of whatever's already been logged is harmless.
  useFocusEffect(refresh);

  return (
    <ThemedView style={styles.flex}>
      <Stack.Screen options={{ title: 'Diagnostics', headerBackTitle: 'Back' }} />
      <SafeAreaView style={styles.flex} edges={['bottom']}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.headerRow}>
            <ThemedText themeColor="textSecondary" style={styles.lede}>
              Signals from this device&apos;s session only — nothing here is fetched or persisted. Open
              a few team screens, then come back and refresh.
            </ThemedText>
            <TouchableOpacity
              onPress={refresh}
              accessibilityRole="button"
              accessibilityLabel="Refresh diagnostics">
              <ThemedText font="mono" style={styles.refresh}>
                Refresh ↻
              </ThemedText>
            </TouchableOpacity>
          </View>

          <Section title="Yield by source group" theme={theme}>
            {yieldSummary.length === 0 ? (
              <Empty text="No name-filter passes logged yet." />
            ) : (
              yieldSummary.map((s) => (
                <View key={s.group} style={styles.row}>
                  <View style={styles.rowHead}>
                    <ThemedText font="mono" style={styles.rowTerm}>
                      {s.group}
                    </ThemedText>
                    {(s.hasZeroYieldEvent || s.hasFullYieldEvent) && (
                      <ThemedText font="mono" style={[styles.flag, { color: theme.accent }]}>
                        {s.hasZeroYieldEvent ? 'ZERO-YIELD EVENT' : 'FULL-YIELD EVENT'}
                      </ThemedText>
                    )}
                  </View>
                  <ThemedText themeColor="textSecondary" style={styles.rowBody}>
                    {s.itemsKept}/{s.itemsIn} kept ({s.yieldPct.toFixed(0)}%) across {s.events} fetch
                    {s.events === 1 ? '' : 'es'}
                  </ThemedText>
                </View>
              ))
            )}
          </Section>

          <Section title="Verdict disagreements" theme={theme}>
            {disagreements.length === 0 ? (
              <Empty text="No disagreements logged yet — needs EXPO_PUBLIC_VERDICT_URL configured." />
            ) : (
              disagreements.map((d) => (
                <View key={`${d.articleLink}-${d.at}`} style={styles.row}>
                  <View style={styles.rowHead}>
                    <ThemedText font="mono" style={styles.rowTerm}>
                      {d.teamShortName} · {d.nickname}
                    </ThemedText>
                    <ThemedText font="mono" style={[styles.flag, { color: theme.accent }]}>
                      {directionLabel(d.direction)}
                    </ThemedText>
                  </View>
                  <ThemedText style={styles.rowBody}>{d.articleTitle}</ThemedText>
                  <ThemedText themeColor="textSecondary" style={styles.rowMeta}>
                    Model&apos;s teams: {d.verdictTeams.length > 0 ? d.verdictTeams.join(', ') : '(none)'}
                  </ThemedText>
                </View>
              ))
            )}
          </Section>

          <Section title="Nickname usefulness" theme={theme}>
            {usefulness.length === 0 && neverRescued.length === 0 ? (
              <Empty text="No local-newsroom fetches with nicknames logged yet." />
            ) : (
              <>
                {usefulness.map((n) => (
                  <View key={`${n.teamShortName}::${n.nickname}`} style={styles.row}>
                    <ThemedText font="mono" style={styles.rowTerm}>
                      {n.teamShortName} · {n.nickname}
                    </ThemedText>
                    <ThemedText themeColor="textSecondary" style={styles.rowBody}>
                      Rescued {n.rescued} article{n.rescued === 1 ? '' : 's'} alone
                    </ThemedText>
                  </View>
                ))}
                {neverRescued.map((n) => (
                  <View key={`${n.teamShortName}::${n.nickname}::never`} style={styles.row}>
                    <View style={styles.rowHead}>
                      <ThemedText font="mono" style={styles.rowTerm}>
                        {n.teamShortName} · {n.nickname}
                      </ThemedText>
                      <ThemedText font="mono" style={[styles.flag, { color: theme.accent }]}>
                        ZERO THIS SESSION
                      </ThemedText>
                    </View>
                    <ThemedText themeColor="textSecondary" style={styles.rowBody}>
                      Never rescued an article on its own this session.
                    </ThemedText>
                  </View>
                ))}
              </>
            )}
          </Section>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function directionLabel(direction: DisagreementDirection): string {
  return direction === 'false-positive-candidate' ? 'FALSE POSITIVE?' : 'FALSE NEGATIVE?';
}

function Section({
  title,
  theme,
  children,
}: {
  title: string;
  theme: ReturnType<typeof useTheme>;
  children: ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={[styles.rule, { backgroundColor: theme.text }]} />
      <ThemedText font="mono" themeColor="textSecondary" style={styles.sectionLabel}>
        {title}
      </ThemedText>
      {children}
    </View>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <ThemedText themeColor="textSecondary" style={styles.rowBody}>
      {text}
    </ThemedText>
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
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.three,
    paddingBottom: Spacing.three,
  },
  lede: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  refresh: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
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
  row: {
    gap: Spacing.half,
  },
  rowHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  rowTerm: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    flexShrink: 1,
  },
  flag: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  rowBody: {
    fontSize: 14,
    lineHeight: 20,
  },
  rowMeta: {
    fontSize: 11,
    lineHeight: 15,
  },
});
