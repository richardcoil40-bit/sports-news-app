import { ScrollView, StyleSheet, TouchableOpacity } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { FootballCategory } from '@/lib/feeds';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type CategoryFilter = FootballCategory | 'all';

const TABS: { id: CategoryFilter; label: string }[] = [
  { id: 'all', label: 'All Football' },
  { id: 'nfl', label: 'NFL' },
  { id: 'college', label: 'College' },
  { id: 'highschool', label: 'High School' },
];

export function CategoryTabs({
  selected,
  onSelect,
}: {
  selected: CategoryFilter;
  onSelect: (id: CategoryFilter) => void;
}) {
  const theme = useTheme();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.container}>
      {TABS.map((tab) => {
        const isSelected = tab.id === selected;
        return (
          <TouchableOpacity
            key={tab.id}
            onPress={() => onSelect(tab.id)}
            style={[
              styles.pill,
              { backgroundColor: isSelected ? theme.text : theme.backgroundElement },
            ]}>
            <ThemedText
              type="smallBold"
              style={{ color: isSelected ? theme.background : theme.text }}>
              {tab.label}
            </ThemedText>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  pill: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: 20,
  },
});
