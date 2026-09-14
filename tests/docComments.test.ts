import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

import {
  DEFAULT_ABORT_THRESHOLD,
  DEFAULT_QUARANTINE_SCOPE,
} from "../src/loopSupervisor.ts";
import { expectNoChainVocabulary } from "./helpers/chainVocabulary.ts";

// Declarations ship (tsconfig.build.json), so a doc comment on a chain-facing
// option is the hover text every consumer reads — engine surface, injected
// into no prompt and caught by no other pin. Vocabulary from *this* repo's
// chain there ships one implementation's conventions with the engine's
// authority (engine-boundary.md § Capability vs convention): the option
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
