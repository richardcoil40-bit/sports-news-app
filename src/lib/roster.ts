const FETCH_TIMEOUT_MS = 10000;

export type PositionGroup = 'offense' | 'defense' | 'specialTeam';

export interface Player {
  id: string;
  fullName: string;
  firstName: string;
  lastName: string;
  jersey: string | null;
  position: string | null; // e.g. "QB"
  positionGroup: PositionGroup;
  headshotUrl: string | null;
}

interface RawAthlete {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  jersey?: string;
  position?: { abbreviation?: string };
  headshot?: { href?: string };
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

const POSITION_GROUPS: PositionGroup[] = ['offense', 'defense', 'specialTeam'];

export async function fetchTeamRoster(teamId: string): Promise<Player[]> {
  const url = `https://site.api.espn.com/apis/site/v2/sports/football/college-football/teams/${teamId}/roster`;
  const response = await fetchWithTimeout(url);
  if (!response.ok) throw new Error(`Roster responded ${response.status}`);
  const json = await response.json();
  const groups: { position: string; items: RawAthlete[] }[] = json?.athletes ?? [];

  const players: Player[] = [];
  for (const group of groups) {
    if (!POSITION_GROUPS.includes(group.position as PositionGroup)) continue;
    for (const athlete of group.items) {
      players.push({
        id: athlete.id,
        fullName: athlete.fullName,
        firstName: athlete.firstName,
        lastName: athlete.lastName,
        jersey: athlete.jersey ?? null,
        position: athlete.position?.abbreviation ?? null,
        positionGroup: group.position as PositionGroup,
        headshotUrl: athlete.headshot?.href ?? null,
      });
    }
  }

  return players;
}
