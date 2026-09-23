/**
 * What a shipped runner does around the one thing that is its own: spawning
 * the consumer's tool once in a tree, and laying down the tree a base run is
 * judged in.
 *
 * `vitestRunner.ts` and `scriptRunner.ts` differ in how they *read* a run —
 * vitest's JSON report against a validator's verdict lines. Everything either
 * of them does before that read is the same sequence, so it lives here with
 * two callers rather than as two copies one change can move apart
 * (`.claude/rules/engineering.md`, *A module is one job*).
 *
 * Nothing here interprets. A refusal is raised where it is detected, and
 * every other observation leaves as a fact for the caller that knows what it
 * means (`.claude/rules/engine-boundary.md`, *Told, not inferred*).
 */

import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { existsLoud } from "../src/fsProbe.js";
import { namespacedJoin } from "../src/paths.js";
import { execFileWithShimRetry } from "../src/spawnShim.js";

import { MAX_OUTPUT_BYTES } from "./exec.js";
import type { RunnerContext } from "./runner.js";

/** What one spawn of a consumer's tool left behind. */
export interface CapturedRun {
  /** Everything the command wrote to stdout, verbatim. */
  readonly stdout: string;
  /**
   * The status it exited with, `0` where it exited clean. A run that never
   * started and a run a signal took down have no status to state, so both
   * throw rather than reporting one.
   */
  readonly status: number;
}

/**
 * Spawn `command` in `cwd` and hand back what it wrote to stdout, and the
 * status it exited with.
 *
 * A non-zero exit is an ordinary way for a test tool to say that something
 * failed while the report the runner reads is still on stdout, so that case
 * is told from a spawn that never started — where `code` is an errno string
 * and there is no output to hand back at all — and the status leaves as a
 * fact beside the output rather than as a verdict over it. Which of the two
 * the caller reads, and what their disagreement means, is the caller's alone
 * (`.claude/rules/engineering.md`, *A fact the engine holds is reported,
 * never rediscovered*).
 */
export async function captureRun(
  command: string,
  args: readonly string[],
  cwd: string,
): Promise<CapturedRun> {
  try {
    const { stdout } = await execFileWithShimRetry(command, [...args], {
      cwd,
      maxBuffer: MAX_OUTPUT_BYTES,
    });
    return { stdout, status: 0 };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stdout?: string };
    if (typeof e.code === "number" && typeof e.stdout === "string") {
      return { stdout: e.stdout, status: e.code };
    }
    throw err;
  }
}

/** One base run's tree, before the tool that judges it is spawned. */
interface BaseTreeRequest {
  /**
   * The operation a refusal names — `vitestRunner.runAtBase`. The two
   * refusals below are the runner's own contract, so they read as the
   * caller's message rather than as this module's.
   */
  readonly label: string;
  /** The run-relative files whose working-tree bytes are laid over the base. */
  readonly files: readonly string[];
  /** The commit the tree is checked out at. */
  readonly baseSha: string;
  /** The tree the bytes are read from. */
  readonly cwd: string;
}

/**
 * The tree a base run is judged in: a detached checkout of `baseSha` with the
 * working-tree bytes of `files` laid over it, provisioned the way a build
 * worktree is. Returns where it landed.
 *
 * Both refusals precede the checkout: a selection that cannot be laid down
 * makes the run unjudgeable either way, and refusing afterwards spends a `git
 * worktree add` to reach the same error.
 */
export async function baseTree(
  ctx: RunnerContext,
  request: BaseTreeRequest,
): Promise<string> {
  const { label, files, baseSha, cwd } = request;
  if (files.length === 0) {
    throw new Error(
      `${label}: no files to lay over the base. A base run ` +
        "with no selection runs the whole suite there, which judges the " +
        "wrong thing and costs a suite.",
    );
  }
  // Read the selection out of the caller's tree before asking for anything:
  // a file that is not there makes the run unjudgeable.
  const sources = files.map((f) => {
    const from = resolve(cwd, f);
    if (!existsLoud(namespacedJoin(from))) {
      throw new Error(`${label}: ${f} is not in the tree at ${cwd}`);
    }
    return { rel: f, from };
  });
  // The tree at `baseSha` is the engine's to hand out (`spec/chain.md`, *What
  // a gate receives*): it decides where the checkout is planted — the state
  // root's worktree base, an operator's relocation and the chain's declared
  // base alike — and reclaims it when the gate this run is driven inside
  // returns, whether that gate ruled or threw. A runner that added its own
  // worktree would be restating a placement rule the engine owns and carrying
  // a second lifetime for it (`.claude/rules/engineering.md`, *A fact the
  // engine holds is reported, never rediscovered*).
  const worktree = await ctx.api.git.checkoutAt({
    repoRoot: cwd,
    flumeDir: ctx.api.paths.flumeDir,
    sha: baseSha,
  });
  for (const { rel, from } of sources) {
    await mkdir(namespacedJoin(dirname(join(worktree, rel))), { recursive: true });
    await copyFile(namespacedJoin(from), namespacedJoin(worktree, rel));
  }
  // A checkout of a git ref has no installed dependencies. The chain's own
  // reduction of the declared `setup` provisions it, so the base tree is
  // provisioned exactly the way a build worktree is — one implementation of
  // that, handed over, rather than a second one here that installs at a root
  // the consumer never installs at.
  await ctx.provision(worktree);
  return worktree;
}
