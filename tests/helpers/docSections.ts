/**
 * The markdown section cutter — one home for the read every doc pin in this
 * suite makes: a heading line through the line before the next heading that
 * closes it (`.claude/rules/engineering.md`, *A module is one job*). Eight
 * copies across five test files preceded it, each new pin copying whichever
 * was nearest, and they disagreed on both rules below — what closes a
 * section, and whether a fenced `# ` line is a heading at all.
 *
 * Not *.test.ts, so neither vitest lane collects it as a suite of its own.
 */

/** A heading line, capturing the level it opens. */
const HEADING = /^(#{1,6}) /;

/** A line that opens or closes a fenced block. */
const FENCE = /^\s*(?:```|~~~)/;

/**
 * One section of a markdown page: the heading line `heading` names through
 * the line before the next heading at the same or a higher level — its own
 * deeper subsections included, since a claim demoted into one is still
 * inside the section a reader is in.
 *
 * Fenced blocks are not read for headings. A page that quotes shell (`# tune:
 * edit ...`, a commented sample) carries lines that look like a level-1
 * heading and close nothing, and a cut that honoured them would end a section
 * at its own first example.
 *
 * A heading no line matches yields the empty string rather than throwing:
 * the cut is a pure read, and each call site anchors the span it got — an
 * empty span reds on that anchor, where the message a reader needs already
 * is.
 */
export function sectionOf(page: string, heading: string | RegExp): string {
  const lines = page.split(/\r?\n/);
  const matches = headingMatcher(heading);
  let start = -1;
  let depth = 0;
  let end = lines.length;
  let fenced = false;

  for (const [i, line] of lines.entries()) {
    if (FENCE.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const level = HEADING.exec(line)?.[1]?.length;
    if (level === undefined) continue;
    if (start === -1) {
      if (matches(line.trimEnd())) {
        start = i;
        depth = level;
      }
      continue;
    }
    if (level <= depth) {
      end = i;
      break;
    }
  }

  return start === -1 ? "" : lines.slice(start, end).join("\n");
}

/**
 * A string heading is the heading line exactly; a pattern is matched against
 * one line at a time, so the global and sticky flags are dropped — a match
 * position carried between calls would make one pattern match or miss by
 * call order.
 */
function headingMatcher(heading: string | RegExp): (line: string) => boolean {
  if (typeof heading === "string") return (line) => line === heading;
  const pattern = new RegExp(heading.source, heading.flags.replace(/[gy]/g, ""));
  return (line) => pattern.test(line);
}
