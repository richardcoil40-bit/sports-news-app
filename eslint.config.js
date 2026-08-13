// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

/**
 * src/lib/ is the data layer: plain TypeScript, no React and no React Native.
 * That's what lets it be tested directly under Vitest without the jest-expo
 * harness, and it's the boundary that keeps rendering concerns out of parsing
 * and caching code. Importing either from there is a design mistake rather
 * than a style preference — that code belongs in src/hooks/ or src/components/.
 */
const NO_REACT = [
  {
    name: 'react',
    message: 'src/lib/ is the plain-TypeScript data layer — React code belongs in src/hooks/ or src/components/.',
  },
  {
    name: 'react-native',
    message:
      'src/lib/ is the plain-TypeScript data layer — React Native code belongs in src/hooks/ or src/components/.',
  },
];

/**
 * The one declared exception, allowed in src/lib/storage.ts only. That file is
 * deliberately the single place in the app that touches disk (see its header
 * and docs/data-retention.md), so AsyncStorage is confined to it rather than
 * being reachable from anywhere in the data layer.
 */
const NO_ASYNC_STORAGE = {
  name: '@react-native-async-storage/async-storage',
  message: 'Only src/lib/storage.ts may touch AsyncStorage — everything persisted goes through it.',
};

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'ios/*', 'android/*', '.expo/*', 'expo-env.d.ts'],
  },
  {
    files: ['src/lib/**'],
    rules: {
      'no-restricted-imports': ['error', { paths: [...NO_REACT, NO_ASYNC_STORAGE] }],
    },
  },
  {
    files: ['src/lib/storage.ts'],
    rules: {
      'no-restricted-imports': ['error', { paths: NO_REACT }],
    },
  },
]);
