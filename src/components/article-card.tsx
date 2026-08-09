import { Image } from 'expo-image';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatRelativeTime } from '@/lib/format';
import { Article } from '@/lib/feeds';

const CATEGORY_LABEL: Record<Article['category'], string> = {
  nfl: 'NFL',
  college: 'College',
  highschool: 'High School',
};

export function ArticleCard({ article, onPress }: { article: Article; onPress: () => void }) {
  const theme = useTheme();

  return (
    <TouchableOpacity style={styles.container} onPress={onPress} activeOpacity={0.7}>
      {article.imageUrl ? (
        <Image
          source={{ uri: article.imageUrl }}
          style={styles.thumbnail}
          contentFit="cover"
          transition={150}
        />
      ) : (
        <View style={[styles.thumbnail, styles.placeholder, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText style={styles.placeholderEmoji}>🏈</ThemedText>
        </View>
      )}

      <View style={styles.textColumn}>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          {CATEGORY_LABEL[article.category]} · {article.source}
        </ThemedText>
        <ThemedText type="smallBold" numberOfLines={3} style={styles.title}>
          {article.title}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {formatRelativeTime(article.publishedAt)}
        </ThemedText>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  thumbnail: {
    width: 96,
    height: 72,
    borderRadius: 8,
  },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderEmoji: {
    fontSize: 28,
  },
  textColumn: {
    flex: 1,
    gap: Spacing.half,
    justifyContent: 'center',
  },
  title: {
    lineHeight: 20,
  },
});
