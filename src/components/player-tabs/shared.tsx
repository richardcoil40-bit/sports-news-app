import { StyleSheet } from 'react-native';

/**
 * The one thing the player tabs need that the team tabs don't.
 *
 * `Centered` is `flex: 1`, and a `flex: 1` ListEmptyComponent only fills the
 * viewport if its content container is allowed to grow past its content — so
 * without this the "no stats recorded" / "no news" message sits at the top of
 * the list instead of centered in it.
 *
 * Composed onto `tabStyles.listContent` at each call site rather than folded
 * into it: the team tabs have always rendered their four empty states without
 * `flexGrow`, and adding it to the shared rule would quietly re-position all
 * of them. Kept as a separate rule so the difference between the two screens
 * is visible instead of implied.
 */
export const playerTabStyles = StyleSheet.create({
  fillHeight: {
    flexGrow: 1,
  },
});
