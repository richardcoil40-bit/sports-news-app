import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { ReactNode, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AccentRow } from '@/components/accent-row';
import { ArticleCard } from '@/components/article-card';
import { Logo } from '@/components/logo';
import { PlayerRow } from '@/components/player-row';
import { ScheduleRow } from '@/components/schedule-row';
import { TabBar } from '@/components/tab-bar';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { Article } from '@/lib/feeds';
import { filterByNotableJournalists } from '@/lib/journalists';
import { RankedPlayer, rankNotablePlayers } from '@/lib/notable-players';
import { filterRecruitingArticles } from '@/lib/recruiting';
import { Player, fetchTeamRoster } from '@/lib/roster';
import { fetchGameOdds, fetchTeamSchedule, ScheduledGame } from '@/lib/schedule';
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

export default function TeamScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{
    id: string;
    name: string;
    shortName: string;
    logoUrl: string;
  }>();

  const [tab, setTab] = useState<TabKey>('news');
  const [journalistsOnly, setJournalistsOnly] = useState(false);
  const [trustedOnly, setTrustedOnly] = useState(false);
  const [teamColor, setTeamColor] = useState<string | null>(null);

  const [newsArticles, setNewsArticles] = useState<Article[] | null>(null);
  const [newsLoading, setNewsLoading] = useState(false);
  const [newsError, setNewsError] = useState(false);

  const [schedule, setSchedule] = useState<ScheduledGame[] | null>(null);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleError, setScheduleError] = useState(false);

  const [roster, setRoster] = useState<Player[] | null>(null);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterError, setRosterError] = useState(false);
  const [statLeaders, setStatLeaders] = useState<StatLeader[]>([]);

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
  // into next (e.g. a player's news).
  useEffect(() => {
    let cancelled = false;

    async function loadNews() {
      if (newsArticles !== null || newsLoading) return;
      setNewsLoading(true);
      setNewsError(false);
      try {
        const pool = await fetchTeamNewsPool(params.id, params.shortName || params.name);
        if (!cancelled) setNewsArticles(pool.articles);
      } catch {
        if (!cancelled) setNewsError(true);
      } finally {
        if (!cancelled) setNewsLoading(false);
      }
    }

    async function loadSchedule() {
      if (schedule !== null || scheduleLoading) return;
      setScheduleLoading(true);
      setScheduleError(false);
      try {
        const games = await fetchTeamSchedule(params.id);
        if (cancelled) return;
        setSchedule(games);

        // Odds for just the next few upcoming games — fetching every game
        // on the schedule (a dozen-plus separate requests) was overkill
        // and most of those games don't have a line posted yet anyway.
        const upcoming = games.filter((g) => !g.completed).slice(0, 5);
        const oddsByGameId = new Map(
          await Promise.all(
            upcoming.map(async (game) => [game.id, await fetchGameOdds(game.id).catch(() => null)] as const),
          ),
        );
        if (!cancelled) {
          setSchedule(games.map((g) => (oddsByGameId.has(g.id) ? { ...g, odds: oddsByGameId.get(g.id)! } : g)));
        }
      } catch {
        if (!cancelled) setScheduleError(true);
      } finally {
        if (!cancelled) setScheduleLoading(false);
      }
    }

    async function loadRoster() {
      if (roster !== null || rosterLoading) return;
      setRosterLoading(true);
      setRosterError(false);
      try {
        const [players, leaders] = await Promise.all([
          fetchTeamRoster(params.id),
          fetchTeamStatLeaders(params.id),
        ]);
        if (!cancelled) {
          setRoster(players);
          setStatLeaders(leaders);
        }
      } catch {
        if (!cancelled) setRosterError(true);
      } finally {
        if (!cancelled) setRosterLoading(false);
      }
    }

    if (tab === 'news' || tab === 'recruiting') loadNews();
    if (tab === 'schedule') loadSchedule();
    // The players tab ranks by article mentions, so it needs the news pool too.
    if (tab === 'players') {
      loadRoster();
      loadNews();
    }

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, params.id, params.shortName, params.name]);

  const visibleNews = useMemo(() => {
    if (!newsArticles) return [];
    let result = newsArticles;
    // Tier 1–2 = professional newsrooms and credible independents.
    if (trustedOnly) result = result.filter((a) => a.tier <= 2);
    if (journalistsOnly) result = filterByNotableJournalists(result);
    return result;
  }, [newsArticles, journalistsOnly, trustedOnly]);

  const recruitingArticles = useMemo(
    () => (newsArticles ? filterRecruitingArticles(newsArticles) : []),
    [newsArticles],
  );

  const notablePlayers = useMemo(
    () => (roster ? rankNotablePlayers(roster, newsArticles ?? [], statLeaders, 10) : []),
    [roster, newsArticles, statLeaders],
  );

  const openArticle = (article: Article) => {
    router.push({
      pathname: '/article',
      params: {
        title: article.title,
        link: article.link,
        source: article.author ? `${article.source} · ${article.author}` : article.source,
        publishedAt: article.publishedAt ?? '',
        description: article.description,
        imageUrl: article.imageUrl ?? '',
      },
    });
  };

  const openPlayer = (player: Player) => {
    router.push({
      pathname: '/player/[id]',
      params: {
        id: player.id,
        fullName: player.fullName,
        lastName: player.lastName,
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
            loading={newsArticles === null && !newsError}
            error={newsError}
            journalistsOnly={journalistsOnly}
            onToggleJournalists={() => setJournalistsOnly((v) => !v)}
            trustedOnly={trustedOnly}
            onToggleTrusted={() => setTrustedOnly((v) => !v)}
            onOpenArticle={openArticle}
            accentColor={teamColor}
          />
        ) : null}

        {tab === 'schedule' ? (
          <ScheduleTab
            games={schedule}
            loading={schedule === null && !scheduleError}
            error={scheduleError}
            accentColor={teamColor}
          />
        ) : null}

        {tab === 'players' ? (
          <PlayersTab
            players={notablePlayers}
            loading={(roster === null || newsArticles === null) && !rosterError && !newsError}
            error={rosterError}
            onOpenPlayer={openPlayer}
            accentColor={teamColor}
          />
        ) : null}

        {tab === 'recruiting' ? (
          <RecruitingTab
            articles={recruitingArticles}
            loading={newsArticles === null && !newsError}
            error={newsError}
            onOpenArticle={openArticle}
            accentColor={teamColor}
          />
        ) : null}
      </SafeAreaView>
    </ThemedView>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <View style={styles.centered}>{children}</View>;
}

function NewsTab({
  articles,
  loading,
  error,
  journalistsOnly,
  onToggleJournalists,
  trustedOnly,
  onToggleTrusted,
  onOpenArticle,
  accentColor,
}: {
  articles: Article[];
  loading: boolean;
  error: boolean;
  journalistsOnly: boolean;
  onToggleJournalists: () => void;
  trustedOnly: boolean;
  onToggleTrusted: () => void;
  onOpenArticle: (a: Article) => void;
  accentColor: string | null;
}) {
  const theme = useTheme();

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
          <ArticleCard article={item} onPress={() => onOpenArticle(item)} />
        </AccentRow>
      )}
      ItemSeparatorComponent={() => (
        <View style={[styles.separator, { backgroundColor: theme.text }]} />
      )}
      ListHeaderComponent={
        <View style={styles.chipRow}>
          <TouchableFilterChip label="Trusted sources" active={trustedOnly} onPress={onToggleTrusted} />
          <TouchableFilterChip label="Notable bylines" active={journalistsOnly} onPress={onToggleJournalists} />
        </View>
      }
      ListEmptyComponent={
        <Centered>
          <ThemedText themeColor="textSecondary" style={styles.centeredText}>
            {error
              ? "Couldn't load headlines right now. Try again later."
              : journalistsOnly || trustedOnly
                ? 'Nothing matches those filters right now.'
                : 'No recent headlines found for this team.'}
          </ThemedText>
        </Centered>
      }
      contentContainerStyle={styles.listContent}
    />
  );
}

function RecruitingTab({
  articles,
  loading,
  error,
  onOpenArticle,
  accentColor,
}: {
  articles: Article[];
  loading: boolean;
  error: boolean;
  onOpenArticle: (a: Article) => void;
  accentColor: string | null;
}) {
  const theme = useTheme();

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
          <ArticleCard article={item} onPress={() => onOpenArticle(item)} />
        </AccentRow>
      )}
      ItemSeparatorComponent={() => (
        <View style={[styles.separator, { backgroundColor: theme.text }]} />
      )}
      ListEmptyComponent={
        <Centered>
          <ThemedText themeColor="textSecondary" style={styles.centeredText}>
            {error
              ? "Couldn't load recruiting news right now. Try again later."
              : 'No recruiting news found for this team right now.'}
          </ThemedText>
        </Centered>
      }
      contentContainerStyle={styles.listContent}
    />
  );
}

function ScheduleTab({
  games,
  loading,
  error,
  accentColor,
}: {
  games: ScheduledGame[] | null;
  loading: boolean;
  error: boolean;
  accentColor: string | null;
}) {
  const theme = useTheme();

  if (loading && !games) {
    return (
      <Centered>
        <ActivityIndicator />
      </Centered>
    );
  }

  return (
    <FlatList
      data={games ?? []}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <AccentRow color={accentColor}>
          <ScheduleRow game={item} />
        </AccentRow>
      )}
      ItemSeparatorComponent={() => (
        <View style={[styles.separator, { backgroundColor: theme.text }]} />
      )}
      ListEmptyComponent={
        <Centered>
          <ThemedText themeColor="textSecondary" style={styles.centeredText}>
            {error ? "Couldn't load the schedule right now. Try again later." : 'No schedule found.'}
          </ThemedText>
        </Centered>
      }
      contentContainerStyle={styles.listContent}
    />
  );
}

function PlayersTab({
  players,
  loading,
  error,
  onOpenPlayer,
  accentColor,
}: {
  players: RankedPlayer[];
  loading: boolean;
  error: boolean;
  onOpenPlayer: (p: Player) => void;
  accentColor: string | null;
}) {
  const theme = useTheme();

  if (loading) {
    return (
      <Centered>
        <ActivityIndicator />
      </Centered>
    );
  }

  return (
    <FlatList
      data={players}
      keyExtractor={(item) => item.player.id}
      renderItem={({ item }) => (
        <AccentRow color={accentColor}>
          <PlayerRow
            player={item.player}
            detail={item.detail}
            onPress={() => onOpenPlayer(item.player)}
          />
        </AccentRow>
      )}
      ItemSeparatorComponent={() => (
        <View style={[styles.separator, { backgroundColor: theme.text }]} />
      )}
      ListHeaderComponent={
        <ThemedText type="small" themeColor="textSecondary" style={styles.playersNote}>
          Most talked about — ranked by recent coverage and last season&apos;s stat leaders.
        </ThemedText>
      }
      ListEmptyComponent={
        <Centered>
          <ThemedText themeColor="textSecondary" style={styles.centeredText}>
            {error
              ? "Couldn't load the roster right now. Try again later."
              : 'No players stand out in recent coverage yet.'}
          </ThemedText>
        </Centered>
      }
      contentContainerStyle={styles.listContent}
    />
  );
}

function TouchableFilterChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <ThemedText
      type="smallBold"
      onPress={onPress}
      style={[
        styles.chip,
        {
          borderColor: theme.text,
          backgroundColor: active ? theme.text : 'transparent',
          color: active ? theme.background : theme.text,
        },
      ]}>
      {active ? '✓ ' : ''}
      {label.toUpperCase()}
    </ThemedText>
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
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.five,
    paddingVertical: Spacing.five,
  },
  centeredText: {
    textAlign: 'center',
  },
  separator: {
    height: 1.5,
    marginLeft: Spacing.three,
  },
  listContent: {
    paddingBottom: Spacing.five,
  },
  chipRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
  },
  chip: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: 0,
    borderWidth: 1.5,
    fontSize: 11,
    letterSpacing: 0.5,
    overflow: 'hidden',
  },
  playersNote: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontSize: 11,
  },
});
