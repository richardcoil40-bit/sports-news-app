import { ActivityIndicator, FlatList } from 'react-native';

import { AccentRow } from '@/components/accent-row';
import { ArticleCard } from '@/components/article-card';
import { FilterBar } from '@/components/filter-bar';
import { Centered, Separator, tabStyles } from '@/components/team-tabs/shared';
import { ThemedText } from '@/components/themed-text';
import { ClaimFilter, ClaimType, CLAIM_FILTER_TABS, Classified } from '@/lib/claim-type';
import { WithDuplicates } from '@/lib/cluster';
import { Article } from '@/lib/feeds';

export function NewsTab({
  articles,
  loading,
  error,
  claimFilter,
  onChangeClaim,
  onOpenArticle,
  accentColor,
}: {
  articles: WithDuplicates<Classified<Article>>[];
  loading: boolean;
  error: boolean;
  claimFilter: ClaimFilter;
  onChangeClaim: (next: ClaimFilter) => void;
  onOpenArticle: (a: Article & { claimType?: ClaimType }) => void;
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
          <ArticleCard
            article={item}
            onPress={() => onOpenArticle(item)}
            claimType={item.claimType}
            onPressClaim={onChangeClaim}
            duplicates={item.duplicates}
            onOpenDuplicate={onOpenArticle}
          />
        </AccentRow>
      )}
      ItemSeparatorComponent={Separator}
      ListHeaderComponent={
        <FilterBar tabs={CLAIM_FILTER_TABS} active={claimFilter} onChange={onChangeClaim} />
      }
      ListEmptyComponent={
        <Centered>
          <ThemedText themeColor="textSecondary" style={tabStyles.centeredText}>
            {error
              ? "Couldn't load headlines right now. Try again later."
              : claimFilter !== 'all'
                ? 'Nothing matches that filter right now.'
                : 'No recent headlines found for this team.'}
          </ThemedText>
        </Centered>
      }
      contentContainerStyle={tabStyles.listContent}
    />
  );
}
