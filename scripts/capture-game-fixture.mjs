#!/usr/bin/env node
/**
 * Captures a real ESPN scoreboard and one game's summary, trimmed to the
 * fields `scoreboard.ts` and `game-summary.ts` read, into
 * `src/lib/__fixtures__/`.
 *
 *   node scripts/capture-game-fixture.mjs football/nfl
 *   node scripts/capture-game-fixture.mjs football/college-football --groups 5
 *   node scripts/capture-game-fixture.mjs football/nfl --event 401872945 --force
 *
 * Picks `--event`, else the first game in progress, else refuses — the
 * point of running this on a game day is to catch the live shapes
 * (`situation`, `drives.current`) that a finished game doesn't have.
 *
 * Prints every distinct drive `result` and `status.type.name` it saw, so
 * `driveOutcome` in `src/lib/game.ts` can be checked against what ESPN
 * actually sends rather than what it's documented to.
 *
 * Plain Node `fetch`, no browser User-Agent: ESPN's August 2026 403s were
 * aimed at browser-like agents, and the app itself sends React Native's.
 * Doesn't import app modules (see scripts/lib/app-modules.mjs for why that
 * route has constraints); the trim below is the parser's field list by hand,
 * and a field the parser starts reading has to be added here too.
 */
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const sitePath = args.find((a) => !a.startsWith('--') && a.includes('/'));
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const force = args.includes('--force');

if (!sitePath) {
  console.error('usage: capture-game-fixture.mjs <sport/league> [--groups N] [--event ID] [--force]');
  process.exit(1);
}

const root = path.resolve(import.meta.dirname, '..', 'src', 'lib', '__fixtures__');
const scoreboardOut = path.join(root, 'espn-scoreboard.json');
const summaryOut = path.join(root, 'espn-game-summary.json');
if (!force && (existsSync(scoreboardOut) || existsSync(summaryOut))) {
  console.error('Fixtures already exist. Pass --force to replace them.');
  process.exit(1);
}

const base = `https://site.api.espn.com/apis/site/v2/sports/${sitePath}`;
const groups = flag('groups');

async function get(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} responded ${res.status}`);
  return res.json();
}

const board = await get(`${base}/scoreboard${groups ? `?groups=${groups}` : ''}`);
const events = board.events ?? [];
const stateOf = (e) => e.status?.type?.state;

const wanted = flag('event');
const chosen = wanted ? events.find((e) => e.id === wanted) : events.find((e) => stateOf(e) === 'in');
if (!chosen && !wanted) {
  console.error(`No game in progress on ${sitePath}. States seen: ${[...new Set(events.map(stateOf))].join(', ')}`);
  console.error('Pass --event <id> to capture a specific game anyway.');
  process.exit(1);
}
const eventId = chosen?.id ?? wanted;

// --- Scoreboard ------------------------------------------------------------

const pickTeam = (t) =>
  t && { id: t.id, abbreviation: t.abbreviation, location: t.location, shortDisplayName: t.shortDisplayName, displayName: t.displayName };

function trimEvent(e) {
  const c = e.competitions?.[0] ?? {};
  const s = e.status ?? {};
  return {
    id: e.id,
    date: e.date,
    status: {
      displayClock: s.displayClock,
      period: s.period,
      type: {
        name: s.type?.name,
        state: s.type?.state,
        completed: s.type?.completed,
        detail: s.type?.detail,
        shortDetail: s.type?.shortDetail,
      },
    },
    competitions: [
      {
        neutralSite: c.neutralSite,
        competitors: (c.competitors ?? []).map((x) => ({ homeAway: x.homeAway, score: x.score, team: pickTeam(x.team) })),
        broadcasts: c.broadcasts,
        geoBroadcasts: c.geoBroadcasts?.[0] ? [{ media: { shortName: c.geoBroadcasts[0].media?.shortName } }] : undefined,
        situation: c.situation
          ? {
              down: c.situation.down,
              distance: c.situation.distance,
              yardLine: c.situation.yardLine,
              possession: c.situation.possession,
              downDistanceText: c.situation.downDistanceText,
              isRedZone: c.situation.isRedZone,
              lastPlay: c.situation.lastPlay ? { text: c.situation.lastPlay.text } : undefined,
            }
          : undefined,
      },
    ],
  };
}

// The chosen game plus one of each other state, so the fixture covers all three.
const keep = [];
if (chosen) keep.push(chosen);
for (const state of ['in', 'pre', 'post']) {
  const other = events.find((e) => stateOf(e) === state && !keep.includes(e));
  if (other && keep.length < 4) keep.push(other);
}

// --- Summary ---------------------------------------------------------------

const summary = await get(`${base}/summary?event=${eventId}`);

function trimPlay(p) {
  return {
    id: p.id,
    text: p.text,
    type: p.type ? { text: p.type.text } : undefined,
    clock: p.clock ? { displayValue: p.clock.displayValue } : undefined,
    period: p.period ? { number: p.period.number } : undefined,
    scoringPlay: p.scoringPlay,
    homeScore: p.homeScore,
    awayScore: p.awayScore,
    end: p.end?.downDistanceText ? { downDistanceText: p.end.downDistanceText } : undefined,
  };
}

// First play, every scoring play, and the last three — enough to read a
// drive and keep the score trail honest, at a fraction of the size.
function trimPlays(plays = []) {
  return plays.filter((p, i) => i === 0 || p.scoringPlay || i >= plays.length - 3).map(trimPlay);
}

function trimDrive(d) {
  return {
    id: d.id,
    description: d.description,
    result: d.result,
    displayResult: d.displayResult,
    offensivePlays: d.offensivePlays,
    yards: d.yards,
    timeElapsed: d.timeElapsed ? { displayValue: d.timeElapsed.displayValue } : undefined,
    team: d.team ? { id: d.team.id, abbreviation: d.team.abbreviation } : undefined,
    plays: trimPlays(d.plays),
  };
}

const previous = (summary.drives?.previous ?? []).map(trimDrive);
const current = summary.drives?.current ? trimDrive(summary.drives.current) : undefined;
const keptPlayIds = new Set([...previous, ...(current ? [current] : [])].flatMap((d) => d.plays.map((p) => p.id)));
const header = summary.header?.competitions?.[0] ?? {};
const wp = summary.winprobability ?? [];

const trimmedSummary = {
  header: {
    competitions: [
      {
        date: header.date,
        broadcasts: (header.broadcasts ?? []).slice(0, 1).map((b) => ({ media: { shortName: b.media?.shortName } })),
        status: {
          displayClock: header.status?.displayClock,
          period: header.status?.period,
          type: {
            state: header.status?.type?.state,
            completed: header.status?.type?.completed,
            detail: header.status?.type?.detail,
            shortDetail: header.status?.type?.shortDetail,
          },
        },
        competitors: (header.competitors ?? []).map((x) => ({ homeAway: x.homeAway, score: x.score, team: pickTeam(x.team) })),
      },
    ],
  },
  drives: current ? { previous, current } : { previous },
  // The first point is ESPN's pregame expectation and matches no play; it
  // is kept because the catch-up swing reads it when there is no marker.
  winprobability: wp
    .filter((w, i) => i === 0 || keptPlayIds.has(w.playId))
    .map((w) => ({ playId: w.playId, homeWinPercentage: w.homeWinPercentage })),
};

/**
 * Indented like `JSON.stringify(x, null, 2)`, except that any object or
 * array short enough to fit on one line goes on one line — a play is one
 * line rather than twenty, which keeps a whole game reviewable in a diff.
 */
function format(value, indent = '') {
  const flat = JSON.stringify(value);
  if (flat === undefined || flat.length <= 600 || value === null || typeof value !== 'object') return flat;
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    return `[\n${value.map((v) => `${inner}${format(v, inner)}`).join(',\n')}\n${indent}]`;
  }
  const entries = Object.entries(value).filter(([, v]) => v !== undefined);
  return `{\n${entries.map(([k, v]) => `${inner}${JSON.stringify(k)}: ${format(v, inner)}`).join(',\n')}\n${indent}}`;
}

writeFileSync(scoreboardOut, `${format({ events: keep.map(trimEvent) })}\n`);
writeFileSync(summaryOut, `${format(trimmedSummary)}\n`);

console.log(`Captured event ${eventId} (${chosen?.name ?? 'by id'}) from ${sitePath}.`);
console.log(`Scoreboard: ${keep.length} events, states ${keep.map(stateOf).join(', ')}`);
console.log(`Summary: ${previous.length} drives${current ? ' + current' : ''}, ${keptPlayIds.size} plays kept, ${trimmedSummary.winprobability.length} win-probability points`);
console.log('Drive results seen:', [...new Set((summary.drives?.previous ?? []).map((d) => d.result))].join(', '));
console.log('Status names seen:', [...new Set(events.map((e) => e.status?.type?.name))].join(', '));
