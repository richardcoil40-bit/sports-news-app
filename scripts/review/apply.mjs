#!/usr/bin/env node
/**
 * Turns a filled-in worksheet into the lines to paste, and refuses a
 * worksheet that isn't filled in.
 *
 *   node scripts/review/apply.mjs <leagueId>
 *
 * ## Why this refuses rather than defaults
 *
 * An empty `decision:` is the state the whole gate exists to make visible.
 * A tool that quietly treated it as "nothing to add" would put the league
 * back exactly where it started — a team nobody looked at, indistinguishable
 * from a team somebody cleared. So a blank decision is an error, and the
 * error names every team still waiting on one.
 *
 * ## Why it prints instead of writing
 *
 * The tables in community-sources.ts and team-nicknames.ts carry the
 * reasoning beside each entry, and that prose is the most valuable thing
 * in either file. A script that edited them would have to decide where a
 * comment goes, and would eventually move one off the entry it explains.
 * Pasting is a few seconds; a misplaced comment is a wrong answer that
 * reads as a right one.
 */
import fs from 'node:fs';
import path from 'node:path';

import { readSnapshot, REVIEW_DIR } from './tables.mjs';
import { parseWorksheet } from './worksheet.mjs';

const DECISIONS = ['approve', 'reject', 'edit'];

function fail(message) {
  process.stderr.write(`apply.mjs: ${message}\n`);
  process.exit(1);
}

/** `'a', 'b'` — single-quoted, matching the tables' style. */
function quoteList(value) {
  return value
    .split(/[\n,]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => `'${part.replace(/'/g, "\\'")}'`)
    .join(', ');
}

/**
 * One `sources:` line, as the entry it describes.
 *
 * `<owner> <id> <name> <host> [tier]` builds the helper call for a chain
 * whose path is already known — the shape most local papers take. Anything
 * else is passed through verbatim as a comment, because a source that
 * isn't one of the known chains needs a URL somebody verified, and
 * guessing one is how a plausible dead feed gets into the table.
 */
function sourceLine(line, ownerHelpers) {
  const parts = line.match(/"[^"]*"|\S+/g) ?? [];
  const [owner, id, name, host, tier] = parts.map((part) => part.replace(/^"|"$/g, ''));
  const helper = ownerHelpers[owner?.toLowerCase()];
  if (!helper || !id || !name || !host) return `// unparsed, needs a verified URL: ${line}`;
  const args = [id, name, host].map((part) => `'${part.replace(/'/g, "\\'")}'`);
  if (tier) args.push(tier);
  return `${helper}(${args.join(', ')}),`;
}

function main() {
  const leagueId = process.argv[2];
  if (!leagueId || leagueId.startsWith('-')) fail('usage: node scripts/review/apply.mjs <leagueId>');

  const worksheetPath = path.join(REVIEW_DIR, `${leagueId}.review.md`);
  if (!fs.existsSync(worksheetPath)) {
    fail(`no worksheet at ${path.relative(process.cwd(), worksheetPath)} — run propose.mjs ${leagueId} first`);
  }

  const snapshot = readSnapshot();
  const league = snapshot.leagues?.[leagueId];
  if (!league) fail(`${leagueId} is not in the roster snapshot — run propose.mjs ${leagueId} first`);

  const answers = parseWorksheet(fs.readFileSync(worksheetPath, 'utf8'));

  const undecided = [];
  const unknown = [];
  const unexplained = [];
  for (const team of league.teams) {
    const answer = answers.get(team.slug) ?? {};
    const decision = (answer.decision ?? '').trim().toLowerCase();
    if (!decision) undecided.push(team.slug);
    else if (!DECISIONS.includes(decision)) unknown.push(`${team.slug}: "${answer.decision}"`);
    else if (!answer.nicknames && !answer.notes) unexplained.push(team.slug);
  }

  if (undecided.length > 0) {
    fail(
      `${undecided.length} of ${league.teams.length} teams have no decision:\n  ${undecided.join('\n  ')}\n` +
        `\nFill them in at ${path.relative(process.cwd(), worksheetPath)}. ` +
        'A blank decision is the state this gate exists to catch, so none of them defaults.',
    );
  }
  if (unknown.length > 0) {
    fail(`decision must be one of ${DECISIONS.join(' / ')}:\n  ${unknown.join('\n  ')}`);
  }
  if (unexplained.length > 0) {
    fail(
      `${unexplained.length} teams have no nicknames and no notes:\n  ${unexplained.join('\n  ')}\n` +
        '\nAn empty entry needs a reason recorded beside it — write one under notes:. ' +
        'See NO_NICKNAME_REASONS in team-nicknames.ts.',
    );
  }

  return { leagueId, league, answers, worksheetPath };
}

const { leagueId, league, answers, worksheetPath } = main();
// The owner keywords a `sources:` line may start with, and the helper each
// one becomes. Same three as OWNER_FEED_URL in community-sources.ts.
const ownerHelpers = { advance: 'ADVANCE', lee: 'LEE', 'sb-nation': 'SB_NATION' };

const nicknameEntries = [];
const reasonEntries = [];
const sourceEntries = [];

for (const team of league.teams) {
  const answer = answers.get(team.slug) ?? {};
  nicknameEntries.push(`  ${JSON.stringify(team.slug)}: [${quoteList(answer.nicknames ?? '')}],`);
  if (!answer.nicknames && answer.notes) {
    reasonEntries.push(`  ${JSON.stringify(team.slug)}: ${JSON.stringify(answer.notes.replace(/\n+/g, ' '))},`);
  }
  const sources = (answer.sources ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (sources.length > 0) {
    sourceEntries.push(
      `  ${JSON.stringify(team.slug)}: [`,
      ...sources.map((line) => `    ${sourceLine(line, ownerHelpers)}`),
      '  ],',
    );
  }
}

process.stdout.write(
  [
    `# ${league.displayName} — entries to paste`,
    '',
    `From ${path.relative(process.cwd(), worksheetPath)}. Keys are quoted uniformly here;`,
    "the tables drop the quotes where a slug is a valid identifier, so match what's around them.",
    '',
    `## NICKNAMES_BY_SLUG in src/lib/team-nicknames.ts`,
    '',
    ...nicknameEntries,
    '',
    `## NO_NICKNAME_REASONS in the same file — required for every [] above`,
    '',
    ...(reasonEntries.length > 0 ? reasonEntries : ['  (none — every team above has an entry)']),
    '',
    `## ${leagueId.toUpperCase().replace(/-/g, '_')}_SOURCES_BY_SLUG in src/lib/community-sources.ts`,
    '',
    ...(sourceEntries.length > 0 ? sourceEntries : ['  (none proposed)']),
    '',
    'Then re-run `npm test` — team-review.test.ts is what checks the result,',
    'and it reads the tables rather than this output.',
    '',
  ].join('\n'),
);
