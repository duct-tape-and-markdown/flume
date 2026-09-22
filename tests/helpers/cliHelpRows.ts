/**
 * The one reader of a `--help` text's own "Exit codes:" block. Two suites
 * read that block — one for the range of codes it lists, one for a single
 * row's causes — and two readers of one artifact is one walk with two
 * callers (`.claude/rules/engineering.md`, *A module is one job*).
 *
 * Not *.test.ts, so neither vitest lane collects it as a suite of its own.
 */

import { expect } from "vitest";

/**
 * A `--help` text's own "Exit codes:" block, one entry per code, carrying
 * everything that code's row says — its first line through the wrapped
 * continuations beneath it, folded to one line, since where a row breaks
 * across help-text lines is the formatter's business and not the row's.
 *
 * Read off the real help output, never restated, so every suite that reads it
 * compares a real producer against the shipped prose rather than against a
 * hand copy. One walk, so the range read and the per-row read agree on what a
 * row is (`.claude/rules/engineering.md`, *The fix lands at the mechanism*).
 */
export function documentedExitCodeRows(help: string): Map<number, string> {
  const start = help.indexOf("Exit codes:\n");
  expect(start).toBeGreaterThan(-1);
  const rows = new Map<number, string>();
  let open: number | undefined;
  const extend = (code: number, text: string): void => {
    const held = rows.get(code);
    rows.set(code, held === undefined ? text : `${held} ${text}`);
  };
  for (const line of help.slice(start).split("\n").slice(1)) {
    if (line.trim() === "") continue;
    // A continuation line is indented past its code; anything unindented
    // ended the block.
    if (!line.startsWith("  ")) break;
    const listed = /^ {2}(\d+) {2,}(\S.*)$/.exec(line);
    if (listed) {
      open = Number(listed[1]);
      extend(open, listed[2]!);
      continue;
    }
    if (open !== undefined) extend(open, line.trim());
  }
  return rows;
}

/**
 * The codes a `--help` text's own "Exit codes:" block lists — the rows above,
 * read for their codes alone.
 */
export function documentedExitCodes(help: string): Set<number> {
  return new Set(documentedExitCodeRows(help).keys());
}

/**
 * One code's row out of that block, and nothing beside it.
 *
 * One row rather than the block, because a claim about one row's cause list
 * read off the whole block would turn on whatever the neighbouring rows
 * happen to quote — the whole-artifact negative the standing lenses name
 * (`.claude/rules/posture-sweep.md`, *A violation counts only when verified
 * on disk this tick*).
 */
export function helpExitCodeRow(help: string, code: number): string {
  const row = documentedExitCodeRows(help).get(code);
  expect(row, `the block lists no ${code} row`).toBeDefined();
  return row!;
}
