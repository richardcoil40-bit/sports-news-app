import { Stack } from 'expo-router';

/**
 * Settings is a stack of its own rather than four screens registered on
 * the root one, so the group's shared header options live in one place
 * and the section reads as a section.
 */
export default function SettingsLayout() {
  return <Stack screenOptions={{ headerBackTitle: 'Back' }} />;
}
