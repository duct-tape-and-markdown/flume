/**
 * The declared `setup` reduced to provisioning one checkout
 * (`spec/harness.md`, *The runner interface*) — the reduction, the queue of
 * one a declared `serialize` takes its turns in, the per-directory install,
 * and the worktree hook that runs the reduction over a provisioned tree.
 *
 * **One reduction, every caller.** The chain factory builds one and hands
 * the same value to the worktree hook and to the runner factory
 * (`chain.ts`), so a base checkout and a wave's worktrees are provisioned by
 * the same rule and take their turns in the same line
 * (`.claude/rules/engineering.md`, *Derived state is computed, never
 * restated beside its source*).
 */

import { resolve } from "node:path";

import type { FlumeApi } from "../src/flumeApi.js";
import type { Phase } from "../src/Phase.js";
import { execFileWithShimRetry } from "../src/spawnShim.js";

import type { Declaration } from "./declaration.js";
import { runnableShell, shellArgs } from "./declaredShell.js";
import { MAX_OUTPUT_BYTES } from "./exec.js";

/**
 * The declared `setup`, reduced to provisioning one checkout at its root.
 *
 * `directories` says where, `restore` says how: undeclared, each directory
 * gets the engine's own lockfile-aware install; declared, the command runs
 * in each directory instead — which is what a consumer whose stack has no
 * lockfile the engine reads (cargo, dotnet, a script) declares. With no
 * setup declared at all the root itself gets the engine's installer, which
 * is what a base checkout needs to run a suite and what a build worktree of
 * such a consumer inherits from its own tree.
 *
 * One reduction, two callers: {@link worktreeSetup} below and the runner
 * factory the chain hands it to (`chain.ts`). A second one built beside
 * either would be a chain restating what this one already decides
 * (`.claude/rules/engineering.md`, *Derived state is computed, never
 * restated beside its source*).
 *
 * Which is also why `setup.serialize` is honoured *here* rather than at
 * either caller: the queue is this reduction's own, so a wave's worktree
 * hooks and the base checkout the runner provisions take their turns in one
 * line. A second queue built beside this one would let the base checkout
 * warm the cache under a worktree that was promised exclusivity.
 */
export function provisioning(
  api: FlumeApi,
  declaration: Declaration,
): (root: string) => Promise<void> {
  const setup = declaration.setup;
  if (setup === undefined) return (root) => api.setupWorktree(root);
  const install = installing(api, declaration, setup.restore);
  const walk = async (root: string): Promise<void> => {
    for (const directory of setup.directories) {
      await install(resolve(root, directory));
    }
  };
  // The restore alone, and one worktree's whole walk at a time: the claim a
  // consumer makes is about the command it wrote, and it makes it per
  // checkout, so a tree's directories are restored contiguously rather than
  // interleaved with another tree's. A declaration naming no restore is
  // provisioned by the engine's installer, which a wave has always run
  // concurrently and which this knob does not reach (`declaration.ts`).
  if (setup.restore === undefined || setup.serialize !== true) return walk;
  const turn = oneAtATime();
  return (root) => turn(() => walk(root));
}

/**
 * A queue of one: each job starts when the job before it has settled, in the
 * order the calls arrived.
 *
 * Settled, not fulfilled. A restore that throws is that entry's provisioning
 * failure and parks it alone (`spec/worktrees.md`, *`setupWorktree` and
 * `teardownWorktree` — the chain's provisioning hooks*), so the rejection
 * reaches the caller who queued it and the queue itself keeps its own tail
 * resolved — a wave whose first restore failed still hands the next worktree
 * its turn rather than rejecting every one behind it.
 */
function oneAtATime(): (job: () => Promise<void>) => Promise<void> {
  let tail: Promise<void> = Promise.resolve();
  return (job) => {
    const turn = tail.then(job);
    tail = turn.then(
      () => {},
      () => {},
    );
    return turn;
  };
}

/**
 * How one declared directory is installed: the engine's own lockfile-aware
 * install, or the consumer's `restore` under the shell the declaration
 * named.
 *
 * A restore is a command line the consumer wrote, so it takes the shell and
 * the invocation form every other such line takes — a gate's command, a
 * gate's script — rather than a spawn of its own beside them
 * (`declaredShell.ts`). The shell is resolved once here, at chain load: a
 * host that will not run it strands every worktree this hook provisions, and
 * a wave of entries each parking on its own setup is that refusal arriving
 * once per entry, hours late (`.claude/rules/engineering.md`, *Loud or
 * nothing*).
 */
function installing(
  api: FlumeApi,
  declaration: Declaration,
  restore: string | undefined,
): (cwd: string) => Promise<void> {
  if (restore === undefined) return (cwd) => api.setupWorktree(cwd);
  const shell = runnableShell(api, declaration.shell, `\`setup.restore\` "${restore}"`);
  return async (cwd) => {
    // The cap is this site's to state: a consumer's restore command is
    // arbitrary, its output is read by nothing here, and node's inherited
    // 1 MiB reports an overrun where an exit status would sit — a verbose
    // install arriving as a restore that never ran
    // (`.claude/rules/platform-facts.md`, *Node caps a captured child
    // stream at 1 MiB, and reports the overrun as a spawn failure*). One
    // number with the rest of the package's captures.
    await execFileWithShimRetry(shell, shellArgs(restore), {
      cwd,
      maxBuffer: MAX_OUTPUT_BYTES,
    });
  };
}

/**
 * The hook every provisioned worktree runs, or none when the consumer
 * declared no setup — a tree a consumer said nothing about gets no hook, and
 * the engine skips the step rather than installing on its own authority.
 *
 * A throw here parks that one entry rather than the wave
 * (`spec/worktrees.md`, *Every `.git/worktrees` mutation is serialized; the
 * agent fanout is not*).
 */
export function worktreeSetup(
  declaration: Declaration,
  provision: (root: string) => Promise<void>,
): Phase["setupWorktree"] | undefined {
  if (declaration.setup === undefined) return undefined;
  return async ({ worktreePath }) => {
    await provision(worktreePath);
  };
}
