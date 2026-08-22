/**
 * The curated tables, assembled into the shape the review tooling reads.
 *
 * Everything here comes from the app's own modules — see
 * scripts/lib/app-modules.mjs for why the scripts import them rather than
 * parsing them. Nothing in this file is a second copy of the research; it
 * is a different arrangement of the same objects.
 */
import fs from 'node:fs';
import path from 'node:path';

import { loadAppModule } from '../lib/app-modules.mjs';

export const ROOT = path.resolve(import.meta.dirname, '../..');
export const SNAPSHOT_PATH = path.join(ROOT, 'src/lib/__data__/reviewed-teams.json');
export const CATALOG_PATH = path.join(ROOT, 'src/lib/__data__/leagues.json');
export const REVIEW_DIR = path.join(ROOT, 'docs/review');

/**
 * The bundled catalog, read as a file rather than imported.
 *
 * league-catalog.ts is the module that owns this, and it cannot be loaded
 * from plain Node — it imports the JSON, which needs an import attribute
 * Metro does not accept. Reading the file is the same bytes and no
 * validation, which is the honest trade for a script: `parseLeagues` is
 * the app's gate against a hostile catalog, and this is a developer's own
 * checkout.
 */
export function readCatalog() {
  return JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
}

export function readSnapshot() {
  try {
    return JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));
  } catch {
    return { leagues: {} };
  }
}

/**
 * A league counts as professional when its level says something other than
 * College.
 *
 * That distinction decides how hard a nickname collision is: a college
 * mascot shared by two schools is resolved by the region each is matched
 * in, and a professional team's name is not resolved by anything — see
 * nickname-safety.ts. Derived from the catalog rather than hardcoded,
 * because the catalog is where leagues are data.
 */
export function isProLeague(league) {
  return typeof league?.level === 'string' && league.level !== 'College';
}

/** Every module the review tooling reads, loaded once. */
export async function loadTables() {
  const [leagues, slug, nicknames, sources, safety] = await Promise.all([
    loadAppModule('@/lib/leagues'),
    loadAppModule('@/lib/team-slug'),
    loadAppModule('@/lib/team-nicknames'),
    loadAppModule('@/lib/community-sources'),
    loadAppModule('@/lib/nickname-safety'),
  ]);
  return { leagues, slug, nicknames, sources, safety };
}
