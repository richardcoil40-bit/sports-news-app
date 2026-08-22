import { describe, expect, it } from 'vitest';

import {
  bigTenSourceReviewFor,
  bigTenSourcesForTeam,
  communitySourceReviewIssues,
  secSourceReviewFor,
  secSourcesForTeam,
} from '@/lib/community-sources';
import { nicknameReviewFor, nicknameReviewIssues, teamNicknamesFor } from '@/lib/team-nicknames';
import { teamSlug } from '@/lib/team-slug';

/**
 * ESPN's short names for the two leagues that ship, which is the list both
 * curated tables have to have an answer for. Written out rather than read
 * from ESPN because that is the point of the gate: a name appearing here
 * is a claim that somebody looked at it.
 */
const BIG_TEN = [
  'Illinois', 'Indiana', 'Iowa', 'Maryland', 'Michigan', 'Michigan St', 'Minnesota',
  'Nebraska', 'Northwestern', 'Ohio St', 'Oregon', 'Penn St', 'Purdue', 'Rutgers',
  'UCLA', 'USC', 'Washington', 'Wisconsin',
];

const SEC = [
  'Alabama', 'Arkansas', 'Auburn', 'Florida', 'Georgia', 'Kentucky', 'LSU',
  'Mississippi St', 'Missouri', 'Ole Miss', 'Oklahoma', 'South Carolina',
  'Tennessee', 'Texas', 'Texas A&M', 'Vanderbilt',
];

/**
 * The distinction the tables didn't used to make. `[]` answered both
 * "researched, nothing to add" and "nobody has looked", and the second one
 * is what ships a league with no local coverage and no sign of it.
 */
describe('reviewed is not the same as absent', () => {
  it('reports a researched team with nothing to add as reviewed', () => {
    expect(teamNicknamesFor('LSU')).toEqual([]);
    expect(nicknameReviewFor('LSU').reviewed).toBe(true);
  });

  it('gives the reason a deliberately empty entry needs', () => {
    expect(nicknameReviewFor('LSU').reason).toContain('Tigers');
  });

  it('reports a team nobody has looked at as unreviewed', () => {
    expect(teamNicknamesFor('Boise State')).toEqual([]);
    expect(nicknameReviewFor('Boise State')).toEqual({ reviewed: false, reason: null });
  });

  it('carries no reason for a team whose entry says everything', () => {
    expect(nicknameReviewFor('Nebraska')).toEqual({ reviewed: true, reason: null });
  });

  // The partial case, which is where most of the ownership research lands:
  // a team with a blog and no reachable metro paper is reviewed, and the
  // reason is why nothing sits beside the blog.
  it('keeps the reason for a team whose sources are partial', () => {
    expect(bigTenSourcesForTeam('Iowa').length).toBeGreaterThan(0);
    expect(bigTenSourceReviewFor('Iowa').reason).toContain('Gannett');
    expect(secSourcesForTeam('Tennessee').length).toBeGreaterThan(0);
    expect(secSourceReviewFor('Tennessee').reason).toContain('Knoxville News Sentinel');
  });

  it('names a chain once and composes it, rather than restating it per team', () => {
    const [indiana, purdue] = [bigTenSourceReviewFor('Indiana'), bigTenSourceReviewFor('Purdue')];
    expect(indiana.reason).toContain('Indianapolis Star');
    expect(purdue.reason).toContain('Indianapolis Star');
    expect(secSourceReviewFor('Kentucky').reason).toContain('McClatchy');
  });
});

/**
 * A reason that has drifted off its entry is invisible at every call site
 * — it reads as research still in force. So does an empty entry with no
 * reason, which is exactly the state this whole change exists to make
 * impossible to ship unnoticed.
 */
describe('the tables and their reasons agree', () => {
  it('has no nickname entry that is empty without a reason, and no orphan reason', () => {
    expect(nicknameReviewIssues()).toEqual([]);
  });

  it('has no source entry that is empty without a reason, and no orphan reason', () => {
    expect(communitySourceReviewIssues()).toEqual([]);
  });
});

/** The gate itself, at the size it can be asserted at today. */
describe('every shipped team has been ruled on', () => {
  for (const name of BIG_TEN) {
    it(`${name} — nicknames and Big Ten sources`, () => {
      expect(nicknameReviewFor(name).reviewed).toBe(true);
      expect(bigTenSourceReviewFor(name).reviewed).toBe(true);
    });
  }

  for (const name of SEC) {
    it(`${name} — nicknames and SEC sources`, () => {
      expect(nicknameReviewFor(name).reviewed).toBe(true);
      expect(secSourceReviewFor(name).reviewed).toBe(true);
    });
  }
});

/**
 * `washington-st` used to alias to `washington`, where every other alias
 * expands an ESPN abbreviation to the *same* school. Washington State
 * would have been served Washington's nicknames and Washington's sources —
 * the Seattle Times and UW Dawg Pound — and nothing on the screen would
 * have looked wrong. Latent only because neither shipped league has it.
 */
describe('an alias resolves to the same school', () => {
  it('does not let Washington State resolve to Washington', () => {
    expect(teamSlug('Washington St')).toBe('washington-state');
    expect(teamSlug('Washington St')).not.toBe(teamSlug('Washington'));
  });

  it('does not hand Washington State the Huskies', () => {
    expect(teamNicknamesFor('Washington')).toContain('Huskies');
    expect(teamNicknamesFor('Washington St')).toEqual([]);
  });

  it('does not hand Washington State the Seattle Times', () => {
    expect(bigTenSourcesForTeam('Washington St')).toEqual([]);
  });

  // And with the alias fixed, the review state says the true thing about
  // it: nobody has researched Washington State, rather than "reviewed,
  // here is another school's work".
  it('reports Washington State as unreviewed', () => {
    expect(nicknameReviewFor('Washington St').reviewed).toBe(false);
    expect(bigTenSourceReviewFor('Washington St').reviewed).toBe(false);
  });

  it('still expands the abbreviations that do resolve to the same school', () => {
    expect(teamSlug('Michigan St')).toBe('michigan-state');
    expect(teamSlug('Mississippi St')).toBe('mississippi-state');
    expect(teamSlug('Ohio St')).toBe('ohio-state');
    expect(teamSlug('Penn St')).toBe('penn-state');
    expect(teamSlug('Texas A&M')).toBe('texas-am');
  });
});
