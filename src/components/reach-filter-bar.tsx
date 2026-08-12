import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ReachFilter, REACH_FILTER_TABS } from '@/lib/reach-filter';

/**
 * All / National / Beat.
 *
 * Deliberately lighter than TabBar even though both are segmented
 * controls: on the team screen this sits directly beneath the main
 * News/Schedule/Players/Recruiting bar, and two identical-looking rows
 * stacked on top of each other would read as one confusing block. This
 * one is smaller, outlined, and inset so it reads as a refinement of the
 * list below it rather than as navigation.
 */
export function ReachFilterBar({
  active,
  onChange,
}: {
  active: ReachFilter;
  onChange: (next: ReachFilter) => void;
}) {
  const theme = useTheme();

  return (
    <View style={styles.wrap}>
      <View style={[styles.container, { borderColor: theme.text }]}>
        {REACH_FILTER_TABS.map((tab, index) => {
          const isActive = tab.key === active;
          return (
            <TouchableOpacity
              key={tab.key}
              onPress={() => onChange(tab.key)}
              activeOpacity={0.6}
              accessibilityRole="button"
              accessibilityState={{ selected: isActive }}
              style={[
                styles.segment,
                { backgroundColor: isActive ? theme.text : 'transparent' },
                index < REACH_FILTER_TABS.length - 1 && {
                  borderRightWidth: 1.5,
                  borderRightColor: theme.text,
                },
              ]}>
              <ThemedText
                style={[
                  styles.label,
                  { color: isActive ? theme.background : theme.textSecondary },
                ]}>
                {tab.label}
              </ThemedText>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
  },
  container: {
    flexDirection: 'row',
    borderWidth: 1.5,
    borderRadius: 0,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.one,
  },
  label: {
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    fontWeight: '700',
  },
});
