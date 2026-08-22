import { router } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ArticleCard } from '@/components/article-card';
import { CaughtUpMarker } from '@/components/caught-up-marker';
import { CollapsibleSection } from '@/components/collapsible-section';
import { DropdownPill, type DropdownOption } from '@/components/dropdown-pill';
import { SettingsButton } from '@/components/settings-button';
import { Logo } from '@/components/logo';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BRIEF_MODE } from '@/constants/flags';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useBrief } from '@/hooks/use-brief';
import { useFeed } from '@/hooks/use-feed';
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
  // `teams` comes from useFeed rather than a second useTeams() here: the
  // feed already holds that list to resolve who you follow, and it's the
  // same list this screen needs. It is wider than the followed teams on
  // purpose — a Michigan follower's pool legitimately contains Michigan
  // State stories, and recognising them as such is what lets the feed tag
  // them honestly and then drop them, rather than tagging them MICHIGAN or
  // showing them bare.
  const {
    articles,
    loading,
    refreshing,
    error,
    refresh,
    teams,
    followedTeams,
    hasFollowedTeams,
    ready,
  } = useFeed();
  const [claimFilter, setClaimFilter] = useState<ClaimFilter>('all');
  // `null` is "all teams" — the default, and deliberately a different
  // value from an explicit empty selection. The two look identical as a
  // list of keys the moment you follow or unfollow anyone, and they mean
  // opposite things: one is "you haven't filtered", the other is "you
  // filtered everything out".
  const [teamSelection, setTeamSelection] = useState<string[] | null>(null);
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

  // One row per followed team, keyed the same league-qualified way
  // favorites are stored — an ESPN id is unique only within a sport, so a
  // bare id would collide the moment a second league ships.
  const teamKeys = useMemo(
    () => followedTeams.map((team) => favoriteKey(team.leagueId, team.id)),
    [followedTeams],
  );

  // Derived rather than reset in an effect: unfollowing the team you were
  // filtered to would otherwise leave a selection referring to someone who
  // is no longer there, and the feed would sit permanently empty with
  // nothing on screen explaining why. Falling back to every team fixes
  // itself in render.
  //
  // The fallback is conditioned on the *stored* selection being non-empty,
  // which is what keeps it from swallowing a deliberate "no teams" — that
  // state is reachable in one tap and reversible in one more, so it is a
  // choice to respect rather than a mistake to correct.
  const selectedKeys = useMemo(() => {
    if (teamSelection === null) return teamKeys;
    const live = teamSelection.filter((key) => teamKeys.includes(key));
    return live.length === 0 && teamSelection.length > 0 ? teamKeys : live;
  }, [teamSelection, teamKeys]);

  const allTeamsSelected = selectedKeys.length === teamKeys.length;

  const selectedTeams = useMemo(
    () => followedTeams.filter((team) => selectedKeys.includes(favoriteKey(team.leagueId, team.id))),
    [followedTeams, selectedKeys],
  );

  // Toggling one team works off the *effective* set rather than the stored
  // one, so the first tap out of the default "all" state removes a team
  // instead of leaving one selected — unchecking a row should uncheck that
  // row and nothing else. Landing back on the full set collapses to `null`,
  // so "all" always has exactly one representation.
  const toggleTeam = (key: string) => {
    const next = selectedKeys.includes(key)
      ? selectedKeys.filter((k) => k !== key)
      : [...selectedKeys, key];
    setTeamSelection(next.length === teamKeys.length ? null : next);
  };

  // Scoped on which team's *pool* surfaced the story, not on the team its
  // headline names. filterToTeams deliberately keeps articles whose
  // mentionedTeam is null — those reach the pool by nickname ("Huskers")
  // and name no team in the text, which is most of the local beat
  // writer's output. Matching on mentionedTeam would silently drop
  // exactly the coverage this app works hardest to keep.
  const teamScoped = useMemo(
    () =>
      allTeamsSelected
        ? classified
        : classified.filter((a) => selectedKeys.includes(favoriteKey(a.leagueId, a.teamId))),
    [classified, allTeamsSelected, selectedKeys],
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
  // The team selection has to be in this condition for a second and harder
  // reason. Reaching the finish line calls markCaughtUp(), which writes
  // one timestamp for the whole feed, not one per team. Sectioning a
  // team-filtered list would let scrolling to the bottom of *one* team's
  // stories advance the cutoff for all of them — silently retiring the
  // other teams' unread news. Whatever else that control does, it must not
  // be able to mark stories read that were never on screen.
  const sectioned = BRIEF_MODE && claimFilter === 'all' && allTeamsSelected && cutoff !== null;

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

  // What the empty states call the current scope. Only names a team when
  // exactly one is selected — "no reported news for Nebraska and two
  // others" is worse than not naming them.
  const scopeLabel = selectedTeams.length === 1 ? selectedTeams[0].shortName : 'your teams';

  // The teams the feed is actually showing, which is the whole followed
  // set until you narrow it. Listing the *selection* rather than the
  // follow list is what makes this line agree with the pill above it.
  const subtitle = !hasFollowedTeams
    ? 'No teams followed yet'
    : selectedTeams.length === 0
      ? 'No teams selected'
      : selectedTeams.map((team) => team.shortName).join(' · ');

  // 0 selected → NO TEAMS; all → ALL TEAMS; one or two → their names; more
  // than that → the first plus a count, which is the only form that can't
  // outgrow the pill. The pill shrinks before the claim filter does, so
  // this degrades rather than pushing its neighbour off screen.
  const teamsPillLabel =
    selectedTeams.length === 0
      ? 'No teams'
      : allTeamsSelected
        ? 'All teams'
        : selectedTeams.length <= 2
          ? selectedTeams.map((team) => team.shortName).join(', ')
          : `${selectedTeams[0].shortName} +${selectedTeams.length - 1}`;

  // "All teams" leads, as a select-all/clear-all shortcut rather than a
  // team of its own — checked only when every team below it is.
  const ALL_TEAMS_KEY = '__all__';
  const teamOptions: DropdownOption[] = [
    { key: ALL_TEAMS_KEY, label: 'All teams', selected: allTeamsSelected },
    ...followedTeams.map((team) => {
      const key = favoriteKey(team.leagueId, team.id);
      return { key, label: team.shortName, selected: selectedKeys.includes(key) };
    }),
  ];

  const claimOptions: DropdownOption[] = CLAIM_FILTER_TABS.map((tab) => ({
    key: tab.key,
    label: tab.label,
    selected: tab.key === claimFilter,
  }));

  // "Filter" while the axis is off, the type's own name once it's on —
  // the tab list's own "All" label would read as a claim type rather than
  // as the absence of one.
  const claimPillLabel =
    claimFilter === 'all'
      ? 'Filter'
      : (CLAIM_FILTER_TABS.find((tab) => tab.key === claimFilter)?.label ?? 'Filter');

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
            <View style={styles.headerSpacer} />
            <SettingsButton />
          </View>
          <ThemedText
            font="mono"
            themeColor="textSecondary"
            style={styles.subtitle}
            numberOfLines={1}>
            {subtitle}
          </ThemedText>

          {/*
            Which teams, then what kind of claim — scope above refinement,
            left to right. Both pills sit in the header rather than in the
            list, so the controls stay put while the feed scrolls under
            them; that is the main thing this redesign changed.

            The teams pill is the one that gives way when the two don't
            fit: its label is user data of unbounded length and already
            degrades to "+N", where the claim filter's four labels are
            fixed and short.
          */}
          {hasFollowedTeams ? (
            <View style={styles.controls}>
              <DropdownPill
                label={teamsPillLabel}
                active={!allTeamsSelected}
                options={teamOptions}
                onSelect={(key) =>
                  key === ALL_TEAMS_KEY
                    ? setTeamSelection(allTeamsSelected ? [] : null)
                    : toggleTeam(key)
                }
                accessibilityLabel="Filter by team"
                style={styles.teamsPill}
              />
              <DropdownPill
                label={claimPillLabel}
                active={claimFilter !== 'all'}
                options={claimOptions}
                onSelect={(key) => setClaimFilter(key as ClaimFilter)}
                align="right"
                panelWidth={190}
                closeOnSelect
                accessibilityLabel="Filter by claim type"
                style={styles.claimPill}
              />
            </View>
          ) : null}
        </View>

        {/*
          The rule the design puts under the controls. The list draws one
          between every pair of cards but none above the first, so without
          this the header floats over the feed with no edge of its own.
        */}
        {hasFollowedTeams ? (
          <View style={[styles.separator, { backgroundColor: theme.text }]} />
        ) : null}

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
                  {/*
                    Clearing the team selection is one tap, so it has to
                    say so — "nothing new for your teams" would blame the
                    news for an empty list the reader just caused.
                  */}
                  {selectedTeams.length === 0
                    ? 'No teams selected. Pick one from the teams filter above.'
                    : claimFilter === 'rumor'
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
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
  },
  // Shrinks and truncates before its neighbour does.
  teamsPill: {
    flexShrink: 1,
    minWidth: 0,
  },
  claimPill: {
    flexShrink: 0,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  headerSpacer: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 23,
    lineHeight: 28,
    fontWeight: '700',
    letterSpacing: 0.2,
    // iOS measures a tracked run without its trailing letter-space and
    // clips whatever overhangs, which sliced the final S off NOFRILLS.
    // Tracking is already at the 0.2 the design system allows, so the
    // remaining fix is to give the glyph somewhere to overhang into.
    //
    // Sized against Newsreader Bold, not the fallback: 4pt was enough
    // while the system sans was still showing and clipped again the
    // moment the real face loaded. A flex spacer follows this text, so
    // over-reserving here costs no layout.
    paddingRight: Spacing.three,
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
    // Clears the floating tab bar rather than sitting under it — see
    // BottomTabInset. The collapsed section headers are the last thing in
    // this list, so without it the bottom one is permanently half-covered.
    paddingBottom: BottomTabInset,
  },
  separator: {
    height: 1.5,
  },
});
