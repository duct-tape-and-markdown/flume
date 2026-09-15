/**
 * The shared {@link Runner} stand-in's one judge: that the harness tests
 * actually stand a runner in through it, rather than through a cast.
 *
 * A cast through `unknown` is the one way a stand-in ships typed-looking and
 * checks nothing — the result literal answers to no `RunResult` at all, so a
 * field the interface drops stays green at every site and a field it gains
 * is missing at every site, and the sweep that finds it is a human's. This
 * is the check the type cannot make about itself: the type bites only where
 * something asked for it (`.claude/rules/engineering.md`, *Narration is the
 * ladder's bottom rung*).
 *
 * The scanned set is `tests/harness*.test.ts` — the harness package's own
 * suite, which is where a declaration's runner is stood in. This file is not
 * one of them, which is why the pattern it quotes is not its own subject; a
 * rename into that set would make it so.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

const TESTS_DIR = fileURLToPath(new URL(".", import.meta.url));

/** The harness package's own test files, read as text. */
const harnessTests = readdirSync(TESTS_DIR)
  .filter((name) => name.startsWith("harness") && name.endsWith(".test.ts"))
  .map((name) => ({
    name,
    text: readFileSync(join(TESTS_DIR, name), "utf8"),
  }));

it("no harness test stands a `Runner` in through an `unknown` cast", () => {
  // Vacuity: the set exists and at least one of its files stands a runner in
  // — an absence asserted over no subject is a false green
  // (`.claude/rules/engineering.md`, *A green verdict is proven
  // non-vacuous*).
  expect(harnessTests.length).toBeGreaterThan(0);
  const adopters = harnessTests.filter((file) =>
    file.text.includes('from "./helpers/stubRunner.ts"'),
  );
  expect(adopters.length).toBeGreaterThan(0);

  const casting = harnessTests
    .filter((file) => /\bas\s+unknown\s+as\s+Runner\b/.test(file.text))
    .map((file) => file.name);

  expect(casting).toEqual([]);
});
