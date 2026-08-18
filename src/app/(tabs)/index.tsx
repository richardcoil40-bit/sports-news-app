import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ArticleCard } from '@/components/article-card';
import { Logo } from '@/components/logo';
import { FilterBar } from '@/components/filter-bar';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useFeed } from '@/hooks/use-feed';
import { useTeams } from '@/hooks/use-teams';
import { useTheme } from '@/hooks/use-theme';
import {
  ClaimFilter,
  CLAIM_FILTER_TABS,
  filterByClaimType,
  withClaimTypes,
} from '@/lib/claim-type';
import { clusterArticles, leadsWithDuplicates } from '@/lib/cluster';
import { Article } from '@/lib/feeds';
import { balanceBySource } from '@/lib/source-balance';
import { withTeamMentions } from '@/lib/team-mentions';

/**
 * The home screen is a feed of the teams you follow, not a directory of
 * every team in the conference. That's the whole premise of the app: if
 * you wanted everything, national coverage already exists everywhere.
 */
export default function FeedScreen() {
  const theme = useTheme();
  const { articles, loading, refreshing, error, refresh, followedTeams, hasFollowedTeams, ready } =
    useFeed();
  // The whole league, not just followed teams: a Michigan follower's pool
  // legitimately contains Michigan State stories, and tagging those
  // MICHIGAN would be worse than not tagging them at all.
  const { teams } = useTeams();
  const [claimFilter, setClaimFilter] = useState<ClaimFilter>('all');

  // Classified and tagged once, then filtered — every card needs both for
  // its badges whether or not a filter is active, so this is one pass
  // instead of one per consumer.
  const classified = useMemo(
    () => withTeamMentions(withClaimTypes(articles), teams),
    [articles, teams],
  );

  // Re-balanced after filtering, matching the team screen: the feed
  // arrives already balanced across all sources, but once a claim type is
  // filtered out that balance no longer describes what's left, so the
  // remaining sources need re-spreading against each other. A no-op when
  // the filter is 'all'.
  // Filter, then cluster, then balance — in that order.
  //
  // Filtering first means every member of every cluster is already
  // eligible, so a cluster can't end up led by an article the active filter
  // removed. Balancing last means it sees the post-cluster distribution:
  // clustering is precisely what removes the duplicates that were inflating
  // an outlet's share.
  const visibleArticles = useMemo(
    () =>
      balanceBySource(
        leadsWithDuplicates(clusterArticles(filterByClaimType(classified, claimFilter))),
      ),
    [classified, claimFilter],
  );

  // Widened to Article because it is also handed the duplicates a cluster
  // absorbed, which carry no team attribution of their own.
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

  const subtitle = hasFollowedTeams
    ? followedTeams.map((team) => team.shortName).join(' · ')
    : 'No teams followed yet';

  return (
    <ThemedView style={styles.flex}>
      <SafeAreaView style={styles.flex} edges={['top']}>
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <Logo size={22} />
            <ThemedText type="title" style={styles.headerTitle}>
              Your Feed
            </ThemedText>
          </View>
          <ThemedText themeColor="textSecondary" style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </ThemedText>
        </View>

        {!ready || loading ? (
          <View style={styles.centered}>
            <ActivityIndicator />
          </View>
        ) : !hasFollowedTeams ? (
          <View style={styles.centered}>
            <ThemedText themeColor="textSecondary" style={styles.centeredText}>
              Follow a few teams and their news shows up here.
            </ThemedText>
            <TouchableOpacity
              style={[styles.button, { backgroundColor: theme.text }]}
              onPress={() => router.push('/teams')}>
              <ThemedText type="smallBold" style={[styles.buttonText, { color: theme.background }]}>
                Pick your teams
              </ThemedText>
            </TouchableOpacity>
          </View>
        ) : error && articles.length === 0 ? (
          <View style={styles.centered}>
            <ThemedText themeColor="textSecondary" style={styles.centeredText}>
              {error}
            </ThemedText>
          </View>
        ) : (
          <FlatList
            data={visibleArticles}
            keyExtractor={(item) => item.link}
            renderItem={({ item }) => (
              <ArticleCard
                article={item}
                onPress={() => openArticle(item)}
                // The team the headline actually names, which is not
                // always the followed team whose pool surfaced it.
                // Omitted when no team is named rather than guessed at.
                tagLabel={item.mentionedTeam?.shortName}
                claimType={item.claimType}
                onPressClaim={setClaimFilter}
                duplicates={item.duplicates}
                onOpenDuplicate={openArticle}
              />
            )}
            ItemSeparatorComponent={() => (
              <View style={[styles.separator, { backgroundColor: theme.text }]} />
            )}
            ListHeaderComponent={
              <FilterBar tabs={CLAIM_FILTER_TABS} active={claimFilter} onChange={setClaimFilter} />
            }
            ListEmptyComponent={
              <View style={styles.centered}>
                <ThemedText themeColor="textSecondary" style={styles.centeredText}>
                  {claimFilter === 'rumor'
                    ? 'No rumors about your teams right now.'
                    : claimFilter === 'take'
                      ? 'No takes about your teams right now.'
                      : claimFilter === 'reported'
                        ? 'No reported news for your teams right now.'
                        : 'Nothing new for your teams right now.'}
                </ThemedText>
              </View>
            }
            contentContainerStyle={styles.listContent}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
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
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.two,
    gap: Spacing.half,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  headerTitle: {
    fontSize: 24,
    lineHeight: 30,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  subtitle: {
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontSize: 11,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.five,
    paddingVertical: Spacing.five,
    gap: Spacing.three,
  },
  centeredText: {
    textAlign: 'center',
  },
  button: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.four,
    borderRadius: 0,
  },
  buttonText: {
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontSize: 12,
  },
  listContent: {
    flexGrow: 1,
    paddingBottom: Spacing.five,
  },
  separator: {
    height: 1.5,
    marginLeft: Spacing.three,
  },
});
