import { ActivityIndicator, FlatList } from 'react-native';

import { AccentRow } from '@/components/accent-row';
import { ArticleCard } from '@/components/article-card';
import { Centered, Separator, tabStyles } from '@/components/team-tabs/shared';
import { ThemedText } from '@/components/themed-text';
import { Classified } from '@/lib/claim-type';
import { Article } from '@/lib/feeds';

export function RecruitingTab({
  articles,
  loading,
  error,
  onOpenArticle,
  accentColor,
}: {
  articles: Classified<Article>[];
  loading: boolean;
  error: boolean;
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
          <ArticleCard
            article={item}
            onPress={() => onOpenArticle(item)}
            claimType={item.claimType}
          />
        </AccentRow>
      )}
      ItemSeparatorComponent={Separator}
      ListEmptyComponent={
        <Centered>
          <ThemedText themeColor="textSecondary" style={tabStyles.centeredText}>
            {error
              ? "Couldn't load recruiting news right now. Try again later."
              : 'No recruiting news found for this team right now.'}
          </ThemedText>
        </Centered>
      }
      contentContainerStyle={tabStyles.listContent}
    />
  );
}
