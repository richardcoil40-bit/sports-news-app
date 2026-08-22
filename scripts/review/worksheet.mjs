/**
 * The review worksheet's format: one block per team, in Markdown.
 *
 * Markdown because the worksheet is read far more often than it is
 * written — it is the artifact a person sits with while deciding, and it
 * lands in docs/review/ next to the prose that explains the decisions. A
 * structured format would be easier to parse and nobody would read it.
 *
 * ## The one rule that matters
 *
 * Generated fields are rewritten on every run. **Answer fields are never
 * touched.** Re-running propose.mjs against a league you have half
 * reviewed re-probes the feeds and recomputes the collisions while leaving
 * your answers exactly where they were — otherwise the second run of the
 * tool destroys the work the first run asked for, and nobody runs it
 * twice.
 *
 * That is why parsing only knows about ANSWER_FIELDS. Everything else in
 * the file is output, and is regenerated rather than read back.
 */

/**
 * The fields a person fills in. `probe` is one of them on purpose: the
 * hosts worth checking for a team are research, so writing one there and
 * re-running is how a candidate gets verified without touching the script.
 */
export const ANSWER_FIELDS = ['decision', 'nicknames', 'sources', 'probe', 'notes'];

const BLOCK_HEADING = /^##\s+(\S+)\s+—\s+(.*)$/;
const FIELD = /^([a-z_]+):[ \t]*(.*)$/;

/**
 * Pulls the answers out of a worksheet, keyed by slug.
 *
 * Tolerant by design: an unknown field, a reordered block, a team that is
 * no longer in the league all pass through without complaint, because the
 * alternative is a tool that refuses to read a file somebody edited by
 * hand. `apply.mjs` is where a missing answer becomes an error, and it is
 * strict there.
 */
export function parseWorksheet(text) {
  const answers = new Map();
  let slug = null;
  let field = null;

  // A value may start on the key's line, continue on indented lines under
  // it, or both. All three are the same answer, so leading indentation is
  // stripped and blank edges dropped — which is also what makes the
  // rendered file stable: parse, render, parse gives the same bytes.
  const commit = (value) => {
    if (!slug || !field) return;
    const lines = String(value)
      .split('\n')
      .map((line) => line.trim());
    while (lines.length > 0 && lines[0] === '') lines.shift();
    while (lines.length > 0 && lines.at(-1) === '') lines.pop();
    if (lines.length > 0) answers.get(slug)[field] = lines.join('\n');
  };

  let buffer = '';
  for (const line of String(text ?? '').split('\n')) {
    const heading = BLOCK_HEADING.exec(line);
    if (heading) {
      commit(buffer);
      buffer = '';
      field = null;
      slug = heading[1];
      if (!answers.has(slug)) answers.set(slug, {});
      continue;
    }

    const match = FIELD.exec(line);
    if (match) {
      commit(buffer);
      buffer = '';
      field = ANSWER_FIELDS.includes(match[1]) ? match[1] : null;
      buffer = field ? match[2] : '';
      continue;
    }

    // An indented continuation belongs to the field above it, and so does a
    // blank line between two of them — a note with a paragraph break in it
    // should survive the next run. Anything flush left ends the field: the
    // fence that closes the block, or prose between blocks.
    if (field && /^(\s+\S|\s*$)/.test(line)) buffer += `\n${line.replace(/\s+$/, '')}`;
    else {
      commit(buffer);
      buffer = '';
      field = null;
    }
  }
  commit(buffer);

  return answers;
}

/**
 * A generated field.
 *
 * A string sits on the key's line, padded into a column so a block of them
 * reads as a table. A list is always indented underneath, even a list of
 * one — a field that changes shape with its length is unreadable in a file
 * where the same field is a line for one team and a paragraph for the next.
 * Indented continuation lines are also what parseWorksheet reads back.
 */
export function field(name, value, width = 20) {
  if (!Array.isArray(value)) return `${`${name}:`.padEnd(width)}${value}`.replace(/\s+$/, '');
  if (value.length === 0) return `${name}:`;
  return [`${name}:`, ...value.map((line) => (line ? `  ${line}` : ''))].join('\n');
}
