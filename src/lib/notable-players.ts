import { Player } from '@/lib/roster';

/**
 * ESPN doesn't publish real depth charts this far ahead of the season (the
 * team depth-chart endpoint comes back empty until close to kickoff), so
 * there's no free API that ranks who's actually a starter. This picks a
 * "most notable" 15 as a proxy: one slot per marquee position, filled by
 * the most experienced player at that position (upperclassmen are more
 * likely to be featured than a true freshman). It's a heuristic, not a
 * real depth chart — worth swapping out if/when ESPN starts publishing
 * depth charts for the season.
 */
const POSITION_BUCKETS: { positions: string[]; slots: number }[] = [
  { positions: ['QB'], slots: 1 },
  { positions: ['RB', 'HB', 'FB'], slots: 2 },
  { positions: ['WR'], slots: 3 },
  { positions: ['TE'], slots: 1 },
  { positions: ['OT', 'OG', 'C', 'G', 'T', 'OL'], slots: 1 },
  { positions: ['DE', 'DT', 'NT', 'DL'], slots: 2 },
  { positions: ['LB', 'OLB', 'ILB', 'MLB'], slots: 2 },
  { positions: ['CB', 'S', 'FS', 'SS', 'DB'], slots: 2 },
  { positions: ['PK', 'K', 'P'], slots: 1 },
];

const TARGET_COUNT = 15;

function sortByNotability(players: Player[]): Player[] {
  return [...players].sort((a, b) => {
    const expA = a.experienceYears ?? -1;
    const expB = b.experienceYears ?? -1;
    if (expA !== expB) return expB - expA;
    const jerseyA = a.jersey ? parseInt(a.jersey, 10) : 999;
    const jerseyB = b.jersey ? parseInt(b.jersey, 10) : 999;
    return jerseyA - jerseyB;
  });
}

export function pickNotablePlayers(roster: Player[]): Player[] {
  const picked: Player[] = [];
  const pickedIds = new Set<string>();

  for (const bucket of POSITION_BUCKETS) {
    const candidates = sortByNotability(
      roster.filter((p) => p.position && bucket.positions.includes(p.position)),
    );
    for (const player of candidates.slice(0, bucket.slots)) {
      picked.push(player);
      pickedIds.add(player.id);
    }
  }

  if (picked.length < TARGET_COUNT) {
    const remaining = sortByNotability(roster.filter((p) => !pickedIds.has(p.id)));
    for (const player of remaining) {
      if (picked.length >= TARGET_COUNT) break;
      picked.push(player);
    }
  }

  return picked.slice(0, TARGET_COUNT);
}
