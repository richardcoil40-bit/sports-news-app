import { Image } from 'expo-image';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatRelativeTime } from '@/lib/format';
import { Article } from '@/lib/feeds';
import { tierLabel } from '@/lib/source-tier';

export function ArticleCard({
  article,
  onPress,
  /**
   * Which team this story is about. Only set in the merged home feed,
   * where several teams' news share one list and the headline alone
   * doesn't tell you who it concerns. Omitted on team-specific screens,
   * where it would just repeat the header.
   */
  tagLabel,
}: {
  article: Article;
  onPress: () => void;
  tagLabel?: string;
}) {
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
        <View style={styles.metaRow}>
          {tagLabel ? (
            <View style={[styles.tag, { backgroundColor: theme.text }]}>
              <ThemedText style={[styles.tagText, { color: theme.background }]}>
                {tagLabel}
              </ThemedText>
            </View>
          ) : null}
          <ThemedText
            type="small"
            themeColor="textSecondary"
            numberOfLines={1}
            style={[styles.meta, styles.metaFlex]}>
            {article.source}
          </ThemedText>
        </View>
        <ThemedText type="smallBold" numberOfLines={3} style={styles.title}>
          {article.title}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.meta}>
          {formatRelativeTime(article.publishedAt)} · {tierLabel(article.tier)}
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
    borderRadius: 0,
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
  meta: {
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontSize: 11,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  metaFlex: {
    flex: 1,
  },
  tag: {
    paddingHorizontal: Spacing.one,
    paddingVertical: 1,
    borderRadius: 0,
  },
  tagText: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
});
