import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

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
