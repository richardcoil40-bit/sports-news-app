import { ReactNode, useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * A header you have to tap to see what's under it.
 *
 * Used for both "rumors & takes" and "earlier", because they're the same
 * affordance and one component is better than two that drift apart.
 *
 * Starts closed every visit and that state is deliberately **not**
 * persisted. The point of the brief is that the default path through the
 * screen ends; remembering that you opened Earlier yesterday would quietly
 * turn the endless feed back on and undo the whole thing.
 */
export function CollapsibleSection({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children: ReactNode;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);

  if (count === 0) return null;

  return (
    <View>
      <TouchableOpacity
        onPress={() => setOpen((v) => !v)}
        activeOpacity={0.6}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${count} ${label}`}
        style={[styles.header, { borderBottomColor: theme.text }]}>
        <ThemedText type="smallBold" style={styles.label}>
          {open ? '▾' : '▸'} {count} {label}
        </ThemedText>
      </TouchableOpacity>
      {open ? children : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderBottomWidth: 1.5,
  },
  label: {
    textTransform: 'uppercase',
    letterSpacing: 1,
    fontSize: 12,
    fontWeight: '600',
  },
});
