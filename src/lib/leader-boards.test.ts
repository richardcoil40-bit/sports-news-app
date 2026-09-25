import { describe, expect, it } from 'vitest';

import { leaderBoards } from '@/lib/leader-boards';
import { League } from '@/lib/leagues';
import { Player } from '@/lib/roster';
import { StatLeader } from '@/lib/team-leaders';

function player(id: string, firstName: string, lastName: string): Player {
  return {
    id,
    fullName: `${firstName} ${lastName}`,
    firstName,
    lastName,
    jersey: id,
    position: 'QB',
    positionGroup: 'offense',
    headshotUrl: null,
    experienceYears: 2,
  };
}

function leader(
  categoryName: string,
  athleteId: string,
  rank: number,
  displayValue = '100',
  category = categoryName,
): StatLeader {
  return { athleteId, categoryName, category, displayValue, rank };
}

const FOOTBALL: League = {
  id: 'test-football',
  displayName: 'Test',
  espnSport: 'football',
  espnLeaguePath: 'college-football',
  leaderCategories: ['passingLeader', 'rushingLeader', 'sacks'],
};

const ROSTER = ['1', '2', '3', '4', '5'].map((id) => player(id, `First${id}`, `Last${id}`));

describe('leaderBoards', () => {
  it('shows the categories the league names, in the league’s order', () => {
    const boards = leaderBoards(
      [
        leader('sacks', '3', 0),
        leader('receptions', '4', 0), // not named by the league
        leader('rushingLeader', '2', 0),
        leader('passingLeader', '1', 0),
      ],
      ROSTER,
      FOOTBALL,
    );

    expect(boards.map((b) => b.name)).toEqual(['passingLeader', 'rushingLeader', 'sacks']);
  });

  it('shows every category in ESPN’s order when the league names none', () => {
    const boards = leaderBoards(
      [leader('pointsPerGame', '1', 0), leader('assistsPerGame', '2', 0)],
      ROSTER,
      { ...FOOTBALL, leaderCategories: undefined },
    );

    expect(boards.map((b) => b.name)).toEqual(['pointsPerGame', 'assistsPerGame']);
  });

  it('ignores a named category ESPN did not return', () => {
    const boards = leaderBoards([leader('passingLeader', '1', 0)], ROSTER, FOOTBALL);
    expect(boards.map((b) => b.name)).toEqual(['passingLeader']);
  });

  it('keeps the top three by rank', () => {
    const boards = leaderBoards(
      [
        leader('rushingLeader', '4', 3),
        leader('rushingLeader', '2', 1),
        leader('rushingLeader', '1', 0),
        leader('rushingLeader', '3', 2),
      ],
      ROSTER,
      FOOTBALL,
    );

    expect(boards[0].entries.map((e) => e.player.id)).toEqual(['1', '2', '3']);
  });

  // ESPN keeps a departed player in a completed season's leaders. Cutting
  // before the roster join would leave the card a player short.
  it('skips a leader no longer on the roster and fills the board from below', () => {
    const boards = leaderBoards(
      [
        leader('rushingLeader', '999', 0),
        leader('rushingLeader', '1', 1),
        leader('rushingLeader', '2', 2),
        leader('rushingLeader', '3', 3),
      ],
      ROSTER,
      FOOTBALL,
    );

    expect(boards[0].entries.map((e) => e.player.id)).toEqual(['1', '2', '3']);
  });

  it('drops a board whose leaders have all left', () => {
    const boards = leaderBoards([leader('sacks', '999', 0)], ROSTER, FOOTBALL);
    expect(boards).toEqual([]);
  });

  it('titles a card by the stat, without ESPN’s “Leader” suffix', () => {
    const boards = leaderBoards(
      [
        leader('passingLeader', '1', 0, '100', 'Passing Leader'),
        leader('sacks', '2', 0, '1', 'Sacks'),
      ],
      ROSTER,
      FOOTBALL,
    );

    expect(boards.map((b) => b.title)).toEqual(['Passing', 'Sacks']);
  });

  it('shows ESPN’s stat line as written, composite or bare', () => {
    const boards = leaderBoards(
      [
        leader('passingLeader', '1', 0, '56/79, 839 YDS, 6 TD', 'Passing Leader'),
        leader('sacks', '2', 0, '4.5', 'Sacks'),
      ],
      ROSTER,
      FOOTBALL,
    );

    expect(boards.map((b) => b.entries[0].detail)).toEqual(['56/79, 839 YDS, 6 TD', '4.5']);
  });

  // The player screen matches articles by name; a surname a teammate shares
  // isn't evidence about either of them.
  it('allows surname matching only when the surname is unique on the roster', () => {
    const roster = [player('1', 'Caleb', 'Downs'), player('2', 'Jamal', 'Downs'), player('3', 'Julian', 'Sayin')];
    const boards = leaderBoards(
      [leader('passingLeader', '3', 0), leader('rushingLeader', '1', 0)],
      roster,
      FOOTBALL,
    );

    expect(boards.map((b) => b.entries[0].matchesSurname)).toEqual([true, false]);
  });

  it('degrades to no boards on an empty roster or no leaders', () => {
    expect(leaderBoards([], ROSTER, FOOTBALL)).toEqual([]);
    expect(leaderBoards([leader('passingLeader', '1', 0)], [], FOOTBALL)).toEqual([]);
  });
});
