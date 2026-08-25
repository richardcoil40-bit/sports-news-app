#!/usr/bin/env node
/**
 * Post-deploy smoke test for the Worker in worker/.
 *
 *   node --env-file=.env --env-file=.env.local scripts/worker-smoke.mjs
 *
 * ## Why this exists
 *
 * The Worker is the one component with live users and no screen to look at,
 * and it is the only piece that can break builds that already shipped — a
 * bad `wrangler deploy` reaches every tester with no app release involved.
 * Until this file, `npm run typecheck` was the entire gate and nothing ever
 * called the deployed service. `/health` has existed since the first deploy
 * with no caller.
 *
 * Three assertions, in the order a deploy fails:
 *
 *   1. GET  /health        — did the deploy land at all
 *   2. GET  /v1/leagues    — does it serve a catalog the app would accept
 *   3. POST /v1/classify   — does the client token still authenticate
 *
 * ## Assertion 3 is the reason to run this
 *
 * ci_scripts/ci_post_clone.sh fails an Xcode Cloud build when
 * EXPO_PUBLIC_VERDICT_TOKEN is *unset*. That is right, and deliberate. But a
 * token that is set and *wrong* — rotated on the Worker, stale in .env.local —
 * sails through that gate, 401s on every POST /v1/classify, and the app
 * degrades silently to local verdict rules. classifyHeadlines resolves every
 * id to null, isRelevantVerdict reads null as "no basis to override the local
 * rules", and nothing anywhere says so. A slightly worse feed, no crash, no
 * error, nothing a tester would think to report.
 *
 * So this is checked against the same two files a build reads: `.env`
 * (tracked, the URLs) and `.env.local` (gitignored, the token). Run it any
 * other way and the assertion stops meaning what it says.
 *
 * ## It cannot spend against DAILY_CALL_CAP
 *
 * handleClassify checks CLIENT_TOKEN *before* it parses the body
 * (worker/src/index.ts). So this sends a deliberately invalid body and
 * expects **400**: a wrong token fails earlier, at 401, and a correct one
 * gets past auth and is rejected by the body parser. The request never
 * reaches KV, never reaches the model, and never records a call. Don't
 * "improve" this by sending a real headline — that costs a model call the
 * first time it runs and proves nothing extra.
 *
 * ## Why the league check is inline rather than parseLeagues
 *
 * It should import the app's own parser, and it can't: league-catalog.ts
 * imports __data__/leagues.json, and scripts/lib/app-modules.mjs documents
 * JSON imports as exactly what a plain-Node load cannot follow. So the four
 * required fields and the one availability rule are mirrored below, kept
 * deliberately small and pointed at their source. The *parsing* is covered
 * properly by league-catalog.test.ts and league-catalog-remote.test.ts under
 * Vitest; what those cannot tell you is whether the deployed Worker is
 * serving it, which is this file's whole job.
 */

const TIMEOUT_MS = 10_000;

/** Mirrors parseLeague + isAvailable in src/lib/league-catalog.ts. */
function availableLeagues(raw) {
  if (!Array.isArray(raw)) return [];
  const nonEmpty = (v) => typeof v === 'string' && v.trim() !== '';
  return raw.filter(
    (e) =>
      e &&
      typeof e === 'object' &&
      nonEmpty(e.id) &&
      nonEmpty(e.displayName) &&
      nonEmpty(e.espnSport) &&
      nonEmpty(e.espnLeaguePath) &&
      e.status !== 'planned',
  );
}

async function req(url, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

const failures = [];
function fail(name, detail) {
  failures.push(name);
  console.error(`  FAIL  ${name}\n        ${detail}`);
}
function pass(name, detail) {
  console.log(`  ok    ${name}${detail ? `  — ${detail}` : ''}`);
}

const verdictUrl = process.env.EXPO_PUBLIC_VERDICT_URL;
const catalogUrl = process.env.EXPO_PUBLIC_CATALOG_URL;
const token = process.env.EXPO_PUBLIC_VERDICT_TOKEN;

if (!verdictUrl && !catalogUrl) {
  console.error(
    'Neither EXPO_PUBLIC_VERDICT_URL nor EXPO_PUBLIC_CATALOG_URL is set.\n' +
      'Both live in .env (tracked). Run this as:\n' +
      '  node --env-file=.env --env-file=.env.local scripts/worker-smoke.mjs',
  );
  process.exit(2);
}

const base = (verdictUrl ?? catalogUrl).replace(/\/+$/, '');
console.log(`Worker smoke test — ${base}\n`);

// 1. Liveness.
try {
  const res = await req(`${base}/health`);
  const body = await res.json().catch(() => null);
  if (res.status !== 200) fail('GET /health', `expected 200, got ${res.status}`);
  else if (body?.ok !== true) fail('GET /health', `200 but body was ${JSON.stringify(body)}`);
  else pass('GET /health');
} catch (err) {
  fail('GET /health', `request failed: ${err.message}`);
}

// 2. A catalog the app would actually accept. fetchLeagueCatalog rejects a
//    document yielding no *available* league rather than degrading to empty,
//    because an empty catalog is an app with no tabs, no filters and no
//    favorites that renders as though it loaded fine. Same bar here.
try {
  const res = await req(`${(catalogUrl ?? base).replace(/\/+$/, '')}/v1/leagues`);
  if (res.status !== 200) {
    fail('GET /v1/leagues', `expected 200, got ${res.status}`);
  } else {
    const body = await res.json().catch(() => null);
    if (body === null) {
      fail('GET /v1/leagues', '200 but the body was not JSON');
    } else {
      const ok = availableLeagues(body);
      if (ok.length === 0) {
        fail(
          'GET /v1/leagues',
          'JSON parsed but yielded no available league — the app would reject this ' +
            'and stay on its bundled catalog',
        );
      } else {
        pass('GET /v1/leagues', `${ok.length} available: ${ok.map((l) => l.id).join(', ')}`);
      }
    }
  }
} catch (err) {
  fail('GET /v1/leagues', `request failed: ${err.message}`);
}

// 3. The token. See the header — an invalid body is the point, not an
//    oversight: auth is checked before the body is read, so 400 proves the
//    token was accepted without spending a model call.
if (!token) {
  fail(
    'POST /v1/classify (auth)',
    'EXPO_PUBLIC_VERDICT_TOKEN is unset. It lives in .env.local — pass ' +
      '--env-file=.env.local, or this proves nothing about what a build ships.',
  );
} else {
  try {
    const res = await req(`${base}/v1/classify`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: '{}',
    });
    if (res.status === 401) {
      fail(
        'POST /v1/classify (auth)',
        '401 — this token does not match the Worker\'s CLIENT_TOKEN secret. A build ' +
          'shipped with it gets a 401 on every classify and silently falls back to ' +
          'local verdict rules. Re-set it: cd worker && npx wrangler secret put CLIENT_TOKEN',
      );
    } else if (res.status === 400) {
      pass('POST /v1/classify (auth)', 'token accepted (400 on the empty body, as intended)');
    } else {
      fail('POST /v1/classify (auth)', `expected 400 for an empty body, got ${res.status}`);
    }
  } catch (err) {
    fail('POST /v1/classify (auth)', `request failed: ${err.message}`);
  }
}

console.log('');
if (failures.length > 0) {
  console.error(`${failures.length} of 3 checks failed: ${failures.join(', ')}`);
  process.exit(1);
}
console.log('All 3 checks passed.');
