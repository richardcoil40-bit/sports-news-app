import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, SectionList, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ArticleCard } from '@/components/article-card';
import { PlayerRow } from '@/components/player-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { Article } from '@/lib/feeds';
import { Player, PositionGroup, fetchTeamRoster } from '@/lib/roster';
import { fetchTeamArticles } from '@/lib/team-news';

const POSITION_GROUP_LABEL: Record<PositionGroup, string> = {
  offense: 'Offense',
  defense: 'Defense',
  specialTeam: 'Special Teams',
};

type Row = ({ kind: 'article' } & Article) | ({ kind: 'player' } & Player);

export default function TeamScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{
    id: string;
    name: string;
    shortName: string;
    logoUrl: string;
  }>();

  const [articles, setArticles] = useState<Article[]>([]);
  const [roster, setRoster] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [articlesError, setArticlesError] = useState(false);
  const [rosterError, setRosterError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      const [articlesResult, rosterResult] = await Promise.allSettled([
        fetchTeamArticles(params.id),
        fetchTeamRoster(params.id),
      ]);
      if (cancelled) return;

      if (articlesResult.status === 'fulfilled') setArticles(articlesResult.value);
      else setArticlesError(true);

      if (rosterResult.status === 'fulfilled') setRoster(rosterResult.value);
      else setRosterError(true);

      setLoading(false);
    }

    load();
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

  const openPlayer = (player: Player) => {
    router.push({
      pathname: '/player/[id]',
      params: {
        id: player.id,
        fullName: player.fullName,
        lastName: player.lastName,
        jersey: player.jersey ?? '',
        position: player.position ?? '',
        headshotUrl: player.headshotUrl ?? '',
        teamId: params.id,
        teamName: params.name,
      },
    });
  };

  const sections: { title: string; data: Row[] }[] = [];

  if (articles.length > 0) {
    sections.push({
      title: 'Headlines',
      data: articles.map((a): Row => ({ kind: 'article', ...a })),
    });
  } else if (articlesError) {
    sections.push({ title: 'Headlines', data: [] });
  }

  (['offense', 'defense', 'specialTeam'] as PositionGroup[]).forEach((group) => {
    const players = roster.filter((p) => p.positionGroup === group);
    if (players.length > 0) {
      sections.push({
        title: POSITION_GROUP_LABEL[group],
        data: players.map((p): Row => ({ kind: 'player', ...p })),
      });
    }
  });

  return (
    <ThemedView style={styles.flex}>
      <Stack.Screen options={{ title: params.shortName || params.name, headerBackTitle: 'Teams' }} />
      <SafeAreaView style={styles.flex} edges={['bottom']}>
        <View style={styles.header}>
          {params.logoUrl ? (
            <Image source={{ uri: params.logoUrl }} style={styles.logo} contentFit="contain" />
          ) : null}
          <ThemedText type="title" style={styles.teamName}>
            {params.name}
          </ThemedText>
        </View>

        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator />
          </View>
        ) : (
          <SectionList
            sections={sections}
            keyExtractor={(item) => `${item.kind}-${item.id}`}
            stickySectionHeadersEnabled={false}
            renderSectionHeader={({ section }) => (
              <ThemedView style={styles.sectionHeaderWrap} type="background">
                <ThemedText type="smallBold" style={styles.sectionHeader}>
                  {section.title}
                </ThemedText>
              </ThemedView>
            )}
            renderItem={({ item }) =>
              item.kind === 'article' ? (
                <ArticleCard article={item} onPress={() => openArticle(item)} />
              ) : (
                <PlayerRow player={item} onPress={() => openPlayer(item)} />
              )
            }
            ItemSeparatorComponent={() => (
              <View style={[styles.separator, { backgroundColor: theme.backgroundElement }]} />
            )}
            ListEmptyComponent={
              <View style={styles.centered}>
                <ThemedText themeColor="textSecondary" style={styles.centeredText}>
                  Couldn&apos;t load headlines or roster for this team. Pull down to try again later.
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
    gap: Spacing.two,
    paddingVertical: Spacing.four,
  },
  logo: {
    width: 72,
    height: 72,
  },
  teamName: {
    fontSize: 22,
    lineHeight: 28,
    textAlign: 'center',
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
  sectionHeaderWrap: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.two,
  },
  sectionHeader: {
    fontSize: 13,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: Spacing.three,
  },
  listContent: {
    paddingBottom: Spacing.five,
  },
});
