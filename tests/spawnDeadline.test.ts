/**
 * The bound this package's synchronous spawn door holds its children to,
 * driven over a real child that outruns it.
 *
 * A blocking capture is where a wedged child costs most: the callers of
 * `captureSync` (`harness/exec.ts`) run at chain load and inside a
 * synchronous `promptArgs`, so a child that never comes back holds the whole
 * tick open on a thread where no timer can fire to say so
 * (`.claude/rules/engineering.md`, *Loud or nothing*). What is pinned here is
 * the kill and the refusal that follows it — the door's own answer, not
 * node's `ETIMEDOUT`, whose message names neither the deadline nor the
 * command line that reached it.
 *
 * Driven over a real child rather than a mocked `execFileSync`, because the
 * kill is the platform's: node arms the timer in its spawn layer and reports
 * what it did where an errno sits, and a hand-authored failure would re-spell
 * that shape by the tester's hand and stay green if it ever changed
 * (`.claude/rules/engineering.md`, *A seam gate reads what the real writer
 * wrote*).
 *
 * The child is a `node` that sleeps: no shell, no shebang and no `.cmd`
 * shim, so the same case runs on every host
 * (`.claude/rules/platform-facts.md`, *win32 spawns no shebang script*).
 */

import { rm } from "node:fs/promises";

import { afterAll, beforeAll, expect, it, vi } from "vitest";

import { MAX_CHILD_MS, captureSync } from "../harness/exec.ts";
import { mkTempDir } from "./helpers/fixtureRoot.ts";
import { SPAWN_BUDGET_MS } from "./helpers/subprocess.ts";

// This file starts processes, so it declares the lane's one budget — cases
// and hooks alike — once here rather than inheriting the runner's default
// (`SPAWN_BUDGET_MS`, `tests/helpers/subprocess.ts`).
vi.setConfig({ testTimeout: SPAWN_BUDGET_MS, hookTimeout: SPAWN_BUDGET_MS });

/**
 * The bound these cases state. Far past a node startup, so a host under load
 * cannot red the case that stays inside it, and far short of the ceiling the
 * door holds where a caller states nothing — which is what makes the kill
 * provable in a run that costs a fraction of a second rather than minutes.
 */
const BOUND_MS = 1_000;

/**
 * How long the sleeper would run unbounded. Long enough that no unbounded run
 * can be mistaken for a killed one, short enough that a tree whose door does
 * not bound its children reds on this case instead of hanging the lane: a
 * synchronous capture blocks the thread, so the runner's own budget cannot
 * interrupt one.
 */
const SLEEP_MS = 15_000;

let root = "";

beforeAll(async () => {
  root = await mkTempDir("flume-spawn-deadline-");
});

afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

it("a sync spawn that outruns its bound refuses, naming the deadline and the command", () => {
  const started = Date.now();
  let caught: unknown;
  try {
    captureSync(
      process.execPath,
      ["-e", `setTimeout(() => {}, ${SLEEP_MS})`],
      { cwd: root, timeoutMs: BOUND_MS },
    );
  } catch (err) {
    caught = err;
  }

  // The child was signalled rather than waited out: the sleeper runs for
  // fifteen seconds, so the elapsed wall clock is the proof that what came
  // back is the deadline's answer and not the command's.
  expect(Date.now() - started).toBeLessThan(SLEEP_MS / 2);
  expect(caught).toBeInstanceOf(Error);

  // Named, so an operator reading the failure knows which child stalled and
  // what it was held to — a tick runs many of these.
  const said = (caught as Error).message;
  expect(said).toContain(`${BOUND_MS}ms`);
  expect(said).toContain(process.execPath);
  expect(said).toContain("SIGTERM");

  // The platform's own report stays reachable under it, for a caller that
  // reads an errno rather than a sentence.
  expect((caught as Error).cause).toMatchObject({ code: "ETIMEDOUT" });

  // Last, after the door has been read: the case proves the bound without
  // spending the ceiling, which is what a bound statable at the call buys —
  // and asserting it here keeps the red on a door that did not kill its
  // child rather than on a constant that is not there yet.
  expect(BOUND_MS).toBeLessThan(MAX_CHILD_MS);
});

it("a sync spawn that finishes inside its bound returns the child's output", () => {
  // The direction the case above cannot assert for itself: the door refuses
  // on the deadline, not on having a deadline.
  expect(
    captureSync(process.execPath, ["-e", "process.stdout.write('done')"], {
      cwd: root,
      timeoutMs: BOUND_MS,
    }),
  ).toBe("done");
});
