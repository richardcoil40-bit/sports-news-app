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
import { Article, fetchAllFeeds } from '@/lib/feeds';
import { matchArticlesForPlayer } from '@/lib/player-match';
import { fetchTeamArticles } from '@/lib/team-news';

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
        const [teamArticles, generalFeeds] = await Promise.all([
          fetchTeamArticles(params.teamId),
          fetchAllFeeds(),
        ]);
        if (cancelled) return;

        const seen = new Set<string>();
        const pool = [...teamArticles, ...generalFeeds.articles].filter((a) => {
          if (seen.has(a.link)) return false;
          seen.add(a.link);
          return true;
        });

        setMatches(matchArticlesForPlayer(pool, params));
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
  }, [params]);

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
          <ThemedText themeColor="textSecondary">
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
              <View style={[styles.separator, { backgroundColor: theme.backgroundElement }]} />
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
    borderRadius: 44,
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
    height: StyleSheet.hairlineWidth,
    marginLeft: Spacing.three,
  },
  listContent: {
    flexGrow: 1,
    paddingBottom: Spacing.five,
  },
});
