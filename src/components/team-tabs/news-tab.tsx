import { ActivityIndicator, FlatList } from 'react-native';

import { AccentRow } from '@/components/accent-row';
import { ArticleCard } from '@/components/article-card';
import { FilterBar } from '@/components/filter-bar';
import { Centered, Separator, tabStyles } from '@/components/team-tabs/shared';
import { ThemedText } from '@/components/themed-text';
import { ClaimFilter, ClaimType, CLAIM_FILTER_TABS, Classified } from '@/lib/claim-type';
import { WithDuplicates } from '@/lib/cluster';
import { Article } from '@/lib/feeds';
import type { TeamNewsCoverage } from '@/lib/team-news-pool';

/**
 * Why the list is empty, in terms that are actually true. There is no
 * recency cutoff anywhere in the app, so "no recent headlines" implied a
 * mechanism that doesn't exist; and a team with no curated sources is a
 * different situation from one whose sources are quiet — see
 * TeamNewsCoverage in team-news-pool.ts.
 */
function emptyMessage(error: boolean, claimFilter: ClaimFilter, coverage?: TeamNewsCoverage) {
  if (error) return "Couldn't load headlines right now. Try again later.";
  if (claimFilter !== 'all') return 'Nothing matches that filter right now.';
  if (coverage?.configured === 0) {
    return 'No dedicated sources cover this team yet — only league-wide coverage that names it.';
  }
  if (coverage && coverage.contributed === 0) {
    return "This team's sources are live, but nothing they've published lately is about it.";
  }
  return 'No headlines found for this team.';
}

export function NewsTab({
  articles,
  loading,
  error,
  coverage,
  claimFilter,
  onChangeClaim,
  onOpenArticle,
  accentColor,
}: {
  articles: WithDuplicates<Classified<Article>>[];
  loading: boolean;
  error: boolean;
  coverage?: TeamNewsCoverage;
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
            {emptyMessage(error, claimFilter, coverage)}
          </ThemedText>
        </Centered>
      }
      contentContainerStyle={tabStyles.listContent}
    />
  );
}
