/**
 * The harness package's runtime ignore set (`spec/harness.md`, *The runtime
 * ignore set*): what `consumerIgnores` derives, and what this repository's
 * own `.gitignore` — the package's reference consumer — may carry under its
 * state root.
 *
 * The derivation cases read the engine's path record rather than a list by
 * the tester's hand: a restated set of names would pass over a rename that
 * moved both sides, which is the drift the derivation exists to end. The
 * `.gitignore` case is the seam the whole section is about — the real
 * derivation's output driven against the real file a consumer maintains
 * (`.claude/rules/engineering.md`, *A seam gate reads what the real writer
 * wrote*) — and it runs in both directions, so neither a line the engine no
 * longer owns nor a runtime path nothing ignores can sit there unnoticed.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

import { consumerIgnores } from "../harness/index.ts";
import { STATE_ROOT_NAMES } from "../src/paths.ts";

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
 * The lines under this repo's state root that the engine does not own, so
 * the derived set must not name them. `sessions/` is this chain's session
 * capture (`.flume/chain.ts`) — a chain-convention dir, the consumer's to
 * add beside the derived set and the consumer's to retire.
 */
const CONSUMER_OWNED = [`${STATE_ROOT}/sessions/`];

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
  // Nothing but those: the record's size is the set's size.
  expect(derived).toHaveLength(names.length);

  // The state root is the caller's, never baked in: a consumer whose root
  // sits deeper gets the same set addressed from where its file lives.
  expect(consumerIgnores("packages/app/.flume")).toEqual(
    derived.map((line) => `packages/app/${line}`),
  );
});

it("the consumer ignore set names no path outside the engine's path record", () => {
  const derived = consumerIgnores(STATE_ROOT);
  expect(derived.length).toBeGreaterThan(0);

  const owned = new Set<string>(Object.values(STATE_ROOT_NAMES));
  for (const line of derived) {
    expect(line.startsWith(`${STATE_ROOT}/`)).toBe(true);
    expect(owned).toContain(line.slice(STATE_ROOT.length + 1).replace(/\/$/, ""));
  }
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
  expect(
    lines.filter((line) => !derived.has(line) && !CONSUMER_OWNED.includes(line)),
  ).toEqual([]);
});

it("this repository's .gitignore names every line the derived set carries", () => {
  const lines = new Set(stateRootLines());
  const derived = consumerIgnores(STATE_ROOT);
  expect(derived.length).toBeGreaterThan(0);

  expect(derived.filter((line) => !lines.has(line))).toEqual([]);
});
