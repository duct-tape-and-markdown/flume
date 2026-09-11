/**
 * The worktree module's own surface: the lifecycle `src/worktrees.ts` owns
 * end to end — provision one, tear it down, sweep what a dead run left.
 *
 * The round-trip below is an agreement gate (`.claude/rules/engineering.md`,
 * *A seam gate reads what the real writer wrote*): the real `createWorktree`
 * provisions, and the real `teardownWorktreeInstance` is handed exactly what
 * it returned. The two build the same path and branch from opposite ends —
 * one composes `<base>/<namespace>/<dirName>` and `flume/<namespace>/<slug>`,
 * the other removes whatever it is given — so a one-sided change to the
 * namespacing or the directory bound shows up here as residue left on disk,
 * rather than as a wave that quietly accumulates worktrees and `flume/**`
 * branches until the next startup sweep.
 *
 * The dispatcher's end-to-end worktree behavior — which tick provisions
 * when, the wave-level surviving-path report, the startup sweep driven
 * through `Dispatcher.sweepStaleWorktrees`, the win32 deep-path cases —
 * stays in tests/Dispatcher.test.ts, where the tick that produces it lives.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Chain, Phase, WorktreeSetupContext } from "../src/Phase.ts";
import { slugify, worktreesBase } from "../src/paths.ts";
import {
  createWorktree,
  teardownWorktreeInstance,
  worktreeDirName,
  type WorktreeContext,
} from "../src/worktrees.ts";
import { makeFixture, silent, type Fixture } from "./helpers/dispatcherFixture.ts";

const exec = promisify(execFile);

/** A phase carrying nothing but the teardown hook the sequence must fire. */
function phaseWithTeardown(
  onTeardown: (ctx: WorktreeSetupContext) => Promise<void>,
): Phase {
  return {
    name: "build",
    description: "",
    promptPath: "prompt.md",
    concurrency: "fanout",
    writablePaths: ["**"],
    gates: [],
    handoff: () => [],
    teardownWorktree: onTeardown,
  };
}

/** Branches git currently holds under `flume/`, at any depth. */
async function flumeBranches(repo: string): Promise<string[]> {
  const { stdout } = await exec(
    "git",
    ["for-each-ref", "--format=%(refname:short)", "refs/heads/flume/"],
    { cwd: repo },
  );
  return stdout.split("\n").map((l) => l.trim()).filter(Boolean);
}

/** Paths git currently considers a worktree of `repo`. */
async function registeredWorktrees(repo: string): Promise<string[]> {
  const { stdout } = await exec("git", ["worktree", "list", "--porcelain"], {
    cwd: repo,
  });
  return stdout
    .split("\n")
    .filter((l) => l.startsWith("worktree "))
    .map((l) => l.slice("worktree ".length).trim());
}

describe("worktrees — one lifecycle over one directory tree", () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await makeFixture();
  });

  afterEach(async () => {
    await fx.cleanup();
  });

  it("worktree provisioning and teardown are exported from src/worktrees.ts, and the real teardown removes exactly the path and branch the real provisioning named", async () => {
    // A tag long enough that `worktreeDirName` must truncate-and-hash it:
    // the directory component and the branch component diverge here, which
    // is precisely the disagreement a one-sided change would introduce.
    const tag = `WORKTREES-ROUND-TRIP-${"x".repeat(60)}`;
    const flumeDir = join(fx.repo, ".flume");
    const ctx: WorktreeContext = {
      repoRoot: fx.repo,
      flumeDir,
      stateRootRel: ".flume",
      namespace: "job-a",
      log: silent,
    };
    const chain: Chain = { phases: [], humanOnly: [], friction: "friction" };
    const { stdout: head } = await exec("git", ["rev-parse", "HEAD"], {
      cwd: fx.repo,
    });

    const wt = await createWorktree(tag, head.trim(), ctx);

    // Both components, composed independently of the writer: the branch
    // keeps the untruncated slug, the directory takes the bound.
    expect(wt.branch).toBe(`flume/job-a/${slugify(tag)}`);
    expect(wt.path).toBe(
      join(worktreesBase(flumeDir), "job-a", worktreeDirName(tag)),
    );
    expect(worktreeDirName(tag)).not.toBe(slugify(tag));

    // Vacuity pin (`.claude/rules/engineering.md`, "A green verdict is
    // proven non-vacuous"): teardown below is judged over a worktree and a
    // branch that really exist, so the absences it asserts are removals
    // rather than two things that were never provisioned.
    expect(existsSync(wt.path)).toBe(true);
    expect(await registeredWorktrees(fx.repo)).toContain(wt.path);
    expect(await flumeBranches(fx.repo)).toEqual([wt.branch]);

    // The note this tick's agent would have left behind: untracked at the
    // worktree's own HEAD, so the harvest teardown runs owes it to the
    // primary friction dir.
    const mirrorDir = join(wt.path, ".flume", "friction");
    await mkdir(mirrorDir, { recursive: true });
    await writeFile(join(mirrorDir, "note.md"), "the loop wants input\n");

    const hookSaw: WorktreeSetupContext[] = [];
    const phase = phaseWithTeardown(async (hookCtx) => {
      // Fires while the directory still exists — chain-provisioned ephemera
      // release before removal, not after.
      expect(existsSync(hookCtx.worktreePath)).toBe(true);
      hookSaw.push(hookCtx);
    });

    const removed = await teardownWorktreeInstance(phase, chain, wt, tag, ctx);

    expect(removed).toBe(true);
    expect(hookSaw).toEqual([
      { worktreePath: wt.path, repoRoot: fx.repo, entryTag: tag },
    ]);
    expect(existsSync(wt.path)).toBe(false);
    expect(await registeredWorktrees(fx.repo)).not.toContain(wt.path);
    expect(await flumeBranches(fx.repo)).toEqual([]);
    // The harvest ran between the hook and the removal, so the note
    // survived the directory that held it.
    expect(await readdir(join(flumeDir, "friction"))).toEqual([
      expect.stringContaining(`${tag}--`),
    ]);
  }, 30_000);
});

/**
 * Single-resolution pin (WORKTREE-BASE-RESOLVED-ONCE, per spec/worktrees.md
 * "Placement — the worktree base and the job namespace": *The base is
 * resolved once*). `createWorktree` and `sweepStaleWorktrees` each used to
 * spell `FLUME_WORKTREES_DIR ?? join(flumeDir, "worktrees")` for themselves.
 * They agreed only because the two spellings happened to match: a sweep
 * basing on the default while creation honored the override reads an empty
 * base, removes nothing, and then fails every `git branch -D` against
 * worktrees still standing where creation actually put them (field-traced
 * four times).
 *
 * Agreement between two copies is not checkable by running them — they agree
 * in every tree where the bug has not been introduced yet. What is checkable
 * is that the second copy does not exist, so this reads `src/` and refuses a
 * second reader.
 */
describe("worktrees — the base is resolved in one place", () => {
  const SRC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "src");

  /** A read of the override env var, however it is subscripted. */
  const READS_OVERRIDE =
    /process\.env(?:\.FLUME_WORKTREES_DIR\b|\[\s*["']FLUME_WORKTREES_DIR["']\s*\])/;

  it("src/ resolves the worktree base in exactly one place", async () => {
    const modules = (await readdir(SRC_DIR)).filter((n) => n.endsWith(".ts"));
    // Vacuity (engineering.md, "A green verdict is proven non-vacuous"): a
    // scan that read no modules would report no second reader either.
    expect(modules.length).toBeGreaterThan(0);

    const readers: string[] = [];
    const sources = new Map<string, string>();
    for (const name of modules) {
      const text = await readFile(join(SRC_DIR, name), "utf8");
      sources.set(name, text);
      if (READS_OVERRIDE.test(text)) readers.push(name);
    }

    // The resolver's own module, and nothing else. A second reader is the
    // defect whether or not it currently spells the same fallback.
    expect(readers).toEqual(["paths.ts"]);

    // And the module's two consumers take the base from there rather than
    // rebuilding it: `createWorktree` (whose stale-slug removal runs against
    // the path it computes) and the startup sweep. Keyed on the call, not on
    // how the state root is currently spelled at either site — the claim is
    // that both reach the resolver, not which field holds their root.
    const worktrees = sources.get("worktrees.ts")!;
    expect(worktrees.match(/worktreesBase\(/g) ?? []).toHaveLength(2);
    // No hand-rolled default survives beside them.
    expect(worktrees).not.toMatch(/join\([^)]*[Ff]lumeDir,\s*"worktrees"\)/);
  });
});
