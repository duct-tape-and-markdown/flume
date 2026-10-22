/**
 * What this package's capturing spawn doors leave their child's stdin as,
 * driven over a real child that answers only once that stdin has ended.
 *
 * `tests/spawnCaps.test.ts` holds the source scan that keeps every spawn home
 * in the shipped trees on this posture, and reads it off a name
 * (`SPAWN_STDIN_ENDER`, `tests/helpers/spawnCaps.ts`). This file is what makes
 * that name mean something: the async door and the sync door each start a
 * child that reads stdin to EOF before it prints anything, so a door that
 * stopped ending the pipe reds here rather than passing a scan over a decoy.
 *
 * The child's wait is bounded, because the regression this guards against is
 * a child that never exits: unbounded, a red door would hold a worker to the
 * lane's budget and report a timeout instead of the door's own answer
 * (`.claude/rules/engineering.md`, *Loud or nothing*).
 */

import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterAll, beforeAll, expect, it, vi } from "vitest";

import { captureSync } from "../harness/exec.ts";
import { execFileWithShimRetry } from "../src/spawnShim.ts";
import { mkTempDir } from "./helpers/fixtureRoot.ts";
import {
  SPAWN_BUDGET_MS,
  SPAWN_OUTPUT_CAP_BYTES,
} from "./helpers/subprocess.ts";

// This file starts processes, so it declares the lane's one budget — cases
// and hooks alike — once here rather than inheriting the runner's default
// (`SPAWN_BUDGET_MS`, `tests/helpers/subprocess.ts`).
vi.setConfig({ testTimeout: SPAWN_BUDGET_MS, hookTimeout: SPAWN_BUDGET_MS });

/**
 * A child that prints nothing until its stdin has ended, and then reports how
 * many bytes it was handed. The stand-in for every tool that falls back to
 * reading stdin when its argv gave it nothing to do — a formatter handed an
 * empty file list, a git verb handed no path — and the one shape that tells
 * an ended pipe from an open one: an open pipe produces no output at all,
 * which no exit code or captured stream would have said.
 *
 * A module on disk rather than `node -e`, so no argv quoting sits between the
 * case and the child on any host.
 */
const READER = [
  `let read = 0;`,
  `process.stdin.on("data", (chunk) => {`,
  `  read += chunk.length;`,
  `});`,
  `process.stdin.on("end", () => {`,
  `  process.stdout.write(\`ended:\${read}\`);`,
  `});`,
  `process.stdin.resume();`,
  ``,
].join("\n");

/** What the child above prints, having been handed nothing. */
const ENDED = "ended:0";

/**
 * How long the async door's child is given before node kills it. Sized to be
 * far past a node startup and far short of the lane's budget: a door that
 * ends stdin answers in milliseconds, and one that does not would otherwise
 * wait for a writer that cannot arrive.
 */
const CHILD_WAIT_MS = 10_000;

let root = "";
let reader = "";

beforeAll(async () => {
  root = await mkTempDir("flume-spawn-stdin-");
  reader = join(root, "reader.mjs");
  await writeFile(reader, READER, "utf8");
});

afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

it("a capturing spawn home ends the stdin it opened for its child", async () => {
  const { stdout } = await execFileWithShimRetry(
    process.execPath,
    [reader],
    { cwd: root, maxBuffer: SPAWN_OUTPUT_CAP_BYTES, timeout: CHILD_WAIT_MS },
  );

  // Resolving at all is half the verdict — the child chose to exit rather
  // than being killed at the bound above — and the payload is the other
  // half: the pipe reached EOF with nothing written to it.
  expect(stdout).toBe(ENDED);
});

it("the sync capture door still ends its child's stdin", () => {
  expect(captureSync(process.execPath, [reader], { cwd: root })).toBe(ENDED);
});
