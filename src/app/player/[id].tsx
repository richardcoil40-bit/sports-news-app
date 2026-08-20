import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Logo } from '@/components/logo';
import { NewsTab } from '@/components/player-tabs/news-tab';
import { StatsTab } from '@/components/player-tabs/stats-tab';
import { TabBar } from '@/components/tab-bar';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAsync } from '@/hooks/use-async';
import { useTheme } from '@/hooks/use-theme';
import { ClaimType, withClaimTypes } from '@/lib/claim-type';
import { Article } from '@/lib/feeds';
import { matchArticlesForPlayer } from '@/lib/player-match';
import { fetchPlayerSeasonStats, PlayerStatCategory } from '@/lib/player-stats';
import { fetchTeamNewsPool } from '@/lib/team-news-pool';

type TabKey = 'stats' | 'news';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'stats', label: 'Stats' },
  { key: 'news', label: 'News' },
];

export default function PlayerScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{
    id: string;
    fullName: string;
    firstName: string;
    lastName: string;
    surnameMatch: string;
    jersey: string;
    position: string;
    headshotUrl: string;
    teamId: string;
    teamName: string;
    teamShortName: string;
  }>();

  const [tab, setTab] = useState<TabKey>('stats');

  const news = useAsync<Article[]>(async () => {
    // Same pool the team's News tab uses (ESPN + community sites + local
    // newsroom + national feeds), and cached there, so this is usually
    // instant rather than a fresh fetch of everything.
    const pool = await fetchTeamNewsPool(params.teamId, params.teamShortName || params.teamName);
    // The same matcher, with the same inputs, that produced the article
    // count on the card you tapped — see notable-players.ts. Surname
    // matching is opt-*out*: '0' is the Players tab saying a teammate
    // shares this surname, and anything else (including arriving here by
    // deep link, with no such judgement to pass on) leaves it enabled.
    return matchArticlesForPlayer(pool.articles, params, {
      allowLastName: params.surnameMatch !== '0',
    });
  });

  // Classified once here rather than inside NewsTab, so the tab stays a pure
  // renderer and the work doesn't re-run on every tab switch. Same shape the
  // team screen passes its own news tab.
  const classifiedMatches = useMemo(() => withClaimTypes(news.data ?? []), [news.data]);

  const stats = useAsync<PlayerStatCategory[]>(() => fetchPlayerSeasonStats(params.id));

  // Both tabs load on mount rather than lazily when their tab is opened (the
  // team screen's pattern): there are only two of them, the news pool is
  // normally already cached by the team screen you arrived from, and stats is
  // a single request.
  //
  // reload() rather than load(): load() is a no-op once data has landed, so it
  // would skip exactly the re-fetch these effects exist to trigger when the
  // params below change. On mount there's no data yet, so the two behave
  // identically there.
  useEffect(() => {
    news.reload();
    // useLocalSearchParams() returns a new object every render, so depending
    // on `params` itself re-ran this effect (and re-fetched) on every
    // re-render forever — the screen never settled on "loaded" because it
    // kept resetting to loading before the previous fetch's result could
    // stick. Depending on the specific primitive values actually used here
    // fixes that.
    //
    // The name fields look unused by the fetch, and are not — they're what
    // matchArticlesForPlayer() matches on, via the whole params object.
    // Narrow this list to just the three team fields and the screen silently
    // stops re-matching when you navigate from one player to another on the
    // same team: same pool, same cache hit, stale matches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    params.teamId,
    params.teamShortName,
    params.teamName,
    params.fullName,
    params.firstName,
    params.lastName,
    params.surnameMatch,
  ]);

  useEffect(() => {
    stats.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  const openArticle = (article: Article & { claimType?: ClaimType }) => {
    router.push({
      pathname: '/article',
      params: {
        title: article.title,
        link: article.link,
        source: article.source,
        publishedAt: article.publishedAt ?? '',
        description: article.description,
        imageUrl: article.imageUrl ?? '',
        claimType: article.claimType ?? '',
      },
    });
  };

  return (
    <ThemedView style={styles.flex}>
      <Stack.Screen
        options={{
          title: params.fullName,
          headerBackTitle: params.teamName,
          headerRight: () => <Logo size={18} />,
        }}
      />
      <SafeAreaView style={styles.flex} edges={['bottom']}>
        <View style={styles.header}>
          {params.headshotUrl ? (
            <Image source={{ uri: params.headshotUrl }} style={styles.headshot} contentFit="cover" />
          ) : (
            <View style={[styles.headshot, styles.headshotPlaceholder, { backgroundColor: theme.backgroundElement }]}>
              {/* A number, not a name — mono, so it sits square in the tile. */}
              <ThemedText type="title" font="mono">
                {params.jersey || '—'}
              </ThemedText>
            </View>
          )}
          <ThemedText type="title" style={styles.name}>
            {params.fullName}
          </ThemedText>
          <ThemedText font="mono" themeColor="textSecondary" style={styles.meta}>
            {[params.position, params.teamName].filter(Boolean).join(' · ')}
          </ThemedText>
        </View>

        <TabBar tabs={TABS} active={tab} onChange={setTab} />

        {tab === 'stats' ? (
          // No `loading` prop: StatsTab derives its spinner from
          // `categories === null && !error`, which is what this screen has
          // always done. useAsync exposes a `loading` flag too, but rendering
          // from it would add a state this tab never had — see the news tab
          // below for the case where it's actually needed.
          <StatsTab categories={stats.data} error={stats.error} />
        ) : (
          <NewsTab
            fullName={params.fullName}
            matches={classifiedMatches}
            // Both halves are load-bearing. `news.loading` is still false on
            // the very first render (the mount effect hasn't run yet), so
            // alone it would flash the empty state before the spinner; the
            // null-data check alone would miss the *re*-load triggered by
            // navigating to another player, where data is already non-null
            // and the old matches would sit there looking current.
            loading={news.loading || (news.data === null && !news.error)}
            error={news.error}
            onOpenArticle={openArticle}
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
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.four,
    paddingHorizontal: Spacing.four,
  },
  headshot: {
    width: 88,
    height: 88,
    borderRadius: 0,
  },
  headshotPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: {
    fontSize: 22,
    lineHeight: 28,
    textAlign: 'center',
    marginTop: Spacing.two,
  },
  meta: {
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontSize: 11,
  },
});
