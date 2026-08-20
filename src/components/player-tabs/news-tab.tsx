import { ActivityIndicator, FlatList, StyleSheet } from 'react-native';

import { ArticleCard } from '@/components/article-card';
import { playerTabStyles } from '@/components/player-tabs/shared';
import { Centered, Separator, tabStyles } from '@/components/team-tabs/shared';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { ClaimType, Classified } from '@/lib/claim-type';
import { Article } from '@/lib/feeds';

export function NewsTab({
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
  onOpenArticle: (a: Article & { claimType?: ClaimType }) => void;
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
      data={matches}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <ArticleCard article={item} onPress={() => onOpenArticle(item)} claimType={item.claimType} />
      )}
      ItemSeparatorComponent={Separator}
      ListHeaderComponent={
        <ThemedText type="smallBold" style={styles.sectionHeader}>
          Articles mentioning {fullName}
        </ThemedText>
      }
      ListEmptyComponent={
        <Centered>
          <ThemedText themeColor="textSecondary" style={tabStyles.centeredText}>
            {error ? "Couldn't load articles right now. Try again later." : 'No news is good news :)'}
          </ThemedText>
        </Centered>
      }
      contentContainerStyle={[tabStyles.listContent, playerTabStyles.fillHeight]}
    />
  );
}

const styles = StyleSheet.create({
  sectionHeader: {
    fontSize: 13,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
  },
});
