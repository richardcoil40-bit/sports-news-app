#!/usr/bin/env node
/**
 * Pulls the verdicts Worker's runtime logs out of Cloudflare.
 *
 *   node scripts/worker-logs.mjs [--since 24h] [--limit N] [--errors]
 *                                [--json] [--script NAME]
 *
 * This is the same data as the Workers Logs tab in the Cloudflare dashboard,
 * fetched over the Observability API so it can be read here — and so the
 * answer to "what did the service do overnight" isn't a person squinting at
 * a log viewer at 200 events a page.
 *
 * ## Three days, and then it's gone
 *
 * Workers Logs on the free plan keeps events for **3 days** and includes
 * 200,000 a day. There is no archive behind it. A log nobody pulled inside
 * that window is not recoverable from anywhere, which is why this script
 * writes what it fetched to disk rather than only printing it.
 *
 * Nothing here is retained by us beyond that file: see the "What the
 * verdicts service sees" section of docs/data-retention.md, which this
 * script's existence is recorded in.
 *
 * ## Credentials
 *
 * Never in this repo, and never on the command line. Read from, in order:
 *
 *   1. env: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
 *   2. ~/.cloudflare/config.json — {"apiToken":…,"accountId":…}
 *
 * The same shape as ~/.appstoreconnect/ and outside the repo for the same
 * reason: `.gitignore` would catch it, but a rule you never have to rely on
 * is better than one you do.
 *
 * The token wants exactly one permission — **Account › Workers Observability
 * › Read** — created at dash.cloudflare.com/profile/api-tokens. Deliberately
 * not the wrangler OAuth token in ~/Library/Preferences/.wrangler: that one
 * carries workers_scripts (write) and kv (write), so a read-only script
 * holding it could deploy or delete. The account id is not a secret and is
 * printed on failure to make a mismatch visible; the token never is.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://api.cloudflare.com/client/v4';
const CONFIG_PATH = join(homedir(), '.cloudflare', 'config.json');
const OUT_DIR = join(REPO_ROOT, '.worker-logs');

/** Free-plan retention. Asking for more just returns an empty head. */
const MAX_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 || i === args.length - 1 ? fallback : args[i + 1];
};

const JSON_OUT = flag('json');
const ERRORS_ONLY = flag('errors');
const LIMIT = Math.min(Number(value('limit', '500')) || 500, 1000);
const SCRIPT_NAME = value('script', 'nofrills-verdicts');

/** `90m` / `24h` / `3d` → milliseconds. */
function parseSince(spec) {
  const m = /^(\d+)([mhd])$/.exec(String(spec).trim());
  if (!m) {
    throw new Error(`--since wants a number followed by m, h or d (got "${spec}")`);
  }
  const n = Number(m[1]);
  const unit = { m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2]];
  return n * unit;
}

async function credentials() {
  const fromEnv = {
    apiToken: process.env.CLOUDFLARE_API_TOKEN,
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
  };
  if (fromEnv.apiToken && fromEnv.accountId) return fromEnv;

  let file = {};
  try {
    file = JSON.parse(await readFile(CONFIG_PATH, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  const apiToken = fromEnv.apiToken ?? file.apiToken;
  const accountId = fromEnv.accountId ?? file.accountId;

  if (!apiToken || !accountId) {
    throw new Error(
      `No Cloudflare credentials.\n\n` +
        `Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID, or write ${CONFIG_PATH}:\n\n` +
        `  {"apiToken": "…", "accountId": "…"}\n\n` +
        `The token needs one permission: Account › Workers Observability › Read.\n` +
        `Create it at https://dash.cloudflare.com/profile/api-tokens`
    );
  }
  return { apiToken, accountId };
}

/**
 * POST /accounts/{id}/workers/observability/telemetry/query
 *
 * `queryId` is required and is just a label for the query — nothing is
 * saved by passing one. Filters are left off deliberately: this account
 * runs one Worker, so a wrong filter key would 400 where an unfiltered
 * query plus the client-side check below cannot.
 */
async function fetchEvents({ apiToken, accountId }, timeframe, limit) {
  const res = await fetch(`${API}/accounts/${accountId}/workers/observability/telemetry/query`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      queryId: 'nofrills-worker-logs',
      view: 'events',
      timeframe,
      limit,
      parameters: {},
    }),
  });

  const body = await res.text();
  if (!res.ok) {
    throw new Error(
      `Cloudflare answered ${res.status} for account ${accountId}.\n` +
        (res.status === 403
          ? `A 403 here is usually the token's permissions rather than the token itself — ` +
            `it needs Account › Workers Observability › Read.\n`
          : '') +
        body.slice(0, 800)
    );
  }

  let json;
  try {
    json = JSON.parse(body);
  } catch {
    throw new Error(`Cloudflare answered 200 with a body that isn't JSON:\n${body.slice(0, 400)}`);
  }
  if (json?.success === false) {
    throw new Error(`Cloudflare reported failure:\n${JSON.stringify(json.errors ?? json, null, 2)}`);
  }

  return json?.result?.events?.events ?? json?.result?.events ?? [];
}

/**
 * Flatten one event into the handful of fields worth reading. Written the
 * way the app reads external JSON — optional chaining and a fallback the
 * whole way down — because this shape is Cloudflare's to change.
 */
function shape(event) {
  const source = event?.$workers ?? event?.source ?? {};
  const meta = event?.$metadata ?? {};
  const req = source?.event?.request ?? {};
  const res = source?.event?.response ?? {};

  let path = null;
  try {
    path = req.url ? new URL(req.url).pathname : null;
  } catch {
    path = req.url ?? null;
  }

  return {
    at: new Date(Number(event?.timestamp ?? event?.$metadata?.timestamp ?? 0)).toISOString(),
    script: source?.scriptName ?? null,
    outcome: source?.outcome ?? null,
    status: res?.status ?? null,
    method: req.method ?? null,
    path,
    cpuMs: source?.cpuTimeMs ?? null,
    wallMs: source?.wallTimeMs ?? null,
    level: meta?.level ?? null,
    message: meta?.message ?? meta?.error ?? null,
  };
}

/** Anything that isn't a clean 2xx that completed. */
function isInteresting(row) {
  if (row.outcome && row.outcome !== 'ok') return true;
  if (row.level && ['error', 'warn', 'fatal'].includes(String(row.level).toLowerCase())) return true;
  if (typeof row.status === 'number' && row.status >= 400) return true;
  return false;
}

function tally(rows, key) {
  const counts = new Map();
  for (const row of rows) {
    const k = row[key] ?? '—';
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

async function main() {
  const sinceMs = parseSince(value('since', '24h'));
  if (sinceMs > MAX_WINDOW_MS) {
    console.warn(
      `note: --since ${value('since', '24h')} is past the 3-day free-plan retention; ` +
        `asking for 3d instead.`
    );
  }

  const to = Date.now();
  const from = to - Math.min(sinceMs, MAX_WINDOW_MS);

  const creds = await credentials();
  const events = await fetchEvents(creds, { from, to }, LIMIT);

  const all = events
    .map(shape)
    .filter((row) => !row.script || row.script === SCRIPT_NAME)
    .sort((a, b) => a.at.localeCompare(b.at));

  const rows = ERRORS_ONLY ? all.filter(isInteresting) : all;

  await mkdir(OUT_DIR, { recursive: true });
  const outPath = join(OUT_DIR, `logs-${new Date(to).toISOString().slice(0, 10)}.json`);
  await writeFile(
    outPath,
    JSON.stringify(
      {
        window: { from: new Date(from).toISOString(), to: new Date(to).toISOString() },
        events: rows,
        // `shape()` maps the fields worth skimming; `raw` is everything
        // Cloudflare sent. Both, because the field that explains an outage is
        // regularly one nothing thought to map — and the window this came from
        // is gone in three days, so a second pull isn't an option.
        raw: ERRORS_ONLY ? events.filter((e) => isInteresting(shape(e))) : events,
      },
      null,
      2
    )
  );

  if (JSON_OUT) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  const window = `${new Date(from).toISOString()} → ${new Date(to).toISOString()}`;
  const problems = all.filter(isInteresting);

  console.log(`${all.length} event${all.length === 1 ? '' : 's'} for ${SCRIPT_NAME}`);
  console.log(`window: ${window}`);
  console.log(`wrote:  ${outPath}\n`);

  if (all.length === 0) {
    console.log(
      `Nothing came back. Either the service genuinely had no traffic, or\n` +
        `observability isn't enabled on the deployed Worker — it's declared in\n` +
        `worker/wrangler.toml, but it only takes effect on the next\n` +
        `\`npx wrangler deploy\`.`
    );
    return;
  }

  for (const [label, key] of [
    ['by path', 'path'],
    ['by status', 'status'],
    ['by outcome', 'outcome'],
  ]) {
    console.log(`${label}:`);
    for (const [k, n] of tally(all, key)) console.log(`  ${String(k).padEnd(24)} ${n}`);
    console.log('');
  }

  console.log(`${problems.length} worth a look:`);
  for (const row of problems.slice(-40)) {
    const bits = [row.at, row.method, row.path, row.status, row.outcome, row.message]
      .filter((b) => b !== null && b !== undefined)
      .join(' ');
    console.log(`  ${bits}`);
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
