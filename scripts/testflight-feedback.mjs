#!/usr/bin/env node
/**
 * Pulls TestFlight tester feedback out of App Store Connect.
 *
 *   node scripts/testflight-feedback.mjs [--limit N] [--download] [--json]
 *                                        [--crashes] [--build N]
 *                                        [--new] [--mark]
 *   node scripts/testflight-feedback.mjs --builds [--limit N]
 *   node scripts/testflight-feedback.mjs --prep-archive
 *   node scripts/testflight-feedback.mjs --start-build [--branch NAME]
 *   node scripts/testflight-feedback.mjs --release [--build N]
 *                                        [--notes "..."] [--confirm]
 *
 * This is the same feedback that shows up under TestFlight → Feedback in
 * App Store Connect — a tester's screenshot plus whatever they typed —
 * fetched over Apple's REST API so it can be read here instead of by
 * squinting at the web UI and retyping it.
 *
 * ## Credentials
 *
 * Never in this repo, and never on the command line. Read from, in order:
 *
 *   1. env: ASC_KEY_ID, ASC_ISSUER_ID, ASC_PRIVATE_KEY (path to the .p8)
 *   2. ~/.appstoreconnect/config.json — {"keyId":…,"issuerId":…}
 *
 * with the key file defaulting to Apple's own documented location,
 * ~/.appstoreconnect/private_keys/AuthKey_<keyId>.p8. That directory is
 * outside the repo on purpose: `.gitignore` catches `*.p8`, but a rule
 * you never have to rely on is better than one you do.
 *
 * The key ID and issuer ID are not secrets (they identify the key, they
 * don't authorize it) and are printed on failure to make a typo visible.
 * The private key is never printed, logged, or written anywhere.
 *
 * ## The token
 *
 * ES256, twenty-minute life, `aud: appstoreconnect-v1`. Signed with
 * node:crypto rather than a JWT library so this stays dependency-free —
 * the only subtlety is `dsaEncoding: 'ieee-p1363'`, which is not the
 * default. Node signs ECDSA as DER unless told otherwise, and JWS wants
 * the raw r‖s pair; a DER signature here produces a 401 that reads like
 * a bad key rather than a bad encoding.
 *
 * ## The triaged ledger
 *
 * Apple offers no "archive" and no "mark as read". The only management
 * action on feedback is Delete, which is permanent and takes the tester's
 * report with it. So "already dealt with" is tracked on this side instead,
 * in docs/testflight-triaged.json: an id maps to the date it was triaged,
 * and `--new` hides anything present. A present key is a decision, an
 * absent key means nobody has looked yet — the same convention the team
 * review tables use.
 *
 * `--mark` records exactly what the run just printed, so the flow is pull,
 * review, then mark. Deliberately not one command that marks things you
 * haven't read yet.
 *
 * The ledger is tracked in git for the reason __data__/reviewed-teams.json
 * is: it's the record of what has been ruled on, and it's worth little if
 * it lives on one machine. It is also the reason nothing here calls Apple's
 * DELETE endpoint. The feedback stays where Apple put it, because that is
 * the only copy of it that exists.
 *
 * `--json` is a raw passthrough of Apple's response and ignores both flags.
 *
 * ## --builds is the other question this key can answer
 *
 * Not feedback at all: the processing and beta-testing state of what was
 * uploaded. It lives here rather than in its own script because the
 * credential handling above is the whole difficulty, and a second copy of
 * it is a second thing to get wrong. `--builds` short-circuits before any
 * feedback resource is fetched, so it shares nothing with the flags above
 * and ignores them apart from `--limit` and `--json`.
 *
 * It answers "did the build Apple has actually make it to testers", which
 * is the half of a health check the Worker logs can't see. A build stuck
 * at PROCESSING or sitting in BETA_REVIEW_REJECTED looks, from the app's
 * side, exactly like nobody opening the app.
 *
 * ## --prep-archive stops a manual archive being rejected at the last step
 *
 * Xcode Cloud overwrites CFBundleVersion with its own run counter when it
 * delivers, so the number on App Store Connect climbs without anything in
 * this repo changing. A manual archive reads ios/NoFrills/Info.plist
 * instead, which nothing updates — so the two drift apart silently, and
 * the first sign is an upload rejected for a duplicate or lower build
 * number, after the archive has already been built and signed.
 *
 * This asks Apple what the highest build number actually is and writes one
 * above it into Info.plist. Run it before Product → Archive.
 *
 * It writes Info.plist and not app.json deliberately: app.json's
 * buildNumber only reaches the native project through prebuild, which
 * won't re-run while ios/ exists, and prebuild would destroy the signing
 * config if it did. app.json is therefore not the source of truth for a
 * manual archive and is left alone rather than edited into agreement.
 *
 * ## --start-build and --release are the two halves of shipping
 *
 * Xcode Cloud only builds when asked — the workflow has no automatic
 * branch trigger, so merging to `main` as often as you like costs nothing
 * and four changes become one build rather than four.
 *
 * `--start-build` is the ask. `--release` is what happens after, and it
 * exists because **Xcode Cloud uploads but never distributes**: a
 * successful run leaves a build in App Store Connect attached to no
 * tester group, which looks identical to a finished release right up
 * until you notice nobody got it. Three calls close that gap — set the
 * release note, attach to every group, submit the external ones for beta
 * review — and doing them by hand is how one gets forgotten.
 *
 * `--release` prints its plan and changes nothing without `--confirm`.
 * That is the same split as `--new` / `--mark` above and for a stronger
 * reason: this one reaches real people.
 *
 * Every step re-checks before acting, so a re-run after a partial failure
 * reports what is already done instead of erroring.
 *
 * ## Why the app id isn't hardcoded
 *
 * It's resolved from the bundle identifier in app.json, so this keeps
 * working if the app is ever recreated in App Store Connect (which
 * issues a new numeric id) and so there's one less number to keep in
 * sync by hand.
 */

import { execFileSync } from 'node:child_process';
import { createSign } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://api.appstoreconnect.apple.com';
const CONFIG_DIR = join(homedir(), '.appstoreconnect');
const TRIAGED_PATH = join(REPO_ROOT, 'docs', 'testflight-triaged.json');

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 || i === args.length - 1 ? fallback : args[i + 1];
};

const LIMIT = Number(value('limit', '20'));
const DOWNLOAD = flag('download');
const JSON_OUT = flag('json');
const CRASHES = flag('crashes');
const BUILDS = flag('builds');
const PREP_ARCHIVE = flag('prep-archive');
const START_BUILD = flag('start-build');
const RELEASE = flag('release');
const CONFIRM = flag('confirm');
const NOTES = value('notes', null);
const BRANCH = value('branch', 'main');
const BUILD_FILTER = value('build', null);
const NEW_ONLY = flag('new');
const MARK = flag('mark');

/** Credentials, from env or the config file. Fails loudly and specifically. */
async function credentials() {
  let file = {};
  try {
    file = JSON.parse(await readFile(join(CONFIG_DIR, 'config.json'), 'utf8'));
  } catch {
    // Absent config file is fine — env may carry everything.
  }

  const keyId = process.env.ASC_KEY_ID ?? file.keyId;
  const issuerId = process.env.ASC_ISSUER_ID ?? file.issuerId;
  const keyPath =
    process.env.ASC_PRIVATE_KEY ??
    file.privateKeyPath ??
    (keyId ? join(CONFIG_DIR, 'private_keys', `AuthKey_${keyId}.p8`) : null);

  const missing = [
    !keyId && 'key ID (ASC_KEY_ID)',
    !issuerId && 'issuer ID (ASC_ISSUER_ID)',
    !keyPath && 'private key path (ASC_PRIVATE_KEY)',
  ].filter(Boolean);

  if (missing.length) {
    throw new Error(
      `Missing ${missing.join(', ')}.\n\n` +
        `Create a key at App Store Connect → Users and Access → Integrations →\n` +
        `App Store Connect API, then either set the env vars or write\n` +
        `${join(CONFIG_DIR, 'config.json')} as {"keyId":"…","issuerId":"…"}\n` +
        `and drop the .p8 at ${join(CONFIG_DIR, 'private_keys')}/AuthKey_<keyId>.p8`,
    );
  }

  let privateKey;
  try {
    privateKey = await readFile(keyPath, 'utf8');
  } catch {
    throw new Error(
      `Can't read the private key at ${keyPath}\n` +
        `Apple lets you download a .p8 exactly once — if it's lost, revoke the\n` +
        `key in App Store Connect and generate a new one.`,
    );
  }

  return { keyId, issuerId, privateKey };
}

const b64url = (input) =>
  Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

function mintToken({ keyId, issuerId, privateKey }) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' }));
  const payload = b64url(
    JSON.stringify({ iss: issuerId, iat: now, exp: now + 1200, aud: 'appstoreconnect-v1' }),
  );

  const signer = createSign('SHA256');
  signer.update(`${header}.${payload}`);
  // JWS wants the raw r‖s pair; node's default DER encoding yields a 401.
  const signature = signer.sign({ key: privateKey, dsaEncoding: 'ieee-p1363' });

  return `${header}.${payload}.${b64url(signature)}`;
}

async function get(token, path, { keyId, issuerId }) {
  const res = await fetch(path.startsWith('http') ? path : `${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const detail = (() => {
      try {
        return JSON.parse(body).errors?.map((e) => `${e.title}: ${e.detail}`).join('\n') || body;
      } catch {
        return body;
      }
    })();

    if (res.status === 401) {
      throw new Error(
        `401 Unauthorized (key ${keyId}, issuer ${issuerId})\n${detail}\n\n` +
          `Check the key ID and issuer ID against App Store Connect, and that the\n` +
          `key has a role that can see TestFlight feedback (Admin, App Manager,\n` +
          `Developer or Marketing).`,
      );
    }
    throw new Error(`${res.status} ${res.statusText} on ${path}\n${detail}`);
  }

  return res.json();
}

/**
 * The write half of `get`. Kept beside it so both render Apple's error
 * envelope the same way — the messages are the whole value when a POST is
 * rejected for a reason the docs don't cover.
 *
 * `status` and `detail` are attached to the thrown error because callers
 * here treat some failures as success: re-submitting a build that is
 * already in review is the expected outcome of a safe re-run, not a fault.
 */
async function send(token, method, path, body, { keyId, issuerId }) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();

  if (!res.ok) {
    const detail = (() => {
      try {
        return JSON.parse(text).errors?.map((e) => `${e.title}: ${e.detail}`).join('\n') || text;
      } catch {
        return text;
      }
    })();
    if (res.status === 401) {
      throw new Error(`401 Unauthorized (key ${keyId}, issuer ${issuerId})\n${detail}`);
    }
    const err = new Error(`${res.status} ${res.statusText} on ${method} ${path}\n${detail}`);
    err.status = res.status;
    err.detail = detail;
    throw err;
  }

  return text ? JSON.parse(text) : null;
}

/** Resolve the numeric App Store Connect id from app.json's bundle identifier. */
async function resolveApp(token, creds) {
  const appJson = JSON.parse(await readFile(join(REPO_ROOT, 'app.json'), 'utf8'));
  const bundleId = appJson?.expo?.ios?.bundleIdentifier;
  if (!bundleId) throw new Error('No expo.ios.bundleIdentifier in app.json');

  const json = await get(
    token,
    `/v1/apps?filter[bundleId]=${encodeURIComponent(bundleId)}&limit=1`,
    creds,
  );
  const app = json?.data?.[0];
  if (!app) {
    throw new Error(
      `No app in App Store Connect with bundle id ${bundleId}.\n` +
        `If the key is scoped to specific apps, make sure this one is included.`,
    );
  }
  return { id: app.id, name: app.attributes?.name ?? bundleId, bundleId };
}

/**
 * List a feedback resource. Apple 400s on an unknown sort or include rather
 * than ignoring it, and the exact spelling has moved since the API shipped —
 * so degrade to a plainer query instead of failing the whole run.
 */
async function listFeedback(token, appId, resource, creds) {
  const attempts = [
    `?sort=-createdDate&limit=${LIMIT}&include=tester,build`,
    `?sort=-createdDate&limit=${LIMIT}`,
    `?limit=${LIMIT}`,
  ];

  let lastError;
  for (const query of attempts) {
    try {
      return await get(token, `/v1/apps/${appId}/${resource}${query}`, creds);
    } catch (err) {
      lastError = err;
      if (!/^4\d\d|^400/.test(String(err.message))) throw err;
    }
  }
  throw lastError;
}

/** Index `included[]` by "type:id" so relationships can be resolved to names. */
function indexIncluded(json) {
  const map = new Map();
  for (const item of json?.included ?? []) map.set(`${item.type}:${item.id}`, item);
  return map;
}

function resolve(map, relationship) {
  const ref = relationship?.data;
  if (!ref) return null;
  return map.get(`${ref.type}:${ref.id}`) ?? null;
}

function screenshotUrls(attributes) {
  // Shape has drifted across releases; take whichever URL field is present.
  return (attributes?.screenshots ?? [])
    .map((shot) => shot?.url ?? shot?.imageAsset?.templateUrl ?? shot?.fileUrl)
    .filter(Boolean);
}

async function download(urls, outDir, prefix) {
  await mkdir(outDir, { recursive: true });
  const saved = [];
  for (const [i, url] of urls.entries()) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        saved.push(`  (failed: ${res.status} on screenshot ${i + 1})`);
        continue;
      }
      const path = join(outDir, `${prefix}-${i + 1}.png`);
      await writeFile(path, Buffer.from(await res.arrayBuffer()));
      saved.push(path);
    } catch (err) {
      saved.push(`  (failed: ${err.message})`);
    }
  }
  return saved;
}

/**
 * The triaged ledger, or an empty one. A missing, unreadable or malformed
 * file degrades to "nothing has been triaged" rather than throwing — the
 * worst case is re-reading feedback you've already seen, and that beats
 * refusing to show feedback at all.
 */
async function readTriaged() {
  try {
    const parsed = JSON.parse(await readFile(TRIAGED_PATH, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function writeTriaged(ledger) {
  await mkdir(dirname(TRIAGED_PATH), { recursive: true });
  await writeFile(TRIAGED_PATH, `${JSON.stringify(ledger, null, 2)}\n`);
}

function formatSubmission(item, included, index) {
  const a = item.attributes ?? {};
  const tester = resolve(included, item.relationships?.tester);
  const build = resolve(included, item.relationships?.build);

  const who =
    [tester?.attributes?.firstName, tester?.attributes?.lastName].filter(Boolean).join(' ') ||
    a.email ||
    'unknown tester';

  const when = a.createdDate ? new Date(a.createdDate).toLocaleString() : 'unknown date';
  const buildNumber = build?.attributes?.version ?? a.buildBundleId ?? '?';

  const lines = [
    `\n${'─'.repeat(72)}`,
    `[${index + 1}] ${who} — ${when}`,
    `    build ${buildNumber} · ${a.deviceModel ?? '?'} · iOS ${a.osVersion ?? '?'} · ${a.locale ?? '?'}`,
  ];

  if (a.comment) lines.push(`\n    "${a.comment.replace(/\n/g, '\n     ')}"`);
  else lines.push(`\n    (no comment — screenshot only)`);

  if (a.batteryPercentage != null || a.connectionType) {
    lines.push(
      `\n    ${[
        a.connectionType && `connection ${a.connectionType}`,
        a.batteryPercentage != null && `battery ${a.batteryPercentage}%`,
        a.appUptimeInMilliseconds != null &&
          `up ${Math.round(a.appUptimeInMilliseconds / 1000)}s`,
      ]
        .filter(Boolean)
        .join(' · ')}`,
    );
  }

  return { lines, urls: screenshotUrls(a), id: item.id };
}

/**
 * Build state, newest first. One request: `buildBetaDetail` and
 * `preReleaseVersion` are both includable on /v1/builds, so this doesn't
 * fan out per build.
 *
 * Read defensively — an `include` Apple declines to honour comes back as a
 * missing relationship rather than an error, and a build with no beta
 * detail yet is a real state (it's brand new), not a fault.
 */
async function reportBuilds(token, app, creds) {
  const json = await get(
    token,
    `/v1/builds?filter[app]=${app.id}&limit=${LIMIT}` +
      `&sort=-uploadedDate&include=preReleaseVersion,buildBetaDetail`,
    creds,
  );

  if (JSON_OUT) {
    console.log(JSON.stringify(json, null, 2));
    return;
  }

  const included = indexIncluded(json);
  const builds = json?.data ?? [];

  console.log(`${app.name} (${app.bundleId}) — app id ${app.id}`);
  console.log(`${builds.length} build${builds.length === 1 ? '' : 's'}, newest first\n`);

  if (!builds.length) {
    console.log('Nothing uploaded yet.');
    return;
  }

  for (const build of builds) {
    const a = build?.attributes ?? {};
    const train = resolve(included, build.relationships?.preReleaseVersion)?.attributes?.version;
    const detail = resolve(included, build.relationships?.buildBetaDetail)?.attributes ?? {};

    const version = `${train ?? '?'} (${a.version ?? '?'})`;
    const flags = [
      a.processingState && `processing=${a.processingState}`,
      detail.internalBuildState && `internal=${detail.internalBuildState}`,
      detail.externalBuildState && `external=${detail.externalBuildState}`,
      a.expired && 'EXPIRED',
    ].filter(Boolean);

    console.log(`  ${version}`);
    console.log(`      uploaded ${a.uploadedDate ? new Date(a.uploadedDate).toLocaleString() : 'unknown date'}`);
    console.log(`      ${flags.join('  ')}`);
    if (a.expirationDate && !a.expired) {
      console.log(`      expires  ${new Date(a.expirationDate).toLocaleDateString()}`);
    }
  }
}

/**
 * Set ios/NoFrills/Info.plist's CFBundleVersion above every build Apple
 * already has, so a manual archive can't collide with one Xcode Cloud
 * uploaded.
 *
 * The maximum is taken across every build rather than only those matching
 * the current short version. Scoping it per version would be technically
 * sufficient — Apple requires uniqueness within a CFBundleShortVersionString
 * — but a number that can go *down* when the version changes is a footgun
 * for no gain, and starting a new version's builds above the old one's
 * costs nothing.
 */
async function prepArchive(token, app, creds) {
  const plist = join(REPO_ROOT, 'ios', 'NoFrills', 'Info.plist');

  let current;
  try {
    current = execFileSync('plutil', ['-extract', 'CFBundleVersion', 'raw', plist], {
      encoding: 'utf8',
    }).trim();
  } catch {
    throw new Error(
      `Can't read ${relative(REPO_ROOT, plist)}\n` +
        `There's no generated native project here. That's normal on a fresh\n` +
        `clone — a manual archive needs one, and Xcode Cloud generates its own.`,
    );
  }

  const json = await get(
    token,
    `/v1/builds?filter[app]=${app.id}&limit=200&sort=-uploadedDate`,
    creds,
  );

  const numbers = (json?.data ?? [])
    .map((b) => Number(b.attributes?.version))
    .filter((n) => Number.isFinite(n));

  if (!numbers.length) {
    console.log(`${app.name} — App Store Connect has no builds yet.`);
    console.log(`Leaving CFBundleVersion at ${current}; nothing can collide with it.`);
    return;
  }

  const highest = Math.max(...numbers);
  const next = String(highest + 1);

  if (current === next) {
    console.log(`Already set: CFBundleVersion ${current}, highest on Apple ${highest}.`);
    return;
  }

  execFileSync('plutil', ['-replace', 'CFBundleVersion', '-string', next, plist]);

  const shortVersion = execFileSync(
    'plutil',
    ['-extract', 'CFBundleShortVersionString', 'raw', plist],
    { encoding: 'utf8' },
  ).trim();

  console.log(`${app.name} (${app.bundleId})`);
  console.log(`  highest build on App Store Connect : ${highest}`);
  console.log(`  CFBundleVersion was                : ${current}`);
  console.log(`  CFBundleVersion now                : ${next}`);
  console.log(`\nNext manual archive uploads as ${shortVersion} (${next}).`);
  if (Number(current) <= highest) {
    console.log(`Before this it would have been rejected — ${current} is not above ${highest}.`);
  }
  console.log(`\napp.json is deliberately untouched; see this file's header for why.`);
}

/**
 * Find the app's Xcode Cloud workflow. Discovered rather than hardcoded,
 * for the reason the app id is (see the header) — and because a workflow
 * id is the kind of opaque UUID nobody notices has gone stale.
 */
async function resolveWorkflow(token, app, creds) {
  const products = await get(token, `/v1/ciProducts?filter[app]=${app.id}&limit=10`, creds);
  const product = products?.data?.[0];
  if (!product) {
    throw new Error(
      `${app.name} has no Xcode Cloud product.\n` +
        `Set one up in App Store Connect, or archive from Xcode instead.`,
    );
  }

  const json = await get(token, `/v1/ciProducts/${product.id}/workflows?limit=50`, creds);
  const enabled = (json?.data ?? []).filter((w) => w.attributes?.isEnabled);

  if (!enabled.length) {
    throw new Error(`No enabled workflow on ${product.attributes?.name ?? product.id}.`);
  }
  if (enabled.length > 1) {
    throw new Error(
      `More than one enabled workflow, so which to build is ambiguous:\n` +
        enabled.map((w) => `  ${w.attributes.name}`).join('\n'),
    );
  }

  return { product, workflow: enabled[0] };
}

/** Ask Xcode Cloud for a build. The workflow has no automatic trigger. */
async function startBuild(token, app, creds) {
  const { product, workflow } = await resolveWorkflow(token, app, creds);

  const repos = await get(
    token,
    `/v1/ciProducts/${product.id}/primaryRepositories?limit=10`,
    creds,
  );
  const repo = repos?.data?.[0];
  if (!repo) throw new Error('No primary repository on the Xcode Cloud product.');

  // Naming the reference explicitly, rather than letting Apple pick a
  // default, so the run says on its face what it built.
  const refs = await get(token, `/v1/scmRepositories/${repo.id}/gitReferences?limit=200`, creds);
  const ref = (refs?.data ?? []).find(
    (r) => r.attributes?.name === BRANCH && r.attributes?.kind === 'BRANCH',
  );
  if (!ref) {
    throw new Error(
      `No branch "${BRANCH}" known to Xcode Cloud.\n` +
        `It only sees branches that have been pushed to the remote.`,
    );
  }

  const run = await send(token, 'POST', '/v1/ciBuildRuns', {
    data: {
      type: 'ciBuildRuns',
      relationships: {
        workflow: { data: { type: 'ciWorkflows', id: workflow.id } },
        sourceBranchOrTag: { data: { type: 'scmGitReferences', id: ref.id } },
      },
    },
  }, creds);

  const a = run?.data?.attributes ?? {};
  console.log(`${app.name} — started ${workflow.attributes.name} on ${BRANCH}`);
  console.log(`  run #${a.number ?? '(assigning)'}  ${a.executionProgress ?? 'PENDING'}`);
  console.log(`\nWatch it with --builds once it finishes, then release with --release.`);
}

/**
 * Turn an uploaded build into one testers actually have.
 *
 * Prints its plan and does nothing without --confirm. Each step checks
 * current state first, so re-running after a partial failure is safe and
 * reports what was already done.
 */
async function releaseBuild(token, app, creds) {
  const json = await get(
    token,
    `/v1/builds?filter[app]=${app.id}&limit=50` +
      `&sort=-uploadedDate&include=preReleaseVersion,buildBetaDetail`,
    creds,
  );
  const included = indexIncluded(json);
  const builds = json?.data ?? [];

  const target = BUILD_FILTER
    ? builds.find((b) => b.attributes?.version === BUILD_FILTER)
    : builds.find((b) => b.attributes?.processingState === 'VALID');

  if (!target) {
    throw new Error(
      BUILD_FILTER
        ? `No build ${BUILD_FILTER} for ${app.name}.`
        : `No build has finished processing yet. Check --builds.`,
    );
  }

  const train = resolve(included, target.relationships?.preReleaseVersion)?.attributes?.version;
  const detail = resolve(included, target.relationships?.buildBetaDetail)?.attributes ?? {};
  const label = `${train ?? '?'} (${target.attributes?.version})`;

  if (target.attributes?.processingState !== 'VALID') {
    throw new Error(
      `Build ${label} is ${target.attributes?.processingState}, not VALID.\n` +
        `Apple has to finish processing before it can go to testers.`,
    );
  }

  // Release note first: it is the only part testers read, and the only
  // part that is silently empty rather than visibly missing.
  const locs = await get(token, `/v1/builds/${target.id}/betaBuildLocalizations`, creds);
  const loc = (locs?.data ?? [])[0];
  const currentNote = loc?.attributes?.whatsNew ?? '';
  const noteChange = NOTES && NOTES !== currentNote;

  const groups = (await get(token, `/v1/apps/${app.id}/betaGroups?limit=50`, creds))?.data ?? [];
  const attachments = [];
  for (const group of groups) {
    const has = await get(token, `/v1/betaGroups/${group.id}/builds?limit=200`, creds);
    attachments.push({
      group,
      attached: (has?.data ?? []).some((b) => b.id === target.id),
    });
  }

  const hasExternal = groups.some((g) => !g.attributes?.isInternalGroup);
  const reviewDone = ['IN_BETA_TESTING', 'WAITING_FOR_REVIEW', 'IN_BETA_REVIEW'].includes(
    detail.externalBuildState,
  );
  const needsReview = hasExternal && !reviewDone;

  console.log(`${app.name} (${app.bundleId})`);
  console.log(`Releasing ${label} — internal=${detail.internalBuildState ?? '?'} ` +
    `external=${detail.externalBuildState ?? '?'}\n`);

  console.log('  release note :', noteChange ? 'set from --notes' :
    currentNote ? 'already set, unchanged' : 'EMPTY — pass --notes to fill it');
  const width = Math.max(...attachments.map((a) => (a.group.attributes?.name ?? '').length), 0);
  for (const { group, attached } of attachments) {
    const kind = group.attributes?.isInternalGroup ? 'internal' : 'external';
    console.log(`  ${(group.attributes?.name ?? group.id).padEnd(width)} (${kind}) :` +
      ` ${attached ? 'already attached' : 'attach'}`);
  }
  console.log('  beta review  :', !hasExternal ? 'not needed, no external group'
    : needsReview ? 'submit' : `already ${detail.externalBuildState}`);

  if (!CONFIRM) {
    console.log(`\nDry run — nothing changed. Re-run with --confirm to do it.`);
    return;
  }

  console.log('');

  if (noteChange) {
    if (!loc) throw new Error('No betaBuildLocalization on this build to write a note to.');
    await send(token, 'PATCH', `/v1/betaBuildLocalizations/${loc.id}`, {
      data: { type: 'betaBuildLocalizations', id: loc.id, attributes: { whatsNew: NOTES } },
    }, creds);
    console.log('  release note set');
  }

  for (const { group, attached } of attachments) {
    if (attached) continue;
    await send(token, 'POST', `/v1/betaGroups/${group.id}/relationships/builds`, {
      data: [{ type: 'builds', id: target.id }],
    }, creds);
    console.log(`  attached to ${group.attributes?.name ?? group.id}`);
  }

  if (needsReview) {
    try {
      await send(token, 'POST', '/v1/betaAppReviewSubmissions', {
        data: {
          type: 'betaAppReviewSubmissions',
          relationships: { build: { data: { type: 'builds', id: target.id } } },
        },
      }, creds);
      console.log('  submitted for beta review');
    } catch (err) {
      // A build already in review is the expected result of a safe re-run.
      if (err.status !== 409) throw err;
      console.log('  beta review already submitted');
    }
  }

  const after = await get(token, `/v1/builds/${target.id}/buildBetaDetail`, creds);
  const s = after?.data?.attributes ?? {};
  console.log(`\n${label} — internal=${s.internalBuildState ?? '?'} ` +
    `external=${s.externalBuildState ?? '?'}`);
  if (!NOTES && !currentNote) {
    console.log(`\nNo release note: testers get an update prompt with no explanation.`);
    console.log(`Fill it with --release --build ${target.attributes?.version} --notes "..." --confirm`);
  }
}

async function main() {
  const creds = await credentials();
  const token = mintToken(creds);
  const app = await resolveApp(token, creds);

  // Not a feedback resource at all — short-circuit before touching one.
  if (BUILDS) return reportBuilds(token, app, creds);
  if (PREP_ARCHIVE) return prepArchive(token, app, creds);
  if (START_BUILD) return startBuild(token, app, creds);
  if (RELEASE) return releaseBuild(token, app, creds);

  const resource = CRASHES ? 'betaFeedbackCrashSubmissions' : 'betaFeedbackScreenshotSubmissions';
  const json = await listFeedback(token, app.id, resource, creds);

  if (JSON_OUT) {
    console.log(JSON.stringify(json, null, 2));
    return;
  }

  const included = indexIncluded(json);
  let items = json?.data ?? [];

  if (BUILD_FILTER) {
    items = items.filter((item) => {
      const build = resolve(included, item.relationships?.build);
      return build?.attributes?.version === BUILD_FILTER;
    });
  }

  const ledgerKey = CRASHES ? 'crashes' : 'screenshots';
  const ledger = await readTriaged();
  const seen = ledger[ledgerKey] ?? {};
  const hidden = items.filter((item) => seen[item.id]).length;
  if (NEW_ONLY) items = items.filter((item) => !seen[item.id]);

  console.log(`${app.name} (${app.bundleId}) — app id ${app.id}`);
  console.log(
    `${items.length} ${CRASHES ? 'crash' : 'screenshot'} submission${items.length === 1 ? '' : 's'}` +
      `${NEW_ONLY ? ' not yet triaged' : ''}` +
      `${BUILD_FILTER ? ` for build ${BUILD_FILTER}` : ''}` +
      `${NEW_ONLY && hidden ? ` · ${hidden} already triaged, hidden` : ''}`,
  );

  if (!items.length) {
    console.log(
      NEW_ONLY && hidden
        ? `\nNothing new — all ${hidden} submission${hidden === 1 ? '' : 's'} Apple returned have\n` +
            `already been triaged (${relative(REPO_ROOT, TRIAGED_PATH)}).\n` +
            `Drop --new to see them again; nothing has been deleted.`
        : `\nNothing yet. Feedback only appears here once a tester submits it from\n` +
            `the TestFlight app (screenshot → Share Beta Feedback, or the Send\n` +
            `Feedback button on the build's page).`,
    );
    return;
  }

  const outDir = join(REPO_ROOT, '.testflight-feedback');

  for (const [i, item] of items.entries()) {
    const { lines, urls, id } = formatSubmission(item, included, i);
    console.log(lines.join('\n'));

    if (!urls.length) continue;

    if (DOWNLOAD) {
      const saved = await download(urls, outDir, `${id.slice(0, 8)}`);
      console.log(`\n    screenshots:`);
      for (const path of saved) console.log(`      ${path}`);
    } else {
      console.log(`\n    ${urls.length} screenshot(s) — re-run with --download to save them`);
    }
  }

  if (CRASHES) {
    console.log(
      `\n${'─'.repeat(72)}\nCrash logs are a sub-resource: ` +
        `/v1/betaFeedbackCrashSubmissions/<id>/crashLog`,
    );
  }

  if (MARK) {
    // Local date, not toISOString() — the run that reviews an evening's
    // feedback would otherwise stamp it with tomorrow's UTC date, which
    // disagrees with the local timestamps printed above it.
    const today = new Date().toLocaleDateString('en-CA');
    for (const item of items) seen[item.id] = today;
    ledger[ledgerKey] = seen;
    await writeTriaged(ledger);
    console.log(
      `\n${'─'.repeat(72)}\n` +
        `Marked ${items.length} submission${items.length === 1 ? '' : 's'} triaged ` +
        `(${relative(REPO_ROOT, TRIAGED_PATH)}).\n` +
        `Nothing was sent to App Store Connect — the feedback is untouched there.`,
    );
  }
}

main().catch((err) => {
  console.error(`\n${err.message}\n`);
  process.exit(1);
});
