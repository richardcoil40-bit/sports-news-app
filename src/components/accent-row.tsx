import { ReactNode } from 'react';
import { View } from 'react-native';

/** Thin flat color tick on the leading edge of a row — the one place a team's real color shows up in list content. */
export function AccentRow({ color, children }: { color: string | null; children: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row' }}>
      <View style={{ width: 4, backgroundColor: color ?? 'transparent' }} />
      <View style={{ flex: 1 }}>{children}</View>
    </View>
  );
}
