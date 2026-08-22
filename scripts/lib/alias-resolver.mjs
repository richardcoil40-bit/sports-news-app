/**
 * Resolves the app's `@/…` import alias for plain Node.
 *
 * Registered by app-modules.mjs — see the argument there for why the
 * scripts read the real modules instead of parsing them.
 *
 * `@/lib/x` is a tsconfig path, which Node knows nothing about, so a hook
 * rewrites it to a file URL and appends the `.ts` the alias omits. That is
 * the whole job: Node 24 strips the types on its own.
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const SRC = path.resolve(fileURLToPath(new URL('../../src', import.meta.url)));

export async function resolve(specifier, context, nextResolve) {
  if (!specifier.startsWith('@/')) return nextResolve(specifier, context);
  const target = path.join(SRC, specifier.slice(2));
  return nextResolve(pathToFileURL(target.endsWith('.ts') ? target : `${target}.ts`).href, context);
}
