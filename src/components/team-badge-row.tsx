import { useEffect, useRef, useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { inkOn, visibleOn } from '@/lib/color';
import { DEFAULT_LEAGUE, getLeague } from '@/lib/league-catalog';
import { fetchTeamColor } from '@/lib/team-color';
import { Team } from '@/lib/teams';

/**
 * One followed team, as an outlined row with its color carried by a
 * badge rather than by the whole block.
 *
 * This replaced a grid of full-bleed color squares. Six teams meant six
 * competing fields of saturated color and no quiet surface anywhere on
 * the screen; moving the color into a 38pt disc keeps each team
 * identifiable at a glance while letting the page read as paper again.
 * It also lets the list be one column of readable names instead of two
 * columns of abbreviations.
 *
 * Each row fetches its own color rather than the list fetching them all:
 * the results are cached for the life of the process, so a screen of six
 * teams costs six requests once and nothing on every visit after. It
 * also means one team's slow or missing color doesn't hold up the other
 * five.
 *
 * Until the color lands the badge sits on the neutral element color.
 * That's a visible change on first paint, and preferable to holding the
 * whole list behind a spinner for something purely decorative.
 *
 * A press hands back where the *badge* is and what color it ended up, so
 * the list can grow that disc out to fill the screen. The badge is the
 * only part of the row wearing the team's color, so it's the only
 * rectangle worth growing — starting from the row would expand a
 * cream-colored box in a color it was never painted.
 */
export interface BadgeFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

const BADGE_SIZE = 38;

export function TeamBadgeRow({
  team,
  onPress,
}: {
  team: Team;
  onPress: (frame: BadgeFrame | null, color: string | null) => void;
}) {
  const theme = useTheme();
  const badge = useRef<View>(null);
  const [color, setColor] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Resolved from the team's own league rather than the default: an
    // ESPN id means nothing without knowing which sport it belongs to.
    const league = getLeague(team.leagueId) ?? DEFAULT_LEAGUE;
    fetchTeamColor(team.id, league).then((next) => {
      if (!cancelled) setColor(next);
    });
    return () => {
      cancelled = true;
    };
  }, [team.id, team.leagueId]);

  // Adjusted to the page it sits on before it is painted — a 38pt disc in
  // a color ESPN chose for white paper can vanish entirely on the dark
  // ground (Kansas State's purple measures 1.19:1 there). See
  // `lib/color.ts`; a color that already clears the floor is untouched.
  const shown = visibleOn(color, theme.background);

  // Measured, not assumed: white wears well on most team colours, but a
  // light one the ground floor leaves untouched — the Saints' beige —
  // carried hardcoded white at 1.85:1. Ink on the placeholder as before,
  // and the team screen's header makes the same call on the same value.
  const ink = shown ? inkOn(shown) : theme.text;

  // measureInWindow is asynchronous, and a press that somehow resolves
  // without a mounted node still has to navigate — the frame is what the
  // animation wants, not what the navigation needs.
  const handlePress = () => {
    const node = badge.current;
    // `shown`, not `color`: the caller grows this disc into a full screen,
    // so it has to start on the color the badge is actually wearing or the
    // overlay pops at t=0. `visibleOn` is idempotent, so the team screen
    // re-applying it to what arrives is a no-op.
    if (!node) {
      onPress(null, shown);
      return;
    }
    node.measureInWindow((x, y, width, height) => onPress({ x, y, width, height }, shown));
  };

  return (
    <TouchableOpacity
      style={[styles.row, { borderColor: theme.text }]}
      onPress={handlePress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={team.name}>
      <View
        ref={badge}
        style={[styles.badge, { backgroundColor: shown ?? theme.backgroundElement }]}>
        <ThemedText font="mono" style={[styles.abbreviation, { color: ink }]}>
          {team.abbreviation}
        </ThemedText>
      </View>
      <ThemedText font="mono" numberOfLines={1} style={styles.name}>
        {team.shortName}
      </ThemedText>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  // Rounded, unlike the app's cards — see the design-system note in
  // AGENTS.md about where corners are allowed.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1.5,
    borderRadius: 12,
  },
  badge: {
    width: BADGE_SIZE,
    height: BADGE_SIZE,
    borderRadius: BADGE_SIZE / 2,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  abbreviation: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  name: {
    flexShrink: 1,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '600',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
});
