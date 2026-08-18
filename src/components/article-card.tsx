import { Image } from 'expo-image';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ClaimType, claimTypeLabel } from '@/lib/claim-type';
import { Article } from '@/lib/feeds';
import { formatRelativeTime } from '@/lib/format';
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
  /**
   * What kind of claim the headline makes. Passed in rather than computed
   * here because the screen already classified the list to filter it, and
   * classifying is a few hundred regex tests per article.
   */
  claimType,
  onPressClaim,
}: {
  article: Article;
  onPress: () => void;
  tagLabel?: string;
  claimType: ClaimType;
  onPressClaim?: (type: ClaimType) => void;
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
          {/*
            Solid, and first. This is the app's primary signal, and it has
            to read as a different *kind* of thing from the tier on the line
            below — rendered as more grey text, "NEWSROOM · RUMOR" reads as
            one label rather than two judgments about different things.
          */}
          <TouchableOpacity
            onPress={() => onPressClaim?.(claimType)}
            disabled={!onPressClaim}
            activeOpacity={0.6}
            accessibilityRole={onPressClaim ? 'button' : undefined}
            accessibilityLabel={`${claimTypeLabel(claimType)} — filter by this`}
            hitSlop={6}
            style={[styles.claimChip, { backgroundColor: theme.text }]}>
            <ThemedText style={[styles.chipText, { color: theme.background }]}>
              {claimTypeLabel(claimType)}
            </ThemedText>
          </TouchableOpacity>

          {/*
            Outlined rather than solid, so the two chips don't compete. The
            claim matters more than which of your teams it concerns, and two
            filled blocks side by side read as noise.
          */}
          {tagLabel ? (
            <View style={[styles.teamTag, { borderColor: theme.text }]}>
              <ThemedText style={[styles.chipText, { color: theme.text }]}>{tagLabel}</ThemedText>
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
  claimChip: {
    paddingHorizontal: Spacing.one,
    paddingVertical: 1,
    borderRadius: 0,
  },
  teamTag: {
    paddingHorizontal: Spacing.one,
    // 1px less vertical padding than the solid chip so the 1.5px border
    // doesn't make the outlined one visibly taller than its neighbour.
    paddingVertical: 0,
    borderWidth: 1.5,
    borderRadius: 0,
  },
  chipText: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
});
