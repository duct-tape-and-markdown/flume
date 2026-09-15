/**
 * The suite's stand-in judge: that an engine type stood in for by a test is
 * stood in as a **typed value**, never reached through an `unknown` cast.
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
 * The scanned set is every top-level `tests/*.test.ts`. A file glob narrower
 * than the suite would be the same special case one rung out: the engine's
 * types are stood in wherever a test reaches for one, so a prefix that
 * happens to name today's stand-in sites leaves tomorrow's unseen. The set
 * is read off the directory, non-recursively, so `tests/helpers/` — the home
 * of the shared typed stand-ins — is scanned by nothing and free to describe
 * what it replaces.
 *
 * This file is in its own set. The cast patterns its prose and its regexes
 * quote survive only because it imports no engine name, which is what makes
 * every one of those casts a non-subject; an engine import added here would
 * make this comment its own finding, and the fix is to name the type in
 * prose without writing the cast.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

const TESTS_DIR = fileURLToPath(new URL(".", import.meta.url));

/** Every top-level test file in the suite, read as text. */
const suiteTests = readdirSync(TESTS_DIR)
  .filter((name) => name.endsWith(".test.ts"))
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

it("no test stands an engine type in through an `unknown` cast", () => {
  // Vacuity: the set exists, at least one of its files stands a runner in
  // through the shared value, and the suite names engine types at all — an
  // absence asserted over no subject is a false green
  // (`.claude/rules/engineering.md`, *A green verdict is proven
  // non-vacuous*).
  expect(suiteTests.length).toBeGreaterThan(0);
  const adopters = suiteTests.filter((file) =>
    file.text.includes('from "./helpers/stubRunner.ts"'),
  );
  expect(adopters.length).toBeGreaterThan(0);

  // The set is the whole suite, not one prefix of it: files outside the
  // harness package's own tests are scanned, and so is this file. Without
  // these, a glob narrowed back to a prefix reads green.
  const names = suiteTests.map((file) => file.name);
  expect(names).toContain("stubRunner.test.ts");
  expect(
    names.filter((name) => !name.startsWith("harness")).length,
  ).toBeGreaterThan(0);

  const scanned = suiteTests.map((file) => ({
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
