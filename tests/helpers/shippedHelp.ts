/**
 * The one reader of the prose this package ships to a reader: the verbs the
 * engine CLI's top-level listing advertises, the page each of them prints,
 * the page the harness package's own bin prints, and the `*.md` assets the
 * build packs beside the emit.
 *
 * Read off `HELP_TOP`, `helpPageFor` and `HARNESS_HELP` rather than
 * restated, so every suite that judges the help text judges what a bin
 * really prints, and a verb added later is read the tick it is added rather
 * than the tick someone remembers to extend a list
 * (`.claude/rules/engineering.md`, *A seam gate reads what the real writer
 * wrote*).
 *
 * Not *.test.ts, so neither vitest lane collects it as a suite of its own.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect } from "vitest";

import { HARNESS_HELP } from "../../harness/cliHelp.ts";
import { HELP_TOP, helpPageFor } from "../../src/cliHelp.ts";
import type { RenderedSurface } from "./commentCitations.ts";
import { REPO_ROOT, filesUnder, relPath } from "./repoProgram.ts";

/** The harness package's own directory in the checkout — what the build packs from. */
const HARNESS_DIR = fileURLToPath(new URL("../../harness/", import.meta.url));

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
 * Every help page this package's two bins print, one surface each, named by
 * the command line that prints it: the engine's top-level listing, then one
 * page per verb that listing advertises, then the harness bin's own page.
 *
 * A verb the listing names and the page table does not answer fails here
 * rather than being passed over — a silence is the loudest way a page can
 * drift out of a scan (`.claude/rules/engineering.md`, *Loud or nothing*).
 *
 * `flume-harness`'s page is among them because it has a module of its own:
 * `harness/cli.ts` runs its `main` at import and holds no text to read.
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
  pages.push({ name: "flume-harness --help", text: HARNESS_HELP });
  return pages;
}

/**
 * Every `*.md` page the build packs beside the emitted modules, one surface
 * each, named by the repo-relative path whoever fixes a finding opens.
 *
 * The asset directories are **derived the way the packer derives them** —
 * every directory beside the package's modules, at any depth — rather than
 * listed here, because that is the packer's own rule
 * (`scripts/pack-harness-assets.mjs`): a prompt or template directory added
 * without this file being touched ships to a reader, so it is read the tick
 * it lands (`.claude/rules/engineering.md`, *Derived state is computed, never
 * restated beside its source*).
 *
 * An empty verdict is refused rather than returned: the package packs
 * `prompts/` at the least, and a reader that stopped finding them would hand
 * every scan below a green over nothing
 * (`.claude/rules/engineering.md`, *A green verdict is proven non-vacuous*).
 */
export function packedAssetPages(): RenderedSurface[] {
  const pages = readdirSync(HARNESS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) =>
      filesUnder({ root: join(HARNESS_DIR, entry.name), suffix: ".md" }),
    )
    .sort()
    .map((path) => ({
      name: relPath(REPO_ROOT, path),
      text: readFileSync(path, "utf8"),
    }));
  expect(
    pages.map((page) => page.name),
    "the build packs asset directories beside the emit; this reader found no page in them",
  ).not.toEqual([]);
  return pages;
}

/**
 * Every page this package ships prose to a reader in: the two bins' help
 * pages and the packed assets, one surface each.
 *
 * One set rather than two, because the citation carve-out reads a literal the
 * package ships by what it is and not by which half of the build put it
 * there.
 */
export function shippedPages(): RenderedSurface[] {
  return [...shippedHelpPages(), ...packedAssetPages()];
}
