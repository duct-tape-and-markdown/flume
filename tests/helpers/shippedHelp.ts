/**
 * The one reader of the CLI's shipped help surface: the verbs its top-level
 * listing advertises, and the page each of them prints.
 *
 * Read off `HELP_TOP` and `helpPageFor` rather than restated, so every suite
 * that judges the help text judges what the CLI really prints, and a verb
 * added later is read the tick it is added rather than the tick someone
 * remembers to extend a list (`.claude/rules/engineering.md`, *A seam gate
 * reads what the real writer wrote*).
 *
 * Not *.test.ts, so neither vitest lane collects it as a suite of its own.
 */

import { expect } from "vitest";

import { HELP_TOP, helpPageFor } from "../../src/cliHelp.ts";
import type { RenderedSurface } from "./commentCitations.ts";

/**
 * The command names the top-level listing's own `Commands:` block advertises.
 *
 * One home rather than one per suite: the block is one artifact, and two
 * readers of it are one walk with two callers
 * (`.claude/rules/engineering.md`, *A module is one job*).
 */
export function topLevelCommandNames(): string[] {
  const start = HELP_TOP.indexOf("Commands:\n");
  expect(start).toBeGreaterThan(-1);
  const block = HELP_TOP.slice(start, HELP_TOP.indexOf("\n\nOptions:"));
  return [
    ...new Set(
      block
        .split("\n")
        .map((line) => /^ {2}(\S+)/.exec(line)?.[1])
        .filter((name): name is string => name !== undefined),
    ),
  ];
}

/**
 * Every help page the engine's CLI prints, one surface each, named by the
 * command line that prints it: the top-level listing, then one page per verb
 * that listing advertises.
 *
 * A verb the listing names and the page table does not answer fails here
 * rather than being passed over — a silence is the loudest way a page can
 * drift out of a scan (`.claude/rules/engineering.md`, *Loud or nothing*).
 *
 * `flume-harness`'s own help literal is not among them: that module runs its
 * `main` at import, so nothing may import it to read the text.
 */
export function shippedHelpPages(): RenderedSurface[] {
  const pages: RenderedSurface[] = [
    { name: "flume --help", text: HELP_TOP },
  ];
  for (const verb of topLevelCommandNames()) {
    const text = helpPageFor(verb);
    expect(text, `the help table answers no page for \`${verb}\``).toBeDefined();
    pages.push({ name: `flume ${verb} --help`, text: text! });
  }
  return pages;
}
