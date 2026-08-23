import { ReactNode } from 'react';
import { View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import { visibleOn } from '@/lib/color';

/**
 * Thin flat color tick on the leading edge of a row — the one place a team's real color shows up in list content.
 *
 * The color is run through `visibleOn` against the page it is drawn on.
 * ESPN picks these to sit on white, so on the dark ground two thirds of
 * the catalogue lands under 3:1 and a quarter of it under 1.5:1 — a 4pt
 * bar in Penn State navy on near-black is a bar nobody can see, which is
 * the entire job it has. The adjustment is a no-op for a color that
 * already clears the floor, which on the cream ground is nearly all of
 * them.
 */
export function AccentRow({ color, children }: { color: string | null; children: ReactNode }) {
  const theme = useTheme();
  const shown = visibleOn(color, theme.background);

  return (
    <View style={{ flexDirection: 'row' }}>
      <View style={{ width: 4, backgroundColor: shown ?? 'transparent' }} />
      <View style={{ flex: 1 }}>{children}</View>
    </View>
  );
}
