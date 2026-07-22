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
 * `--job <name>` given alongside an explicitly-set `FLUME_DIR` /
 * `FLUME_CONFIG_DIR`: two resolution authorities for one state root (v0.5 §3).
 * The CLI maps this to a usage error (exit 2).
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
 * Job resolution (v0.5 §3): `jobFlag` (the global `--job <name>`) or a
 * pre-set `FLUME_JOB` retargets both defaults to
 * `<repoRoot>/.flume/jobs/<name>` and writes `FLUME_JOB` back alongside the
 * dirs, so loop-spawned tick children inherit the whole resolution via env.
 * The flag is a strict authority — an explicitly-set dir env var beside it
 * throws {@link JobResolutionConflictError}. `FLUME_JOB` from env composes
 * with explicit dirs instead of conflicting: on the loop → tick boundary the
 * child sees all three written-back vars, and the dir vars *are* the parent's
 * canonical job resolution, so set dirs win and the job name rides along for
 * the branch guard and fanout namespacing.
 */
export function resolveStateDirs(
  env: NodeJS.ProcessEnv,
  repoRoot: string,
  jobFlag?: string,
): { flumeDir: string; configDir: string; job: string | undefined } {
  if (jobFlag && (env.FLUME_DIR || env.FLUME_CONFIG_DIR)) {
    const set = [env.FLUME_DIR && "FLUME_DIR", env.FLUME_CONFIG_DIR && "FLUME_CONFIG_DIR"]
      .filter(Boolean)
      .join(" and ");
    throw new JobResolutionConflictError(
      `--job ${jobFlag} conflicts with explicit ${set}: one resolution authority — drop --job or unset the env`,
    );
  }
  const job = jobFlag ?? (env.FLUME_JOB || undefined);
  const jobDefault = job ? join(repoRoot, ".flume", "jobs", job) : undefined;
  const flumeDir = env.FLUME_DIR
    ? resolve(env.FLUME_DIR)
    : (jobDefault ?? join(repoRoot, ".flume"));
  const configDir = env.FLUME_CONFIG_DIR
    ? resolve(env.FLUME_CONFIG_DIR)
    : (jobDefault ?? join(repoRoot, ".flume"));
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

Options:
  --job <name>        Resolve state + config to <repoRoot>/.flume/jobs/<name>
                      and set FLUME_JOB=<name> (equivalent to setting the env
                      var). Conflicts with explicit FLUME_DIR/FLUME_CONFIG_DIR
                      (exit 2). tick/loop then require HEAD == job/<name>.
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

function isSubcommand(value: string): value is Subcommand {
  return (SUBCOMMANDS as readonly string[]).includes(value);
}

function wantsHelp(args: readonly string[]): boolean {
  return args.includes("--help") || args.includes("-h");
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

  const cmd = firstArg ?? "tick";
  const rest = restArgs;

  // Per-subcommand --help short-circuits before any side effects (chain load,
  // baton mutation, agent invocation).
  if (isSubcommand(cmd) && wantsHelp(rest)) {
    process.stdout.write(HELP_SUB[cmd]);
    return 0;
  }

  // Resolve both state roots up front and canonicalize them back into the env
  // (§12). `flumeDir` is the mutable-state root (baton, pending, worktrees,
  // prior-attempts); `configDir` is the chain+prompt dir. Both default to
  // `<repoRoot>/.flume`; `FLUME_DIR` / `FLUME_CONFIG_DIR` relocate them, and
  // `--job` / `FLUME_JOB` retargets the default to `.flume/jobs/<name>`
  // (v0.5 §3). Resolving here (not constructing) lets the values survive the
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
