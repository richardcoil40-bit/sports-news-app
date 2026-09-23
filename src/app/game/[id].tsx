import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, FlatList, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AccentRow } from '@/components/accent-row';
import { CaughtUpMarker } from '@/components/caught-up-marker';
import { CollapsibleSectionHeader } from '@/components/collapsible-section';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAsync } from '@/hooks/use-async';
import { useFavorites } from '@/hooks/use-favorites';
import { useTheme } from '@/hooks/use-theme';
import { catchUp, DriveLine, driveLineText } from '@/lib/catch-up';
import { inkOn, visibleOn } from '@/lib/color';
import { favoriteKey } from '@/lib/favorite-keys';
import { cleanPlayText, isClockEvent, periodLabel } from '@/lib/game';
import { clearGameMarker, getGameMarker, setGameMarker } from '@/lib/game-markers';
import { fetchGameSummary, GameSummary } from '@/lib/game-summary';
import { DEFAULT_LEAGUE, getLeague } from '@/lib/league-catalog';
import { espnCacheKey } from '@/lib/leagues';
import { fetchGameOdds, Odds } from '@/lib/schedule';
import { peekScoreboard } from '@/lib/scoreboard';
import { fetchTeamColor } from '@/lib/team-color';

/** Under the summary cache's 15s TTL plus a margin, so every tick is a real read. */
const SUMMARY_POLL_MS = 20 * 1000;

type Row =
  | { kind: 'live'; key: string; situation: string; lastPlay: string | null }
  | { kind: 'heading'; key: string; text: string }
  | { kind: 'swing'; key: string; text: string }
  | { kind: 'blurb'; key: string; text: string }
  | { kind: 'turning'; key: string; text: string; detail: string }
  | { kind: 'drive'; key: string; line: DriveLine; ruled: boolean }
  | { kind: 'marker'; key: string; title: string; detail: string }
  | { kind: 'section'; key: string; label: string; count: number; open: boolean; ruled: boolean }
  | { kind: 'note'; key: string; text: string };

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function moneyline(value: number | null): string {
  if (value === null) return '—';
  return value > 0 ? `+${value}` : `${value}`;
}

/**
 * One game, as a catch-up rather than a gamecast.
 *
 * ESPN already shows every play. What this shows is what happened since
 * you last looked — the win-probability swing, the one play that moved it
 * most, a sentence about the drives, then the drives themselves — with a
 * finish line and everything earlier collapsed under it, the same shape as
 * the brief on the home screen. After the final it is the recap: the
 * scoring drives and the turning point, the rest one tap away.
 *
 * Where you last looked is written when you leave (blur, unmount, or the
 * app going to the background), never when you arrive — writing on arrival
 * would empty the section you came to read.
 */
export default function GameScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ id: string; leagueId?: string; teamId?: string }>();
  // Required at every push site; the fallback is the team screen's, for a
  // deep link that arrives without one.
  const league = useMemo(() => getLeague(params.leagueId ?? '') ?? DEFAULT_LEAGUE, [params.leagueId]);
  const markerKey = espnCacheKey(league, params.id);

  const summary = useAsync<GameSummary>(() => fetchGameSummary(params.id, league));
  const { load, reload } = summary;
  useEffect(() => {
    load();
  }, [load, params.id, league]);

  const data = summary.data;
  const header = data?.header ?? null;
  const state = header?.state ?? null;

  // --- Which side is yours ---------------------------------------------
  const { favoriteIds } = useFavorites();
  const followedSide: 'home' | 'away' = !header
    ? 'home'
    : params.teamId
      ? params.teamId === header.away.teamId
        ? 'away'
        : 'home'
      : favoriteIds.includes(favoriteKey(league.id, header.home.teamId))
        ? 'home'
        : favoriteIds.includes(favoriteKey(league.id, header.away.teamId))
          ? 'away'
          : 'home';
  const mine = header ? header[followedSide] : null;
  const theirs = header ? header[followedSide === 'home' ? 'away' : 'home'] : null;
  const followedTeamId = mine?.teamId ?? params.teamId ?? null;

  const [teamColor, setTeamColor] = useState<string | null>(null);
  useEffect(() => {
    if (!followedTeamId) return;
    let cancelled = false;
    fetchTeamColor(followedTeamId, league).then((color) => {
      if (!cancelled) setTeamColor(color);
    });
    return () => {
      cancelled = true;
    };
  }, [followedTeamId, league]);
  const shownColor = visibleOn(teamColor, theme.background);
  const bandInk = shownColor ? inkOn(shownColor) : theme.text;

  // --- Where you last looked -------------------------------------------
  // Read on the way in, written on the way out. Kept current in refs so the
  // blur and background handlers see the newest play without re-binding.
  const [seen, setSeen] = useState<string | null>(() => getGameMarker(markerKey));
  const latestPlayId = useRef<string | null>(null);
  const latestState = useRef<typeof state>(null);
  useEffect(() => {
    latestPlayId.current = data?.drives.at(-1)?.plays.at(-1)?.id ?? latestPlayId.current;
    latestState.current = state;
    // A finished game is read as a recap, from the top, every time.
    if (state === 'post') clearGameMarker(markerKey);
  }, [data, state, markerKey]);

  const leave = useCallback(() => {
    if (latestState.current === 'in' && latestPlayId.current) setGameMarker(markerKey, latestPlayId.current);
  }, [markerKey]);

  const [focused, setFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      setSeen(getGameMarker(markerKey));
      return () => {
        setFocused(false);
        leave();
      };
    }, [markerKey, leave]),
  );

  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        // Back from the lock screen: what you missed is what happened
        // since the app left the foreground.
        setSeen(getGameMarker(markerKey));
        setActive(true);
        reload();
      } else {
        leave();
        setActive(false);
      }
    });
    return () => subscription.remove();
  }, [markerKey, leave, reload]);

  // --- Polling ---------------------------------------------------------
  // Only while the game is on, this screen is the one in front, and the
  // app is in the foreground. Everything else is a single read.
  useEffect(() => {
    if (state !== 'in' || !focused || !active) return;
    const timer = setInterval(reload, SUMMARY_POLL_MS);
    return () => clearInterval(timer);
  }, [state, focused, active, reload]);

  // --- Pre-game odds ---------------------------------------------------
  const odds = useAsync<Odds | null>(() => fetchGameOdds(params.id, league));
  const loadOdds = odds.load;
  useEffect(() => {
    if (state === 'pre') loadOdds();
  }, [state, loadOdds]);

  const [earlierOpen, setEarlierOpen] = useState(false);

  // --- Rows ------------------------------------------------------------
  const rows = useMemo<Row[]>(() => {
    if (!data || !header || !mine || !theirs) return [];
    const out: Row[] = [];

    if (header.state === 'pre') {
      const kickoff = header.startDate ? new Date(header.startDate) : null;
      out.push({ kind: 'heading', key: 'h', text: 'Kickoff' });
      out.push({
        kind: 'note',
        key: 'kickoff',
        text: [
          kickoff && !Number.isNaN(kickoff.getTime())
            ? kickoff.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
            : header.statusDetail,
          header.network,
        ]
          .filter(Boolean)
          .join(' · '),
      });
      const line = odds.data;
      if (line) {
        out.push({
          kind: 'note',
          key: 'odds',
          text: [
            line.details ?? 'Line',
            line.overUnder ? `O/U ${line.overUnder}` : null,
            `ML ${moneyline(followedSide === 'home' ? line.homeMoneyline : line.awayMoneyline)}`,
          ]
            .filter(Boolean)
            .join(' · '),
        });
      }
      out.push({ kind: 'note', key: 'wait', text: 'The catch-up starts at kickoff.' });
      return out;
    }

    // Live line. The scoreboard's situation block leads: it is ESPN's own
    // statement of down, distance and possession, where the summary's last
    // play can be a timeout whose "end" is the other team's ball. The
    // summary fills in when the board hasn't been read, and a clock event
    // is never shown as the last play.
    if (header.state === 'in') {
      const board = peekScoreboard(league)?.find((g) => g.id === params.id);
      const situation = board?.state === 'in' ? board.situation : null;
      const current = data.drives.find((d) => d.current);
      const lastReal = [...(current?.plays ?? [])].reverse().find((p) => !isClockEvent(p.type));
      const situationText = situation?.downDistanceText ?? lastReal?.downDistanceText ?? null;
      const possessor = situation?.possessionTeamId
        ? situation.possessionTeamId === header.home.teamId
          ? header.home.abbreviation
          : situation.possessionTeamId === header.away.teamId
            ? header.away.abbreviation
            : null
        : (current?.abbreviation ?? null);
      if (situationText) {
        out.push({
          kind: 'live',
          key: 'live',
          situation: possessor ? `${situationText} ● ${possessor}` : situationText,
          lastPlay: cleanPlayText(situation?.lastPlayText ?? lastReal?.text ?? '') || null,
        });
      }
    }

    const cu = catchUp(data, header.state === 'post' ? null : seen);
    const hasMarker = cu.since !== null;

    out.push({
      kind: 'heading',
      key: 'h',
      text:
        header.state === 'post'
          ? 'How it happened'
          : hasMarker
            ? `Since you looked · ${periodLabel(cu.since!.period)} ${cu.since!.clock}`
            : 'So far',
    });

    if (cu.swing) {
      const from = followedSide === 'home' ? cu.swing.fromHomePct : 1 - cu.swing.fromHomePct;
      const to = followedSide === 'home' ? cu.swing.toHomePct : 1 - cu.swing.toHomePct;
      out.push({ kind: 'swing', key: 'swing', text: `Win probability · ${mine.abbreviation} ${pct(from)} → ${pct(to)}` });
    }
    if (cu.blurb) out.push({ kind: 'blurb', key: 'blurb', text: cu.blurb });
    if (cu.turningPoint) {
      const delta = followedSide === 'home' ? cu.turningPoint.deltaHomePct : -cu.turningPoint.deltaHomePct;
      const sign = delta >= 0 ? '+' : '−';
      out.push({
        kind: 'turning',
        key: 'turning',
        text: cleanPlayText(cu.turningPoint.play.text),
        detail: `The play that mattered · ${periodLabel(cu.turningPoint.play.period)} ${cu.turningPoint.play.clock} · ${mine.abbreviation} ${sign}${pct(Math.abs(delta))}`,
      });
    }

    // Newest first, like the brief: the most recent drive is the one you
    // want, and the finish line then sits between new and already-seen.
    //
    // With no marker — a first look mid-game, or the recap — the list is
    // the drives that changed something (points, turnovers, the drive on
    // the field) and the rest collapse; twenty-one drive lines is the
    // gamecast this screen exists not to be.
    const matters = (d: DriveLine) => d.scoring || d.current || d.outcome === 'turnover' || d.outcome === 'missed-fg';
    const shown = hasMarker ? cu.drives : cu.drives.filter(matters);
    const collapsed = hasMarker ? cu.earlier.drives : cu.drives.filter((d) => !matters(d));

    // Each drive draws the rule above it, like the feed's cards; the one
    // exception is the first drive under an open section header, whose own
    // bottom border already is that rule.
    for (const line of [...shown].reverse()) out.push({ kind: 'drive', key: `d:${line.driveId}`, line, ruled: true });
    // Unless the blurb has already said as much.
    if (shown.length === 0 && !hasMarker) out.push({ kind: 'note', key: 'none', text: 'No drives yet.' });

    if (hasMarker) {
      out.push({
        kind: 'marker',
        key: 'marker',
        title: 'You looked here',
        detail: `${periodLabel(cu.since!.period)} ${cu.since!.clock} · ${cu.earlier.playCount} ${cu.earlier.playCount === 1 ? 'play' : 'plays'} earlier`,
      });
    }

    if (collapsed.length > 0) {
      out.push({
        kind: 'section',
        key: 'section',
        label: hasMarker ? 'earlier drives' : 'other drives',
        count: collapsed.length,
        open: earlierOpen,
        // The marker is ruled top and bottom; without one, the section
        // header needs its own top rule to close the last drive above it.
        ruled: !hasMarker,
      });
      if (earlierOpen) {
        [...collapsed].reverse().forEach((line, index) =>
          out.push({ kind: 'drive', key: `e:${line.driveId}`, line, ruled: index > 0 }),
        );
      }
    }

    return out;
  }, [data, header, mine, theirs, seen, followedSide, league, params.id, odds.data, earlierOpen]);

  const renderRow = ({ item }: { item: Row }) => {
    switch (item.kind) {
      case 'live':
        return (
          <View style={[styles.live, { borderBottomColor: theme.text }]}>
            <ThemedText font="mono" style={[styles.meta, styles.strong]}>
              {item.situation}
            </ThemedText>
            {item.lastPlay ? <ThemedText>{item.lastPlay}</ThemedText> : null}
          </View>
        );
      case 'heading':
        return (
          <ThemedText type="smallBold" style={styles.heading}>
            {item.text}
          </ThemedText>
        );
      case 'swing':
        return (
          <ThemedText font="mono" themeColor="textSecondary" style={[styles.meta, styles.pad]}>
            {item.text}
          </ThemedText>
        );
      case 'blurb':
        return <ThemedText style={[styles.blurb, styles.pad]}>{item.text}</ThemedText>;
      case 'turning':
        return (
          <View style={[styles.pad, styles.turning]}>
            <ThemedText>{item.text}</ThemedText>
            <ThemedText font="mono" themeColor="textSecondary" style={styles.meta}>
              {item.detail}
            </ThemedText>
          </View>
        );
      case 'drive':
        return (
          <View style={item.ruled ? [styles.driveRule, { borderTopColor: theme.text }] : null}>
            <AccentRow color={item.line.teamId === followedTeamId ? teamColor : null}>
              <ThemedText
                font="mono"
                themeColor={item.line.current || item.line.scoring ? 'text' : 'textSecondary'}
                style={[styles.meta, styles.drive]}
                numberOfLines={1}>
                {driveLineText(item.line, followedSide)}
              </ThemedText>
            </AccentRow>
          </View>
        );
      case 'marker':
        return <CaughtUpMarker title={item.title} detail={item.detail} />;
      case 'section':
        return (
          <View style={item.ruled ? [styles.driveRule, { borderTopColor: theme.text }] : null}>
            <CollapsibleSectionHeader
              label={item.label}
              count={item.count}
              open={item.open}
              onToggle={() => setEarlierOpen((open) => !open)}
            />
          </View>
        );
      case 'note':
        return (
          <ThemedText font="mono" themeColor="textSecondary" style={[styles.meta, styles.pad]}>
            {item.text}
          </ThemedText>
        );
    }
  };

  return (
    <ThemedView style={styles.flex}>
      <Stack.Screen
        options={{ title: header ? `${header.away.abbreviation} at ${header.home.abbreviation}` : 'Game' }}
      />
      <SafeAreaView style={styles.flex} edges={['bottom']}>
        {header && mine && theirs ? (
          <FlatList
            data={rows}
            keyExtractor={(item) => item.key}
            renderItem={renderRow}
            ListHeaderComponent={
              <View style={[styles.band, { backgroundColor: shownColor ?? theme.backgroundElement }]}>
                <ThemedText font="mono" style={[styles.score, { color: bandInk }]}>
                  {mine.abbreviation} {mine.score}
                  {'  ·  '}
                  {theirs.abbreviation} {theirs.score}
                </ThemedText>
                <ThemedText font="mono" style={[styles.meta, { color: bandInk }]}>
                  {header.state === 'pre' ? 'Upcoming' : header.statusDetail}
                </ThemedText>
              </View>
            }
            contentContainerStyle={styles.listContent}
          />
        ) : summary.error ? (
          <View style={styles.centered}>
            <ThemedText themeColor="textSecondary" style={styles.centeredText}>
              Couldn&apos;t load this game right now. Try again in a moment.
            </ThemedText>
          </View>
        ) : data && !header ? (
          <View style={styles.centered}>
            <ThemedText themeColor="textSecondary" style={styles.centeredText}>
              ESPN has nothing on this game yet.
            </ThemedText>
          </View>
        ) : (
          <View style={styles.centered}>
            <ActivityIndicator />
          </View>
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  band: {
    alignItems: 'center',
    gap: Spacing.one,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.three,
    paddingHorizontal: Spacing.three,
  },
  score: {
    fontSize: 26,
    lineHeight: 32,
    fontWeight: '700',
  },
  meta: {
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontSize: 11,
  },
  strong: {
    fontWeight: '600',
  },
  pad: {
    paddingHorizontal: Spacing.three,
  },
  live: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    gap: Spacing.one,
    borderBottomWidth: 1.5,
  },
  heading: {
    textTransform: 'uppercase',
    letterSpacing: 1,
    fontSize: 12,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.one,
  },
  blurb: {
    fontSize: 20,
    lineHeight: 28,
    paddingTop: Spacing.two,
  },
  turning: {
    paddingTop: Spacing.two,
    paddingBottom: Spacing.three,
    gap: Spacing.half,
  },
  driveRule: {
    borderTopWidth: 1.5,
  },
  drive: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.two,
  },
  listContent: {
    paddingBottom: Spacing.five,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.five,
  },
  centeredText: {
    textAlign: 'center',
  },
});
