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
 * in; a cast of an engine value *out* to a structural shape is the
 * refusal-test input engineering.md sanctions (*A seam gate reads what the
 * real writer wrote*). No import names a structural type, so reading the
 * cast's target against the file's engine imports is what separates them —
 * no list of exemptions.
 *
 * The scanned set is every `.ts` file under `tests/`, read recursively. A
 * filename rule is the last selection a type-directed scan would still make
 * without looking at imports, and it is the same special case one rung out
 * (*The fix lands at the mechanism*): an engine type is stood in wherever a
 * file reaches for one, and `tests/helpers/` — the home of the shared typed
 * stand-ins — is the one place a single escape hatch reaches every adopter
 * at once. What a file is *called* decides nothing here; what it imports
 * decides everything.
 *
 * This file is in its own set. The cast patterns its regexes quote survive
 * only because it imports no engine name, which is what makes every one of
 * them a non-subject; an engine import added here would make this comment
 * its own finding, and the fix is to name the type in prose without writing
 * the cast — what `helpers/stubRunner.ts` does.
 */

import { readdirSync, readFileSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

const TESTS_DIR = fileURLToPath(new URL(".", import.meta.url));

/** This file, by the name the walk below gives it. */
const SELF = basename(fileURLToPath(import.meta.url));

/** One scanned file: its `tests/`-relative name and its bytes. */
interface SuiteFile {
  readonly name: string;
  readonly text: string;
}

/**
 * Every `.ts` file under `tests/`, at any depth, read as text. Off the
 * directory rather than a list: a stand-in added in a new subdirectory is
 * exactly what this scan exists to see, and a hand-kept set is what would
 * not carry it.
 */
function suiteFiles(dir: string = TESTS_DIR): SuiteFile[] {
  const out: SuiteFile[] = [];
  for (const dirent of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, dirent.name);
    if (dirent.isDirectory()) out.push(...suiteFiles(path));
    else if (dirent.name.endsWith(".ts"))
      out.push({
        name: relative(TESTS_DIR, path).split(sep).join("/"),
        text: readFileSync(path, "utf8"),
      });
  }
  return out;
}

const scannedFiles = suiteFiles();

/** A module specifier reaching into `src/` or `harness/` — the engine. */
const ENGINE_SPECIFIER = /(?:^|\/)(?:src|harness)\//;

/** The shared stand-in, however deep the importing file sits. */
const SHARED_STAND_IN = /from\s+["'][^"']*helpers\/stubRunner\.ts["']/;

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

it("the stand-in scan's subject set contains a `tests/helpers/` file", () => {
  const names = scannedFiles.map((file) => file.name);
  // The walk descends, and this file is judged by it: without both, a set
  // narrowed back to a filename rule at one directory reads green.
  expect(names).toContain(SELF);
  expect(names.filter((name) => name.startsWith("helpers/")).length)
    .toBeGreaterThan(0);
  // The helper whose prose this scan judges, named — a `helpers/` file that
  // is not this one would satisfy the count above and prove nothing.
  expect(names).toContain("helpers/stubRunner.ts");
});

it("no suite file stands an engine type in through an `unknown` cast, `tests/helpers/` included", () => {
  // Vacuity: the set exists, at least one file other than this one stands a
  // runner in through the shared value, and the suite names engine types at
  // all — an absence asserted over no subject is a false green
  // (`.claude/rules/engineering.md`, *A green verdict is proven
  // non-vacuous*).
  expect(scannedFiles.length).toBeGreaterThan(0);
  const adopters = scannedFiles.filter(
    (file) => file.name !== SELF && SHARED_STAND_IN.test(file.text),
  );
  expect(adopters.length).toBeGreaterThan(0);

  // The set is the whole tree, not one prefix of it: files outside the
  // harness package's own tests are scanned, and so is `tests/helpers/`.
  const names = scannedFiles.map((file) => file.name);
  expect(
    names.filter((name) => !name.startsWith("harness")).length,
  ).toBeGreaterThan(0);
  expect(names.some((name) => name.startsWith("helpers/"))).toBe(true);

  const scanned = scannedFiles.map((file) => ({
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
