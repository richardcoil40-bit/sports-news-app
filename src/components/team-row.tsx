import { Image } from 'expo-image';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { Team } from '@/lib/teams';

export function TeamRow({
  team,
  onPress,
  following,
  onToggleFollow,
  detail,
}: {
  team: Team;
  onPress: () => void;
  following?: boolean;
  onToggleFollow?: () => void;
  /**
   * A line under the name — the team's league, where the list spans more
   * than one. Passed in rather than derived here because most lists are
   * already scoped to a single league, and repeating "Big Ten" down every
   * row of the Big Ten's own team list is noise.
   */
  detail?: string;
}) {
  const theme = useTheme();

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.main} onPress={onPress} activeOpacity={0.7}>
        {team.logoUrl ? (
          <Image source={{ uri: team.logoUrl }} style={styles.logo} contentFit="contain" />
        ) : (
          <View style={[styles.logo, styles.placeholder, { backgroundColor: theme.backgroundElement }]} />
        )}
        <View style={styles.names}>
          <ThemedText type="default">{team.name}</ThemedText>
          {detail ? (
            <ThemedText font="mono" themeColor="textSecondary" style={styles.detail}>
              {detail}
            </ThemedText>
          ) : null}
        </View>
      </TouchableOpacity>

      {onToggleFollow ? (
        // A filled/hollow star rather than an icon library: it reads
        // instantly, costs no dependency, and the plain glyph suits the
        // monospace, no-decoration look better than a drawn icon would.
        <TouchableOpacity
          onPress={onToggleFollow}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={following ? `Unfollow ${team.name}` : `Follow ${team.name}`}
          style={styles.star}>
          <ThemedText style={[styles.starGlyph, { color: theme.text }]}>
            {following ? '★' : '☆'}
          </ThemedText>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: Spacing.three,
  },
  main: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  logo: {
    width: 36,
    height: 36,
  },
  placeholder: {
    borderRadius: 0,
  },
  names: {
    flex: 1,
    gap: 2,
  },
  detail: {
    fontSize: 10.5,
    lineHeight: 14,
    textTransform: 'uppercase',
    letterSpacing: 0.2,
  },
  star: {
    paddingLeft: Spacing.two,
    paddingVertical: Spacing.two,
  },
  starGlyph: {
    fontSize: 22,
    lineHeight: 26,
  },
});
