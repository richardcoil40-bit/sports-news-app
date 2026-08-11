import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { ReactNode, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ArticleCard } from '@/components/article-card';
import { PlayerRow } from '@/components/player-row';
import { ScheduleRow } from '@/components/schedule-row';
import { TabBar } from '@/components/tab-bar';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { Article } from '@/lib/feeds';
import { filterByNotableJournalists } from '@/lib/journalists';
import { pickNotablePlayers } from '@/lib/notable-players';
import { filterRecruitingArticles } from '@/lib/recruiting';
import { Player, fetchTeamRoster } from '@/lib/roster';
import { fetchGameOdds, fetchTeamSchedule, ScheduledGame } from '@/lib/schedule';
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

  const [newsArticles, setNewsArticles] = useState<Article[] | null>(null);
  const [newsLoading, setNewsLoading] = useState(false);
  const [newsError, setNewsError] = useState(false);

  const [schedule, setSchedule] = useState<ScheduledGame[] | null>(null);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleError, setScheduleError] = useState(false);

  const [roster, setRoster] = useState<Player[] | null>(null);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterError, setRosterError] = useState(false);

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
        const players = await fetchTeamRoster(params.id);
        if (!cancelled) setRoster(players);
      } catch {
        if (!cancelled) setRosterError(true);
      } finally {
        if (!cancelled) setRosterLoading(false);
      }
    }

    if (tab === 'news' || tab === 'recruiting') loadNews();
    if (tab === 'schedule') loadSchedule();
    if (tab === 'players') loadRoster();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, params.id, params.shortName, params.name]);

  const visibleNews = useMemo(() => {
    if (!newsArticles) return [];
    return journalistsOnly ? filterByNotableJournalists(newsArticles) : newsArticles;
  }, [newsArticles, journalistsOnly]);

  const recruitingArticles = useMemo(
    () => (newsArticles ? filterRecruitingArticles(newsArticles) : []),
    [newsArticles],
  );

  const notablePlayers = useMemo(() => (roster ? pickNotablePlayers(roster) : []), [roster]);

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
      },
    });
  };

  return (
    <ThemedView style={styles.flex}>
      <Stack.Screen options={{ title: params.shortName || params.name, headerBackTitle: 'Teams' }} />
      <SafeAreaView style={styles.flex} edges={['bottom']}>
        <View style={styles.header}>
          {params.logoUrl ? (
            <Image source={{ uri: params.logoUrl }} style={styles.logo} contentFit="contain" />
          ) : null}
          <ThemedText type="title" style={styles.teamName}>
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
            onOpenArticle={openArticle}
          />
        ) : null}

        {tab === 'schedule' ? (
          <ScheduleTab games={schedule} loading={schedule === null && !scheduleError} error={scheduleError} />
        ) : null}

        {tab === 'players' ? (
          <PlayersTab
            players={notablePlayers}
            loading={roster === null && !rosterError}
            error={rosterError}
            onOpenPlayer={openPlayer}
          />
        ) : null}

        {tab === 'recruiting' ? (
          <RecruitingTab
            articles={recruitingArticles}
            loading={newsArticles === null && !newsError}
            error={newsError}
            onOpenArticle={openArticle}
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
  onOpenArticle,
}: {
  articles: Article[];
  loading: boolean;
  error: boolean;
  journalistsOnly: boolean;
  onToggleJournalists: () => void;
  onOpenArticle: (a: Article) => void;
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
      renderItem={({ item }) => <ArticleCard article={item} onPress={() => onOpenArticle(item)} />}
      ItemSeparatorComponent={() => (
        <View style={[styles.separator, { backgroundColor: theme.backgroundElement }]} />
      )}
      ListHeaderComponent={
        <TouchableFilterChip
          label="Notable journalists only"
          active={journalistsOnly}
          onPress={onToggleJournalists}
        />
      }
      ListEmptyComponent={
        <Centered>
          <ThemedText themeColor="textSecondary" style={styles.centeredText}>
            {error
              ? "Couldn't load headlines right now. Try again later."
              : journalistsOnly
                ? 'No articles from notable journalists right now.'
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
}: {
  articles: Article[];
  loading: boolean;
  error: boolean;
  onOpenArticle: (a: Article) => void;
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
      renderItem={({ item }) => <ArticleCard article={item} onPress={() => onOpenArticle(item)} />}
      ItemSeparatorComponent={() => (
        <View style={[styles.separator, { backgroundColor: theme.backgroundElement }]} />
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
}: {
  games: ScheduledGame[] | null;
  loading: boolean;
  error: boolean;
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
      renderItem={({ item }) => <ScheduleRow game={item} />}
      ItemSeparatorComponent={() => (
        <View style={[styles.separator, { backgroundColor: theme.backgroundElement }]} />
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
}: {
  players: Player[];
  loading: boolean;
  error: boolean;
  onOpenPlayer: (p: Player) => void;
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
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => <PlayerRow player={item} onPress={() => onOpenPlayer(item)} />}
      ItemSeparatorComponent={() => (
        <View style={[styles.separator, { backgroundColor: theme.backgroundElement }]} />
      )}
      ListHeaderComponent={
        <ThemedText type="small" themeColor="textSecondary" style={styles.playersNote}>
          Most-featured 15, estimated from roster experience — not an official depth chart.
        </ThemedText>
      }
      ListEmptyComponent={
        <Centered>
          <ThemedText themeColor="textSecondary" style={styles.centeredText}>
            {error ? "Couldn't load the roster right now. Try again later." : 'No roster found.'}
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
    <View style={styles.chipWrap}>
      <ThemedText
        type="smallBold"
        onPress={onPress}
        style={[
          styles.chip,
          {
            backgroundColor: active ? theme.text : theme.backgroundElement,
            color: active ? theme.background : theme.text,
          },
        ]}>
        {active ? '✓ ' : ''}
        {label}
      </ThemedText>
    </View>
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
    paddingBottom: Spacing.two,
  },
  logo: {
    width: 64,
    height: 64,
  },
  teamName: {
    fontSize: 22,
    lineHeight: 28,
    textAlign: 'center',
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
    height: StyleSheet.hairlineWidth,
    marginLeft: Spacing.three,
  },
  listContent: {
    paddingBottom: Spacing.five,
  },
  chipWrap: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
  },
  chip: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: 16,
    overflow: 'hidden',
  },
  playersNote: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
  },
});
