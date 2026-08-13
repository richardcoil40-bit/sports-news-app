/**
 * Vite's `?raw` suffix, used by the src/lib/ tests to load the XML fixtures as
 * strings. Node's `fs` isn't an option here: Expo's tsconfig.base sets
 * `customConditions: ["react-native"]`, under which `node:*` type definitions
 * don't resolve.
 */
declare module '*?raw' {
  const content: string;
  export default content;
}
