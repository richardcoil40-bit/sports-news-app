import {
  IBMPlexMono_400Regular,
  IBMPlexMono_500Medium,
  IBMPlexMono_600SemiBold,
  IBMPlexMono_700Bold,
} from '@expo-google-fonts/ibm-plex-mono';
import {
  Newsreader_400Regular,
  Newsreader_500Medium,
  Newsreader_600SemiBold,
  Newsreader_700Bold,
} from '@expo-google-fonts/newsreader';
import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, router, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useRef } from 'react';
import { AppState, AppStateStatus, useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { ErrorBoundary } from '@/components/error-boundary';
import { Colors, fontFamilyFor } from '@/constants/theme';
import { hasOnboarded, hydrateFavorites } from '@/lib/favorites';
import { refreshIfNewPeriod } from '@/lib/refresh-schedule';

SplashScreen.preventAutoHideAsync();

/**
 * Checks on launch and every time the app comes back to the foreground
 * whether we've moved into a new refresh window (morning/noon/night) since
 * the last check, forcing a fresh pull of the national feed pool if so. See
 * lib/refresh-schedule.ts for why this is foreground-triggered rather than
 * a true background job.
 */
function useAutoRefresh() {
  const appState = useRef(AppState.currentState);

  useEffect(() => {
    refreshIfNewPeriod();

    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (appState.current !== 'active' && next === 'active') {
        refreshIfNewPeriod();
      }
      appState.current = next;
    });

    return () => subscription.remove();
  }, []);
}

/**
 * Sends first-time users to the team picker before anything else. Reads
 * the persisted flag rather than inferring from "has no favorites," so
 * someone who deliberately unfollows every team isn't dragged back
 * through onboarding on their next launch.
 */
function useFirstLaunchRouting() {
  useEffect(() => {
    let cancelled = false;

    async function check() {
      await hydrateFavorites();
      const onboarded = await hasOnboarded();
      if (!cancelled && !onboarded) router.replace('/onboarding');
    }

    check();
    return () => {
      cancelled = true;
    };
  }, []);
}

/**
 * The four weights of each family that `fontFamilyFor` can hand back.
 * Deliberately not gated behind a loading screen: `useFonts` re-renders
 * when the faces land, the splash overlay covers the first few hundred
 * milliseconds anyway, and holding the tree back would mean the
 * first-launch redirect below fires at a navigator that isn't mounted.
 */
const FONTS = {
  Newsreader_400Regular,
  Newsreader_500Medium,
  Newsreader_600SemiBold,
  Newsreader_700Bold,
  IBMPlexMono_400Regular,
  IBMPlexMono_500Medium,
  IBMPlexMono_600SemiBold,
  IBMPlexMono_700Bold,
};

/**
 * React Navigation paints the native header and the screen background
 * itself, from its own theme rather than from `Colors` — left alone it
 * puts a white header and a white push transition behind the cream
 * paper. These map its slots onto the same tokens every other surface
 * reads, so the chrome is the same colour as the app.
 */
const NAV_THEMES = {
  light: {
    ...DefaultTheme,
    colors: {
      ...DefaultTheme.colors,
      background: Colors.light.background,
      card: Colors.light.background,
      text: Colors.light.text,
      border: Colors.light.text,
      primary: Colors.light.accent,
    },
  },
  dark: {
    ...DarkTheme,
    colors: {
      ...DarkTheme.colors,
      background: Colors.dark.background,
      card: Colors.dark.background,
      text: Colors.dark.text,
      border: Colors.dark.text,
      primary: Colors.dark.accent,
    },
  },
};

/**
 * The back label and header title are meta, not prose, so they ask for
 * the mono.
 *
 * Known not to take on iOS 26: the native header draws itself through
 * UIKit and ignores this family, under both the name `useFonts`
 * registers and the face's own PostScript name — both were tried. The
 * system sans in the nav bar is therefore deliberate-by-default rather
 * than overlooked. It is left declared because it does apply on Android,
 * and because the day the native header honours it, it should already be
 * right. Anything the design needs to control for certain has to be an
 * in-screen element instead.
 */
const HEADER_OPTIONS = {
  headerTitleStyle: { fontFamily: fontFamilyFor('mono', '600'), fontSize: 14 },
  headerBackTitleStyle: { fontFamily: fontFamilyFor('mono', '600'), fontSize: 12 },
} as const;

export default function RootLayout() {
  const colorScheme = useColorScheme();
  useFonts(FONTS);
  useAutoRefresh();
  useFirstLaunchRouting();
  return (
    <ErrorBoundary>
      <ThemeProvider value={colorScheme === 'dark' ? NAV_THEMES.dark : NAV_THEMES.light}>
        <AnimatedSplashOverlay />
        <Stack screenOptions={HEADER_OPTIONS}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="onboarding" options={{ headerShown: false }} />
          {/* Draws its own header from settings/_layout.tsx. */}
          <Stack.Screen name="article" />
          <Stack.Screen name="team/[id]" />
          <Stack.Screen name="player/[id]" />
        </Stack>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
