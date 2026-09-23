import { Image } from 'expo-image';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect } from 'react';
import { ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TRUST_LABELS } from '@/constants/flags';
import { claimBadgeColors, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ClaimType, claimTypeLabel } from '@/lib/claim-type';
import { formatRelativeTime } from '@/lib/format';
import { markArticleRead } from '@/lib/read-articles';

export default function ArticleScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{
    title: string;
    link: string;
    source: string;
    publishedAt: string;
    description: string;
    imageUrl: string;
    claimType: ClaimType | '';
  }>();

  /**
   * The one place a story counts as opened. Home, team and player screens
   * all push here, so none of them has to know how a story was reached.
   *
   * Keyed on `link` because it is the only identifier consistent across
   * sources — `id` is the link for RSS items and ESPN's numeric id for
   * ESPN's, and every dedupe, cluster and list key in the app already
   * settled on the link for that reason.
   *
   * Depends on the primitive rather than on `params`, which is a new object
   * every render and would re-fire this forever.
   */
  useEffect(() => {
    if (params.link) void markArticleRead(params.link);
  }, [params.link]);

  const openInBrowser = () => {
    // params.link comes straight from a third-party RSS item — validate the
    // scheme before handing it to the browser, and swallow a rejection
    // instead of leaving an unhandled promise if it's malformed.
    if (!/^https?:\/\//i.test(params.link ?? '')) return;
    WebBrowser.openBrowserAsync(params.link).catch(() => {});
  };

  return (
    <ThemedView style={styles.flex}>
      {/*
        No headerRight. The logo used to sit there, and a tester reported
        it as a button that does nothing — correctly, since it was a bare
        <Logo> with no handler occupying the corner iOS reserves for the
        screen's action. There is nothing for it to do here (the one
        outbound action is the CTA below, where the premise wants it), so
        the affordance goes rather than gaining a behaviour to justify it.
      */}
      <Stack.Screen options={{ title: '', headerBackTitle: 'Back' }} />
      <SafeAreaView style={styles.flex} edges={['bottom']}>
        <ScrollView>
          {params.imageUrl ? (
            <Image source={{ uri: params.imageUrl }} style={styles.image} contentFit="cover" />
          ) : null}

          <View style={styles.body}>
            {/*
              Same solid chip as the feed row, so the claim you tapped
              through on is still the first thing you see here. Absent
              when the caller had no classification to hand on rather
              than re-run one — see the screens that push here. Hidden
              with the row's while TRUST_LABELS is off.
            */}
            <View style={styles.metaRow}>
              {TRUST_LABELS && params.claimType ? (
                <View
                  style={[
                    styles.claimChip,
                    { backgroundColor: claimBadgeColors(params.claimType, theme).background },
                  ]}>
                  <ThemedText
                    font="mono"
                    style={[
                      styles.chipText,
                      { color: claimBadgeColors(params.claimType, theme).text },
                    ]}>
                    {claimTypeLabel(params.claimType)}
                  </ThemedText>
                </View>
              ) : null}
              <ThemedText
                type="small"
                themeColor="textSecondary"
                numberOfLines={1}
                style={[styles.meta, styles.metaFlex]}>
                {params.source}
                {params.publishedAt ? ` · ${formatRelativeTime(params.publishedAt)}` : ''}
              </ThemedText>
            </View>

            <ThemedText type="subtitle">{params.title}</ThemedText>

            {params.description ? (
              <ThemedText style={styles.description}>{params.description}</ThemedText>
            ) : null}

            {/*
              The one place the accent is allowed to fill a surface. It's
              the only outbound action in the app, and the whole premise
              is that the story finishes on the publisher's site.
            */}
            <TouchableOpacity
              style={[styles.readButton, { backgroundColor: theme.accent }]}
              onPress={openInBrowser}>
              <ThemedText font="mono" style={[styles.readButtonText, { color: theme.background }]}>
                Read full article ↗
              </ThemedText>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  image: {
    width: '100%',
    aspectRatio: 16 / 9,
  },
  body: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 40,
    gap: 14,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  metaFlex: {
    flex: 1,
  },
  meta: {
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontSize: 11,
  },
  claimChip: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 0,
  },
  chipText: {
    fontSize: 9,
    lineHeight: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  // Body copy, and the longest run of prose anywhere in the app — the
  // serif is set larger and looser here than the 16/24 default.
  description: {
    fontSize: 17,
    lineHeight: 26,
  },
  readButton: {
    marginTop: Spacing.two,
    paddingVertical: 13,
    paddingHorizontal: Spacing.three,
    borderRadius: 0,
    alignItems: 'center',
  },
  readButtonText: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
});
