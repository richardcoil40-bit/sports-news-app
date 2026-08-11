import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ArticleCard } from '@/components/article-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { Article } from '@/lib/feeds';
import { matchArticlesForPlayer } from '@/lib/player-match';
import { fetchTeamNewsPool } from '@/lib/team-news-pool';

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

  const [matches, setMatches] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(false);
      try {
        // Same pool the team's News tab uses (ESPN + community sites + local
        // newsroom + national feeds), and cached there, so this is usually
        // instant rather than a fresh fetch of everything.
        const pool = await fetchTeamNewsPool(params.teamId, params.teamShortName || params.teamName);
        if (cancelled) return;
        setMatches(matchArticlesForPlayer(pool.articles, params));
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
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
      <Stack.Screen options={{ title: params.fullName, headerBackTitle: params.teamName }} />
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

        <ThemedText type="smallBold" style={styles.sectionHeader}>
          Articles mentioning {params.fullName}
        </ThemedText>

        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator />
          </View>
        ) : (
          <FlatList
            data={matches}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => <ArticleCard article={item} onPress={() => openArticle(item)} />}
            ItemSeparatorComponent={() => (
              <View style={[styles.separator, { backgroundColor: theme.text }]} />
            )}
            ListEmptyComponent={
              <View style={styles.centered}>
                <ThemedText themeColor="textSecondary" style={styles.centeredText}>
                  {error
                    ? "Couldn't load articles right now. Try again later."
                    : 'No news is good news :)'}
                </ThemedText>
              </View>
            }
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
});
