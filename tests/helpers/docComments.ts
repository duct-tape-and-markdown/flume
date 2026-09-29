/**
 * Reading a shipped doc comment out of `src/` — the block, by the
 * declaration it precedes.
 *
 * Declarations ship (`tsconfig.build.json`), so these blocks are the hover
 * text a chain author reads, which is why more than one suite pins one: the
 * vocabulary scans in `tests/docComments.test.ts`, and the roster seams that
 * read a block against the array the surfaces beside it are read against.
 * One home for the extraction, so a block found two ways is never two
 * different blocks (`.claude/rules/engineering.md`, *A module is one job*).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** `src/<module>` as an absolute path on this host. */
export const srcPath = (module: string): string =>
  fileURLToPath(new URL(`../../src/${module}`, import.meta.url));

/** `src/<module>` as the working tree holds it. */
export const srcText = (module: string): string =>
  readFileSync(srcPath(module), "utf8");

/**
 * The doc comment block immediately preceding whatever `decl` (a regex
 * source) matches. The body pattern cannot cross a comment terminator, so
 * the match is the adjacent block, never an earlier one swallowed by a lazy
 * span.
 */
export const docCommentBefore = (
  source: string,
  decl: string,
  label: string,
): string => {
  const body = source.match(
    new RegExp(String.raw`/\*\*((?:[^*]|\*(?!/))*)\*/\s*${decl}`),
  )?.[1];
  if (body === undefined) {
    throw new Error(`no doc comment precedes ${label}`);
  }
  return body;
};

/** The doc comment block immediately preceding `field`'s declaration. */
export const docCommentFor = (source: string, field: string): string =>
  docCommentBefore(source, String.raw`${field}\??:`, `\`${field}\``);

/**
 * A block as a reader sees it: the comment furniture off, and the wrapping
 * folded to the one space it stands for. A phrase a block states is wrapped
 * wherever the column ran out, so a read for one against the raw block
 * answers about the wrapping rather than about the prose.
 */
export const docProse = (doc: string): string =>
  doc
    .replace(/^[ \t]*\*[ \t]?/gm, "")
    .replace(/\s+/g, " ")
    .trim();
