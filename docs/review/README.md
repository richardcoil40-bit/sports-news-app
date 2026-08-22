# Team review

One worksheet per league, and the record that somebody looked.

Adding a league used to be an entry in `leagues.json` and nothing else.
That is still true of the *catalog* — leagues are data, and that is the
point of it — but a league also arrives with a list of teams whose local
papers and nicknames nobody has researched, and there was no way to tell
that state apart from a league somebody had looked at and found nothing
for. Both answered `[]`.

At 34 teams you notice by reading the file. At 900 you never notice at
all, and a conference ships with no local coverage looking exactly like a
conference that has none to find.

## The three pieces

**`propose.mjs <leagueId>`** fetches the league's teams from ESPN and
writes `<leagueId>.review.md` — one block per team, with everything that
can be determined without a human: ESPN's names, the slug the tables are
keyed by, what the tables already hold, which nicknames collide with
what, and whether each feed still returns items. It also refreshes that
league's roster in `src/lib/__data__/reviewed-teams.json`.

Re-running it is safe. Answers already written into the worksheet are
carried across verbatim; everything else is regenerated. Re-run after
adding a `probe:` host, or when a roster changes.

**`vet.mjs <leagueId> [--ai]`** scores the candidates that survived
probing against `../source-reliability.md`. Off by default and last on
purpose — the free checks above eliminate most candidates before a model
call would tell you anything, and a dry run prints the batch without
sending it. Output is a proposal in its own file, never an edit.

**`apply.mjs <leagueId>`** prints the table entries to paste, and refuses
while any block still has an empty `decision:`.

## The gate

`src/lib/team-review.test.ts` reads the roster snapshot and asserts, for
every league the catalog serves:

1. The league has a snapshot at all — it has been through the worksheet.
2. Every team in it is a **key** in the nickname table, and in its
   league's source table where there is one.
3. Every deliberately empty entry has a recorded reason.
4. No nickname is unsafe against the sources it is matched against.

So flipping a league out of `"status": "planned"` without doing the work
fails `npm test`. That is the whole mechanism, and it is why the snapshot
is a committed file rather than something the test fetches: tests here
make no network calls, and the roster is ESPN's to say.

## Filling one in

Each block ends with five fields. Only `decision:` is mandatory.

| Field | What goes in it |
| --- | --- |
| `decision` | `approve`, `reject`, or `edit`. Blank is the state the gate exists to catch, so nothing defaults. |
| `nicknames` | Comma-separated, the forms a headline actually uses. Empty is a decision — write the reason in `notes:`. |
| `sources` | One per line, `<owner> <id> "<name>" <host> [tier]` for a known chain, or free text for anything else. |
| `probe` | Hosts worth checking, `host` or `host=owner`. A host on a chain recorded dead is skipped without a request. |
| `notes` | Why. Required when an entry is empty, and the thing that ends up as a comment in the table. |

Two things the worksheet will not do for you.

**The nickname candidates are ESPN's, and ESPN is not what a paper
prints.** It gives "Cornhuskers"; the Lincoln Journal Star writes
"Huskers". It cannot produce "Illini" or "Terps" at all. Finding the real
forms is the research — the candidates are a starting point and are
labelled unverified.

**A collision is about the source, not the word.** "Wildcats" is
Northwestern and Kentucky both, and both are fine, because neither has a
broad-scoped paper for the word to run against. It stops being fine the
moment they share one. The collision column says which of those two
situations you are in; `src/lib/nickname-safety.ts` is where the rule is
written down.

## The files here

Worksheets are committed, like `../evidence/`. They are the record of
what was decided and why, and diffing one against the last run is how you
see that a paper died or a roster changed.
