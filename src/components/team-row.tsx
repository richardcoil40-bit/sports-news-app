import { Image } from 'expo-image';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { Team } from '@/lib/teams';

export function TeamRow({ team, onPress }: { team: Team; onPress: () => void }) {
  const theme = useTheme();

  return (
    <TouchableOpacity style={styles.container} onPress={onPress} activeOpacity={0.7}>
      {team.logoUrl ? (
        <Image source={{ uri: team.logoUrl }} style={styles.logo} contentFit="contain" />
      ) : (
        <View style={[styles.logo, styles.placeholder, { backgroundColor: theme.backgroundElement }]} />
      )}
      <ThemedText type="default" style={styles.name}>
        {team.name}
      </ThemedText>
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
  logo: {
    width: 36,
    height: 36,
  },
  placeholder: {
    borderRadius: 0,
  },
  name: {
    flex: 1,
  },
});
