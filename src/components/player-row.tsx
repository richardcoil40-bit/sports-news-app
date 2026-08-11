import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { Player } from '@/lib/roster';

export function PlayerRow({
  player,
  detail,
  onPress,
}: {
  player: Player;
  detail?: string;
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <TouchableOpacity style={styles.container} onPress={onPress} activeOpacity={0.7}>
      <View style={[styles.jerseyBadge, { backgroundColor: theme.backgroundElement }]}>
        <ThemedText type="smallBold">{player.jersey ?? '—'}</ThemedText>
      </View>

      <View style={styles.textColumn}>
        <ThemedText type="default">{player.fullName}</ThemedText>
        {detail ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.detail}>
            {detail}
          </ThemedText>
        ) : null}
      </View>

      {player.position ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.position}>
          {player.position}
        </ThemedText>
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  jerseyBadge: {
    width: 32,
    height: 32,
    borderRadius: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textColumn: {
    flex: 1,
    gap: Spacing.half,
  },
  detail: {
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontSize: 11,
  },
  position: {
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontSize: 11,
  },
});
