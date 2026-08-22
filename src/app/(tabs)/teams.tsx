import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { Logo } from '@/components/logo';
import { SettingsButton } from '@/components/settings-button';
import { BadgeFrame, TeamBadgeRow } from '@/components/team-badge-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useFavorites } from '@/hooks/use-favorites';
import { useTeams } from '@/hooks/use-teams';
import { useTheme } from '@/hooks/use-theme';
import { Team } from '@/lib/teams';

/**
 * A way in to each team you follow, and nothing else.
 *
 * This tab used to be the whole conference with a search box and a star
 * on every row, which made it two screens wearing one coat: a directory
 * and a settings surface. Managing the set moved to Settings →
 * Favorites, leaving this as pure navigation.
 *
 * The rows themselves used to be a two-column grid of full-bleed color
 * squares; see TeamBadgeRow for why the color moved into a badge.
 *
 * Tapping one grows that badge out to fill the screen before the team
 * screen is pushed, so the color you tapped is the color you land on.
 * Hand-built rather than a shared-element transition: Reanimated's is
 * experimental, explicitly doesn't support paths through a tab
 * navigator (which this is), and can't animate backgroundColor — which
 * is the only thing being animated here.
 */
const EXPAND_MS = 260;
export default function TeamsScreen() {
  const theme = useTheme();
  const { teams, loading, error } = useTeams();
  const { hydrated, isFavorite } = useFavorites();

  const followed = useMemo(() => teams.filter((team) => isFavorite(team)), [teams, isFavorite]);

  // The badge currently growing, if any. Held rather than derived so the
  // overlay keeps painting the team's color through the navigation.
  const [expanding, setExpanding] = useState<{ frame: BadgeFrame; color: string | null } | null>(
    null,
  );
  const progress = useSharedValue(0);
  const { width, height } = useWindowDimensions();

  const openTeam = useCallback((team: Team, color: string | null) => {
    router.push({
      pathname: '/team/[id]',
      params: {
        id: team.id,
        name: team.name,
        shortName: team.shortName,
        logoUrl: team.logoUrl ?? '',
        // An ESPN team id is only unique within a sport, so the screen on
        // the other side can't build a single correct URL without knowing
        // which league this row came from. Carried on the Team already —
        // passing it is what keeps an NFL team off college-football
        // endpoints.
        leagueId: team.leagueId,
        // Handed over so the team screen's header is already the right
        // color on its first frame. It would otherwise fetch the same
        // (cached) value a tick later and visibly change under the
        // arriving screen, undoing the continuity this whole animation
        // exists to create.
        accent: color ?? '',
      },
    });
  }, []);

  const pressTeam = (team: Team) => (frame: BadgeFrame | null, color: string | null) => {
    // No frame means no measurement, which means nothing to grow from —
    // navigate plainly rather than inventing a starting rectangle.
    if (!frame) {
      openTeam(team, color);
      return;
    }

    setExpanding({ frame, color });
    progress.value = 0;
    progress.value = withTiming(1, { duration: EXPAND_MS, easing: Easing.out(Easing.cubic) }, (finished) => {
      'worklet';
      if (finished) scheduleOnRN(openTeam, team, color);
    });
  };

  // Cleared when the list is shown again, not when it is left: clearing on
  // the way out would drop the color mid-push and flash the list behind
  // the arriving screen. The functional update makes the common case —
  // focusing with nothing expanded — a no-op rather than a re-render.
  useFocusEffect(
    useCallback(() => {
      setExpanding((current) => (current ? null : current));
    }, []),
  );

  // Transforms rather than left/top/width/height: the latter re-run
  // layout on every frame of the animation, where a translate and a
  // scale are handled without one. The view is laid out at its *final*
  // size and scaled down to the badge's, so t=1 is the identity
  // transform and the end state needs no correction.
  //
  // The overlay stays square-cornered even though it starts life over a
  // disc. A full-screen view scaled to 38pt is scaled far harder
  // horizontally than vertically, so a single borderRadius cannot render
  // as a circle at t=0 whatever value it's given — matching the badge
  // would mean animating width/height instead, and re-running layout
  // every frame is exactly what this approach exists to avoid. The
  // mismatch lasts one frame at 38pt.
  const overlayStyle = useAnimatedStyle(() => {
    const frame = expanding?.frame;
    if (!frame) return { opacity: 0 };

    const t = progress.value;
    const fromScaleX = frame.width / width;
    const fromScaleY = frame.height / height;
    // Both boxes are centre-anchored, so the offset is between centres.
    const fromX = frame.x + frame.width / 2 - width / 2;
    const fromY = frame.y + frame.height / 2 - height / 2;

    return {
      opacity: 1,
      transform: [
        { translateX: fromX * (1 - t) },
        { translateY: fromY * (1 - t) },
        { scaleX: fromScaleX + (1 - fromScaleX) * t },
        { scaleY: fromScaleY + (1 - fromScaleY) * t },
      ],
    };
  });

  // Both, or the empty state flashes on every cold launch before the
  // persisted favorites have been read back off disk.
  const settling = loading || !hydrated;

  return (
    <ThemedView style={styles.flex}>
      <SafeAreaView style={styles.flex} edges={['top']}>
        <View style={styles.header}>
          <Logo
            size={22}
            onPress={() => router.push('/settings')}
            accessibilityLabel="Settings"
          />
          <ThemedText type="title" style={styles.headerTitle}>
            Teams
          </ThemedText>
          <View style={styles.headerSpacer} />
          <SettingsButton />
        </View>

        {settling ? (
          <View style={styles.centered}>
            <ActivityIndicator />
          </View>
        ) : error && followed.length === 0 ? (
          <View style={styles.centered}>
            <ThemedText themeColor="textSecondary" style={styles.centeredText}>
              {error}
            </ThemedText>
          </View>
        ) : followed.length === 0 ? (
          <View style={styles.centered}>
            <ThemedText themeColor="textSecondary" style={styles.centeredText}>
              You&apos;re not following any teams yet.
            </ThemedText>
            <TouchableOpacity
              style={[styles.button, { backgroundColor: theme.text }]}
              onPress={() => router.push('/settings/favorites')}>
              <ThemedText font="mono" style={[styles.buttonText, { color: theme.background }]}>
                Pick your teams
              </ThemedText>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList
            data={followed}
            keyExtractor={(item) => `${item.leagueId}:${item.id}`}
            renderItem={({ item }) => <TeamBadgeRow team={item} onPress={pressTeam(item)} />}
            contentContainerStyle={styles.listContent}
          />
        )}
      </SafeAreaView>

      {/*
        Outside the SafeAreaView so it can cover the inset too, and
        non-interactive throughout — it is scenery for a navigation
        that has already been decided, and swallowing a second tap
        during it would be the wrong kind of responsive.
      */}
      {expanding ? (
        <Animated.View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[
            styles.overlay,
            { width, height, backgroundColor: expanding.color ?? theme.backgroundElement },
            overlayStyle,
          ]}
        />
      ) : null}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.three,
  },
  headerTitle: {
    fontSize: 23,
    lineHeight: 28,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.2,
    // Same trailing-glyph clip as the feed's wordmark — TEAMS lost its S.
    paddingRight: Spacing.three,
  },
  headerSpacer: {
    flex: 1,
  },
  overlay: {
    position: 'absolute',
    left: 0,
    top: 0,
    borderRadius: 0,
  },
  listContent: {
    paddingHorizontal: Spacing.three,
    // Same floating-tab-bar clearance as the feed — see BottomTabInset.
    paddingBottom: BottomTabInset,
    gap: 10,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.five,
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
});
