/**
 * When an entry was filed (`src/filingOrder.ts`): the add commit the read
 * answers with, and what it answers for a ledger git cannot see
 * (`spec/pending.md`, *The entry core*).
 *
 * Over a real repository with real filing commits, because the fact under test
 * is git's: a hand-built history of adds and deletes is this file's copy of the
 * rule the read exists to apply. The order those times put a queue in is driven
 * through a whole tick in `tests/Dispatcher.test.ts` — what is judged here is
 * the read alone.
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { readFilingTimes } from "../src/filingOrder.ts";
import { entryFileName } from "../src/PendingSchema.ts";
import { mkFixtureRoot } from "./helpers/fixtureRoot.ts";
import { commitInto } from "./helpers/scratchRepo.ts";
import { exec, SPAWN_BUDGET_MS } from "./helpers/subprocess.ts";

// This file starts processes (`git`, both in the fixture's own filing commits
// and in the read under test), so it declares the lane's one budget — cases
// and hooks alike — once here rather than inheriting the runner's default
// (`SPAWN_BUDGET_MS`, `tests/helpers/subprocess.ts`).
vi.setConfig({ testTimeout: SPAWN_BUDGET_MS, hookTimeout: SPAWN_BUDGET_MS });

/** The queue directory this fixture files into, in git's own alphabet. */
const QUEUE_REL = ".flume/plan/pending";

let repo: string;

beforeEach(async () => {
  repo = await mkFixtureRoot("flume-filing-order-");
  await commitInto(repo, { "README.md": "seed\n" });
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

/** A commit dated `at` on both of git's clocks, so a case names its own history. */
const datedEnv = (at: string): NodeJS.ProcessEnv => ({
  ...process.env,
  GIT_AUTHOR_DATE: at,
  GIT_COMMITTER_DATE: at,
});

/** File `name` under the queue directory as its own commit, dated `at`. */
async function fileAt(name: string, at: string): Promise<void> {
  const dir = join(repo, ".flume", "plan", "pending");
  // Per call, not once in the hook: git holds no empty directory, so the
  // retire below takes the directory with the last entry under it.
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, name), "{}\n", "utf8");
  await exec("git", ["add", "--", `${QUEUE_REL}/${name}`], { cwd: repo });
  await exec("git", ["commit", "-q", "-m", `file ${name}`], {
    cwd: repo,
    env: datedEnv(at),
  });
}

/** Drop `name` from the queue directory as its own commit. */
async function retire(name: string): Promise<void> {
  await exec("git", ["rm", "-q", "--", `${QUEUE_REL}/${name}`], { cwd: repo });
  await exec("git", ["commit", "-q", "-m", `retire ${name}`], { cwd: repo });
}

/** Unix seconds for an ISO instant, which is what `%ct` answers in. */
const seconds = (iso: string): number => Date.parse(iso) / 1000;

it("the filing time is the oldest commit that added a file under the tag, not the newest", async () => {
  const first = "2024-01-01T00:00:00Z";
  const again = "2024-06-01T00:00:00Z";
  await fileAt(entryFileName("REFILED"), first);
  await retire(entryFileName("REFILED"));
  await fileAt(entryFileName("REFILED"), again);
  // A second tag filed once, so the read is judged over a populated map and a
  // case that answered nothing at all cannot read as this claim holding.
  await fileAt(entryFileName("FILED-ONCE"), again);

  const times = await readFilingTimes(repo, "HEAD", QUEUE_REL);

  expect(times.size).toBe(2);
  expect(times.get("FILED-ONCE")).toBe(seconds(again));
  expect(times.get("REFILED")).toBe(seconds(first));
});

it("a name that is no entry file's carries no filing time", async () => {
  await fileAt(".gitkeep", "2024-01-01T00:00:00Z");
  await fileAt(entryFileName("REAL"), "2024-01-02T00:00:00Z");

  const times = await readFilingTimes(repo, "HEAD", QUEUE_REL);

  // The sidecar is in the same filing commit's diff and is not an entry: the
  // listing that decides what is work ignores it (`readQueueOnDisk`,
  // `src/pendingLedger.ts`), and so does this read.
  expect([...times.keys()]).toEqual(["REAL"]);
});

it("a ledger git cannot name has no filing times, so its entries tie", async () => {
  await fileAt(entryFileName("IN-TREE"), "2024-01-01T00:00:00Z");

  // The relocated dock (`isPendingRelocated`, `src/pendingLedger.ts`): no
  // repo-relative path names it, so there is no history to read and every
  // entry under it falls through to the tag alone. Asserted explicitly, not
  // inherited from a case that happened to file nothing
  // (`.claude/rules/engineering.md`, *A green verdict is proven non-vacuous*).
  expect((await readFilingTimes(repo, "HEAD", undefined)).size).toBe(0);
  // And over the same repo the in-tree read does answer, so the empty map
  // above is the relocation and not a fixture that filed nothing.
  expect((await readFilingTimes(repo, "HEAD", QUEUE_REL)).size).toBe(1);
});
