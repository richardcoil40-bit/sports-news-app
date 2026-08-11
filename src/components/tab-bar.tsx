import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export function TabBar<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: { key: T; label: string }[];
  active: T;
  onChange: (key: T) => void;
}) {
  const theme = useTheme();

  return (
    <View
      style={[
        styles.container,
        { borderTopColor: theme.text, borderBottomColor: theme.text },
      ]}>
      {tabs.map((tab, index) => {
        const isActive = tab.key === active;
        return (
          <TouchableOpacity
            key={tab.key}
            onPress={() => onChange(tab.key)}
            activeOpacity={0.6}
            style={[
              styles.tab,
              index < tabs.length - 1 && { borderRightWidth: 1.5, borderRightColor: theme.text },
            ]}>
            <ThemedText
              type="small"
              numberOfLines={1}
              style={[
                styles.label,
                { color: isActive ? theme.text : theme.textSecondary, fontWeight: isActive ? '700' : '400' },
              ]}>
              {tab.label}
            </ThemedText>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    borderTopWidth: 1.5,
    borderBottomWidth: 1.5,
    marginBottom: Spacing.two,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.two,
  },
  label: {
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
});
