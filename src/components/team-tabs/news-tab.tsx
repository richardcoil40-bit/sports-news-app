import { ActivityIndicator, FlatList } from 'react-native';

import { AccentRow } from '@/components/accent-row';
import { ArticleCard } from '@/components/article-card';
import { ReachFilterBar } from '@/components/reach-filter-bar';
import { Centered, Separator, tabStyles } from '@/components/team-tabs/shared';
import { ThemedText } from '@/components/themed-text';
import { Article } from '@/lib/feeds';
import { ReachFilter } from '@/lib/reach-filter';

export function NewsTab({
  articles,
  loading,
  error,
  reachFilter,
  onChangeReach,
  onOpenArticle,
  accentColor,
}: {
  articles: Article[];
  loading: boolean;
  error: boolean;
  reachFilter: ReachFilter;
  onChangeReach: (next: ReachFilter) => void;
  onOpenArticle: (a: Article) => void;
  accentColor: string | null;
}) {
  if (loading) {
    return (
      <Centered>
        <ActivityIndicator />
      </Centered>
    );
  }

  return (
    <FlatList
      data={articles}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <AccentRow color={accentColor}>
          <ArticleCard article={item} onPress={() => onOpenArticle(item)} />
        </AccentRow>
      )}
      ItemSeparatorComponent={Separator}
      ListHeaderComponent={<ReachFilterBar active={reachFilter} onChange={onChangeReach} />}
      ListEmptyComponent={
        <Centered>
          <ThemedText themeColor="textSecondary" style={tabStyles.centeredText}>
            {error
              ? "Couldn't load headlines right now. Try again later."
              : reachFilter !== 'all'
                ? 'Nothing matches that filter right now.'
                : 'No recent headlines found for this team.'}
          </ThemedText>
        </Centered>
      }
      contentContainerStyle={tabStyles.listContent}
    />
  );
}
