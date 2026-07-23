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

import { resolve, join, dirname } from "node:path";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

import { Baton } from "./Baton.js";
import { currentBranch } from "./git.js";
import {
  jobExtract,
  jobNew,
  jobRm,
  jobRun,
  jobStatus,
  JobUsageError,
} from "./job.js";
import {
  Dispatcher,
  diskChainLoader,
  superviseLoop,
  EX_TERMINAL_MISCONFIG,
  type TickOutcome,
} from "./Dispatcher.js";
import { claudeCode } from "./Agent.js";
import type { TickContext } from "./Phase.js";
import { renderPrompt } from "./Prompt.js";
import { parsePending } from "./PendingSchema.js";

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
 * Map a tick outcome to the `flume tick` process exit code — the §3 axis
 * classification at the process boundary: 78 (`EX_CONFIG`) terminal
 * misconfiguration, 1 chain-resolution failure, 0 otherwise (work done or
 * clean hibernation). Exported for the exit-code seam tests.
 */
export function tickExitCode(outcome: TickOutcome): number {
  if (outcome.terminal) return EX_TERMINAL_MISCONFIG;
  return outcome.failed ? 1 : 0;
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
  job new <name> [--template <dir>]
                      Create branch job/<name> + seed .flume/jobs/<name>/
                      (runtime .gitignore, @dtmd/flume link, baseline commit).
  job run <name> [--max N]
                      Check out job/<name>, wake the chain's entry phase from
                      hibernation, then loop under the job resolution.
  job rm <name>       Remove the job's state root: git rm + cleanup commit on
                      job/<name>, untracked runtime swept, worktrees pruned.
                      Refuses on a live loop; the job branch survives.
  job status          List jobs under .flume/jobs/ — awake phases + pending
                      count per job. Observational; no side effects.
  job extract <name> --onto <base> [--intake <path>]...
                      Fork clean branch <name> off <base>: intake files first
                      as one commit, then non-harness commits cherry-picked
                      oldest-first; harvest friction/open-questions to
                      stdout; delete job/<name> + the job dir (extract
                      consumes the job).

Options:
  --job <name>        Resolve state to <repoRoot>/.flume/jobs/<name> and set
                      FLUME_JOB=<name> (equivalent to setting the env var).
                      Config (chain.ts + prompts) stays at <repoRoot>/.flume —
                      chains are repo-resident; an explicit FLUME_CONFIG_DIR
                      composes. Conflicts with explicit FLUME_DIR (exit 2).
                      tick/loop then require HEAD == job/<name>.
  -h, --help          Print this message.
  -v, --version       Print the flume version.

Run \`flume <command> --help\` for per-command usage and exit codes.
`;

const HELP_SUB: Record<Subcommand, string> = {
  status: `Usage: flume status

Print baton state: awake phases (or "hibernating" if none). Observational —
no side effects, no agent invocation.

Exit codes:
  0   Always.
`,
  tick: `Usage: flume tick

Run one phase × one tick of whichever phase is awake. Loads .flume/chain.ts,
picks the next pending entry (for fanout phases) or runs the singleton phase,
invokes the agent, and applies validation gates.

Exit codes:
  0   Success, or hibernation (no phase awake).
  1   Harness error (chain load failure, unexpected exception), or — under a
      job resolution (--job/FLUME_JOB) — HEAD is not job/<name>.
  78  Terminal misconfiguration (EX_CONFIG): every awake flag names a phase
      the chain does not declare. The flags are left on disk — inspect, then
      \`flume sleep <phase>\` or fix the chain.
`,
  loop: `Usage: flume loop [--max N]

Run ticks until hibernation or --max iterations have elapsed.

Options:
  --max N    Maximum number of ticks before bailing (default 50).

Exit codes:
  0   Hibernation reached, or --max ticks completed.
  1   Harness error, another live loop holds the lock, or — under a job
      resolution (--job/FLUME_JOB) — HEAD is not job/<name>.
  78  Stopped on a child tick's terminal misconfiguration (see \`flume tick
      --help\`); the orphaned awake flags are left on disk.
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

Lifecycle verbs over the job convention (a job is branch job/<name> plus
state root .flume/jobs/<name>/). Machinery only — harness content (chain.ts,
prompts) arrives via --template, caller-owned.

Verbs:
  new <name> [--template <dir>]
      From current HEAD: create branch job/<name> (reuse if it exists), seed
      .flume/jobs/<name>/ from --template (verbatim copy; absent → empty dir
      plus a warning), merge runtime ignore entries into the job dir's
      .gitignore (awake/, prior-attempts/, worktrees/, node_modules/,
      loop.pid), link node_modules/@dtmd/flume to the running flume's
      package root (junction on win32; skipped if the link exists), pin
      core.longpaths repo-locally (win32), and baseline-commit the seeded
      harness. Stays on job/<name>.

  run <name> [--max N]
      Assert branch job/<name> exists (error otherwise) and check it out
      unless HEAD is already on it; wake the chain's entry phase (phases[0])
      iff the baton is hibernating — a mid-job baton is left untouched; then
      run the standard loop under the job resolution. Lock, supervisor, and
      exit codes are identical to \`flume --job <name> loop [--max N]\`.

  rm <name>
      Refuse while the job's loop.pid records a live pid. Check out
      job/<name> if HEAD is elsewhere, \`git rm -r .flume/jobs/<name>\` plus
      a cleanup commit on the branch, remove untracked runtime remnants
      (awake/, prior-attempts/, the @dtmd/flume link, pid files), and
      \`git worktree prune\`. The job branch survives — integration
      (merge/squash) and branch deletion are the operator's acts.

  status
      Enumerate .flume/jobs/* in the working tree: one line per job with its
      awake phases (or "hibernating") and pending count (entries in the
      job's plan/pending.json; 0 when absent, "unparsable" when broken).
      Observational — nothing on disk changes; prints "no jobs" when the
      jobs dir is empty or missing.

  extract <name> --onto <base> [--intake <path>]...
      The clean-history ending: refuse if branch <name> already exists (no
      clobber); fork <name> off --onto; sync each --intake file byte-exact
      to its state at the job/<name> tip and ship the whole delta as one
      commit; then cherry-pick, oldest-first, the commits in
      <base>..job/<name> touching any path outside .flume/jobs/<name> and
      outside the intake set. A cherry-pick failure aborts, unwinds to the
      job branch, and deletes the partial branch — retryable, nothing lost.
      On success, print friction.md and plan/open-questions.md off the job
      branch tip to stdout, then delete job/<name> and the harness dir:
      extract consumes the job. --onto is required, never guessed.

Exit codes:
  0   Success (run: hibernation reached, or --max ticks completed; rm on an
      already-clean job is a no-op; status: always, including no jobs).
  1   Git or filesystem failure (checkout, link provisioning, commit); for
      run also: harness error, or another live loop holds the job's lock;
      for rm also: the job's loop is still live; for extract also: branch
      <name> already exists, uncommitted tracked changes, a live loop,
      job/<name> checked out in another worktree, or a cherry-pick conflict
      (unwound to job/<name>; retryable).
  2   Usage error: missing or unknown verb, missing <name>, a <name> that is
      not a single path segment, --template pointing at no directory, run
      on a job whose branch does not exist, rm on a <name> that names
      neither a branch nor a job dir, status given any argument, or extract
      missing --onto, given a flag without a value, given an --onto that
      resolves to no commit, or naming a job whose branch does not exist.
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
      const jobs = jobStatus(repoRoot);
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
        console.log(`${j.name.padEnd(width)}  ${state}  ${pending}`);
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

  if (verb === "extract") {
    const usage =
      "usage: flume job extract <name> --onto <base> [--intake <path>]...";
    const words = [...rest];
    let onto: string | undefined;
    const ontoIdx = words.indexOf("--onto");
    if (ontoIdx >= 0) {
      const value = words[ontoIdx + 1];
      if (!value || value.startsWith("-")) {
        console.error(usage);
        return 2;
      }
      onto = value;
      words.splice(ontoIdx, 2);
    }
    const intake: string[] = [];
    let intakeIdx: number;
    while ((intakeIdx = words.indexOf("--intake")) >= 0) {
      const value = words[intakeIdx + 1];
      if (!value || value.startsWith("-")) {
        console.error(usage);
        return 2;
      }
      intake.push(value);
      words.splice(intakeIdx, 2);
    }
    const name = words[0];
    if (!name || words.length > 1 || onto === undefined) {
      console.error(usage);
      return 2;
    }
    try {
      const result = await jobExtract({ repoRoot, name, onto, intake });
      // §5e-4: the harvested prose goes to stdout for operator routing.
      for (const h of result.harvest) {
        if (h.content === null) {
          console.log(`[flume] no ${h.path} on job/${name}`);
        } else {
          console.log(`--- job/${name}:${h.path} ---`);
          process.stdout.write(
            h.content.endsWith("\n") ? h.content : h.content + "\n",
          );
        }
      }
      return 0;
    } catch (err) {
      if (err instanceof JobUsageError) {
        console.error(`[flume] ${err.message}`);
        return 2;
      }
      console.error(
        `[flume] job extract failed: ${err instanceof Error ? err.message : String(err)}`,
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
  let template: string | undefined;
  const tplIdx = words.indexOf("--template");
  if (tplIdx >= 0) {
    const value = words[tplIdx + 1];
    if (!value || value.startsWith("-")) {
      console.error("usage: flume job new <name> [--template <dir>]");
      return 2;
    }
    template = value;
    words.splice(tplIdx, 2);
  }
  const name = words[0];
  if (!name || words.length > 1) {
    console.error("usage: flume job new <name> [--template <dir>]");
    return 2;
  }

  try {
    await jobNew({
      repoRoot,
      name,
      ...(template !== undefined ? { template } : {}),
    });
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
  const repoRoot = process.cwd();

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

  // `job run` preflight (v0.5 §5b-1/2): assert-or-checkout job/<name>, wake
  // the entry phase iff hibernating. Placed after the resolution (a conflict
  // must refuse before any mutation) and before the wrong-branch guard —
  // the checkout is what satisfies it.
  if (jobRunName !== undefined) {
    try {
      await jobRun({ repoRoot, name: jobRunName, flumeDir, configDir });
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

  // Wrong-branch guard (v0.5 §3): under a job resolution the mutating
  // subcommands commit to the working tree's HEAD (HEAD-is-truth, §2), so
  // they assert HEAD is the job's conventional branch before dispatch.
  // Read-only subcommands skip the check; bare invocation (no job) keeps
  // HEAD-is-truth untouched.
  if (job && (cmd === "tick" || cmd === "loop")) {
    const head = await currentBranch(repoRoot);
    const want = `job/${job}`;
    if (head !== want) {
      console.error(
        `[flume] job '${job}' mutates branch '${want}' but HEAD is '${head}'; refusing ${cmd} — check out ${want} first`,
      );
      return 1;
    }
  }

  if (cmd === "status") {
    const baton = new Baton(flumeDir);
    const awake = baton.awake();
    console.log(awake.length ? `awake: ${awake.join(", ")}` : "hibernating");
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
  const dispatcher = new Dispatcher({
    repoRoot,
    configDir,
    flumeDir,
    agent: claudeCode(),
    // Fanout branch namespace (v0.5 §4): the job resolution above is the one
    // authority; the dispatcher receives it as an option, never re-derives it
    // from flumeDir.
    ...(job !== undefined ? { namespace: job } : {}),
  });

  if (cmd === "tick") {
    const outcome = await dispatcher.tick();
    console.log(outcome.summary);
    // Fail loudly on the Axis-C exits (§3) so the supervisor — and any human
    // watching exit codes — classifies the failure without reading logs:
    // 78 terminal misconfiguration, 1 resolution failure, 0 otherwise.
    return tickExitCode(outcome);
  }

  if (cmd === "loop") {
    const maxIdx = rest.indexOf("--max");
    const max = maxIdx >= 0 ? Number(rest[maxIdx + 1]) : 50;
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
    const dropLock = () => {
      try {
        unlinkSync(lockPath);
      } catch {
        // already gone
      }
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
    // stop (§3) propagates the child's 78 out of `flume loop` too: exiting
    // 0 here would re-mask the misconfiguration as clean at the next
    // process boundary up.
    const supervised = await superviseLoop({ repoRoot, flumeDir, maxTicks: max });
    return supervised.terminal ? EX_TERMINAL_MISCONFIG : 0;
  }

  if (cmd === "render") {
    const phaseName = rest[0];
    if (!phaseName) {
      console.error("usage: flume render <phase> [--entry <tag>]");
      return 2;
    }
    const { default: chain } = await resolveChain();
    const phase = chain.phases.find((p) => p.name === phaseName);
    if (!phase) {
      console.error(`unknown phase: ${phaseName}`);
      return 2;
    }

    const entryIdx = rest.indexOf("--entry");
    const entryTag = entryIdx >= 0 ? rest[entryIdx + 1] : undefined;

    const pendingPath = join(flumeDir, "plan", "pending.json");
    const pending = existsSync(pendingPath)
      ? (() => {
          const r = parsePending(readFileSync(pendingPath, "utf8"));
          if (!r.ok) {
            console.error(`pending.json invalid (${r.errors.length} errors):`);
            for (const e of r.errors) {
              console.error(`  [${e.index}] ${e.path}: ${e.message}`);
            }
            return [];
          }
          return r.entries;
        })()
      : [];

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
const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
