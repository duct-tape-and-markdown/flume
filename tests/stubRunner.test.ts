/**
 * The harness suite's stand-in judge: that an engine type stood in for by a
 * test is stood in as a **typed value**, never reached through an `unknown`
 * cast.
 *
 * A cast through `unknown` is the one way a stand-in ships typed-looking and
 * checks nothing — the literal answers to no shape at all, so a field the
 * real type drops stays green at the site and a field it gains is missing
 * there, and the sweep that finds it is a human's. This is the check the
 * type cannot make about itself: the type bites only where something asked
 * for it (`.claude/rules/engineering.md`, *Narration is the ladder's bottom
 * rung*).
 *
 * The subject is the cast's **target**, not one type's name: a name the file
 * imported from `src/` or `harness/` is an engine type, and standing one in
 * through `unknown` is what this refuses. Naming a single type here would be
 * the special case the mechanism should have generalized past
 * (`.claude/rules/engineering.md`, *The fix lands at the mechanism*) — the
 * next stand-in of the next type would ship unseen.
 *
 * Direction is the whole line. A cast *to* an engine type stands that type
 * in; `as unknown as Record<string, unknown>` casts an engine value *out* to
 * a structural shape, which is the refusal-test input engineering.md
 * sanctions (*A seam gate reads what the real writer wrote*). No import
 * names a structural type, so reading the cast's target against the file's
 * engine imports is what separates them — no list of exemptions.
 *
 * The scanned set is `tests/harness*.test.ts` — the harness package's own
 * suite, which is where the package's types are stood in. This file is not
 * one of them, which is why the patterns it quotes are not its own subject;
 * a rename into that set would make it so.
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

/** A module specifier reaching into `src/` or `harness/` — the engine. */
const ENGINE_SPECIFIER = /(?:^|\/)(?:src|harness)\//;

/** `import { a, type B as C } from "..."` — the clause and its specifier. */
const IMPORT_BLOCK = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g;

/** `x as unknown as T` — captures the head identifier of the cast's target. */
const UNKNOWN_CAST = /\bas\s+unknown\s+as\s+([A-Za-z_$][\w$]*)/g;

/**
 * Every local name `text` imports from the engine. A cast whose target is
 * one of these is standing an engine type in; a cast to anything else — a
 * structural type, a local alias — is not this test's subject.
 */
function engineNames(text: string): Set<string> {
  const names = new Set<string>();
  for (const match of text.matchAll(IMPORT_BLOCK)) {
    const [, clause, specifier] = match;
    if (clause === undefined || specifier === undefined) continue;
    if (!ENGINE_SPECIFIER.test(specifier)) continue;
    for (const raw of clause.split(",")) {
      // `type X`, `X as Y` — the binding this file can name is the tail.
      const parts = raw.trim().replace(/^type\s+/, "").split(/\s+as\s+/);
      const local = parts[parts.length - 1]?.trim();
      if (local) names.add(local);
    }
  }
  return names;
}

it("no harness test stands an engine type in through an `unknown` cast", () => {
  // Vacuity: the set exists, at least one of its files stands a runner in
  // through the shared value, and the suite names engine types at all — an
  // absence asserted over no subject is a false green
  // (`.claude/rules/engineering.md`, *A green verdict is proven
  // non-vacuous*).
  expect(harnessTests.length).toBeGreaterThan(0);
  const adopters = harnessTests.filter((file) =>
    file.text.includes('from "./helpers/stubRunner.ts"'),
  );
  expect(adopters.length).toBeGreaterThan(0);

  const scanned = harnessTests.map((file) => ({
    name: file.name,
    engine: engineNames(file.text),
    casts: [...file.text.matchAll(UNKNOWN_CAST)]
      .map((match) => match[1])
      .filter((target): target is string => target !== undefined),
  }));
  expect(scanned.some((file) => file.engine.size > 0)).toBe(true);

  const standIns = scanned.flatMap((file) =>
    file.casts
      .filter((target) => file.engine.has(target))
      .map((target) => `${file.name}: as unknown as ${target}`),
  );

  expect(standIns).toEqual([]);
});
