import { Image } from 'expo-image';
import { memo, useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { TRUST_LABELS } from '@/constants/flags';
import { claimBadgeColors, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ClaimType, claimTypeLabel } from '@/lib/claim-type';
import { Article } from '@/lib/feeds';
import { formatRelativeTime } from '@/lib/format';
import { tierLabel } from '@/lib/source-tier';

function ArticleCardInner({
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
   * Whether the reader has opened this story. Where tagLabel says what the
   * story is about, this says what the reader has *done* with it — a third
   * vocabulary, and deliberately a colourless one. The palette keeps its
   * two accents apart on purpose (see the note in theme.ts: brick red is
   * links and the outbound CTA, teal is a control actively narrowing
   * something), so a third meaning gets no hue at all: the headline drops
   * to the secondary ink and the meta line gains a word.
   */
  read,
  duplicates,
  onOpenDuplicate,
  /**
   * What kind of claim the headline makes. Passed in rather than computed
   * here because the screen already classified the list to filter it, and
   * classifying is a few hundred regex tests per article.
   */
  claimType,
  onPressClaim,
}: {
  article: Article;
  onPress: (article: Article) => void;
  tagLabel?: string;
  read?: boolean;
  claimType: ClaimType;
  onPressClaim?: (type: ClaimType) => void;
  /**
   * Other outlets that ran the same story. Shown as a count that expands,
   * rather than as more cards — the whole point of grouping them is that
   * one story should take up one slot.
   */
  duplicates?: Article[];
  onOpenDuplicate?: (article: Article) => void;
}) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  const duplicateCount = duplicates?.length ?? 0;
  const badge = claimBadgeColors(claimType, theme);
  const metaLine = [
    article.publishedAt ? formatRelativeTime(article.publishedAt) : '',
    TRUST_LABELS ? tierLabel(article.tier) : '',
    read ? 'Read' : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <TouchableOpacity style={styles.container} onPress={() => onPress(article)} activeOpacity={0.7}>
      {article.imageUrl ? (
        <Image
          source={{ uri: article.imageUrl }}
          style={styles.thumbnail}
          contentFit="cover"
          // Keyed so a recycled cell swaps its bitmap instead of showing the
          // previous row's thumbnail for a frame, and with no fade: a fling
          // mounts dozens of rows at once, and dozens of thumbnails fading in
          // on their own clocks reads as flicker rather than as polish.
          recyclingKey={article.link}
          transition={0}
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

            Coloured per claim type, so the three are told apart at a
            glance rather than only by reading the word. The hues live in
            claimBadgeColors beside the palette, not here: the article
            screen draws the same badge and the two must not drift.

            Hidden while TRUST_LABELS is off (constants/flags.ts). The prop
            stays wired so flipping the flag brings it back unchanged.
          */}
          {TRUST_LABELS ? (
            <TouchableOpacity
              onPress={() => onPressClaim?.(claimType)}
              disabled={!onPressClaim}
              activeOpacity={0.6}
              accessibilityRole={onPressClaim ? 'button' : undefined}
              accessibilityLabel={`${claimTypeLabel(claimType)} — filter by this`}
              hitSlop={6}
              style={[styles.claimChip, { backgroundColor: badge.background }]}>
              <ThemedText font="mono" style={[styles.chipText, { color: badge.text }]}>
                {claimTypeLabel(claimType)}
              </ThemedText>
            </TouchableOpacity>
          ) : null}

          {/*
            Outlined rather than solid, so the two chips don't compete. The
            claim matters more than which of your teams it concerns, and two
            filled blocks side by side read as noise.
          */}
          {tagLabel ? (
            <View style={[styles.teamTag, { borderColor: theme.text }]}>
              <ThemedText font="mono" style={[styles.chipText, { color: theme.text }]}>
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
        <ThemedText
          numberOfLines={3}
          themeColor={read ? 'textSecondary' : undefined}
          style={styles.title}>
          {article.title}
        </ThemedText>
        {/*
          Joined from whichever parts are present, because any of them
          can be missing: formatRelativeTime returns '' for a null date,
          the tier is off with TRUST_LABELS, and Read only applies once
          opened. Fixed separators rendered a leading bullet with nothing
          before it — a tester caught it on Eleven Warriors, whose dates
          parsed to null until parsePubDate learned its format, and any
          item with no <pubDate> at all still has no date. With all three
          absent, the line is left out rather than drawn empty.

          Read is a word here rather than a chip of its own: the chips
          above are judgments about the story, and a third block would
          read as a third one. The style already uppercases.
        */}
        {metaLine ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.meta}>
            {metaLine}
          </ThemedText>
        ) : null}

        {/*
          On its own line rather than appended to the meta above: that line
          is 10.5pt in a column already narrowed by an 88px thumbnail, and
          "2H AGO · NEWSROOM · +5 OTHER SOURCES" runs past the edge.
        */}
        {duplicateCount > 0 ? (
          <TouchableOpacity
            onPress={() => setExpanded((v) => !v)}
            activeOpacity={0.6}
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            hitSlop={6}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.meta}>
              {expanded ? '▾' : '▸'} {duplicateCount} other{' '}
              {duplicateCount === 1 ? 'source' : 'sources'}
            </ThemedText>
          </TouchableOpacity>
        ) : null}

        {/*
          The rows inside are a list of who else ran the story, not cards —
          so they carry no read mark even when one has been opened.
        */}
        {expanded
          ? duplicates?.map((duplicate) => (
              <TouchableOpacity
                key={duplicate.link}
                onPress={() => onOpenDuplicate?.(duplicate)}
                disabled={!onOpenDuplicate}
                activeOpacity={0.6}
                accessibilityRole={onOpenDuplicate ? 'button' : undefined}
                style={styles.duplicateRow}>
                <ThemedText type="small" themeColor="textSecondary" style={styles.meta}>
                  {duplicate.source}
                </ThemedText>
              </TouchableOpacity>
            ))
          : null}
      </View>
    </TouchableOpacity>
  );
}

/**
 * Memoized because the home feed re-renders the whole screen on every
 * state tick — the live ticker's 30-second check, a read mark landing —
 * and without this every mounted card re-rendered with it, including
 * mid-fling. The callbacks are stable at the call sites (useCallback in
 * the feed, and the card passes its own article to onPress so nobody
 * needs a per-row closure), which is what lets the shallow compare hold.
 */
export const ArticleCard = memo(ArticleCardInner);

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    gap: 14,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  thumbnail: {
    width: 88,
    height: 66,
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
    gap: 3,
    justifyContent: 'center',
  },
  // The one piece of prose in the row, so the one piece set in the serif.
  title: {
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '600',
  },
  meta: {
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    fontSize: 10.5,
    lineHeight: 15,
  },
  duplicateRow: {
    paddingLeft: Spacing.two,
    paddingVertical: 1,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  metaFlex: {
    flex: 1,
  },
  claimChip: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 0,
  },
  teamTag: {
    paddingHorizontal: 5,
    // 1px less vertical padding than the solid chip so the 1.4px border
    // doesn't make the outlined one visibly taller than its neighbour.
    paddingVertical: 0,
    borderWidth: 1.4,
    borderRadius: 0,
  },
  chipText: {
    fontSize: 9,
    lineHeight: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
});
