import { Image } from 'expo-image';
import * as SplashScreen from 'expo-splash-screen';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, Keyframe } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

const DURATION = 600;

/**
 * The JS half of the launch sequence: it re-draws the native splash so it
 * can be animated out, since the native one can only be hidden abruptly.
 *
 * Both halves have to agree or the seam shows. This used to paint
 * `#208AEF` — the colour the Expo template ships with, never updated
 * through either rebrand — so every cold launch went white (the native
 * splash), then bright blue, then the app. Reading the same tokens
 * `app.json`'s splash config is set to makes the handoff invisible in
 * both themes; if you retune `Colors.light.background` or
 * `Colors.dark.background`, update the `expo-splash-screen` plugin block
 * to match, because nothing enforces it.
 *
 * The mark is a separate asset per theme rather than a tinted one: it's
 * a solid glyph on transparency, so the dark variant is the same shape
 * repainted in `Colors.dark.text`.
 */
export function AnimatedSplashOverlay() {
  const [animate, setAnimate] = useState(false);
  const [visible, setVisible] = useState(true);
  const scheme = useColorScheme();
  const dark = scheme === 'dark';

  if (!visible) return null;

  const splashKeyframe = new Keyframe({
    0: {
      transform: [{ scale: 1 }],
      opacity: 1,
    },
    20: {
      opacity: 1,
    },
    70: {
      opacity: 0,
      easing: Easing.elastic(0.7),
    },
    100: {
      opacity: 0,
      transform: [{ scale: 1 }],
      easing: Easing.elastic(0.7),
    },
  });

  const ground = { backgroundColor: dark ? Colors.dark.background : Colors.light.background };
  const image = (
    <Image
      style={styles.image}
      source={
        dark
          ? require('@/assets/images/splash-icon-dark.png')
          : require('@/assets/images/splash-icon.png')
      }
    />
  );

  return animate ? (
    <Animated.View
      entering={splashKeyframe.duration(DURATION).withCallback((finished) => {
        'worklet';
        if (finished) {
          scheduleOnRN(setVisible, false);
        }
      })}
      style={[styles.splashOverlay, ground]}>
      {image}
    </Animated.View>
  ) : (
    <View
      onLayout={() => {
        SplashScreen.hideAsync().finally(() => {
          setAnimate(true);
        });
      }}
      style={[styles.splashOverlay, ground]}>
      {image}
    </View>
  );
}

const styles = StyleSheet.create({
  image: {
    width: 76,
    height: 71,
  },
  splashOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
});
