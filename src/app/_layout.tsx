import { DarkTheme, DefaultTheme, router, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useRef } from 'react';
import { AppState, AppStateStatus, useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { ErrorBoundary } from '@/components/error-boundary';
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

export default function RootLayout() {
  const colorScheme = useColorScheme();
  useAutoRefresh();
  useFirstLaunchRouting();
  return (
    <ErrorBoundary>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <AnimatedSplashOverlay />
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="onboarding" options={{ headerShown: false }} />
          <Stack.Screen name="article" />
          <Stack.Screen name="team/[id]" />
          <Stack.Screen name="player/[id]" />
        </Stack>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
