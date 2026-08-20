import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Logo } from '@/components/logo';
import { TabBar } from '@/components/tab-bar';
import { NewsTab } from '@/components/team-tabs/news-tab';
import { PlayersTab } from '@/components/team-tabs/players-tab';
import { RecruitingTab } from '@/components/team-tabs/recruiting-tab';
import { ScheduleTab } from '@/components/team-tabs/schedule-tab';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAsync } from '@/hooks/use-async';
import { useTeams } from '@/hooks/use-teams';
import { useTheme } from '@/hooks/use-theme';
import { Article } from '@/lib/feeds';
import { RankedPlayer, rankNotablePlayers } from '@/lib/notable-players';
import {
  ClaimFilter,
  ClaimType,
  filterByClaimType,
  withClaimTypes,
} from '@/lib/claim-type';
import { filterRecruitingArticles } from '@/lib/recruiting';
import { Player, fetchTeamRoster } from '@/lib/roster';
import { fetchGameOdds, fetchTeamSchedule, ScheduledGame } from '@/lib/schedule';
import { clusterArticles, leadsWithDuplicates } from '@/lib/cluster';
import { balanceBySource } from '@/lib/source-balance';
import { withTeamMentions } from '@/lib/team-mentions';
import { fetchTeamColor } from '@/lib/team-color';
import { StatLeader, fetchTeamStatLeaders } from '@/lib/team-leaders';
import { fetchTeamNewsPool } from '@/lib/team-news-pool';

type TabKey = 'news' | 'schedule' | 'players' | 'recruiting';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'news', label: 'News' },
  { key: 'schedule', label: 'Schedule' },
  { key: 'players', label: 'Players' },
  { key: 'recruiting', label: 'Recruiting' },
];

/** The roster and its stat leaders load together, so they're one async unit. */
interface RosterData {
  players: Player[];
  leaders: StatLeader[];
}

export default function TeamScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{
    id: string;
    name: string;
    shortName: string;
    logoUrl: string;
  }>();

  const [tab, setTab] = useState<TabKey>('news');
  // The whole league: this team's pool carries stories about its
  // opponents and neighbours, and those should be tagged as such.
  const { teams } = useTeams();
  const [claimFilter, setClaimFilter] = useState<ClaimFilter>('all');
  const [teamColor, setTeamColor] = useState<string | null>(null);

  const news = useAsync<Article[]>(async () => {
    const pool = await fetchTeamNewsPool(params.id, params.shortName || params.name);
    return pool.articles;
  });

  const schedule = useAsync<ScheduledGame[]>(async (publish) => {
    const games = await fetchTeamSchedule(params.id);
    publish(games);

    // Odds for just the next few upcoming games — fetching every game
    // on the schedule (a dozen-plus separate requests) was overkill
    // and most of those games don't have a line posted yet anyway.
    const upcoming = games.filter((g) => !g.completed).slice(0, 5);
    const oddsByGameId = new Map(
      await Promise.all(
        upcoming.map(async (game) => [game.id, await fetchGameOdds(game.id).catch(() => null)] as const),
      ),
    );
    return games.map((g) => (oddsByGameId.has(g.id) ? { ...g, odds: oddsByGameId.get(g.id)! } : g));
  });

  const roster = useAsync<RosterData>(async () => {
    const [players, leaders] = await Promise.all([
      fetchTeamRoster(params.id),
      fetchTeamStatLeaders(params.id),
    ]);
    return { players, leaders };
  });

  useEffect(() => {
    let cancelled = false;
    fetchTeamColor(params.id).then((color) => {
      if (!cancelled) setTeamColor(color);
    });
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  // Each tab's data loads only the first time that tab is opened, not all
  // four up front — the schedule tab in particular fires one odds request
  // per upcoming game, and doing that (plus news plus roster) all at once
  // on mount was slow and stole bandwidth from whatever screen you tapped
  // into next (e.g. a player's news). load() is a no-op once a tab's data
  // has arrived, so re-running this on every tab change is free.
  useEffect(() => {
    if (tab === 'news' || tab === 'recruiting') news.load();
    if (tab === 'schedule') schedule.load();
    // The players tab ranks by article mentions, so it needs the news pool too.
    if (tab === 'players') {
      roster.load();
      news.load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, params.id, params.shortName, params.name]);

  // Classified and tagged once here, so the News and Recruiting tabs
  // share one pass and every card has its badges whether or not a filter
  // is active. Tagged against the whole league because this team's pool
  // carries stories about its opponents and neighbours too.
  const classifiedNews = useMemo(
    () => withTeamMentions(withClaimTypes(news.data ?? []), teams),
    [news.data, teams],
  );

  // Filter, cluster, balance — see the note on the home feed for why the
  // order matters.
  const visibleNews = useMemo(
    () =>
      balanceBySource(
        leadsWithDuplicates(clusterArticles(filterByClaimType(classifiedNews, claimFilter))),
      ),
    [classifiedNews, claimFilter],
  );

  const recruitingArticles = useMemo(
    () => filterRecruitingArticles(classifiedNews),
    [classifiedNews],
  );

  const notablePlayers = useMemo(
    () =>
      roster.data
        ? rankNotablePlayers(roster.data.players, news.data ?? [], roster.data.leaders, 10)
        : [],
    [roster.data, news.data],
  );

  const openArticle = (article: Article & { claimType?: ClaimType }) => {
    router.push({
      pathname: '/article',
      params: {
        title: article.title,
        link: article.link,
        source: article.author ? `${article.source} · ${article.author}` : article.source,
        publishedAt: article.publishedAt ?? '',
        description: article.description,
        imageUrl: article.imageUrl ?? '',
        claimType: article.claimType ?? '',
      },
    });
  };

  const openPlayer = ({ player, matchesSurname }: RankedPlayer) => {
    router.push({
      pathname: '/player/[id]',
      params: {
        id: player.id,
        fullName: player.fullName,
        // firstName as well as fullName because ESPN's fullName can carry a
        // middle name or suffix no article writes, and both screens have to
        // match on the same forms to agree on the same articles.
        firstName: player.firstName,
        lastName: player.lastName,
        // The ranking decided whether this surname is specific enough to
        // match on its own (it isn't, when a teammate shares it). Passing
        // the decision along is what keeps the count on the card and the
        // list on the screen describing the same articles.
        surnameMatch: matchesSurname ? '1' : '0',
        jersey: player.jersey ?? '',
        position: player.position ?? '',
        headshotUrl: player.headshotUrl ?? '',
        teamId: params.id,
        teamName: params.name,
        teamShortName: params.shortName,
      },
    });
  };

  return (
    <ThemedView style={styles.flex}>
      <Stack.Screen
        options={{
          title: params.shortName || params.name,
          headerBackTitle: 'Teams',
          headerRight: () => <Logo size={18} />,
        }}
      />
      <SafeAreaView style={styles.flex} edges={['bottom']}>
        <View style={[styles.header, { backgroundColor: teamColor ?? theme.backgroundElement }]}>
          {params.logoUrl ? (
            <View style={styles.logoChip}>
              <Image source={{ uri: params.logoUrl }} style={styles.logo} contentFit="contain" />
            </View>
          ) : null}
          <ThemedText
            type="title"
            style={[styles.teamName, { color: teamColor ? '#FFFFFF' : theme.text }]}>
            {params.name}
          </ThemedText>
        </View>

        <TabBar tabs={TABS} active={tab} onChange={setTab} />

        {tab === 'news' ? (
          <NewsTab
            articles={visibleNews}
            loading={news.data === null && !news.error}
            error={news.error}
            claimFilter={claimFilter}
            onChangeClaim={setClaimFilter}
            onOpenArticle={openArticle}
            accentColor={teamColor}
          />
        ) : null}

        {tab === 'schedule' ? (
          <ScheduleTab
            games={schedule.data}
            loading={schedule.data === null && !schedule.error}
            error={schedule.error}
            accentColor={teamColor}
          />
        ) : null}

        {tab === 'players' ? (
          <PlayersTab
            players={notablePlayers}
            loading={(roster.data === null || news.data === null) && !roster.error && !news.error}
            error={roster.error}
            onOpenPlayer={openPlayer}
            accentColor={teamColor}
          />
        ) : null}

        {tab === 'recruiting' ? (
          <RecruitingTab
            articles={recruitingArticles}
            loading={news.data === null && !news.error}
            error={news.error}
            onOpenArticle={openArticle}
            accentColor={teamColor}
          />
        ) : null}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  header: {
    alignItems: 'center',
    gap: Spacing.two,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.three,
    paddingHorizontal: Spacing.three,
  },
  logoChip: {
    width: 56,
    height: 56,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    width: 44,
    height: 44,
  },
  teamName: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: 0.2,
  },
});
