#!/usr/bin/env -S node --experimental-strip-types --no-warnings

/**
 * `flume` — single tick, or loop until hibernation.
 *
 * The runtime usage text printed by `flume --help` / `flume <cmd> --help`
 * is the authoritative reference; see HELP_TEXT below.
 *
 * The chain config is loaded from `./.flume/chain.ts` (resolved with tsx).
 * That file must default-export a `Chain` and may export `agent` to override
 * the default `claudeCode()`.
 */

import { resolve, join, dirname, basename } from "node:path";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

import { Baton } from "./Baton.js";
import {
  acquireTipClaim,
  currentRefPath,
  gitCommonDir,
  liveTipClaimPid,
  tipClaimPath,
  TipClaimHeldError,
} from "./git.js";
import {
  jobNew,
  jobRm,
  jobRun,
  jobStatus,
  JobUsageError,
  liveLoopPid,
  readPendingLoose,
} from "./job.js";
import {
  Dispatcher,
  diskChainLoader,
  frictionCountLine,
  superviseLoop,
  clearTickVerdict,
  writeTickVerdict,
  CjsContextLoadError,
  EX_TERMINAL_MISCONFIG,
  EX_MOUNT_DEAD,
  type TickOutcome,
  type SuperviseResult,
} from "./Dispatcher.js";
import { claudeCode } from "./Agent.js";
import type { TickContext, Chain } from "./Phase.js";
import { renderPrompt } from "./Prompt.js";
import { parsePending } from "./PendingSchema.js";
import type { PendingEntry } from "./PendingSchema.js";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Resolve flume's own package.json (sibling of src/ in checkout, sibling of
 * dist/ in the published tarball — both layouts put it at `../package.json`).
 */
function readPackageVersion(): string {
  const pkgPath = resolve(HERE, "..", "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: unknown };
  if (typeof pkg.version !== "string") {
    throw new Error(`package.json at ${pkgPath} has no string "version"`);
  }
  return pkg.version;
}

/**
 * `--job <name>` given alongside an explicitly-set `FLUME_DIR`: two
 * resolution authorities for one state root (v0.6 §3). The CLI maps this to
 * a usage error (exit 2). An explicit `FLUME_CONFIG_DIR` composes instead —
 * the authority was always over state, and config never belonged to the job.
 */
export class JobResolutionConflictError extends Error {}

/**
 * Resolve the mutable-state root (`flumeDir`) and the chain+prompt dir
 * (`configDir`) from `env`, canonicalizing each to an **absolute** path, and
 * write the resolved values back into `env`.
 *
 * Writing back is the point (§12): a chain loaded later in this same process
 * (via tsx) and any spawned child then read the single resolved value from
 * `FLUME_DIR` / `FLUME_CONFIG_DIR` rather than re-deriving the default or
 * falling back to a coincidentally-equal `configDir`. `FLUME_DIR` becomes a
 * reliable, always-present source of truth for the state root.
 *
 * Both default to `<repoRoot>/.flume` when unset; a set-but-relative value is
 * resolved against the cwd. Independent of one another: a dock sets both to its
 * ephemeral dir to co-locate config and state.
 *
 * Job resolution (v0.6 §3): `jobFlag` (the global `--job <name>`) or a
 * pre-set `FLUME_JOB` retargets only the `flumeDir` default (state root →
 * `<repoRoot>/.flume/jobs/<name>`) and writes `FLUME_JOB` back alongside the
 * dirs, so loop-spawned tick children inherit the whole resolution via env.
 * `configDir` never retargets — the chain is repo-resident (§2), so it stays
 * `<repoRoot>/.flume` (or explicit `FLUME_CONFIG_DIR`, which composes: env
 * owns the chain+prompts dir, job owns state). The flag is a strict authority
 * over the state root — an explicitly-set `FLUME_DIR` beside it throws
 * {@link JobResolutionConflictError}. `FLUME_JOB` from env composes with an
 * explicit `FLUME_DIR` instead of conflicting: on the loop → tick boundary
 * the child sees all three written-back vars, and the dir vars *are* the
 * parent's canonical job resolution, so set dirs win and the job name rides
 * along for the branch guard and fanout namespacing.
 */

/**
 * Walk up from `cwd` looking for the nearest `.flume` — the same resolution
 * git applies to `.git/` (RELEASE-v0.7 §9). `cwd` itself counts as inside
 * the bay: if its basename is `.flume`, the bay root is its parent, no walk
 * needed. If no ancestor has a `.flume`, fall back to `cwd` unchanged so a
 * first `flume job new` in a fresh, undocked repo still creates `.flume`
 * there rather than reaching for an unrelated ancestor.
 */
export function resolveRepoRoot(cwd: string): string {
  if (basename(cwd) === ".flume") return dirname(cwd);
  let dir = cwd;
  for (;;) {
    if (existsSync(join(dir, ".flume"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return cwd;
    dir = parent;
  }
}

export function resolveStateDirs(
  env: NodeJS.ProcessEnv,
  repoRoot: string,
  jobFlag?: string,
): { flumeDir: string; configDir: string; job: string | undefined } {
  if (jobFlag && env.FLUME_DIR) {
    throw new JobResolutionConflictError(
      `--job ${jobFlag} conflicts with explicit FLUME_DIR: one resolution authority — drop --job or unset the env`,
    );
  }
  const job = jobFlag ?? (env.FLUME_JOB || undefined);
  const flumeDir = env.FLUME_DIR
    ? resolve(env.FLUME_DIR)
    : job
      ? join(repoRoot, ".flume", "jobs", job)
      : join(repoRoot, ".flume");
  const configDir = env.FLUME_CONFIG_DIR
    ? resolve(env.FLUME_CONFIG_DIR)
    : join(repoRoot, ".flume");
  env.FLUME_DIR = flumeDir;
  env.FLUME_CONFIG_DIR = configDir;
  if (job) env.FLUME_JOB = job;
  return { flumeDir, configDir, job };
}

/**
 * Map a tick outcome to the `flume tick` process exit code — the process
 * boundary classification at the intersection of §3, v0.7 §4, and v0.7 §5:
 * 78 (`EX_CONFIG`) terminal misconfiguration (a chain that resolved but
 * declares an inconsistent world), 2 (usage) the RELEASE-v0.7 §5
 * CJS-context refusal (a nameable fix, checked before `failed` since a
 * chain-load failure sets at most one of the two), 69 (`EX_UNAVAILABLE`,
 * {@link EX_MOUNT_DEAD}) the chain never resolved at all for any other
 * reason, 0 otherwise (work done or clean hibernation). Exported for the
 * exit-code seam tests.
 */
export function tickExitCode(outcome: TickOutcome): number {
  if (outcome.terminal) return EX_TERMINAL_MISCONFIG;
  if (outcome.usageError) return 2;
  return outcome.failed ? EX_MOUNT_DEAD : 0;
}

/**
 * Map a whole `flume loop` / `job run` supervised run to its process exit
 * code (v0.7 §4, amended): `terminal`/`mountDead` propagate the child's
 * abort code unchanged (§3, v0.7 §4's mount-dead class). `repeatedFailure`
 * (§16) is unconditionally non-zero — the consecutive-failure backstop
 * fired regardless of how much the run shipped before hitting the wall.
 * Otherwise non-zero iff at least one child tick errored AND the run shipped
 * nothing — "settled with nothing to do" (no errors) and partial success
 * (ships landed despite some tick errors) both stay 0. Exported for the
 * exit-code seam tests.
 */
export function loopExitCode(result: SuperviseResult): number {
  if (result.terminal) return EX_TERMINAL_MISCONFIG;
  if (result.mountDead) return EX_MOUNT_DEAD;
  if (result.repeatedFailure) return 1;
  return result.erroredTicks.length > 0 && result.shippedTags.length === 0
    ? 1
    : 0;
}

/**
 * `flume loop` / `job run`'s completion summary line naming surfaced tick
 * errors, and (§16) an abort on the consecutive-failure backstop — undefined
 * when the run had neither. Printed even on a 0 exit (partial success):
 * errors must not vanish into a green exit silently (v0.7 §4).
 */
export function loopCompletionSummary(
  result: SuperviseResult,
): string | undefined {
  const parts: string[] = [];
  if (result.repeatedFailure) {
    parts.push(
      `aborted: identical worktree provisioning failure repeated ` +
        `${result.repeatedFailure.count} consecutive ticks — ` +
        `${result.repeatedFailure.signature}`,
    );
  }
  if (result.erroredTicks.length > 0) {
    const shipped =
      result.shippedTags.length > 0
        ? `shipped ${result.shippedTags.join(", ")}; `
        : "";
    parts.push(
      `${shipped}${result.erroredTicks.length} tick(s) errored: ` +
        result.erroredTicks.join(" | "),
    );
  }
  if (parts.length === 0) return undefined;
  return `[flume] ${parts.join(" | ")}`;
}

const SUBCOMMANDS = ["status", "tick", "loop", "wake", "sleep", "render"] as const;
type Subcommand = (typeof SUBCOMMANDS)[number];

const HELP_TOP = `flume — a disciplined harness for AI-derivation pipelines.

Usage: flume <command> [options]

Commands:
  status              Print baton state (awake phases + pending count).
  tick                Run one tick of whichever phase is awake.
  loop [--max N]      Run ticks until hibernation (default cap 50).
  wake <phase>        Mark <phase> awake (touch .flume/awake/<phase>).
  sleep <phase>       Mark <phase> hibernating (remove .flume/awake/<phase>).
  render <phase>      Print the rendered prompt for <phase> without invoking
                      the agent.
  job new <name>      Seed .flume/jobs/<name>/ from the repo chain's declared
                      Chain.seedDir, if any (runtime .gitignore, baseline
                      commit on the current HEAD). No branch created.
  job run <name> [--max N]
                      Wake the chain's entry phase from hibernation, then
                      loop under the job resolution — on whatever branch
                      HEAD is on.
  job rm <name>       Remove the job's state root: git rm + cleanup commit on
                      the current HEAD, untracked runtime swept, worktrees
                      pruned. Refuses on a live loop.
  job status          List jobs under .flume/jobs/ — awake phases + pending
                      count, plus a friction count where declared and
                      non-empty, per job. Observational; no side effects.

Options:
  --job <name>        Resolve state to <repoRoot>/.flume/jobs/<name> and set
                      FLUME_JOB=<name> (equivalent to setting the env var).
                      Config (chain.ts + prompts) stays at <repoRoot>/.flume —
                      chains are repo-resident; an explicit FLUME_CONFIG_DIR
                      composes. Conflicts with explicit FLUME_DIR (exit 2).
  -h, --help          Print this message.
  -v, --version       Print the flume version.

Run \`flume <command> --help\` for per-command usage and exit codes.
`;

const HELP_SUB: Record<Subcommand, string> = {
  status: `Usage: flume status

Print baton state: awake phases (or "hibernating" if none), then, when
.flume/loop.pid exists, supervisor liveness ("supervisor pid N live" or
"loop.pid present, process dead — stale"; no pidfile prints nothing extra),
then, when HEAD names a ref and a tip claim exists for it, its holder ("tip
claimed by pid N" or "tip claim present, process dead — stale"; a detached
HEAD or no claim file prints nothing extra), then the pending entry count
from plan/pending.json ("pending: N"; "pending: 0" if absent; "pending:
unparsable" if present but malformed), then, when the chain loads, a
friction count (declared Chain.friction dir holding notes) and one line per
pending entry gated on a capability the chain hasn't asserted. Observational
— no side effects, no agent invocation.

Exit codes:
  0   Always.
`,
  tick: `Usage: flume tick

Run one phase × one tick of whichever phase is awake. Loads .flume/chain.ts,
picks the next pending entry (for fanout phases) or runs the singleton phase,
invokes the agent, and applies validation gates.

Exit codes:
  0   Success, or hibernation (no phase awake).
  1   Harness error (unexpected exception), or HEAD is detached (v0.11 §4:
      the tick record's meaning is advancing a named tip; checkout a branch
      first). No claim is taken or checked — that's loop-level only.
  69  Mount-dead (EX_UNAVAILABLE): the chain module could not load, its
      state root is missing, or its declaration is invalid. No agent ran —
      fix the chain (or its state root) and re-run.
  78  Terminal misconfiguration (EX_CONFIG): every awake flag names a phase
      the chain does not declare. The flags are left on disk — inspect, then
      \`flume sleep <phase>\` or fix the chain.
`,
  loop: `Usage: flume loop [--max N]

Run ticks until hibernation or --max iterations have elapsed.

Options:
  --max N    Maximum number of ticks before bailing (default 50).

Exit codes:
  0   Hibernation reached, or --max ticks completed — including partial
      success (some ticks errored but at least one entry shipped; the
      completion summary names the errors).
  1   Harness error, another live loop holds the lock; also, HEAD is
      detached (v0.11 §4: checkout a branch first — the tip claim below
      keys on the ref); also, another process holds the tip claim (v0.11
      §4: the refusal names the holder pid and claim path); also, at least
      one tick errored and the run shipped nothing (v0.7 §4); also, an
      identical pre-tick worktree provisioning failure repeated 3
      consecutive ticks with no successful tick between them (v0.7 §16) —
      the completion summary names the repeated signature. A single
      entry's provisioning failure alone does not abort: it quarantines
      that entry for the rest of the run while the others keep dispatching.
  69  Stopped on a child tick's mount-dead failure (see \`flume tick
      --help\`): the chain never resolved. The run aborts after that one
      tick instead of burning the remaining --max ticks against the same
      wall.
  78  Stopped on a child tick's terminal misconfiguration (see \`flume tick
      --help\`); the orphaned awake flags are left on disk.
  2   Bad --max: missing, non-numeric, or negative. No tick runs.
`,
  wake: `Usage: flume wake <phase>

Mark <phase> awake by touching .flume/awake/<phase>. The next tick will
schedule that phase.

Exit codes:
  0   Success.
  2   Missing <phase> argument.
`,
  sleep: `Usage: flume sleep <phase>

Mark <phase> hibernating by removing .flume/awake/<phase>.

Exit codes:
  0   Success (no-op if already hibernating).
  2   Missing <phase> argument.
`,
  render: `Usage: flume render <phase> [--entry <tag>]

Print the rendered prompt for <phase> to stdout without invoking the agent.
Useful for dry-run inspection of prompt construction.

Options:
  --entry <tag>   For fanout phases, render the prompt for the pending entry
                  with this tag. Defaults to the first entry whose gate is
                  "open".

Exit codes:
  0   Success.
  2   Missing or unknown <phase>; or --entry <tag> with no matching entry.
`,
};

const HELP_JOB = `Usage: flume job <verb> [args]

Lifecycle verbs over a job — .flume/jobs/<name>/, tracked files in the
working tree, on whatever branch the operator is on. Machinery only —
harness content arrives via the repo chain's declared Chain.seedDir,
chain-owned.

Verbs:
  new <name>
      Load the repo chain (<configDir>/chain.ts — missing chain exits 2: a
      job that could never \`run\` must not be creatable), copy its declared
      seedDir into .flume/jobs/<name>/ verbatim and skip-existing (absent
      seedDir → bare job, no warning; a declared-but-absent seedDir exits 2),
      merge runtime ignore entries into the job dir's .gitignore (awake/,
      prior-attempts/, worktrees/, node_modules/, loop.pid), pin
      core.longpaths repo-locally (win32), and baseline-commit the seeded
      harness on the current HEAD. No branch is created or checked out.

  run <name> [--max N]
      Wake the chain's entry phase (phases[0]) iff the baton is hibernating
      — a mid-job baton is left untouched; then run the standard loop under
      the job resolution, on whatever branch HEAD is on. Lock, supervisor,
      and exit codes are identical to \`flume --job <name> loop [--max N]\`.

  rm <name>
      Refuse while the job's loop.pid records a live pid. \`git rm -r
      .flume/jobs/<name>\` plus a cleanup commit on the current HEAD, remove
      untracked runtime remnants (awake/, prior-attempts/, the @dtmd/flume
      link, pid files), and \`git worktree prune\`. No branch is touched.

  status
      Enumerate .flume/jobs/* in the working tree: one line per job with its
      awake phases (or "hibernating"), pending count (entries in the
      job's plan/pending.json; 0 when absent, "unparsable" when broken), and,
      when the repo chain declares Chain.friction and that job's dir holds
      notes, a friction count. Observational — nothing on disk changes;
      prints "no jobs" when the jobs dir is empty or missing.

Exit codes:
  0   Success (run: hibernation reached, or --max ticks completed —
      including partial success, some ticks errored but at least one entry
      shipped; rm on a job dir with nothing tracked is a no-op; status:
      always, including no jobs).
  1   Git or filesystem failure (provisioning, commit); for run also:
      harness error, another live loop holds the job's lock, at least one
      tick errored and the run shipped nothing (v0.7 §4), or an identical
      pre-tick worktree provisioning failure repeated 3 consecutive ticks
      (v0.7 §16); for rm also: the job's loop is still live.
  2   Usage error: missing or unknown verb, missing <name>, a <name> that is
      not a single path segment, new with no chain at <configDir>/chain.ts or
      a declared seedDir absent on disk, rm on a <name> whose job dir does
      not exist, or status given any argument.
  78  run: stopped on a child tick's terminal misconfiguration (see
      \`flume tick --help\`).
`;

function isSubcommand(value: string): value is Subcommand {
  return (SUBCOMMANDS as readonly string[]).includes(value);
}

function wantsHelp(args: readonly string[]): boolean {
  return args.includes("--help") || args.includes("-h");
}

/**
 * `flume job <verb> …` (v0.5 §5), minus `run` — that verb is the standard
 * loop under a job resolution and is rewritten in `main()` before dispatch
 * reaches here. Usage-shaped failures exit 2, operational failures 1 —
 * mirroring the JobUsageError split in the job verbs.
 */
async function runJobVerb(
  args: readonly string[],
  repoRoot: string,
): Promise<number> {
  const [verb, ...rest] = args;

  if (verb === "status") {
    if (rest.length > 0) {
      console.error("usage: flume job status");
      return 2;
    }
    try {
      // §6 (v0.6.2): the friction dir is job-dir-relative but declared once
      // on the repo-resident chain — load it here, best-effort (a missing or
      // broken chain must never fail `job status`, only silently withhold
      // the friction counts).
      const configDir = process.env.FLUME_CONFIG_DIR
        ? resolve(process.env.FLUME_CONFIG_DIR)
        : join(repoRoot, ".flume");
      let frictionDir: string | undefined;
      try {
        const { chain } = await diskChainLoader(configDir)();
        frictionDir = chain.friction;
      } catch {
        frictionDir = undefined;
      }

      const jobs = jobStatus(repoRoot, frictionDir);
      if (jobs.length === 0) {
        console.log("no jobs");
        return 0;
      }
      const width = Math.max(...jobs.map((j) => j.name.length));
      for (const j of jobs) {
        const state = j.awake.length
          ? `awake: ${j.awake.join(", ")}`
          : "hibernating";
        const pending =
          j.pending === null ? "pending: unparsable" : `pending: ${j.pending}`;
        const friction =
          j.frictionCount !== undefined && j.frictionCount > 0
            ? `  friction: ${j.frictionCount} note(s) await routing`
            : "";
        console.log(`${j.name.padEnd(width)}  ${state}  ${pending}${friction}`);
      }
      return 0;
    } catch (err) {
      console.error(
        `[flume] job status failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return 1;
    }
  }

  if (verb === "rm") {
    const name = rest[0];
    if (!name || rest.length > 1) {
      console.error("usage: flume job rm <name>");
      return 2;
    }
    try {
      await jobRm({ repoRoot, name });
      return 0;
    } catch (err) {
      if (err instanceof JobUsageError) {
        console.error(`[flume] ${err.message}`);
        return 2;
      }
      console.error(
        `[flume] job rm failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return 1;
    }
  }

  if (verb !== "new") {
    console.error(
      verb ? `unknown job verb: ${verb}` : "usage: flume job <verb> [args]",
    );
    console.error("Run `flume job --help` for usage.");
    return 2;
  }

  const words = [...rest];
  const name = words[0];
  if (!name || words.length > 1) {
    console.error("usage: flume job new <name>");
    return 2;
  }

  try {
    const configDir = process.env.FLUME_CONFIG_DIR
      ? resolve(process.env.FLUME_CONFIG_DIR)
      : join(repoRoot, ".flume");
    await jobNew({ repoRoot, name, configDir });
    return 0;
  } catch (err) {
    if (err instanceof JobUsageError) {
      console.error(`[flume] ${err.message}`);
      return 2;
    }
    console.error(
      `[flume] job new failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return 1;
  }
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const repoRoot = resolveRepoRoot(process.cwd());

  // Global `--job <name>` (v0.5 §3): extract it wherever it appears so it
  // composes with every subcommand, before any dispatch.
  let jobFlag: string | undefined;
  const jobIdx = argv.indexOf("--job");
  if (jobIdx >= 0) {
    const value = argv[jobIdx + 1];
    if (!value || value.startsWith("-")) {
      console.error("usage: flume --job <name> <command>");
      return 2;
    }
    jobFlag = value;
    argv.splice(jobIdx, 2);
  }

  const [firstArg, ...restArgs] = argv;

  // Top-level --help / --version short-circuit before subcommand dispatch
  // (and before any resolution or chain load) so they work in any cwd.
  if (firstArg === "--help" || firstArg === "-h") {
    process.stdout.write(HELP_TOP);
    return 0;
  }
  if (firstArg === "--version" || firstArg === "-v") {
    console.log(readPackageVersion());
    return 0;
  }

  let cmd = firstArg ?? "tick";
  let rest = restArgs;

  // Per-subcommand --help short-circuits before any side effects (chain load,
  // baton mutation, agent invocation).
  if (isSubcommand(cmd) && wantsHelp(rest)) {
    process.stdout.write(HELP_SUB[cmd]);
    return 0;
  }

  // `flume job <verb>` (v0.5 §5) — repo-level lifecycle verbs, routed before
  // state-dir resolution: they operate on the repo and the job dir named by
  // their argument, not on a resolved state root. `run` is the exception —
  // it IS the standard loop under the job resolution (§5b-3), so it rewrites
  // itself into `--job <name> loop [--max N]` and falls through; only its
  // preflight (branch + entry-phase wake) runs before the loop, below.
  let jobRunName: string | undefined;
  if (cmd === "job") {
    if (wantsHelp(rest)) {
      process.stdout.write(HELP_JOB);
      return 0;
    }
    if (rest[0] === "run") {
      const words = rest.slice(1);
      let maxArgs: string[] = [];
      const maxIdx = words.indexOf("--max");
      if (maxIdx >= 0) {
        const value = words[maxIdx + 1];
        if (!value || value.startsWith("-")) {
          console.error("usage: flume job run <name> [--max N]");
          return 2;
        }
        maxArgs = ["--max", value];
        words.splice(maxIdx, 2);
      }
      const name = words[0];
      if (!name || words.length > 1) {
        console.error("usage: flume job run <name> [--max N]");
        return 2;
      }
      if (jobFlag !== undefined && jobFlag !== name) {
        console.error(
          `[flume] --job ${jobFlag} conflicts with \`job run ${name}\`: one resolution authority — drop --job`,
        );
        return 2;
      }
      jobRunName = name;
      jobFlag = name;
      cmd = "loop";
      rest = maxArgs;
    } else {
      return runJobVerb(rest, repoRoot);
    }
  }

  // Resolve both state roots up front and canonicalize them back into the env
  // (§12). `flumeDir` is the mutable-state root (baton, pending, worktrees,
  // prior-attempts); `configDir` is the chain+prompt dir. Both default to
  // `<repoRoot>/.flume`; `FLUME_DIR` / `FLUME_CONFIG_DIR` relocate them, and
  // `--job` / `FLUME_JOB` retargets only the flumeDir default to
  // `.flume/jobs/<name>` — configDir never follows the job (v0.6 §2/§3).
  // Resolving here (not constructing) lets the values survive the
  // `loop` → `tick` process boundary — children inherit the (now
  // absolute-canonical) env vars — and lets a chain loaded later in this
  // process read one authoritative state root.
  let flumeDir: string;
  let configDir: string;
  let job: string | undefined;
  try {
    ({ flumeDir, configDir, job } = resolveStateDirs(process.env, repoRoot, jobFlag));
  } catch (err) {
    if (err instanceof JobResolutionConflictError) {
      console.error(`[flume] ${err.message}`);
      return 2;
    }
    throw err;
  }

  // `job run` preflight (v0.11 §2/§3): wake the entry phase iff hibernating.
  // Placed after the resolution (a conflict must refuse before any
  // mutation). No branch assertion — the engine has no opinion on which
  // branch a state root runs on.
  if (jobRunName !== undefined) {
    try {
      await jobRun({ name: jobRunName, flumeDir, configDir });
    } catch (err) {
      if (err instanceof JobUsageError) {
        console.error(`[flume] ${err.message}`);
        return 2;
      }
      console.error(
        `[flume] job run failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return 1;
    }
  }

  if (cmd === "status") {
    const baton = new Baton(flumeDir);
    const awake = baton.awake();
    console.log(awake.length ? `awake: ${awake.join(", ")}` : "hibernating");
    // §17: surface supervisor liveness beside the awake markers — the
    // 2026-07-29 incident's "hibernating" reading left the operator to
    // infer relaunch-safety instead of being told it. No pidfile: silent,
    // unchanged from pre-§17 output.
    if (existsSync(join(flumeDir, "loop.pid"))) {
      const pid = await liveLoopPid(flumeDir);
      console.log(
        pid !== null
          ? `supervisor pid ${pid} live`
          : "loop.pid present, process dead — stale",
      );
    }
    // v0.11 §4: report the current tip's claim alongside supervisor
    // liveness, observational and best-effort — a detached HEAD (no ref to
    // key the claim on) or an absent claim file both read as silence, the
    // same precedent as the no-pidfile case above.
    const headRefForStatus = await currentRefPath(repoRoot);
    if (headRefForStatus !== null) {
      const claimPath = tipClaimPath(
        await gitCommonDir(repoRoot),
        headRefForStatus,
      );
      if (existsSync(claimPath)) {
        const holder = await liveTipClaimPid(claimPath);
        console.log(
          holder !== null
            ? `tip claimed by pid ${holder}`
            : "tip claim present, process dead — stale",
        );
      }
    }
    // §3: the pending entry count, independent of whether the chain loads —
    // `flume job status` probes the same file the same way (`readPendingLoose`,
    // src/job.ts), so a corrupt pending.json reads "unparsable" identically
    // on both surfaces.
    const pending = readPendingLoose(join(flumeDir, "plan", "pending.json"));
    console.log(
      pending.ok ? `pending: ${pending.entries.length}` : "pending: unparsable",
    );
    // §6 (v0.6.2): best-effort — a missing or broken chain must never fail
    // `status`, only silently withhold the friction line.
    try {
      const { chain } = await diskChainLoader(configDir)();
      const line = await frictionCountLine(flumeDir, chain);
      if (line) console.log(line);
      // v0.8 §4: name entries stuck on a capability this chain hasn't
      // asserted — a `requiresCapability` skip must never be silent.
      const capabilities = new Set(chain.capabilities ?? []);
      for (const entry of pending.entries) {
        if (
          entry.gate.kind === "requiresCapability" &&
          !capabilities.has(entry.gate.capability)
        ) {
          console.log(
            `${entry.tag}: skipped — missing capability "${entry.gate.capability}"`,
          );
        }
      }
    } catch {
      // no chain, or a chain that fails to load — nothing to report beyond
      // the pending count above
    }
    return 0;
  }

  if (cmd === "wake") {
    const phase = rest[0];
    if (!phase) {
      console.error("usage: flume wake <phase>");
      return 2;
    }
    new Baton(flumeDir).wake(phase);
    console.log(`woke ${phase}`);
    return 0;
  }

  if (cmd === "sleep") {
    const phase = rest[0];
    if (!phase) {
      console.error("usage: flume sleep <phase>");
      return 2;
    }
    new Baton(flumeDir).sleep(phase);
    console.log(`slept ${phase}`);
    return 0;
  }

  // Dispatcher resolves .flume/chain.ts from configDir once at tick start
  // (one load per process — `flume loop` re-resolves by spawning a fresh
  // `flume tick` per iteration, §2); a chain.ts that exports `agent`
  // overrides the default agent per tick. `render` resolves the chain
  // directly (it inspects phases without invoking the agent).
  const resolveChain = diskChainLoader(configDir);
  // §16 (RELEASE-v0.7): the `flume loop` supervisor's run-scoped quarantine
  // crosses the process boundary via this env var (set by
  // `defaultTickRunner`, `src/Dispatcher.ts`) — a slug named here is skipped
  // by this tick's fanout pick without touching pending.json.
  const quarantinedSlugs = process.env.FLUME_QUARANTINED_SLUGS
    ? new Set(process.env.FLUME_QUARANTINED_SLUGS.split(",").filter(Boolean))
    : undefined;
  const dispatcher = new Dispatcher({
    repoRoot,
    configDir,
    flumeDir,
    agent: claudeCode(),
    // Fanout branch namespace (v0.5 §4): the job resolution above is the one
    // authority; the dispatcher receives it as an option, never re-derives it
    // from flumeDir.
    ...(job !== undefined ? { namespace: job } : {}),
    ...(quarantinedSlugs ? { quarantinedSlugs } : {}),
  });

  if (cmd === "tick") {
    // v0.11 §4: tick and loop both refuse before any tick when HEAD is
    // detached — the tick record's meaning is advancing a named tip, and
    // the (loop-level) claim that guards it keys on a ref. A bare tick
    // takes no claim itself but still refuses here so the behavior is
    // identical whether or not a loop wraps it.
    if ((await currentRefPath(repoRoot)) === null) {
      console.error(
        "[flume] tick refuses: HEAD is detached — checkout a branch first",
      );
      return 1;
    }
    // v0.8 §5: clear any stale verdict before this tick's own work — a tick
    // that returns below without an agent having run (chain-load failure,
    // hibernation, terminal misconfiguration) must leave no record for
    // `flume loop`'s supervisor to misread as its own.
    await clearTickVerdict(flumeDir);
    const outcome = await dispatcher.tick();
    console.log(outcome.summary);
    if (outcome.verdict) {
      await writeTickVerdict(flumeDir, outcome.verdict);
    }
    // Fail loudly on the Axis-C exits (§3) so the supervisor — and any human
    // watching exit codes — classifies the failure without reading logs:
    // 78 terminal misconfiguration, 1 resolution failure, 0 otherwise.
    return tickExitCode(outcome);
  }

  if (cmd === "loop") {
    const maxIdx = rest.indexOf("--max");
    let max = 50;
    if (maxIdx >= 0) {
      const value = rest[maxIdx + 1];
      const parsed = value !== undefined ? Number(value) : NaN;
      if (!Number.isFinite(parsed) || parsed < 0) {
        console.error("usage: flume loop [--max N]");
        return 2;
      }
      max = parsed;
    }
    // v0.11 §4: refuse before any tick when HEAD is detached — the tip
    // claim acquired below keys on the ref HEAD resolves to.
    const headRef = await currentRefPath(repoRoot);
    if (headRef === null) {
      console.error(
        "[flume] loop refuses: HEAD is detached — checkout a branch first",
      );
      return 1;
    }
    // Cross-process loop lock: one supervisor per state root. A stale
    // pidfile (dead pid) is reclaimed; a live one refuses the second loop —
    // two supervisors against one state root race plan/build state. Lives
    // under flumeDir (§16): the state root is what races, and a relocated
    // dock must carry its lock with it.
    const lockPath = join(flumeDir, "loop.pid");
    mkdirSync(flumeDir, { recursive: true });
    if (existsSync(lockPath)) {
      const prior = Number(readFileSync(lockPath, "utf8").trim());
      let alive = false;
      if (Number.isFinite(prior) && prior > 0) {
        try {
          process.kill(prior, 0);
          alive = true;
        } catch {
          // dead or not ours — reclaim
        }
      }
      if (alive) {
        console.error(
          `[flume] another loop (pid ${prior}) already runs against ${flumeDir}; refusing`,
        );
        return 1;
      }
    }
    writeFileSync(lockPath, String(process.pid));
    // v0.11 §4: advisory per-ref tip claim — one flume writer per tip, the
    // resource multiple jobs under one checkout actually contend on. Guards
    // a different resource than loop.pid (a ref vs. a state root); both
    // stand. A refusal here rolls back the loop.pid claim just taken above.
    let tipClaim: Awaited<ReturnType<typeof acquireTipClaim>>;
    try {
      tipClaim = await acquireTipClaim(repoRoot, headRef);
    } catch (err) {
      try {
        unlinkSync(lockPath);
      } catch {
        // already gone
      }
      if (err instanceof TipClaimHeldError) {
        console.error(`[flume] ${err.message}`);
        return 1;
      }
      throw err;
    }
    const dropLock = () => {
      try {
        unlinkSync(lockPath);
      } catch {
        // already gone
      }
      tipClaim.release();
    };
    process.on("exit", dropLock);
    process.on("SIGINT", () => {
      dropLock();
      process.exit(130);
    });
    process.on("SIGTERM", () => {
      dropLock();
      process.exit(143);
    });
    // Supervisor: one fresh `flume tick` process per iteration (§2). The
    // dispatcher constructed above is unused on this path — each child
    // builds its own and resolves chain.ts in its own process. A terminal
    // stop (§3) or a mount-dead abort (v0.7 §4) propagates the child's exit
    // code out of `flume loop` too: exiting 0 here would re-mask either as
    // clean at the next process boundary up.
    //
    // v0.8 §8: best-effort read of the chain's `supervisorPolicy` override —
    // a chain that fails to load here surfaces nothing new; the first child
    // tick still reports mount-dead exactly as it does today, and
    // `superviseLoop` falls through to the v0.7 §16 defaults meanwhile.
    let supervisorPolicy: Chain["supervisorPolicy"];
    try {
      ({ chain: { supervisorPolicy } } = await resolveChain());
    } catch {
      // unresolved chain — defaults apply; the child tick names the failure
    }
    const supervised = await superviseLoop({
      repoRoot,
      flumeDir,
      configDir,
      maxTicks: max,
      ...(supervisorPolicy?.quarantineScope !== undefined
        ? { quarantineScope: supervisorPolicy.quarantineScope }
        : {}),
      ...(supervisorPolicy?.abortThreshold !== undefined
        ? { abortThreshold: supervisorPolicy.abortThreshold }
        : {}),
    });
    // v0.7 §4 amendment: name surfaced tick errors in the completion summary
    // even on a 0 exit (partial success) — they must not vanish silently.
    const completion = loopCompletionSummary(supervised);
    if (completion) console.log(completion);
    return loopExitCode(supervised);
  }

  if (cmd === "render") {
    const phaseName = rest[0];
    if (!phaseName) {
      console.error("usage: flume render <phase> [--entry <tag>]");
      return 2;
    }
    let chain: Chain;
    try {
      ({ chain } = await resolveChain());
    } catch (err) {
      if (err instanceof CjsContextLoadError) {
        console.error(`[flume] ${err.message}`);
        return 2;
      }
      throw err;
    }
    const phase = chain.phases.find((p) => p.name === phaseName);
    if (!phase) {
      console.error(`unknown phase: ${phaseName}`);
      return 2;
    }

    const entryIdx = rest.indexOf("--entry");
    const entryTag = entryIdx >= 0 ? rest[entryIdx + 1] : undefined;

    const pendingPath = join(flumeDir, "plan", "pending.json");
    let pending: PendingEntry[];
    if (existsSync(pendingPath)) {
      const r = parsePending(
        readFileSync(pendingPath, "utf8"),
        chain.entryExtension,
      );
      if (!r.ok) {
        // Same reader `Dispatcher.tick()`'s decide-reads refuse on
        // (engineering.md "Loud or nothing"): a queue that never resolved
        // must not read as an empty one — render is a third reader of the
        // same file, and rendering a prompt over `[]` would show the agent a
        // queue that lost every real entry rather than the parse errors
        // blocking it.
        console.error(`pending.json invalid (${r.errors.length} errors):`);
        for (const e of r.errors) {
          console.error(`  [${e.index}] ${e.path}: ${e.message}`);
        }
        return 2;
      }
      pending = r.entries;
    } else {
      pending = [];
    }

    const ctx: TickContext = { cwd: repoRoot, flumeDir, pending };
    if (phase.concurrency === "fanout") {
      const target = entryTag
        ? pending.find((e) => e.tag === entryTag)
        : pending.find((e) => e.gate.kind === "open");
      if (!target) {
        console.error(
          entryTag
            ? `no entry with tag ${entryTag} in pending.json`
            : `no open entries in pending.json; pass --entry <tag> to render a gated one`,
        );
        return 2;
      }
      ctx.assignedEntry = target;
    }

    const args = phase.promptArgs?.(ctx) ?? {};
    const prompt = await renderPrompt({
      phase,
      flumeDir,
      promptFile: join(configDir, phase.promptPath),
      cwd: repoRoot,
      args,
    });
    process.stdout.write(prompt);
    return 0;
  }

  console.error(`unknown command: ${cmd}`);
  console.error("Run `flume --help` for usage.");
  return 2;
}

// Run only when invoked as the binary, not when imported (tests reach in for
// `resolveStateDirs` at the resolution seam, §14).
//
// import.meta.url resolves through junctions/symlinks to the file's realpath;
// process.argv[1] keeps the invoked path verbatim. Through a junction- or
// symlink-based install (pnpm's linked store) the two never match on a raw
// string comparison, so resolve argv[1]'s realpath first (RELEASE-v0.7 §3).
// realpathSync throws if argv[1] doesn't exist on disk — fall back to the raw
// comparison rather than crash the import.
export function isInvokedDirectly(argv1: string | undefined): boolean {
  if (argv1 === undefined) return false;
  let argv1Url: string;
  try {
    argv1Url = pathToFileURL(realpathSync(argv1)).href;
  } catch {
    argv1Url = pathToFileURL(argv1).href;
  }
  return import.meta.url === argv1Url;
}

const invokedDirectly = isInvokedDirectly(process.argv[1]);

if (invokedDirectly) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
