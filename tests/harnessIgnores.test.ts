/**
 * The harness package's runtime ignore set (`spec/harness.md`, *The runtime
 * ignore set*): what `consumerIgnores` derives, and what this repository's
 * own `.gitignore` — the package's reference consumer — may carry under its
 * state root.
 *
 * The derivation cases read the engine's path record and the package's own
 * per-run artifact names rather than a list by the tester's hand: a restated
 * set of names would pass over a rename that moved both sides, which is the
 * drift the derivation exists to end. The `.gitignore` case is the seam the
 * whole section is about — the real derivation's output driven against the
 * real file a consumer maintains (`.claude/rules/engineering.md`, *A seam
 * gate reads what the real writer wrote*) — and it runs in both directions
 * over the whole footprint, so neither a line nobody owns any more nor a
 * per-run path nothing ignores can sit there unnoticed.
 *
 * The last case is the one the module's lifetime declaration rests on
 * (`ignores.ts`, *One writer, and the refusal that bounds it*): the package's
 * lines have a single writer only for as long as the engine's re-asserted set
 * stays clear of the package's artifacts, so that separation is checked here
 * rather than left to the prose that reasons from it.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

import { SESSIONS_REL, consumerIgnores } from "../harness/ignores.ts";
import { RUNTIME_IGNORES } from "../src/job.ts";
import { STATE_ROOT_NAMES } from "../src/paths.ts";

/** A gitignore line as its bare name — the directory separator dropped. */
const bare = (line: string): string => line.replace(/\/$/, "");

/** This repository's state root, as its `.gitignore` addresses it. */
const STATE_ROOT = ".flume";

/**
 * The lines this repo's `.gitignore` carries for its state root, trimmed.
 * Read off the real file, never a fixture: the claim is about what this
 * consumer maintains.
 */
const stateRootLines = (): string[] =>
  readFileSync(fileURLToPath(new URL("../.gitignore", import.meta.url)), "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith(`${STATE_ROOT}/`));

/**
 * Every bare name the derived set may carry: the engine's path record plus
 * the package's own per-run artifacts. Composed from both owners rather than
 * spelled out, so neither side can rename a path past this file.
 */
const FOOTPRINT: ReadonlySet<string> = new Set<string>([
  ...Object.values(STATE_ROOT_NAMES),
  SESSIONS_REL,
]);

it("the consumer ignore set prefixes every engine runtime path with the declared state root", () => {
  const derived = consumerIgnores(STATE_ROOT);

  // Vacuity pin: the path record is the judged subject, and an empty one
  // would let a set of nothing satisfy every line below.
  const names = Object.values(STATE_ROOT_NAMES);
  expect(names.length).toBeGreaterThan(0);

  for (const name of names) {
    // Either shape the engine spells — a bare file, or a directory carrying
    // its trailing separator — under the state root, and exactly one of them.
    const under = derived.filter(
      (line) =>
        line === `${STATE_ROOT}/${name}` || line === `${STATE_ROOT}/${name}/`,
    );
    expect(under).toHaveLength(1);
  }
  // The state root is the caller's, never baked in: a consumer whose root
  // sits deeper gets the same set addressed from where its file lives.
  expect(consumerIgnores("packages/app/.flume")).toEqual(
    derived.map((line) => `packages/app/${line}`),
  );
});

it("the consumer ignore set names the package's own session capture directory", () => {
  // The dir the package's agent factory tees every transcript into
  // (`SESSIONS_REL`, read off its one home rather than respelled here). It
  // is the package's to place and so the package's to ignore: a consumer
  // that had to add the line by hand would carry an untracked path under its
  // own state root the first time it ran a tick.
  expect(consumerIgnores(STATE_ROOT)).toContain(`${STATE_ROOT}/${SESSIONS_REL}/`);
});

it("the consumer ignore set names no path outside the package's runtime footprint", () => {
  const derived = consumerIgnores(STATE_ROOT);
  expect(derived.length).toBeGreaterThan(0);

  for (const line of derived) {
    expect(line.startsWith(`${STATE_ROOT}/`)).toBe(true);
    expect(FOOTPRINT).toContain(bare(line.slice(STATE_ROOT.length + 1)));
  }
  // Nothing but those, and each exactly once: the footprint's size is the
  // set's size.
  expect(derived).toHaveLength(FOOTPRINT.size);
  // The one line the job-dir seed carries that the runtime does not own
  // (`RUNTIME_IGNORES`, `src/job.ts`) is dropped by that filter, not copied
  // through: a consumer's root is not a job dir's install.
  expect(derived).not.toContain(`${STATE_ROOT}/node_modules/`);
});

it("this repository's .gitignore carries no state-root line the derived set does not name", () => {
  const lines = stateRootLines();
  // Vacuity pin: an empty state-root section passes any absence claim.
  expect(lines.length).toBeGreaterThan(0);

  const derived = new Set(consumerIgnores(STATE_ROOT));
  expect(lines.filter((line) => !derived.has(line))).toEqual([]);
});

it("this repository's .gitignore names every line the derived set carries", () => {
  const lines = new Set(stateRootLines());
  const derived = consumerIgnores(STATE_ROOT);
  expect(derived.length).toBeGreaterThan(0);

  expect(derived.filter((line) => !lines.has(line))).toEqual([]);
});

it("the engine's re-asserted runtime ignore set names none of the package's own artifacts", () => {
  // The package's half of the derived set: everything under the state root
  // the engine's path record does not name. Read off the real derivation,
  // never respelled, so a package artifact added later joins this subject.
  const engineOwned = new Set<string>(Object.values(STATE_ROOT_NAMES));
  const packageOwned = consumerIgnores(STATE_ROOT)
    .map((line) => bare(line.slice(STATE_ROOT.length + 1)))
    .filter((name) => !engineOwned.has(name));

  // Vacuity pin, both sides: a package contributing nothing, or an empty
  // re-asserted set, would satisfy the disjointness below while saying
  // nothing about the asymmetry it exists to hold.
  expect(packageOwned).toContain(SESSIONS_REL);
  expect(RUNTIME_IGNORES.length).toBeGreaterThan(0);

  // The engine re-merges its set into the state root at every `loop` /
  // `job run` start (`ensureRuntimeIgnores`, `src/job.ts`), so an engine line
  // repairs itself in an adopted consumer's file. A package artifact landing
  // in that set would quietly give the package's lines a second writer, and
  // `ignores.ts` declares it has exactly one — adoption.
  const reasserted = new Set<string>(RUNTIME_IGNORES.map(bare));
  expect(packageOwned.filter((name) => reasserted.has(name))).toEqual([]);
});
