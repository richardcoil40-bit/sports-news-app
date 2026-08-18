import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ArticleCard } from '@/components/article-card';
import { Logo } from '@/components/logo';
import { TabBar } from '@/components/tab-bar';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { Classified, withClaimTypes } from '@/lib/claim-type';
import { Article } from '@/lib/feeds';
import { matchArticlesForPlayer } from '@/lib/player-match';
import { fetchPlayerSeasonStats, PLAYER_STATS_SEASON, PlayerStatCategory } from '@/lib/player-stats';
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
    lastName: string;
    jersey: string;
    position: string;
    headshotUrl: string;
    teamId: string;
    teamName: string;
    teamShortName: string;
  }>();

  const [tab, setTab] = useState<TabKey>('stats');

  const [matches, setMatches] = useState<Article[]>([]);
  const classifiedMatches = useMemo(() => withClaimTypes(matches), [matches]);
  const [newsLoading, setNewsLoading] = useState(true);
  const [newsError, setNewsError] = useState(false);

  const [stats, setStats] = useState<PlayerStatCategory[] | null>(null);
  const [statsError, setStatsError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setNewsLoading(true);
      setNewsError(false);
      try {
        // Same pool the team's News tab uses (ESPN + community sites + local
        // newsroom + national feeds), and cached there, so this is usually
        // instant rather than a fresh fetch of everything.
        const pool = await fetchTeamNewsPool(params.teamId, params.teamShortName || params.teamName);
        if (cancelled) return;
        setMatches(matchArticlesForPlayer(pool.articles, params));
      } catch {
        if (!cancelled) setNewsError(true);
      } finally {
        if (!cancelled) setNewsLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
    // useLocalSearchParams() returns a new object every render, so depending
    // on `params` itself re-ran this effect (and re-fetched) on every
    // re-render forever — the screen never settled on "loaded" because it
    // kept resetting to loading before the previous fetch's result could
    // stick. Depending on the specific primitive values actually used here
    // fixes that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.teamId, params.teamShortName, params.teamName, params.fullName, params.lastName]);

  useEffect(() => {
    let cancelled = false;

    async function loadStats() {
      setStatsError(false);
      try {
        const categories = await fetchPlayerSeasonStats(params.id);
        if (!cancelled) setStats(categories);
      } catch {
        if (!cancelled) setStatsError(true);
      }
    }

    loadStats();
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  const openArticle = (article: Article) => {
    router.push({
      pathname: '/article',
      params: {
        title: article.title,
        link: article.link,
        source: article.source,
        publishedAt: article.publishedAt ?? '',
        description: article.description,
        imageUrl: article.imageUrl ?? '',
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
              <ThemedText type="title">{params.jersey || '—'}</ThemedText>
            </View>
          )}
          <ThemedText type="title" style={styles.name}>
            {params.fullName}
          </ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.meta}>
            {[params.position, params.teamName].filter(Boolean).join(' · ')}
          </ThemedText>
        </View>

        <TabBar tabs={TABS} active={tab} onChange={setTab} />

        {tab === 'stats' ? (
          <StatsTab categories={stats} error={statsError} />
        ) : (
          <NewsTab
            fullName={params.fullName}
            matches={classifiedMatches}
            loading={newsLoading}
            error={newsError}
            onOpenArticle={openArticle}
          />
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

function StatsTab({
  categories,
  error,
}: {
  categories: PlayerStatCategory[] | null;
  error: boolean;
}) {
  if (categories === null && !error) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  if (error || !categories || categories.length === 0) {
    return (
      <View style={styles.centered}>
        <ThemedText themeColor="textSecondary" style={styles.centeredText}>
          {error
            ? "Couldn't load stats right now. Try again later."
            : `No ${PLAYER_STATS_SEASON} stats recorded for this player.`}
        </ThemedText>
      </View>
    );
  }

  return (
    <FlatList
      data={categories}
      keyExtractor={(item) => item.name}
      renderItem={({ item }) => <StatCategoryCard category={item} />}
      ItemSeparatorComponent={() => <View style={{ height: Spacing.two }} />}
      ListHeaderComponent={
        <ThemedText type="small" themeColor="textSecondary" style={styles.statsNote}>
          {PLAYER_STATS_SEASON} season
        </ThemedText>
      }
      contentContainerStyle={[styles.listContent, styles.statsContent]}
    />
  );
}

function StatCategoryCard({ category }: { category: PlayerStatCategory }) {
  const theme = useTheme();

  return (
    <View style={[styles.statCard, { borderColor: theme.text }]}>
      <ThemedText type="smallBold" style={styles.statCardTitle}>
        {category.displayName.toUpperCase()}
      </ThemedText>
      <View style={styles.statTiles}>
        {category.labels.map((label, index) => (
          <View key={label + index} style={styles.statTile}>
            <ThemedText type="title" style={styles.statValue}>
              {category.values[index] ?? '—'}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.statLabel}>
              {label}
            </ThemedText>
          </View>
        ))}
      </View>
    </View>
  );
}

function NewsTab({
  fullName,
  matches,
  loading,
  error,
  onOpenArticle,
}: {
  fullName: string;
  matches: Classified<Article>[];
  loading: boolean;
  error: boolean;
  onOpenArticle: (a: Article) => void;
}) {
  const theme = useTheme();

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <FlatList
      data={matches}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <ArticleCard
          article={item}
          onPress={() => onOpenArticle(item)}
          claimType={item.claimType}
        />
      )}
      ItemSeparatorComponent={() => (
        <View style={[styles.separator, { backgroundColor: theme.text }]} />
      )}
      ListHeaderComponent={
        <ThemedText type="smallBold" style={styles.sectionHeader}>
          Articles mentioning {fullName}
        </ThemedText>
      }
      ListEmptyComponent={
        <View style={styles.centered}>
          <ThemedText themeColor="textSecondary" style={styles.centeredText}>
            {error ? "Couldn't load articles right now. Try again later." : 'No news is good news :)'}
          </ThemedText>
        </View>
      }
      contentContainerStyle={styles.listContent}
    />
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
  sectionHeader: {
    fontSize: 13,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
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
  separator: {
    height: 1.5,
    marginLeft: Spacing.three,
  },
  listContent: {
    flexGrow: 1,
    paddingBottom: Spacing.five,
  },
  statsContent: {
    paddingHorizontal: Spacing.three,
  },
  statsNote: {
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontSize: 11,
    paddingBottom: Spacing.two,
  },
  statCard: {
    borderWidth: 1.5,
    padding: Spacing.three,
  },
  statCardTitle: {
    fontSize: 13,
    letterSpacing: 0.5,
    paddingBottom: Spacing.three,
  },
  statTiles: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.three,
  },
  statTile: {
    minWidth: 72,
    alignItems: 'center',
    gap: Spacing.half,
  },
  statValue: {
    fontSize: 26,
    lineHeight: 30,
  },
  statLabel: {
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontSize: 10,
  },
});
