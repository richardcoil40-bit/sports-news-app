#!/usr/bin/env node
/**
 * Scores the source candidates that survived probing, against the criteria
 * in docs/source-reliability.md.
 *
 *   node scripts/review/vet.mjs <leagueId>          # dry run: what it would send
 *   node scripts/review/vet.mjs <leagueId> --ai     # actually asks the model
 *
 * ## Why --ai is opt-in and last
 *
 * The two free steps come first and do most of the work.
 * scripts/review/propose.mjs already rules out a candidate whose feed is
 * dead (it never returned items), whose chain is recorded dead (it is never
 * requested at all), and whose nickname would collide. What is left is the
 * small set where the question is genuinely "is this outlet any good",
 * which is the only question worth spending a model call on.
 *
 * So this defaults to printing the batch and sending nothing. A dry run
 * costs nothing and shows exactly what would go out, which is also the
 * honest way to find out that the answer is "four sources" and you may as
 * well read them yourself.
 *
 * ## What it produces, and what it is not
 *
 * `docs/review/<leagueId>.vetting.md` — a **proposal**, in its own file,
 * never the worksheet and never community-sources.ts. Two reasons for the
 * separate file: propose.mjs regenerates the worksheet and would wipe it,
 * and a model's opinion should not sit in the same field as a person's
 * decision. A tier is recorded when somebody writes it into the table with
 * their reasoning beside it. That rule is the whole point of the gate, and
 * it does not get an exception for being automated.
 *
 * ## Configuration
 *
 * `VET_URL` — the Worker's /v1/vet-source endpoint. Unset means --ai
 * cannot run, which is the default state: nothing here reaches the network
 * unless somebody has deployed the endpoint and set a second API key for
 * it. `VET_TOKEN` if the Worker has one set.
 */
import fs from 'node:fs';
import path from 'node:path';

import { loadTables, readSnapshot, REVIEW_DIR } from './tables.mjs';
import { parseWorksheet } from './worksheet.mjs';

const MAX_BATCH = 20;

function fail(message) {
  process.stderr.write(`vet.mjs: ${message}\n`);
  process.exit(1);
}

/**
 * A worksheet line from `source_candidates`, back into fields.
 *
 * Rendered by propose.mjs as `label owner in-app/candidate result`. Only
 * the candidates matter here — anything already in the app was vetted when
 * it went in, and re-scoring it would invite quietly re-tiering a source
 * that a person decided on.
 */
function candidateLines(answers) {
  const found = [];
  for (const [slug, answer] of answers) {
    for (const line of (answer.probe ?? '').split(/[\n,]/)) {
      const entry = line.trim();
      if (!entry) continue;
      const [host, owner = null] = entry.split('=').map((part) => part.trim());
      if (host) found.push({ id: `${slug}:${host}`, slug, host, owner });
    }
  }
  return found;
}

const leagueId = process.argv[2];
const useAi = process.argv.includes('--ai');
if (!leagueId || leagueId.startsWith('-')) fail('usage: node scripts/review/vet.mjs <leagueId> [--ai]');

const worksheetPath = path.join(REVIEW_DIR, `${leagueId}.review.md`);
if (!fs.existsSync(worksheetPath)) {
  fail(`no worksheet at ${path.relative(process.cwd(), worksheetPath)} — run propose.mjs ${leagueId} first`);
}
if (!readSnapshot().leagues?.[leagueId]) {
  fail(`${leagueId} is not in the roster snapshot — run propose.mjs ${leagueId} first`);
}

const answers = parseWorksheet(fs.readFileSync(worksheetPath, 'utf8'));
const { sources: community } = await loadTables();

// The free steps come first here too. A candidate on a chain already ruled
// dead is not a judgment call about quality — it is a paper with no feed,
// and asking a model to assess it would be paying to rediscover Gannett.
const dropped = [];
const candidates = candidateLines(answers).filter((candidate) => {
  const dead = candidate.owner ? community.DEAD_FEED_OWNERS[candidate.owner] : null;
  if (dead) dropped.push(`${candidate.id} — ${dead}`);
  return !dead;
});

if (dropped.length > 0) {
  process.stdout.write(`Skipped ${dropped.length} on a chain recorded dead:\n  ${dropped.join('\n  ')}\n\n`);
}

if (candidates.length === 0) {
  process.stdout.write(
    `Nothing to vet for ${leagueId}.\n` +
      'Candidates come from the `probe:` lines in the worksheet — add a host there\n' +
      `(\`journalstar.com=lee\`), re-run propose.mjs so it gets probed, then come back.\n`,
  );
  process.exit(0);
}

const batch = candidates.slice(0, MAX_BATCH).map((candidate) => ({
  id: candidate.id,
  name: candidate.host,
  host: candidate.host,
  url: `https://${candidate.host}`,
  owner: candidate.owner ?? undefined,
}));

if (!useAi) {
  process.stdout.write(
    [
      `${candidates.length} candidate${candidates.length === 1 ? '' : 's'} for ${leagueId}, and nothing was sent.`,
      '',
      ...batch.map((source) => `  ${source.id.padEnd(40)} ${source.owner ?? '—'}`),
      '',
      candidates.length > MAX_BATCH ? `Only the first ${MAX_BATCH} would go in one batch.` : '',
      'Re-run with --ai to score these against docs/source-reliability.md.',
      'That needs VET_URL pointing at a deployed Worker with VET_ANTHROPIC_API_KEY set;',
      'the endpoint is off until then, and does not borrow the app\'s key.',
      '',
    ]
      .filter((line) => line !== '')
      .join('\n') + '\n',
  );
  process.exit(0);
}

const url = process.env.VET_URL;
if (!url) {
  fail(
    'VET_URL is not set, so --ai has nowhere to go.\n' +
      'Point it at the Worker\'s /v1/vet-source endpoint. Off by default is the point: ' +
      'nothing in this directory reaches a model unless you have deployed that route ' +
      'and given it its own API key.',
  );
}

const response = await fetch(url, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    ...(process.env.VET_TOKEN ? { authorization: `Bearer ${process.env.VET_TOKEN}` } : {}),
  },
  body: JSON.stringify({ sources: batch }),
  signal: AbortSignal.timeout(120_000),
});

const body = await response.json().catch(() => null);
if (!response.ok) fail(`${url} responded ${response.status}: ${body?.error ?? '(no body)'}`);

const CRITERIA = [
  ['accountability', 'Accountability'],
  ['attribution', 'Attribution transparency'],
  ['independence', 'Independence'],
  ['originalReporting', 'Original reporting'],
  ['trackRecord', 'Track record'],
  ['stability', 'Stability'],
  ['businessModel', 'Business-model hygiene'],
];

const outPath = path.join(REVIEW_DIR, `${leagueId}.vetting.md`);
fs.writeFileSync(
  outPath,
  [
    `# ${leagueId} — source vetting proposal`,
    '',
    `From \`${body?.model ?? 'unknown model'}\` on ${new Date().toISOString().slice(0, 10)}, via ${url}.`,
    '',
    '**This is a proposal and nothing more.** A tier belongs in',
    'community-sources.ts only once a person has agreed with it and written the',
    'reasoning beside the entry. Treat `uncertain: true` and tier 0 as what they',
    'say they are — the model recognising a name is not the same as evidence, and',
    'tier 0 means not assessed rather than "probably fine". The criteria are',
    'docs/source-reliability.md.',
    '',
    ...(body?.results ?? []).flatMap(({ id, assessment }) => [
      `## ${id}`,
      '',
      `- **tier** ${assessment?.tier ?? '?'} · **scope** ${assessment?.scope ?? '?'}` +
        `${assessment?.uncertain ? ' · **uncertain**' : ''}`,
      `- ${assessment?.summary ?? '(no summary)'}`,
      '',
      ...CRITERIA.map(([field, label]) => `  - *${label}* — ${assessment?.[field] ?? '(not answered)'}`),
      '',
    ]),
  ].join('\n'),
);

process.stdout.write(
  `Vetted ${body?.results?.length ?? 0} candidates with ${body?.model ?? 'the model'}.\n` +
    `Wrote ${path.relative(process.cwd(), outPath)} — a proposal, not a decision.\n`,
);
