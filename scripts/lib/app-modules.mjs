/**
 * Reads the app's own data modules from a plain Node script.
 *
 * ## Why not parse them
 *
 * scripts/check-feeds.sh used to pull sources out of the TypeScript with a
 * regex over adjacent `name:`/`url:` lines, plus one special case for the
 * `SB_NATION(...)` helper. That works until the file grows a second helper:
 * the extractor then reports a smaller catalog rather than an error, and a
 * liveness report that silently checks two thirds of the sources looks
 * exactly like a clean one. Adding ADVANCE() and LEE() was precisely that
 * change, which is what prompted this.
 *
 * Importing the module removes the failure mode instead of patching it —
 * the script sees what the app sees, helpers and all, because it is the
 * same code.
 *
 * ## Why it works without a build step
 *
 * Node 24 strips TypeScript types on import, and every module reachable
 * from here is plain data with no runtime dependencies — the same property
 * that lets src/lib/ be tested under Vitest without a React Native
 * harness. Two constraints follow, and both are load-bearing:
 *
 * - **Type-only imports need the `type` keyword.** Node strips types
 *   syntactically and cannot know that `import { FeedSource }` names a
 *   type, so it emits a real import that fails at runtime.
 * - **Nothing reachable may import JSON or a package.** JSON needs an
 *   import attribute Metro does not accept, and a package needs
 *   node_modules, which the feed-check workflow deliberately does not
 *   install. That rules out league-catalog.ts (JSON) and anything pulling
 *   in feeds.ts at runtime (fast-xml-parser).
 *
 * Both are why `loadAppModule` throws with an explanation rather than
 * letting an ordinary module-resolution error surface.
 */
import { register } from 'node:module';

register('./alias-resolver.mjs', import.meta.url);

export async function loadAppModule(specifier) {
  try {
    return await import(specifier);
  } catch (error) {
    throw new Error(
      `could not load ${specifier} from plain Node: ${error.message}\n` +
        'Type-only imports in that file (or one it imports) need the `type` keyword, ' +
        'and nothing it reaches may import JSON or an npm package. ' +
        'See scripts/lib/app-modules.mjs.',
      { cause: error },
    );
  }
}
