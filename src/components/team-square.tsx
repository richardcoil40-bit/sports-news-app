import { useEffect, useRef, useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { DEFAULT_LEAGUE, getLeague } from '@/lib/league-catalog';
import { fetchTeamColor } from '@/lib/team-color';
import { Team } from '@/lib/teams';

/**
 * One followed team, as a block of that team's own color.
 *
 * Each square fetches its own color rather than the grid fetching them
 * all: the results are cached for the life of the process, so a screen
 * of six teams costs six requests once and nothing on every visit
 * after. It also means one team's slow or missing color doesn't hold up
 * the other five.
 *
 * Until the color lands the square sits on the neutral element color.
 * That's a visible change on first paint, and preferable to holding the
 * whole grid behind a spinner for something purely decorative.
 *
 * A press hands back where the square is and what color it ended up, so
 * the grid can grow that exact block out to fill the screen. The square
 * owns both facts, so it is the only thing that can answer without the
 * grid duplicating the lookup.
 */
export interface SquareFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function TeamSquare({
  team,
  onPress,
}: {
  team: Team;
  onPress: (frame: SquareFrame | null, color: string | null) => void;
}) {
  const theme = useTheme();
  const ref = useRef<View>(null);
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

  // White on the team's color, ink on the placeholder — the same choice
  // the team screen's header makes for the same reason.
  const ink = color ? '#FFFFFF' : theme.text;

  // measureInWindow is asynchronous, and a press that somehow resolves
  // without a mounted node still has to navigate — the frame is what the
  // animation wants, not what the navigation needs.
  const handlePress = () => {
    const node = ref.current;
    if (!node) {
      onPress(null, color);
      return;
    }
    node.measureInWindow((x, y, width, height) => onPress({ x, y, width, height }, color));
  };

  return (
    <TouchableOpacity
      ref={ref}
      style={[
        styles.square,
        { backgroundColor: color ?? theme.backgroundElement, borderColor: theme.text },
      ]}
      onPress={handlePress}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={team.name}>
      <ThemedText font="mono" style={[styles.abbreviation, { color: ink }]}>
        {team.abbreviation}
      </ThemedText>
      <ThemedText font="mono" numberOfLines={1} style={[styles.name, { color: ink }]}>
        {team.shortName}
      </ThemedText>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  square: {
    flex: 1,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    padding: Spacing.two,
    borderWidth: 1.5,
    borderRadius: 0,
  },
  abbreviation: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '700',
    letterSpacing: 1,
  },
  name: {
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    fontSize: 10.5,
    lineHeight: 15,
    fontWeight: '500',
  },
});
