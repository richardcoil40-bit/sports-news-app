import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * One step down the Sport → Level → League drill-down.
 *
 * `disabled` is for a league the catalog knows about but can't serve
 * yet: it stays on screen, greyed, with a note saying so. Showing it is
 * the point — "Football has an NFL level, and it isn't ready" is more
 * honest than a list that pretends the NFL doesn't exist.
 */
export function PickerRow({
  label,
  detail,
  disabled,
  onPress,
}: {
  label: string;
  detail?: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <View>
      <TouchableOpacity
        style={styles.row}
        activeOpacity={0.7}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityState={{ disabled: !!disabled }}
        onPress={onPress}>
        <View style={styles.text}>
          <ThemedText
            themeColor={disabled ? 'textSecondary' : 'text'}
            style={styles.label}>
            {label}
          </ThemedText>
          {detail ? (
            <ThemedText font="mono" themeColor="textSecondary" style={styles.detail}>
              {detail}
            </ThemedText>
          ) : null}
        </View>
        {disabled ? null : (
          <ThemedText font="mono" style={styles.chevron}>
            ›
          </ThemedText>
        )}
      </TouchableOpacity>
      <View style={[styles.rule, { backgroundColor: theme.text }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  text: {
    flex: 1,
    gap: Spacing.half,
  },
  label: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '600',
  },
  detail: {
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontSize: 10.5,
    lineHeight: 15,
  },
  chevron: {
    fontSize: 20,
    lineHeight: 24,
  },
  rule: {
    height: 1.5,
  },
});
