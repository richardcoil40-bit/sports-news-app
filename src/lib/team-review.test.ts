import { describe, expect, it } from 'vitest';

import snapshot from '@/lib/__data__/reviewed-teams.json';
import {
  bigTenSourceReviewFor,
  bigTenSourcesForTeam,
  communitySourceReviewIssues,
  CURATED_SOURCE_TABLES,
  secSourceReviewFor,
  secSourcesForTeam,
} from '@/lib/community-sources';
import { getLeagues } from '@/lib/league-catalog';
import { curatedTeams, nicknameHazards, reservedNames } from '@/lib/nickname-safety';
import { nicknameReviewFor, nicknameReviewIssues, teamNicknamesFor } from '@/lib/team-nicknames';
import { aliasIssues, teamSlug } from '@/lib/team-slug';

/**
 * The gate.
 *
 * A league cannot ship without a recorded human decision about every one
 * of its teams' names and sources. That used to be unenforceable, because
 * "nobody researched this team" and "researched, nothing to add" were the
 * same state — an absent key answering `[]`. Phase 3a made the two
 * distinguishable; this is what makes the distinction cost something.
 *
 * ## Why the roster comes from a file
 *
 * Tests here make no network calls, and the list of teams in a league is
 * ESPN's to say. So scripts/review/propose.mjs writes
 * `__data__/reviewed-teams.json` when it builds a league's worksheet, and
 * this reads it back. That indirection is the mechanism: a league in the
 * catalog with no snapshot has never been through the worksheet at all,
 * which is the first thing asserted below and the reason flipping a league
 * off `"status": "planned"` fails `npm test` until somebody does the work.
 *
 * This file used to hardcode its 34 teams inline, as team-nicknames.test.ts
 * still did for the ambiguity rule. Both were correct at 34 teams and
 * neither survives 900.
 */

const snapshotLeagues: Record<string, (typeof snapshot.leagues)[keyof typeof snapshot.leagues]> =
  snapshot.leagues;

/**
 * `[]` for a league whose sources nobody curates, which is a normal state:
 * a league ships on ESPN and the national pool, and curated sources are
 * backfilled. Missing *names* is the thing that isn't normal — those are
 * what every broad source is filtered on.
 */
function sourceReviewFor(leagueId: string, teamShortName: string) {
  return CURATED_SOURCE_TABLES[leagueId]?.reviewFor(teamShortName) ?? null;
}

describe('every shipped league has been through the worksheet', () => {
  for (const league of getLeagues()) {
    it(`${league.displayName} has a roster snapshot`, () => {
      expect(
        snapshotLeagues[league.id],
        `${league.id} is available in leagues.json but has no entry in reviewed-teams.json. ` +
          `Run \`node scripts/review/propose.mjs ${league.id}\` and fill in the worksheet, ` +
          'or set "status": "planned" until that happens.',
      ).toBeDefined();
    });
  }
});

describe('every shipped team has been ruled on', () => {
  for (const league of getLeagues()) {
    const teams = snapshotLeagues[league.id]?.teams ?? [];
    const curated = CURATED_SOURCE_TABLES[league.id];

    for (const team of teams) {
      it(`${league.id}/${team.shortName} — names${curated ? ' and sources' : ''}`, () => {
        // The snapshot's slug is written by a script with its own copy of
        // the slugifier; this is what keeps the two honest, and what would
        // catch a worksheet keyed on something the tables can't be read by.
        expect(teamSlug(team.shortName)).toBe(team.slug);

        expect(nicknameReviewFor(team.shortName).reviewed).toBe(true);
        if (curated) expect(sourceReviewFor(league.id, team.shortName)?.reviewed).toBe(true);
      });
    }
  }
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

/**
 * The ambiguity rule, generalized.
 *
 * team-nicknames.test.ts asserted this as nine hand-written words that
 * must not appear anywhere in the table. The words were right; the shape
 * didn't scale, and more importantly it asked the wrong question. Whether
 * a nickname is safe depends on the sources it is matched against, not on
 * the word — "Bulldogs" is Mississippi State's and safe, while "Lions"
 * belongs to nobody in college football because PennLive covers Detroit.
 * nickname-safety.ts draws that line, and scripts/review/propose.mjs shows
 * the reviewer the same answer before they paste rather than after.
 */
describe('no nickname is unsafe against the sources it runs on', () => {
  const hazards = nicknameHazards(curatedTeams(), reservedNames(snapshotLeagues));

  it('has no two teams claiming one word through a source they share', () => {
    expect(hazards.filter((hazard) => hazard.kind === 'shared-source')).toEqual([]);
  });

  it('has no team claiming a word reserved to a professional team', () => {
    expect(hazards.filter((hazard) => hazard.kind === 'reserved')).toEqual([]);
  });

  // Not a failure, and worth asserting anyway: the contested list is the
  // one that has to be re-read whenever a team gains a local paper, and a
  // silent change to it is a change to how much the rule above is holding
  // up. "Wildcats" is the whole story — Northwestern and Kentucky both
  // claim it, and both are safe today only because neither has a broad
  // source for it to run against.
  it('reports the contested words, which are safe by circumstance rather than by the word', () => {
    expect([...new Set(hazards.filter((h) => h.kind === 'contested').map((h) => h.nickname))]).toEqual([
      'Wildcat',
      'Wildcats',
    ]);
  });
});

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

  // The general form of that defect, rather than the one instance of it.
  // An alias exists to expand an abbreviation into the way a school is
  // written, which adds a word; one that drops a word has landed on a
  // different school, and every future alias goes through this.
  it('has no alias anywhere in the table that shortens rather than expands', () => {
    expect(aliasIssues()).toEqual([]);
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
