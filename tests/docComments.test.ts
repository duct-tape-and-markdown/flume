import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

import {
  DEFAULT_ABORT_THRESHOLD,
  DEFAULT_QUARANTINE_SCOPE,
} from "../src/loopSupervisor.ts";
import { DEFAULT_KILL_GRACE_MS } from "../src/processTree.ts";
import { expectNoChainVocabulary } from "./helpers/chainVocabulary.ts";

// Declarations ship (tsconfig.build.json), so a doc comment on a chain-facing
// option is the hover text every consumer reads — engine surface, injected into
// no prompt and caught by no other pin. Vocabulary from *this* repo's chain
// there ships one implementation's conventions with the engine's authority
// (.claude/rules/engine-boundary.md § Capability vs convention): the option
// describes only what the engine's mechanics consume.

const srcText = (module: string): string =>
  readFileSync(
    fileURLToPath(new URL(`../src/${module}`, import.meta.url)),
    "utf8",
  );

/**
 * The doc comment block immediately preceding `field`'s declaration. The
 * body pattern cannot cross a comment terminator, so the match is the
 * adjacent block, never an earlier one swallowed by a lazy span.
 */
const docCommentFor = (source: string, field: string): string => {
  const body = source.match(
    new RegExp(String.raw`/\*\*((?:[^*]|\*(?!/))*)\*/\s*${field}\??:`),
  )?.[1];
  if (body === undefined) {
    throw new Error(`no doc comment precedes \`${field}\``);
  }
  return body;
};

it("the shipped `forkResolver` and `entryChannelPaths` doc comments name no term in the shared chain-vocabulary list", () => {
  const docs = {
    forkResolver: docCommentFor(srcText("Dispatcher.ts"), "forkResolver"),
    entryChannelPaths: docCommentFor(srcText("Phase.ts"), "entryChannelPaths"),
  };

  // Vacuity guard: each block is the one it claims to be before any absence
  // is asserted over it — an absence over a vanished subject is a false green.
  expect(docs.forkResolver).toContain("dependsOnForks");
  expect(docs.entryChannelPaths).toContain("entry-scoped fanout tick");

  for (const [field, doc] of Object.entries(docs)) {
    expectNoChainVocabulary(doc, `\`${field}\` doc`);
  }
});

/**
 * `DEFAULT_ABORT_THRESHOLD` (`src/loopSupervisor.ts`) is the one home for the
 * abort backstop's default; the chain-facing option's hover text points at
 * that home rather than keeping a second copy of the number
 * (`.claude/rules/engineering.md` § Derived state is computed, never restated
 * beside its source). Read against the real constant, so bumping the default
 * can never leave a stale literal passing this pin.
 */
it("the shipped `abortThreshold` doc comment restates no DEFAULT_ABORT_THRESHOLD literal", () => {
  const doc = docCommentFor(srcText("Phase.ts"), "abortThreshold");

  // Vacuity guard: this is the block it claims to be before the absence is
  // asserted over it — an absence over a vanished subject is a false green.
  expect(doc).toContain("consecutive ticks");
  expect(doc).toContain("aborts the run");

  expect(doc).not.toContain(String(DEFAULT_ABORT_THRESHOLD));
});

/**
 * `DEFAULT_QUARANTINE_SCOPE` (`src/loopSupervisor.ts`) is the one home for the
 * run-scoped quarantine's default; the chain-facing option's hover text
 * describes what each union member does and marks neither as the engine's
 * choice (`.claude/rules/engineering.md` § Derived state is computed, never
 * restated beside its source). The member the block must still describe is
 * read off the real constant, so flipping the default can never leave a stale
 * marker passing this pin.
 */
it("the shipped `quarantineScope` doc comment marks no union member as the engine default", () => {
  const doc = docCommentFor(srcText("Phase.ts"), "quarantineScope");

  // Vacuity guard: the block still describes the member that carried the
  // marker before the absence is asserted over it — an absence over a vanished
  // subject is a false green.
  expect(doc).toContain(`\`"${DEFAULT_QUARANTINE_SCOPE}"\``);
  expect(doc).toContain("quarantine");

  expect(doc).not.toMatch(/defaults?/i);
});

/**
 * `DEFAULT_KILL_GRACE_MS` (`src/processTree.ts`) is the one home for the
 * teardown escalation's default; the chain-facing option's hover text
 * describes the window without restating the number
 * (`.claude/rules/engineering.md` § Derived state is computed, never restated
 * beside its source). Read against the real constant, so bumping the default
 * can never leave a stale literal passing this pin.
 */
it("the shipped `killGraceMs` doc comment restates no DEFAULT_KILL_GRACE_MS literal", () => {
  const doc = docCommentFor(srcText("Phase.ts"), "killGraceMs");

  // Vacuity guard: this is the block it claims to be before the absence is
  // asserted over it — an absence over a vanished subject is a false green.
  expect(doc).toContain("SIGKILL");
  expect(doc).toContain("agent tree");

  expect(doc).not.toContain(String(DEFAULT_KILL_GRACE_MS));
});

/**
 * Foreign glob dialects, named as classes rather than one literal apiece —
 * pinning a single spelling lets its siblings ship green.
 *
 * `matchesAny` (`src/paths.ts`) is the one home for the dialect the write
 * guard enforces, and every special but `*` and `**` is escaped there. A
 * chain-facing glob option whose hover text names some *other* dialect
 * promises syntax the matcher reads as literal text — `?`, `{a,b}`, `[abc]`
 * — so an author trusting it declares a fence narrower than the one they
 * wrote, and the commit reverts on a path they believed they had covered.
 */
const FOREIGN_GLOB_DIALECTS: readonly RegExp[] = [
  /\b(mini|micro|pico|node)-?match\b/i,
  /\bfn-?match\b/i,
  /\bglob-?star\b/i,
  /\bext-?glob\b/i,
  /\b(bash|sh|shell|posix|gitignore)[-\s]?(style\s+)?glob/i,
  /\bglob\(\d\)/,
  /\bbrace expansion\b/i,
  /\bcharacter class(es)?\b/i,
];

/**
 * Every chain-facing glob option, judged by the one scan. The dialect is a
 * property of `matchesAny`, not of any single option that feeds it, so the
 * scan generalizes over the options rather than pinning the first one that
 * shipped a wrong spelling (`.claude/rules/engineering.md` § The fix lands at
 * the mechanism). `PartitionOptions` reaches the shipped declarations through
 * `partitionByFileOverlap`'s signature (`src/index.ts`), so its block is
 * hover text on the same footing as the `Chain` fields.
 *
 * Each subject carries anchors only *its* block states, so a block that was
 * renamed or absorbed elsewhere fails loudly here instead of passing an
 * absence asserted over nothing.
 */
const GLOB_OPTIONS: readonly {
  readonly label: string;
  readonly module: string;
  readonly field: string;
  readonly anchors: readonly string[];
}[] = [
  {
    label: "writablePaths",
    module: "Phase.ts",
    field: "writablePaths",
    anchors: ["permitted to modify", "relative to the repo root"],
  },
  {
    label: "entryChannelPaths",
    module: "Phase.ts",
    field: "entryChannelPaths",
    anchors: ["entry-scoped fanout tick", "outer ceiling"],
  },
  {
    label: "supervisorPolicy.partitionIgnore",
    module: "Phase.ts",
    field: "partitionIgnore",
    anchors: ["collision set", "never a permission"],
  },
  {
    label: "PartitionOptions.ignore",
    module: "partition.ts",
    field: "ignore",
    anchors: ["collision set", "dropped before placement"],
  },
];

it("the shipped chain-facing glob options' doc comments name no glob dialect the engine's matcher does not implement", () => {
  // Vacuity guard: the subject list and the dialect list are both populated
  // before any absence is asserted — a scan over zero options, or one judged
  // by zero patterns, is a false green.
  expect(GLOB_OPTIONS.length).toBeGreaterThan(0);
  expect(FOREIGN_GLOB_DIALECTS.length).toBeGreaterThan(0);

  for (const { label, module, field, anchors } of GLOB_OPTIONS) {
    const doc = docCommentFor(srcText(module), field);

    // Vacuity guard: each block is the one it claims to be before the
    // absence is asserted over it — an absence over a vanished subject is a
    // false green.
    for (const anchor of anchors) {
      expect(doc, `\`${label}\` doc no longer states ${anchor}`).toContain(
        anchor,
      );
    }

    for (const dialect of FOREIGN_GLOB_DIALECTS) {
      expect(doc, `\`${label}\` doc names ${dialect}`).not.toMatch(dialect);
    }
  }
});
