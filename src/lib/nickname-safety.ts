/**
 * Whether a nickname is safe to give a team.
 *
 * ## The thing this exists to say
 *
 * A nickname is never safe or unsafe on its own. "Wildcats" is exactly
 * right in the Lexington Herald-Leader and wrong in a national feed, and
 * the word is identical in both. What decides it is **which sources the
 * name will be matched against** — which, for this app, is a precise and
 * knowable set: the `scope: 'broad'` sources in that team's own entry in
 * community-sources.ts, because team-news-pool.ts passes nicknames to the
 * local-newsroom group and nothing else.
 *
 * team-nicknames.ts argues that rule in prose and every entry in the table
 * obeys it. Nothing checked it. This is the check.
 *
 * ## The two halves, and why they differ
 *
 * - **A college mascot collision is decided by the sources.** Georgia and
 *   Mississippi State are both Bulldogs, and Mississippi State claims the
 *   word while Georgia doesn't. That isn't a lapse: Mississippi State's
 *   only paper is in Starkville, which covers one Bulldogs team. The
 *   collision becomes real the moment the two teams share a broad source,
 *   and not one moment before — so a shared source is the failure, and a
 *   collision without one is a note.
 * - **A professional team collision is decided by the word.** No region
 *   resolves it: every metro sports section in the country covers the NFL,
 *   so "Lions" pulls Detroit into Penn State's feed from PennLive whatever
 *   else is true. Those words are reserved outright — see
 *   `RESERVED_NICKNAMES` in team-nicknames.ts, and the pro-league rosters
 *   that scripts/review/propose.mjs snapshots.
 *
 * ## What is deliberately not checked
 *
 * Region. Whether the Lincoln Journal Star covers Kansas State is not
 * derivable from anything in this repo, so `contested` says the safety of
 * that word rests on a fact nothing here can verify — which is the honest
 * answer, and the reason the reviewer is looking at a worksheet rather
 * than a green tick.
 */

import { CURATED_SOURCE_TABLES } from '@/lib/community-sources';
import { CURATED_NICKNAMES, RESERVED_NICKNAMES } from '@/lib/team-nicknames';

/** One team as the reviewer sees it: what it claims, and where that runs. */
export interface CuratedTeam {
  slug: string;
  /** The name to print in a report. ESPN's short name, in practice. */
  name: string;
  nicknames: readonly string[];
  /**
   * Ids of that team's `scope: 'broad'` sources — the only feeds its
   * nicknames are ever matched against. Empty means the nicknames are
   * unreachable: harmless, and worth seeing, since it is also the state in
   * which a collision is invisible right up until someone adds a paper.
   */
  broadSourceIds: readonly string[];
}

/** A word no team may claim, unless it is the team the word belongs to. */
export interface ReservedName {
  name: string;
  /** Why, in a phrase — printed straight into the worksheet. */
  reason: string;
  /** The slug that legitimately owns it, where the catalog has one. */
  ownedBy: string | null;
}

export type HazardKind = 'shared-source' | 'reserved' | 'contested';

export interface NicknameHazard {
  slug: string;
  nickname: string;
  /**
   * `shared-source` and `reserved` are defects — the gate test fails on
   * either. `contested` is a note: a word two teams both answer to, whose
   * safety currently rests on their sources not overlapping.
   */
  kind: HazardKind;
  detail: string;
}

/** Nicknames are matched case-insensitively, so collisions are too. */
function key(nickname: string): string {
  return nickname.trim().toLowerCase();
}

/**
 * Every hazard across a set of teams, sorted so two runs read the same.
 *
 * Pure, and takes the whole world as arguments, because it has two callers
 * that assemble that world differently: the gate test builds it from the
 * shipped tables, and propose.mjs builds it with a candidate word added to
 * one team, to ask what would happen if you took the suggestion. One
 * implementation is the point — a report that disagrees with the test is
 * worse than no report.
 */
export function nicknameHazards(
  teams: readonly CuratedTeam[],
  reserved: readonly ReservedName[],
): NicknameHazard[] {
  const claimants = new Map<string, string[]>();
  for (const team of teams) {
    for (const nickname of team.nicknames) {
      const claims = claimants.get(key(nickname));
      if (claims) claims.push(team.slug);
      else claimants.set(key(nickname), [team.slug]);
    }
  }

  const bySlug = new Map(teams.map((team) => [team.slug, team]));
  const reservedByWord = new Map(reserved.map((entry) => [key(entry.name), entry]));
  const hazards: NicknameHazard[] = [];

  for (const team of teams) {
    const broad = new Set(team.broadSourceIds);

    for (const nickname of team.nicknames) {
      const word = key(nickname);

      const claim = reservedByWord.get(word);
      // A pro team claiming its own name is the one case that isn't a
      // collision — it is the word doing its job.
      if (claim && claim.ownedBy !== team.slug) {
        hazards.push({
          slug: team.slug,
          nickname,
          kind: 'reserved',
          detail: `"${nickname}" is reserved: ${claim.reason}`,
        });
      }

      for (const otherSlug of claimants.get(word) ?? []) {
        if (otherSlug === team.slug) continue;
        const other = bySlug.get(otherSlug);
        if (!other) continue;

        const shared = other.broadSourceIds.filter((id) => broad.has(id));
        if (shared.length > 0) {
          hazards.push({
            slug: team.slug,
            nickname,
            kind: 'shared-source',
            detail:
              `${other.slug} also claims "${nickname}", and both are matched ` +
              `against ${shared.join(', ')} — that source's stories about ` +
              'either team would be given to both',
          });
        } else {
          hazards.push({
            slug: team.slug,
            nickname,
            kind: 'contested',
            detail:
              `${other.slug} also claims "${nickname}"; safe only while ` +
              `${team.broadSourceIds.length === 0 ? 'it has no broad source' : 'their sources stay in different regions'}`,
          });
        }
      }
    }
  }

  hazards.sort(
    (a, b) =>
      a.slug.localeCompare(b.slug) ||
      a.nickname.localeCompare(b.nickname) ||
      a.kind.localeCompare(b.kind) ||
      a.detail.localeCompare(b.detail),
  );
  return hazards;
}

/**
 * Whether a team's nicknames can ever fire. False means the team has no
 * broad-scoped source, so the local-newsroom filter those names feed never
 * runs on it — the state LSU is in, and the reason its reasons entry can
 * say the collision costs nothing today.
 *
 * Deliberately not a hazard above: a claim nothing can reach is not wrong,
 * it is inert. Reports print it beside the entry instead.
 */
export function nicknamesAreReachable(team: CuratedTeam): boolean {
  return team.broadSourceIds.length > 0;
}

/**
 * Every team anyone has ruled on, across every conference, ready to judge.
 *
 * Deliberately not scoped to one league. A nickname collision does not
 * respect a conference boundary — "Wildcats" is Northwestern in the Big
 * Ten and Kentucky in the SEC — so checking a league at a time is how you
 * would miss exactly the collisions worth catching. Realignment makes that
 * worse rather than better, since it moves a school's table entry between
 * leagues without changing what the school is called.
 */
export function curatedTeams(): CuratedTeam[] {
  const slugs = new Set(Object.keys(CURATED_NICKNAMES));
  const broadBySlug = new Map<string, string[]>();

  for (const table of Object.values(CURATED_SOURCE_TABLES)) {
    for (const [slug, feeds] of Object.entries(table.sourcesBySlug)) {
      slugs.add(slug);
      broadBySlug.set(slug, [
        ...(broadBySlug.get(slug) ?? []),
        ...feeds.filter((feed) => feed.scope === 'broad').map((feed) => feed.id),
      ]);
    }
  }

  return [...slugs].sort().map((slug) => ({
    slug,
    name: slug,
    nicknames: CURATED_NICKNAMES[slug] ?? [],
    broadSourceIds: broadBySlug.get(slug) ?? [],
  }));
}

/** One professional league's roster, as reviewed-teams.json records it. */
export interface SnapshotLeague {
  displayName?: string;
  pro?: boolean;
  teams?: { slug: string; shortName?: string; displayName?: string; mascot?: string }[];
}

/**
 * The words no team may claim: the curated list, plus every name already
 * snapshotted for a *professional* league.
 *
 * The curated list is the floor and stays the floor — it holds words no
 * roster would supply, like the one Rutgers' nickname shortens to, and it
 * is where the reasoning lives. The snapshot is the half that scales:
 * review the NFL once and its 32 names are reserved without anyone
 * maintaining a list of them. Only pro rosters, because a college mascot
 * shared by two schools is settled by which paper each is matched in, and
 * a pro team's name is settled by nothing at all.
 */
export function reservedNames(leagues: Record<string, SnapshotLeague>): ReservedName[] {
  const byWord = new Map<string, ReservedName>();

  for (const [name, reason] of Object.entries(RESERVED_NICKNAMES)) {
    byWord.set(key(name), { name, reason, ownedBy: null });
  }

  for (const [leagueId, league] of Object.entries(leagues)) {
    if (!league?.pro) continue;
    for (const team of league.teams ?? []) {
      for (const name of [team.mascot, team.shortName]) {
        if (!name) continue;
        const existing = byWord.get(key(name));
        // The two lists overlap on purpose — "Lions" is both a curated
        // word and a snapshotted roster entry — and each carries the half
        // the other doesn't. The curated reason is the researched prose
        // worth printing; the roster is the only thing that knows the word
        // has a rightful owner, without which reviewing the NFL would fail
        // Detroit against its own name.
        byWord.set(key(name), {
          name: existing?.name ?? name,
          reason:
            existing?.reason ??
            `${league.displayName ?? leagueId} — ${team.displayName ?? team.shortName ?? team.slug}`,
          ownedBy: team.slug,
        });
      }
    }
  }

  return [...byWord.values()];
}
