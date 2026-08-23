import { describe, expect, it } from 'vitest';

import {
  getNicknamesNeverRescued,
  getNicknameUsefulness,
  getVerdictDisagreements,
  getYieldEvents,
  recordNicknameRescue,
  recordVerdictDisagreement,
  recordYield,
  summarizeYieldByGroup,
} from '@/lib/diagnostics';
import { Verdict } from '@/lib/verdicts';

// Every export here is a module-scope log with no reset hook — same posture
// as verdicts.ts's memo (see AGENTS.md's Tests section) — so every case
// below uses a team/nickname/group name unique to it rather than relying on
// isolation between tests.

function verdict(teams: string[]): Verdict {
  return { sport: 'football', teams, claim: 'reported', kind: 'news' };
}

describe('recordVerdictDisagreement', () => {
  it('logs a false-positive candidate when the model does not back the school the nickname kept', () => {
    recordVerdictDisagreement(
      'Kentucky',
      'Wildcats',
      { title: 'Wildcats fall in overtime', link: 'https://example.com/fp-1' },
      verdict(['Kansas State']),
      'false-positive-candidate',
    );

    const found = getVerdictDisagreements().find((d) => d.articleLink === 'https://example.com/fp-1');
    expect(found).toMatchObject({ direction: 'false-positive-candidate', teamShortName: 'Kentucky' });
  });

  it('does not log a false-positive candidate when the model agrees', () => {
    recordVerdictDisagreement(
      'Nebraska',
      'Huskers',
      { title: 'Huskers win big', link: 'https://example.com/fp-2' },
      verdict(['Nebraska Cornhuskers']),
      'false-positive-candidate',
    );

    expect(getVerdictDisagreements().some((d) => d.articleLink === 'https://example.com/fp-2')).toBe(false);
  });

  it('logs a false-negative candidate when the model backs a school the filter rejected', () => {
    recordVerdictDisagreement(
      'Ohio State',
      'Buckeyes',
      { title: 'Buckeyes edge Ducks', link: 'https://example.com/fn-1' },
      verdict(['Ohio State']),
      'false-negative-candidate',
    );

    const found = getVerdictDisagreements().find((d) => d.articleLink === 'https://example.com/fn-1');
    expect(found).toMatchObject({ direction: 'false-negative-candidate' });
  });

  it('is a no-op for a null verdict — nothing to disagree with', () => {
    recordVerdictDisagreement(
      'Iowa',
      'Hawkeyes',
      { title: 'Hawkeyes preview', link: 'https://example.com/null-1' },
      null,
      'false-positive-candidate',
    );

    expect(getVerdictDisagreements().some((d) => d.articleLink === 'https://example.com/null-1')).toBe(false);
  });
});

describe('yield monitoring', () => {
  it('skips itemsIn === 0 — a quiet source is a success, not a yield problem', () => {
    recordYield('yield-test-empty-group', 'Purdue', 0, 0);
    expect(getYieldEvents().some((e) => e.group === 'yield-test-empty-group')).toBe(false);
  });

  it('summarizes per group and flags zero- and full-yield events', () => {
    recordYield('yield-test-group-a', 'Illinois', 10, 0);
    recordYield('yield-test-group-a', 'Illinois', 8, 4);

    const summary = summarizeYieldByGroup().find((s) => s.group === 'yield-test-group-a');
    expect(summary).toBeDefined();
    expect(summary?.itemsIn).toBe(18);
    expect(summary?.itemsKept).toBe(4);
    expect(summary?.hasZeroYieldEvent).toBe(true);
    expect(summary?.hasFullYieldEvent).toBe(false);
  });

  it('flags a full-yield event on a broad source that kept everything', () => {
    recordYield('yield-test-group-b', 'Indiana', 6, 6);

    const summary = summarizeYieldByGroup().find((s) => s.group === 'yield-test-group-b');
    expect(summary?.hasFullYieldEvent).toBe(true);
    expect(summary?.yieldPct).toBe(100);
  });
});

describe('getNicknamesNeverRescued', () => {
  it('flags a curated nickname that never rescued anything once the team has been checked', () => {
    // Purdue is curated as ['Boilermaker', 'Boilermakers'] in team-nicknames.ts.
    recordYield('local newsroom', 'Purdue', 5, 1);
    recordNicknameRescue('Purdue', 'Boilermaker');

    const never = getNicknamesNeverRescued().filter((n) => n.teamShortName === 'Purdue');
    expect(never).toEqual([{ teamShortName: 'Purdue', nickname: 'Boilermakers' }]);
  });

  it('does not flag a team that has never had a local-newsroom fetch logged', () => {
    // Wisconsin is curated but this test never calls recordYield for it.
    expect(getNicknamesNeverRescued().some((n) => n.teamShortName === 'Wisconsin')).toBe(false);
  });
});

describe('recordNicknameRescue', () => {
  it('counts rescues per team+nickname independently of same-named nicknames on other teams', () => {
    recordNicknameRescue('Kentucky', 'usefulness-test-wildcats');
    recordNicknameRescue('Kentucky', 'usefulness-test-wildcats');
    recordNicknameRescue('Northwestern', 'usefulness-test-wildcats');

    const all = getNicknameUsefulness();
    const kentucky = all.find((n) => n.teamShortName === 'Kentucky' && n.nickname === 'usefulness-test-wildcats');
    const northwestern = all.find(
      (n) => n.teamShortName === 'Northwestern' && n.nickname === 'usefulness-test-wildcats',
    );

    expect(kentucky?.rescued).toBe(2);
    expect(northwestern?.rescued).toBe(1);
  });
});
