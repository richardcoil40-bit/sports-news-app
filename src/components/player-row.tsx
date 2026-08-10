import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { Player } from '@/lib/roster';

export function PlayerRow({ player, onPress }: { player: Player; onPress: () => void }) {
  const theme = useTheme();

  return (
    <TouchableOpacity style={styles.container} onPress={onPress} activeOpacity={0.7}>
      <View style={[styles.jerseyBadge, { backgroundColor: theme.backgroundElement }]}>
        <ThemedText type="smallBold">{player.jersey ?? '—'}</ThemedText>
      </View>
      <ThemedText type="default" style={styles.name}>
        {player.fullName}
      </ThemedText>
      {player.position ? (
        <ThemedText type="small" themeColor="textSecondary">
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
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: {
    flex: 1,
  },
});
