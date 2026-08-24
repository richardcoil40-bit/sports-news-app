import { useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing, withAlpha } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * A pill that opens a checklist anchored under itself.
 *
 * This is the home feed's filter control, and it replaced two different
 * rows — a scrolling ChipRow for teams and a segmented FilterBar for
 * claim types — with one shape used twice. Those two had to look
 * unalike so that stacked on each other they didn't read as a single
 * confusing block; collapsing each to a pill removes the stacking, and
 * with it the reason they had to differ. It also pins both controls to
 * the header instead of letting them scroll away with the list.
 *
 * ## Why the panel is a Modal rather than an absolute child
 *
 * The panel has to paint over the article list below it. An absolutely
 * positioned sibling gets clipped by the header's bounds on Android
 * whatever its zIndex says, and on iOS it fights the FlatList for
 * stacking order. A transparent Modal sidesteps both, and pays for
 * itself twice over: it gives tap-outside-to-dismiss and the hardware
 * back button for free, and it makes the two pills mutually exclusive
 * without either one knowing the other exists — while one panel is
 * open, its backdrop is what receives a tap on the other pill.
 *
 * The anchor is measured at press time rather than on layout: the pill
 * shrinks as its label grows, and a stale rectangle would put the panel
 * somewhere the button no longer is.
 */
export interface DropdownOption {
  key: string;
  label: string;
  selected: boolean;
}

interface Anchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

const PANEL_GAP = 8;
const SCREEN_MARGIN = 12;
/**
 * A floor for the panel, for a pill low enough on screen that there is
 * barely any room under it. Overhanging the bottom edge by a little is
 * better than a panel too short to show a row.
 */
const MIN_PANEL_HEIGHT = 120;

export function DropdownPill({
  label,
  active,
  options,
  onSelect,
  align = 'left',
  panelWidth = 210,
  closeOnSelect = false,
  accessibilityLabel,
  style,
}: {
  /** What the closed pill reads. Uppercased for you. */
  label: string;
  /**
   * Whether the control is currently narrowing anything. Drives the
   * teal treatment — so pass `false` when the selection is "everything",
   * which is not a filter even though it is a selection.
   */
  active: boolean;
  options: readonly DropdownOption[];
  onSelect: (key: string) => void;
  /** Which edge the panel lines up with. */
  align?: 'left' | 'right';
  panelWidth?: number;
  /** Single-select axes close on a tap; multi-select ones stay open. */
  closeOnSelect?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const pill = useRef<View>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);

  const open = anchor !== null;
  const tint = active ? theme.accentControl : theme.text;

  const openPanel = () => {
    const node = pill.current;
    // measureInWindow is asynchronous and can resolve on an unmounted
    // node. No rectangle means nothing to anchor to, so the tap is
    // simply dropped rather than opening a panel in the corner.
    if (!node) return;
    node.measureInWindow((x, y, width, height) => setAnchor({ x, y, width, height }));
  };

  const press = () => (open ? setAnchor(null) : openPanel());

  const choose = (key: string) => {
    onSelect(key);
    if (closeOnSelect) setAnchor(null);
  };

  // Clamped to the screen so a wide panel under a pill near the edge
  // doesn't hang off it. Right-aligned panels are positioned from the
  // right edge for the same reason the design does: the filter pill sits
  // against it, and measuring from the left would need the pill's width.
  //
  // Both branches clamp *both* edges, and the right-aligned one has to:
  // an offset that lines the panel up with a pill near the left of the
  // screen puts the panel's far edge past x=0. That is not hypothetical —
  // in single-team view the two pills are narrow, so the claim pill's
  // right edge sits ~144pt in, a 210pt panel starts at -66pt, and the
  // row labels render off-screen. The cap is the largest offset that
  // still leaves SCREEN_MARGIN on the opposite side.
  const panelTop = anchor ? anchor.y + anchor.height + PANEL_GAP : 0;
  const farEdgeCap = screenWidth - panelWidth - SCREEN_MARGIN;
  const panelPosition = anchor
    ? align === 'right'
      ? {
          right: Math.max(
            SCREEN_MARGIN,
            Math.min(screenWidth - (anchor.x + anchor.width), farEdgeCap),
          ),
          top: panelTop,
        }
      : {
          left: Math.max(SCREEN_MARGIN, Math.min(anchor.x, farEdgeCap)),
          top: panelTop,
        }
    : null;

  // The teams panel holds one row per followed team, so its height is user
  // data: at thirty follows it ran off the bottom of the screen with the
  // last rows unreachable. Capped to what is actually below the pill and
  // scrolled past that.
  const panelMaxHeight = Math.max(MIN_PANEL_HEIGHT, screenHeight - panelTop - SCREEN_MARGIN);

  return (
    <>
      <TouchableOpacity
        ref={pill}
        onPress={press}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ expanded: open }}
        style={[
          styles.pill,
          {
            borderColor: active
              ? withAlpha(theme.accentControl, 0.45)
              : withAlpha(theme.text, 0.16),
            backgroundColor: active
              ? withAlpha(theme.accentControl, 0.12)
              : withAlpha(theme.text, 0.04),
          },
          style,
        ]}>
        <ThemedText
          font="mono"
          numberOfLines={1}
          style={[styles.pillLabel, { color: active ? tint : withAlpha(theme.text, 0.6) }]}>
          {label}
        </ThemedText>
        <ThemedText
          font="mono"
          style={[
            styles.chevron,
            { color: active ? tint : withAlpha(theme.text, 0.45) },
            open && styles.chevronOpen,
          ]}>
          ▾
        </ThemedText>
      </TouchableOpacity>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        // Android draws a Modal below the status bar by default, which
        // shifts it against the coordinates measureInWindow just
        // reported and lands the panel low by that height.
        statusBarTranslucent
        onRequestClose={() => setAnchor(null)}>
        <Pressable
          style={styles.backdrop}
          accessibilityLabel="Close"
          onPress={() => setAnchor(null)}
        />
        {panelPosition ? (
          <View
            style={[
              styles.panel,
              panelPosition,
              { width: panelWidth, backgroundColor: theme.background, borderColor: theme.text },
            ]}>
            {/*
              A ScrollView rather than a FlatList: the panel is capped at
              roughly a screen of rows, so there is nothing here worth
              virtualizing, and a VirtualizedList nested in a Modal over
              the feed's own list is a fight not worth picking. maxHeight
              lives on the scroller so a short list still sizes the panel
              to its content.
            */}
            <ScrollView style={{ maxHeight: panelMaxHeight }} bounces={false}>
              {options.map((option, index) => (
                <TouchableOpacity
                  key={option.key}
                  onPress={() => choose(option.key)}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityState={{ selected: option.selected }}
                  style={[
                    styles.row,
                    index > 0 && {
                      borderTopWidth: 1,
                      borderTopColor: withAlpha(theme.text, 0.14),
                    },
                  ]}>
                  <ThemedText font="mono" numberOfLines={1} style={styles.rowLabel}>
                    {option.label}
                  </ThemedText>
                  {/*
                    Always rendered, and hidden with opacity rather than
                    unmounted: the labels would otherwise shift sideways as
                    rows are checked and unchecked under the finger.
                  */}
                  <ThemedText
                    font="mono"
                    style={[
                      styles.check,
                      { color: theme.accentControl, opacity: option.selected ? 1 : 0 },
                    ]}>
                    ✓
                  </ThemedText>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        ) : null}
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  // The one place in the app that isn't square-cornered, along with the
  // panel below — see the design-system note in AGENTS.md.
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderWidth: 1,
    borderRadius: 20,
  },
  pillLabel: {
    flexShrink: 1,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '500',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  chevron: {
    flexShrink: 0,
    fontSize: 9,
    lineHeight: 14,
  },
  chevronOpen: {
    transform: [{ rotate: '180deg' }],
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  panel: {
    position: 'absolute',
    borderWidth: 1.5,
    borderRadius: 8,
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    // Roughly half the CSS blur radius, which is how the two measures
    // line up.
    shadowRadius: 10,
    elevation: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  rowLabel: {
    flexShrink: 1,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  check: {
    flexShrink: 0,
    fontSize: 13,
    lineHeight: 16,
  },
});
