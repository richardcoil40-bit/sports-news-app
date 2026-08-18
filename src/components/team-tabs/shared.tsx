import { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Full-bleed centered box — the spinner and the empty/error message both use it. */
export function Centered({ children }: { children: ReactNode }) {
  return <View style={styles.centered}>{children}</View>;
}

/** The house separator: bold 1.5px in `theme.text`, not a hairline. */
export function Separator() {
  const theme = useTheme();
  return <View style={[styles.separator, { backgroundColor: theme.text }]} />;
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.five,
    paddingVertical: Spacing.five,
  },
  separator: {
    height: 1.5,
    marginLeft: Spacing.three,
  },
});

/** Shared by all four tabs, which are otherwise independent FlatLists. */
export const tabStyles = StyleSheet.create({
  centeredText: {
    textAlign: 'center',
  },
  listContent: {
    paddingBottom: Spacing.five,
  },
});
