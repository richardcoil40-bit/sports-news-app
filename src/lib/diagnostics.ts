import { Article } from '@/lib/feeds';
import { teamNicknamesFor } from '@/lib/team-nicknames';
import { Verdict } from '@/lib/verdicts';

/**
 * Runtime signals for the three things the review gate (`team-review.ts`)
 * can't see: a nickname the classifier disagrees with, a source group
 * whose filter has stopped doing anything, and a nickname that never
 * rescues an article. The gate catches *unreviewed* teams; these catch
 * *reviewed-but-wrong* ones — see the plan's "Phase 3d" for the framing.
 *
 * All three are read off work the app already does — the classify call
 * `team-news-pool.ts` makes for filtering, and the name-matching it already
 * runs per source group — so collecting them costs no extra network call.
 * The one exception is the false-negative half of verdict disagreement,
 * which does cost an extra classify call and is gated on `__DEV__` at its
 * call site in `team-news-pool.ts`, not here.
 *
 * Everything below is a bounded in-process log: per-device, in-memory, and
 * gone on force-quit, same as every other cache in this directory (see
 * `docs/data-retention.md`). It exists to be read by a dev-gated screen,
 * `src/app/settings/diagnostics.tsx` — nothing here is persisted or sent
 * anywhere. This file stays plain TypeScript like the rest of `src/lib/`
 * (see AGENTS.md's Lint section) even though its only reader is a screen.
 */

/**
 * These grow with *use* — every team fetched, every headline classified —
 * not with the catalog, so each log is capped the same way the entity
 * caches in `cache.ts` are: a `maxEntries` on something with no natural
 * ceiling. A rolling window of "just happened" is what a runtime-detection
 * screen needs; a full history is not.
 */
const MAX_DISAGREEMENTS = 200;
const MAX_YIELD_EVENTS = 300;

function pushBounded<T>(list: T[], item: T, max: number): void {
  list.push(item);
  if (list.length > max) list.splice(0, list.length - max);
}

// ---------------------------------------------------------------------------
// 1. Verdict disagreement — the "Wildcats" hazard, caught by the classifier
// ---------------------------------------------------------------------------

export type DisagreementDirection =
  /** The nickname filter kept this article for a team; the classifier's own
   * team list doesn't mention that school at all. */
  | 'false-positive-candidate'
  /** The nickname/school filter rejected this article; the classifier's
   * team list mentions the school anyway. Dev-only — see the sampling note
   * in team-news-pool.ts, since generating this direction costs an extra
   * classify call the pool wouldn't otherwise make. */
  | 'false-negative-candidate';

export interface VerdictDisagreement {
  teamShortName: string;
  /** The nickname that decided this article's fate — the specific word
   * being cross-checked, not the whole team-nicknames.ts entry. */
  nickname: string;
  articleTitle: string;
  articleLink: string;
  verdictTeams: string[];
  direction: DisagreementDirection;
  at: number;
}

const disagreements: VerdictDisagreement[] = [];

/**
 * Whether `verdict.teams` plausibly names `teamShortName`. Deliberately
 * loose (substring, either direction) rather than an exact match: the
 * model's team list is free text ("Nebraska", "Nebraska Cornhuskers",
 * "Huskers") and this only needs to separate "mentions this school in some
 * form" from "doesn't," not parse it precisely.
 */
function verdictMentionsSchool(verdict: Verdict, teamShortName: string): boolean {
  const school = teamShortName.toLowerCase();
  return verdict.teams.some((t) => {
    const name = t.toLowerCase();
    return name.includes(school) || school.includes(name);
  });
}

/**
 * Call for an article the nickname/school filter already decided to keep
 * *or* reject, once a classify verdict is available for it. `verdict` is
 * whatever `classifyHeadlines` resolved — `null` (service unset, timed
 * out, over its cap, or errored) means there's nothing to disagree with,
 * so this is a no-op rather than a logged event.
 *
 * `direction` says which half of the disagreement this is: a kept article
 * the model doesn't back is a false-positive candidate, a rejected one the
 * model does back is a false-negative candidate.
 */
export function recordVerdictDisagreement(
  teamShortName: string,
  nickname: string,
  article: Pick<Article, 'title' | 'link'>,
  verdict: Verdict | null,
  direction: DisagreementDirection,
): void {
  if (!verdict) return;

  const mentionsSchool = verdictMentionsSchool(verdict, teamShortName);
  // A false-positive candidate is a disagreement when the model does NOT
  // back the school; a false-negative candidate is a disagreement when the
  // model DOES back it despite the local filter's rejection. Agreement in
  // either case is exactly what nothing-to-see-here looks like.
  const isDisagreement = direction === 'false-positive-candidate' ? !mentionsSchool : mentionsSchool;
  if (!isDisagreement) return;

  pushBounded(
    disagreements,
    {
      teamShortName,
      nickname,
      articleTitle: article.title,
      articleLink: article.link,
      verdictTeams: verdict.teams,
      direction,
      at: Date.now(),
    },
    MAX_DISAGREEMENTS,
  );
}

export function getVerdictDisagreements(): readonly VerdictDisagreement[] {
  return disagreements;
}

// ---------------------------------------------------------------------------
// 2. Yield monitoring — pure arithmetic on the choke points that already
//    call filterArticlesForTeams
// ---------------------------------------------------------------------------

export interface YieldEvent {
  group: string;
  teamShortName: string;
  itemsIn: number;
  itemsKept: number;
  at: number;
}

const yieldEvents: YieldEvent[] = [];

/**
 * Logs one name-filter pass. `itemsIn === 0` is skipped rather than logged
 * as 0% — an empty *source* answering with nothing is a quiet publisher
 * (AGENTS.md's "a feed with zero items is still a success"), not a filter
 * problem, and there's nothing this signal can say about a filter that
 * never ran.
 */
export function recordYield(group: string, teamShortName: string, itemsIn: number, itemsKept: number): void {
  if (itemsIn === 0) return;
  pushBounded(yieldEvents, { group, teamShortName, itemsIn, itemsKept, at: Date.now() }, MAX_YIELD_EVENTS);
}

export function getYieldEvents(): readonly YieldEvent[] {
  return yieldEvents;
}

/** Per-group rollup for the diagnostics screen: total in/kept across every
 * logged event for that group, plus the two shapes worth flagging. Neither
 * threshold is a hard failure — both are "worth a human look," which is
 * the whole posture of a runtime-detection screen rather than a gate. */
export interface GroupYieldSummary {
  group: string;
  events: number;
  itemsIn: number;
  itemsKept: number;
  yieldPct: number;
  /** At least one logged event kept nothing at all — the nickname stopped
   * matching, or the feed reshaped. */
  hasZeroYieldEvent: boolean;
  /** At least one logged event kept everything it was handed — for a
   * broad-scoped source that's the filter not filtering. */
  hasFullYieldEvent: boolean;
}

export function summarizeYieldByGroup(): GroupYieldSummary[] {
  const byGroup = new Map<string, YieldEvent[]>();
  for (const event of yieldEvents) {
    const list = byGroup.get(event.group);
    if (list) list.push(event);
    else byGroup.set(event.group, [event]);
  }

  return Array.from(byGroup.entries()).map(([group, events]) => {
    const itemsIn = events.reduce((sum, e) => sum + e.itemsIn, 0);
    const itemsKept = events.reduce((sum, e) => sum + e.itemsKept, 0);
    return {
      group,
      events: events.length,
      itemsIn,
      itemsKept,
      yieldPct: itemsIn === 0 ? 0 : (itemsKept / itemsIn) * 100,
      hasZeroYieldEvent: events.some((e) => e.itemsKept === 0),
      hasFullYieldEvent: events.some((e) => e.itemsKept === e.itemsIn),
    };
  });
}

// ---------------------------------------------------------------------------
// 3. Per-nickname usefulness — how many articles each nickname rescued
//    *alone*, school name absent
// ---------------------------------------------------------------------------

export interface NicknameUsefulness {
  teamShortName: string;
  nickname: string;
  rescued: number;
  lastRescuedAt: number;
}

const nicknameUsefulness = new Map<string, NicknameUsefulness>();

function nicknameKey(teamShortName: string, nickname: string): string {
  return `${teamShortName}::${nickname}`;
}

/** Call once per article a nickname rescued on its own — see
 * `trackNicknameRescues` in team-news-pool.ts, the one caller. */
export function recordNicknameRescue(teamShortName: string, nickname: string): void {
  const key = nicknameKey(teamShortName, nickname);
  const existing = nicknameUsefulness.get(key);
  nicknameUsefulness.set(key, {
    teamShortName,
    nickname,
    rescued: (existing?.rescued ?? 0) + 1,
    lastRescuedAt: Date.now(),
  });
}

export function getNicknameUsefulness(): readonly NicknameUsefulness[] {
  return Array.from(nicknameUsefulness.values());
}

/**
 * Curated nicknames for a team whose local-newsroom filter has run at
 * least once this session (i.e. `recordYield` logged a 'local newsroom'
 * event for it) but that have never once rescued an article — "zero means
 * dead weight to delete" from the plan. This is a *this-session* read, not
 * a verdict: a nickname that's genuinely rare in coverage looks identical
 * to one that's stopped matching until enough teams have been visited
 * enough times to tell them apart.
 */
export function getNicknamesNeverRescued(): { teamShortName: string; nickname: string }[] {
  const teamsChecked = new Set(
    yieldEvents.filter((e) => e.group === 'local newsroom').map((e) => e.teamShortName),
  );

  const results: { teamShortName: string; nickname: string }[] = [];
  for (const teamShortName of teamsChecked) {
    for (const nickname of teamNicknamesFor(teamShortName)) {
      if (!nicknameUsefulness.has(nicknameKey(teamShortName, nickname))) {
        results.push({ teamShortName, nickname });
      }
    }
  }
  return results;
}
