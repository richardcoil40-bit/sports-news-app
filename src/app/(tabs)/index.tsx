import { router } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ArticleCard } from '@/components/article-card';
import { CaughtUpMarker } from '@/components/caught-up-marker';
import { ChipRow } from '@/components/chip-row';
import { CollapsibleSection } from '@/components/collapsible-section';
import { Logo } from '@/components/logo';
import { FilterBar } from '@/components/filter-bar';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BRIEF_MODE } from '@/constants/flags';
import { Spacing } from '@/constants/theme';
import { useBrief } from '@/hooks/use-brief';
import { useFeed } from '@/hooks/use-feed';
import { useTeams } from '@/hooks/use-teams';
import { useTheme } from '@/hooks/use-theme';
import {
  ClaimFilter,
  ClaimType,
  CLAIM_FILTER_TABS,
  filterByClaimType,
  withClaimTypes,
} from '@/lib/claim-type';
import { caughtUpMessage, splitBrief } from '@/lib/brief';
import { clusterArticles, leadsWithDuplicates } from '@/lib/cluster';
import { favoriteKey } from '@/lib/favorite-keys';
import { Article } from '@/lib/feeds';
import { balanceBySource } from '@/lib/source-balance';
import { filterToTeams, withTeamMentions } from '@/lib/team-mentions';

/**
 * The home screen is a feed of the teams you follow, not a directory of
 * every team in the conference. That's the whole premise of the app: if
 * you wanted everything, national coverage already exists everywhere.
 */
export default function FeedScreen() {
  const theme = useTheme();
  const { articles, loading, refreshing, error, refresh, followedTeams, hasFollowedTeams, ready } =
    useFeed();
  // The whole league, not just followed teams. A Michigan follower's pool
  // legitimately contains Michigan State stories, and recognising them as
  // such is the point: it's what lets the feed tag them honestly and then
  // drop them, rather than tagging them MICHIGAN or showing them bare.
  const { teams } = useTeams();
  const [claimFilter, setClaimFilter] = useState<ClaimFilter>('all');
  const [teamFilter, setTeamFilter] = useState<string | null>(null);
  const { ready: briefReady, cutoff, periodLabel, reachedEnd } = useBrief();
  // "Did the reader actually get to the bottom?" — two ways for that to be
  // true, and both are needed. Requiring a scroll alone means a brief that
  // fits on one screen can never be marked read, so it would greet the
  // reader with the same stories forever.
  const hasScrolled = useRef(false);
  const contentHeight = useRef(0);
  const viewportHeight = useRef(0);
  const briefWasSeen = () =>
    hasScrolled.current ||
    (viewportHeight.current > 0 && contentHeight.current <= viewportHeight.current);

  // Classified and tagged once, then filtered — every card needs both for
  // its badges whether or not a filter is active, so this is one pass
  // instead of one per consumer.
  //
  // Followed teams are passed twice, for the two halves of one idea: as the
  // tie-breaker for a story naming several teams, then as the set the feed
  // is narrowed to. A pool is built from a followed team's *sources*, and a
  // team site previewing next week's opponent is still that site's own
  // post — so without this, someone else's team shows up in your feed.
  const classified = useMemo(
    () =>
      filterToTeams(withTeamMentions(withClaimTypes(articles), teams, followedTeams), followedTeams),
    [articles, teams, followedTeams],
  );

  // One chip per followed team, keyed the same league-qualified way
  // favorites are stored — an ESPN id is unique only within a sport, so a
  // bare id would collide the moment a second league ships.
  const teamChips = useMemo(
    () =>
      followedTeams.map((team) => ({
        key: favoriteKey(team.leagueId, team.id),
        label: team.shortName,
      })),
    [followedTeams],
  );

  // Derived rather than reset in an effect: unfollowing the team you were
  // filtered to would otherwise leave a chip selected that no longer
  // exists, and the feed would sit permanently empty with nothing on
  // screen explaining why. Falling back to "all" fixes itself in render.
  const activeTeam = teamChips.some((chip) => chip.key === teamFilter) ? teamFilter : null;

  // Scoped on which team's *pool* surfaced the story, not on the team its
  // headline names. filterToTeams deliberately keeps articles whose
  // mentionedTeam is null — those reach the pool by nickname ("Huskers")
  // and name no team in the text, which is most of the local beat
  // writer's output. Matching on mentionedTeam would silently drop
  // exactly the coverage this app works hardest to keep.
  const teamScoped = useMemo(
    () =>
      activeTeam === null
        ? classified
        : classified.filter((a) => favoriteKey(a.leagueId, a.teamId) === activeTeam),
    [classified, activeTeam],
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
        leadsWithDuplicates(clusterArticles(filterByClaimType(teamScoped, claimFilter))),
      ),
    [teamScoped, claimFilter],
  );

  // Only when nothing is filtered. Catching up and browsing are different
  // intents: filtering to RUMOR and still seeing a "you're caught up" line
  // above a collapsed section holding everything is nonsense, so an active
  // filter renders one plain list instead.
  //
  // The team chips have to be in this condition for a second and harder
  // reason. Reaching the finish line calls markCaughtUp(), which writes
  // one timestamp for the whole feed, not one per team. Sectioning a
  // team-filtered list would let scrolling to the bottom of *one* team's
  // stories advance the cutoff for all of them — silently retiring the
  // other teams' unread news. Whatever else this row does, it must not be
  // able to mark stories read that were never on screen.
  const sectioned = BRIEF_MODE && claimFilter === 'all' && activeTeam === null && cutoff !== null;

  const sections = useMemo(
    () => (cutoff ? splitBrief(visibleArticles, cutoff) : null),
    [visibleArticles, cutoff],
  );

  // Widened past Article because the detail screen shows the same claim
  // chip the row does, and re-classifying there would repeat a few hundred
  // regex tests for a story that was already classified to get here. It is
  // also handed the duplicates a cluster absorbed, which carry neither a
  // classification nor a team attribution of their own — hence optional,
  // and the chip is simply omitted for them.
  const openArticle = (article: Article & { claimType?: ClaimType }) => {
    router.push({
      pathname: '/article',
      params: {
        title: article.title,
        link: article.link,
        source: article.source,
        publishedAt: article.publishedAt ?? '',
        description: article.description,
        imageUrl: article.imageUrl ?? '',
        claimType: article.claimType ?? '',
      },
    });
  };

  const renderCard = (item: (typeof visibleArticles)[number]) => (
    <ArticleCard
      article={item}
      onPress={() => openArticle(item)}
      // The team the headline actually names, which is not always the
      // followed team whose pool surfaced it. Omitted when no team is
      // named rather than guessed at.
      tagLabel={item.mentionedTeam?.shortName}
      claimType={item.claimType}
      onPressClaim={setClaimFilter}
      duplicates={item.duplicates}
      onOpenDuplicate={openArticle}
    />
  );

  // The collapsed sections render their rows themselves rather than
  // through a list, so they have to draw the rule the FlatList's
  // separator draws for the brief above — without one under the section
  // header, whose own bottom border already closes that edge.
  const renderSectionCard = (item: (typeof visibleArticles)[number], index: number) => (
    <View key={item.link}>
      {index > 0 ? <View style={[styles.separator, { backgroundColor: theme.text }]} /> : null}
      {renderCard(item)}
    </View>
  );

  // What the empty states and the header line call the current scope.
  const scopeLabel = teamChips.find((chip) => chip.key === activeTeam)?.label ?? 'your teams';

  // The chip row scrolls away with the list header, so this line is the
  // only always-visible statement of what you're looking at — which is
  // why it narrows with the filter rather than always listing everyone.
  const subtitle = !hasFollowedTeams
    ? 'No teams followed yet'
    : activeTeam
      ? `${scopeLabel} only`
      : followedTeams.map((team) => team.shortName).join(' · ');

  return (
    <ThemedView style={styles.flex}>
      <SafeAreaView style={styles.flex} edges={['top']}>
        <View style={styles.header}>
          {/*
            The wordmark rather than a screen title: the tab bar below
            already says which screen this is, and the subtitle line says
            whose news it holds.
          */}
          <View style={styles.headerRow}>
            <Logo
              size={16}
              onPress={() => router.push('/settings')}
              accessibilityLabel="Settings"
            />
            <ThemedText type="title" style={styles.headerTitle}>
              NOFRILLS
            </ThemedText>
          </View>
          <ThemedText
            font="mono"
            themeColor="textSecondary"
            style={styles.subtitle}
            numberOfLines={1}>
            {subtitle}
          </ThemedText>
        </View>

        {!ready || loading || (BRIEF_MODE && !briefReady) ? (
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
              onPress={() => router.push('/settings/favorites')}>
              <ThemedText font="mono" style={[styles.buttonText, { color: theme.background }]}>
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
            data={sectioned && sections ? sections.brief : visibleArticles}
            keyExtractor={(item) => item.link}
            renderItem={({ item }) => renderCard(item)}
            ItemSeparatorComponent={() => (
              <View style={[styles.separator, { backgroundColor: theme.text }]} />
            )}
            ListHeaderComponent={
              <View>
                {/*
                  Which teams, then what kind of claim — scope above
                  refinement. Hidden below two followed teams, where the
                  row would be an "All" chip beside the only team there
                  is, and the header line already names them.
                */}
                {teamChips.length > 1 ? (
                  <ChipRow
                    items={teamChips}
                    active={activeTeam}
                    onChange={setTeamFilter}
                    allLabel="All teams"
                  />
                ) : null}
                <FilterBar tabs={CLAIM_FILTER_TABS} active={claimFilter} onChange={setClaimFilter} />
              </View>
            }
            ListFooterComponent={
              sectioned && sections ? (
                <View>
                  <CaughtUpMarker message={caughtUpMessage(sections, periodLabel)} />
                  <CollapsibleSection label="rumors & takes" count={sections.chatter.length}>
                    {sections.chatter.map(renderSectionCard)}
                  </CollapsibleSection>
                  <CollapsibleSection label="earlier" count={sections.earlier.length}>
                    {sections.earlier.map(renderSectionCard)}
                  </CollapsibleSection>
                </View>
              ) : null
            }
            // A brief longer than the viewport reaches its "end" during
            // initial layout, so onEndReached alone would retire stories
            // nobody scrolled to. briefWasSeen() distinguishes that from a
            // brief that simply fit on screen, which genuinely was read.
            onLayout={(e) => {
              viewportHeight.current = e.nativeEvent.layout.height;
            }}
            onContentSizeChange={(_w, h) => {
              contentHeight.current = h;
            }}
            onScroll={(e) => {
              if (e.nativeEvent.contentOffset.y > 8) hasScrolled.current = true;
            }}
            scrollEventThrottle={200}
            onEndReached={sectioned ? () => reachedEnd(briefWasSeen()) : undefined}
            onEndReachedThreshold={0.1}
            // Suppressed in sectioned mode: the caught-up marker in the
            // footer already says there's nothing new, and this copy is
            // written for the whole feed — it would claim the feed is empty
            // while Earlier sits one tap below holding two dozen stories.
            ListEmptyComponent={
              sectioned ? null : (
              <View style={styles.centered}>
                <ThemedText themeColor="textSecondary" style={styles.centeredText}>
                  {claimFilter === 'rumor'
                    ? `No rumors about ${scopeLabel} right now.`
                    : claimFilter === 'take'
                      ? `No takes about ${scopeLabel} right now.`
                      : claimFilter === 'reported'
                        ? `No reported news for ${scopeLabel} right now.`
                        : `Nothing new for ${scopeLabel} right now.`}
                </ThemedText>
              </View>
              )
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
    paddingHorizontal: 20,
    paddingTop: Spacing.two,
    paddingBottom: 14,
    gap: Spacing.one,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  headerTitle: {
    fontSize: 23,
    lineHeight: 28,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  subtitle: {
    textTransform: 'uppercase',
    letterSpacing: 0.6,
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
    letterSpacing: 0.6,
    fontSize: 12,
    fontWeight: '700',
  },
  listContent: {
    flexGrow: 1,
    paddingBottom: Spacing.five,
  },
  separator: {
    height: 1.5,
  },
});
