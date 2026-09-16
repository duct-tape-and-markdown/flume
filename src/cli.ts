#!/usr/bin/env -S node --experimental-strip-types --no-warnings

/**
 * `flume` — single tick, or loop until hibernation.
 *
 * The runtime usage text printed by `flume --help` / `flume <cmd> --help`
 * is the authoritative reference; see HELP_TEXT below.
 *
 * The chain config is loaded from `./.flume/chain.ts` (resolved with tsx).
 * That file must default-export a factory — `(api) => ({ chain })` — whose
 * return may carry `agent` to override the default `claudeCode()`.
 */

import { resolve, join, dirname, toNamespacedPath } from "node:path";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import type { Dirent, Stats } from "node:fs";

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
  ensureRuntimeIgnores,
  frictionIgnoreEntry,
  jobRun,
  liveLoopPid,
  readPendingLoose,
  JobUsageError,
} from "./job.js";
import { diskChainLoader } from "./chainLoad.js";
import {
  Dispatcher,
  RenderUnresolvedError,
  RenderUsageError,
  type RenderResolution,
  type TickOutcome,
} from "./Dispatcher.js";
import { EX_MOUNT_DEAD, EX_TERMINAL_MISCONFIG } from "./exitCodes.js";
import { readMergingMarkers } from "./mergingMarkers.js";
import {
  clearTickVerdict,
  readTickVerdicts,
  writeTickVerdict,
} from "./tickVerdict.js";
import { frictionCountLine } from "./friction.js";
import { existsLoud } from "./fsProbe.js";
import { DEFAULT_KILL_GRACE_MS } from "./processTree.js";
import { superviseLoop, type SuperviseResult } from "./loopSupervisor.js";
import { readPackageVersion } from "./selfPackage.js";
import { claudeCode } from "./Agent.js";
import type { Chain } from "./Phase.js";
import { parsePending } from "./PendingSchema.js";
import { InlineExecRenderError } from "./Prompt.js";
import {
  DEFAULT_PENDING_REL,
  loopLockPath,
  mergingDir,
  namespacedJoin,
  plainPath,
  queueFenceViolations,
  resolvePendingPath,
  STATE_ROOT_NAMES,
  stopFlagPath,
} from "./paths.js";
import {
  JobResolutionConflictError,
  CrossRepoFlumeDirError,
  resolveRepoRoot,
  resolveStateDirs,
} from "./cliJobResolution.js";
import {
  tickExitCode,
  loopExitCode,
  describeRefFailure,
  loopCompletionSummary,
  formatTickVerdictLine,
} from "./cliVerdict.js";
import { HELP_TOP, HELP_SUB, HELP_JOB, isSubcommand, wantsHelp } from "./cliHelp.js";
import {
  loadChainForObservation,
  refuseCjsContextHost,
} from "./cliChainLoad.js";
import { runJobVerb } from "./cliJobVerbs.js";
import type { FlumePaths } from "./flumeApi.js";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * sysexits.h `EX_DATAERR` — a declared-world inconsistency the caller can
 * classify from the exit status alone (`.claude/rules/platform-facts.md`,
 * "Exit codes come from sysexits.h"). `flume check`'s only non-zero exit:
 * a `pending.json` that fails to parse or that declares a path outside the
 * consumer phase's fence.
 */
export const EX_DATAERR = 65;

/**
 * sysexits.h `EX_IOERR` — I/O failed on a file known to exist (permission
 * denied, a path too long for the platform, …), distinct from `ENOENT`
 * (`.claude/rules/engineering.md`, "Loud or nothing": a stat failure other
 * than absence must never read as "nothing to check").
 */
export const EX_IOERR = 74;

/**
 * Shared `--max` numeric parse for `job run` (rewrites into `loop` below) and
 * `loop` itself — a non-numeric or negative value must refuse identically on
 * both surfaces, and `job run` must refuse before its preflight wakes the
 * entry phase, not after rewriting into `loop`.
 */
function parseMaxValue(value: string | undefined): number | null {
  const parsed = value !== undefined ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * What a signal handler says at receipt, before the wait it is announcing
 * starts (spec/loop.md, "The loop lock and the tip claim"). One spelling for
 * both handlers below: a `flume loop` waiting on its tick child and a bare
 * `flume tick` waiting on its agent tree are the same promise one rung apart,
 * and the operator at a Ctrl-C is at whichever one they launched.
 *
 * Neither handler bounds its own wait, so the only number that ends a tree
 * ignoring the SIGTERM is the escalation grace — named here rather than left
 * to a lookup, because `--help` names no supervisor knob and a Ctrl-C that
 * takes the whole grace is otherwise a silent hang.
 */
function signalledWaitLine(waitingOn: string, graceMs: number): string {
  return (
    `[flume] signalled; waiting for ${waitingOn} to exit — this wait has no ` +
    `bound of its own; the SIGKILL that ends a tree ignoring the SIGTERM ` +
    `lands ${graceMs}ms after it (supervisorPolicy.killGraceMs)`
  );
}

/**
 * `wake`/`sleep`'s best-effort chain load: a missing or broken chain must
 * never block the marker mutation — there is nothing to validate the phase
 * name against. Only a chain that loads *successfully* and does not declare
 * `phase` among its `chain.phases` refuses. Reached with `configDir`
 * (repo-resident) — `--job` never retargets it, so a job-dir `chain.ts` is
 * inert here exactly as it is for `status` and `tick`.
 *
 * Not merely mirroring `status`'s pattern — taking it: the same shared load
 * (`loadChainForObservation`, src/cliChainLoad.ts) both observational
 * surfaces use, so a chain that throws is named on stderr here too rather
 * than swallowed by a second bare catch beside it
 * (`.claude/rules/engineering.md`, "The fix lands at the mechanism"). The
 * cost `wake`/`sleep` pay is its own — not a rebased pending count, but a
 * phase name nothing checked.
 */
async function chainRefusesPhase(
  paths: FlumePaths,
  surface: string,
  phase: string,
): Promise<boolean> {
  const { chain } = await loadChainForObservation(
    paths,
    surface,
    `proceeding without phase validation — '${phase}' is taken on trust, so ` +
      `a typo lands a marker no phase will ever read.`,
  );
  if (!chain) return false;
  return !chain.phases.some((p) => p.name === phase);
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);

  // Bay discovery's own stat refusal, mapped at the same boundary as every
  // other one in this file: `resolveRepoRoot` throws on a `.flume` that is
  // present but unstattable (src/cliJobResolution.ts), and this is the first
  // thing the CLI does, ahead of every other try/catch. Uncaught, the throw
  // reached `main().catch` and left the operator a raw stack and an exit 1 —
  // the one stat refusal in the CLI that could not be classified from the
  // exit status (`.claude/rules/platform-facts.md`, "Exit codes come from
  // `sysexits.h`"). The stat error carries the offending path; the cwd here
  // is the walk's origin, which it does not.
  let repoRoot: string;
  try {
    repoRoot = resolveRepoRoot(process.cwd());
  } catch (err) {
    console.error(
      `[flume] bay discovery from ${process.cwd()} failed to stat an ancestor bay: ${err instanceof Error ? err.message : String(err)}`,
    );
    return EX_IOERR;
  }

  // Global `--job <name>`: extract it wherever it appears so it composes with
  // every subcommand, before any dispatch.
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
  // (and before any resolution or chain load) so they work in any cwd. The
  // bare `help` verb is one more arm on this same branch, never a usage text
  // of its own: it is the first thing an operator types at a command line
  // they have not run before, and the answer it gets is `--help`'s to the
  // byte.
  if (firstArg === "--help" || firstArg === "-h" || firstArg === "help") {
    process.stdout.write(HELP_TOP);
    return 0;
  }
  if (firstArg === "--version" || firstArg === "-v") {
    console.log(readPackageVersion(HERE));
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

  // `flume job <verb>`. `run` is the exception — it IS the standard loop under
  // the job resolution, so it rewrites itself into `--job <name> loop [--max
  // N]` and falls through; only its preflight (branch + entry-phase wake) runs
  // before the loop, below. The other verbs (`status`/`rm`/`new`) are stashed
  // in `jobVerbArgs` and dispatched to `runJobVerb` *after* state-dir
  // resolution below — they operate on the repo and the job dir named by their
  // own argument, not on a resolved state root, but they still need the single
  // canonicalized `configDir` every other subcommand reads, not a
  // re-derivation from raw `process.env.FLUME_CONFIG_DIR`.
  let jobRunName: string | undefined;
  let jobVerbArgs: readonly string[] | undefined;
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
        if (parseMaxValue(value) === null) {
          console.error("usage: flume job run <name> [--max N]");
          return 2;
        }
        maxArgs = ["--max", value as string];
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
      jobVerbArgs = rest;
    }
  }

  // Resolve both state roots up front and canonicalize them back into the env.
  // `flumeDir` is the mutable-state root (baton, pending, worktrees,
  // prior-attempts); `configDir` is the chain+prompt dir. Both default to
  // `<repoRoot>/.flume`; `FLUME_DIR` / `FLUME_CONFIG_DIR` relocate them, and
  // `--job` / `FLUME_JOB` retargets only the flumeDir default to
  // `.flume/jobs/<name>` — configDir never follows the job. Resolving here
  // (not constructing) lets the values survive the `loop` → `tick` process
  // boundary — children inherit the (now absolute-canonical) env vars — and
  // lets a chain loaded later in this process read one authoritative state
  // root. This runs ahead of every subcommand branch, `job status`/`rm`/`new`
  // included, so none of them re-derives `configDir` independently.
  let flumeDir: string;
  let configDir: string;
  let job: string | undefined;
  try {
    ({ flumeDir, configDir, job } = resolveStateDirs(process.env, repoRoot, jobFlag));
  } catch (err) {
    if (
      err instanceof JobResolutionConflictError ||
      err instanceof CrossRepoFlumeDirError
    ) {
      console.error(`[flume] ${err.message}`);
      return 2;
    }
    throw err;
  }

  // The one resolved-roots value every chain load in this process is built
  // from — `FlumeApi.paths` by reference, so a chain reads the same answer
  // `resolveStateDirs` reached rather than re-deriving one from the env.
  const paths: FlumePaths = { repoRoot, configDir, flumeDir };

  if (jobVerbArgs !== undefined) {
    return runJobVerb(jobVerbArgs, paths);
  }

  // `--job` / `FLUME_JOB` names an existing state root everywhere except
  // `job new` (which creates it — routed above via `runJobVerb`, never
  // reaches this guard) and `job run` (spec/jobs.md "`flume job run <name>`"
  // — no existence precondition, by design: it may materialize a bare state
  // root). `jobRunName` is what distinguishes the `job run` rewrite from a
  // bare `--job`/`FLUME_JOB` use of `status`/`tick`/`loop`/`wake`/`sleep` —
  // the flag alone can't carry that distinction, since `job run` reaches
  // this same resolution by construction (above).
  // Absent is the only silent reading, as with the `status` probes below:
  // `existsLoud` (src/fsProbe.ts) refuses a state root that is present but
  // unstattable (a symlink loop, a permission-denied parent) rather than
  // reporting `does not exist` over a job the operator can see on disk
  // (`.claude/rules/engineering.md`, "Loud or nothing").
  if (job !== undefined && jobRunName === undefined) {
    let stateRootPresent: boolean;
    try {
      stateRootPresent = existsLoud(namespacedJoin(flumeDir));
    } catch (err) {
      console.error(
        `[flume] job '${job}': state root ${flumeDir} failed to stat: ${err instanceof Error ? err.message : String(err)}`,
      );
      return EX_IOERR;
    }
    if (!stateRootPresent) {
      console.error(`[flume] no job '${job}': ${flumeDir} does not exist`);
      return 2;
    }
  }

  // `job run` preflight: wake the entry phase iff hibernating. Placed after
  // the resolution (a conflict must refuse before any mutation). No branch
  // assertion — the engine has no opinion on which branch a state root runs
  // on.
  if (jobRunName !== undefined) {
    try {
      await jobRun({ name: jobRunName, repoRoot, flumeDir, configDir });
    } catch (err) {
      // `jobRun` loads the chain to name the entry phase whenever the baton
      // is hibernating, so this catch sees the same CJS-context refusal
      // `check`, `friction` and `job new` do — through the same arm, so no
      // surface can drift into relaying it at exit 1 behind a
      // `job run failed:` prefix.
      const cjs = refuseCjsContextHost(err);
      if (cjs !== undefined) return cjs;
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
    // Surface supervisor liveness beside the awake markers — the 2026-07-29
    // incident's "hibernating" reading left the operator to infer
    // relaunch-safety instead of being told it. No pidfile: silent, leaving
    // the output as it read before this line existed.
    // Absent is the only silent reading: `existsLoud` (src/fsProbe.ts) refuses
    // a `loop.pid` that is present but unstattable (a symlink loop, a
    // permission-denied parent) rather than reading it as absent and printing
    // no supervisor line over a possibly-live loop
    // (`.claude/rules/engineering.md`, "Loud or nothing").
    let supervisorLive = false;
    let loopLockPresent: boolean;
    try {
      loopLockPresent = existsLoud(namespacedJoin(loopLockPath(flumeDir)));
    } catch (err) {
      // The stat error carries the offending path itself; the name here comes
      // from the accessor's own table, never a second spelling of "loop.pid".
      console.error(
        `[flume] status: ${STATE_ROOT_NAMES.loopLock} failed to stat: ${err instanceof Error ? err.message : String(err)}`,
      );
      return EX_IOERR;
    }
    if (loopLockPresent) {
      const pid = await liveLoopPid(flumeDir);
      supervisorLive = pid !== null;
      console.log(
        pid !== null
          ? `supervisor pid ${pid} live`
          : "loop.pid present, process dead — stale",
      );
    }
    // spec/loop.md "Graceful stop — the stop flag" / spec/cli.md "`flume
    // status` owes exactly this" line 3: named right after supervisor
    // liveness, before the tip claim — the ack ritual only works if the
    // operator who forgot the flag finds it where they look first.
    // Absent is the only silent reading, as with `loop.pid` above: a stop
    // flag that is present but unstattable must never print as no stop line,
    // because that is exactly the reading spec/loop.md "Graceful stop — the
    // stop flag" promises can never happen — the operator would relaunch over
    // an unacknowledged stop (`.claude/rules/engineering.md`, "Loud or
    // nothing").
    const statusStopPath = stopFlagPath(flumeDir);
    let stopFlagPresent: boolean;
    try {
      stopFlagPresent = existsLoud(namespacedJoin(statusStopPath));
    } catch (err) {
      console.error(
        `[flume] status: ${STATE_ROOT_NAMES.stopFlag} failed to stat: ${err instanceof Error ? err.message : String(err)}`,
      );
      return EX_IOERR;
    }
    if (stopFlagPresent) {
      console.log(
        supervisorLive
          ? `${statusStopPath} present: the running supervisor will finish ` +
              "its in-flight tick and end the run"
          : `${statusStopPath} present: the next \`loop\`/\`job run\` refuses ` +
              "to start until it is removed",
      );
    }
    // Report the current tip's claim alongside supervisor liveness,
    // observational and best-effort — a detached HEAD (no ref to key the claim
    // on), a non-repository cwd, or a git invocation failure all read as
    // silence, the same precedent as the no-pidfile case above. That
    // declaration covers the *git* side and stops there: the claim file's own
    // existence probe splits absent (silent) from unstattable (refuse), so a
    // claim that is present but unreadable never prints as an unclaimed tip
    // (`.claude/rules/engineering.md`, "Loud or nothing").
    const headRefForStatus = await currentRefPath(repoRoot);
    if (headRefForStatus.kind === "ref") {
      const claimPath = tipClaimPath(
        await gitCommonDir(repoRoot),
        headRefForStatus.path,
      );
      let claimPresent: boolean;
      try {
        claimPresent = existsLoud(namespacedJoin(claimPath));
      } catch (err) {
        console.error(
          `[flume] status: tip claim at ${claimPath} failed to stat: ${err instanceof Error ? err.message : String(err)}`,
        );
        return EX_IOERR;
      }
      if (claimPresent) {
        const holder = await liveTipClaimPid(claimPath);
        console.log(
          holder !== null
            ? `tip claimed by pid ${holder}`
            : "tip claim present, process dead — stale",
        );
      }
    }
    // spec/pending.md "The pending queue": best-effort — a missing or broken
    // chain must never fail `status` — but never silent: the shared load
    // (`loadChainForObservation`, src/cliChainLoad.ts) reports the failure and
    // names what it costs on stderr, because the pending count below then
    // rebases on the default queue path.
    const { chain, loadFailure } = await loadChainForObservation(
      paths,
      "status",
      "proceeding over engine defaults — the pending count reads the default " +
        "queue path, and chain-declared friction and capability lines are " +
        "withheld.",
    );
    // That stderr report is not enough on a *listing* (spec/cli.md, "`flume
    // status` owes exactly this"): a status whose chain died printed stdout
    // byte-identical to a healthy repo's, so an operator reading the listing —
    // or anything piping it — saw a count with no sign it had been rebased.
    // The failure is a row of the listing, on the listing's stream, ahead of
    // the count it explains; nothing above it is withheld, and the exit stays
    // 0.
    if (loadFailure) console.log(`chain: failed to load — ${loadFailure}`);
    // The pending entry count, independent of whether the chain loads — `flume
    // job status` probes the same file the same way (`readPendingLoose`,
    // src/job.ts), so a corrupt pending.json reads "unparsable" identically
    // on both surfaces.
    const pending = readPendingLoose(
      resolvePendingPath(flumeDir, chain?.pendingPath),
    );
    console.log(
      pending.ok ? `pending: ${pending.entries.length}` : "pending: unparsable",
    );
    if (chain) {
      const line = await frictionCountLine(flumeDir, chain);
      if (line) console.log(line);
      // Name entries stuck on a capability this chain hasn't asserted — a
      // `requiresCapability` skip must never be silent.
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
    }
    return 0;
  }

  if (cmd === "wake") {
    const phase = rest[0];
    if (!phase || rest.length > 1) {
      console.error("usage: flume wake <phase>");
      return 2;
    }
    if (await chainRefusesPhase(paths, "wake", phase)) {
      console.error(
        `[flume] wake refuses: '${phase}' is not a phase this chain declares`,
      );
      return 2;
    }
    new Baton(flumeDir).wake(phase);
    console.log(`woke ${phase}`);
    return 0;
  }

  if (cmd === "sleep") {
    const phase = rest[0];
    if (!phase || rest.length > 1) {
      console.error("usage: flume sleep <phase>");
      return 2;
    }
    if (await chainRefusesPhase(paths, "sleep", phase)) {
      console.error(
        `[flume] sleep refuses: '${phase}' is not a phase this chain declares`,
      );
      return 2;
    }
    new Baton(flumeDir).sleep(phase);
    console.log(`slept ${phase}`);
    return 0;
  }

  if (cmd === "stop") {
    // `stop` consumes no positionals (spec/cli.md "Subcommand surface") — a
    // stray trailing arg is refused before the flag write below, not run as
    // something other than what the operator typed.
    if (rest.length > 0) {
      console.error("usage: flume stop");
      return 2;
    }
    // spec/loop.md "Graceful stop — the stop flag": the file is the
    // mechanism, this verb is discoverability plus a printed statement —
    // `touch <flumeDir>/stop` is equally the interface. Idempotent: always
    // (re)write the same empty file and print the same fixed statement,
    // never conditioned on whether a supervisor happens to be live right
    // now (that liveness-conditioned phrasing is `status`'s stop-flag line).
    const stopPath = stopFlagPath(flumeDir);
    mkdirSync(toNamespacedPath(flumeDir), { recursive: true });
    writeFileSync(namespacedJoin(stopPath), "");
    console.log(
      `[flume] wrote ${stopPath}: a live supervisor finishes its in-flight ` +
        "tick and ends the run; the next `loop`/`job run` refuses to start " +
        "until the flag is removed.",
    );
    return 0;
  }

  if (cmd === "log") {
    const words = [...rest];
    let jsonMode = false;
    const jsonIdx = words.indexOf("--json");
    if (jsonIdx >= 0) {
      jsonMode = true;
      words.splice(jsonIdx, 1);
    }
    let n = 10;
    const nIdx = words.indexOf("-n");
    if (nIdx >= 0) {
      const parsed = parseMaxValue(words[nIdx + 1]);
      if (parsed === null) {
        console.error("usage: flume log [-n N] [--json]");
        return 2;
      }
      n = parsed;
      words.splice(nIdx, 2);
    }
    if (words.length > 0) {
      console.error("usage: flume log [-n N] [--json]");
      return 2;
    }

    const verdicts = await readTickVerdicts(flumeDir, n);
    for (const v of verdicts) {
      console.log(jsonMode ? JSON.stringify(v) : formatTickVerdictLine(v));
    }
    return 0;
  }

  if (cmd === "check") {
    // `check` consumes no positionals (spec/cli.md "Subcommand surface") —
    // refuse before the chain load below, not just before the fence checks.
    if (rest.length > 0) {
      console.error("usage: flume check");
      return 2;
    }
    let chain: Chain;
    try {
      ({ chain } = await diskChainLoader(paths)());
    } catch (err) {
      const cjs = refuseCjsContextHost(err);
      if (cjs !== undefined) return cjs;
      console.error(
        `[flume] check: chain failed to load: ${err instanceof Error ? err.message : String(err)}`,
      );
      return EX_MOUNT_DEAD;
    }

    // spec/pending.md "The pending queue": the queue path is Chain.pendingPath
    // (default plan/pending.json) — the same resolved value the dispatcher,
    // `flume status`, and `pendingGate` read, never a hardcoded copy.
    const pendingRel = chain.pendingPath ?? DEFAULT_PENDING_REL;
    const pendingPath = resolvePendingPath(flumeDir, chain.pendingPath);
    let raw: string;
    try {
      raw = readFileSync(namespacedJoin(pendingPath), "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        console.log(`${pendingRel} absent — nothing to check`);
        return 0;
      }
      console.error(
        `[flume] check: ${pendingRel} failed to read: ${err instanceof Error ? err.message : String(err)}`,
      );
      return EX_IOERR;
    }

    const parsed = parsePending(raw, chain.entryExtension);
    if (!parsed.ok) {
      console.error(
        `[flume] check: ${pendingRel} has ${parsed.errors.length} schema violation(s)`,
      );
      for (const e of parsed.errors) {
        console.error(`  [${e.index}] ${e.path}: ${e.message}`);
      }
      return EX_DATAERR;
    }

    // The consumer of the queue is whichever phase(s) pick from pending —
    // fanout concurrency is the sole site that does (Phase.ts, "Concurrency";
    // spec/pending.md, "Selection is the sole site; a singleton phase does
    // not pick from pending"). Mirrors how .flume/chain.ts wires build's own
    // writablePaths/entryChannelPaths as plan's pendingGate targetFence —
    // for a chain with one fanout phase this is byte-identical to that
    // fence, derived from the phase declaration instead of a chain-side
    // constant.
    const consumerPhases = chain.phases.filter((p) => p.concurrency === "fanout");

    // No fanout phase means no consumer, and no consumer means no fence to
    // measure against — not an empty fence every declared path falls outside
    // of. The parse above still stands; the fence step is skipped and says so
    // (spec/cli.md "Subcommand surface"), the vacuous case spelled rather
    // than inherited (`.claude/rules/engineering.md`, "A green verdict is
    // proven non-vacuous").
    if (consumerPhases.length === 0) {
      console.log(
        `${pendingRel} valid (${parsed.entries.length} entries), no fanout phase declared; fence not checked`,
      );
      return 0;
    }

    // The same derivation `pendingGate` (`src/builtinGates.ts`) pre-checks a
    // plan commit with, so this verb and that gate can never name different
    // offending paths for one queue — the verb differs only in which
    // consumers it reads the fence from, and in reporting to an operator
    // rather than failing a tick.
    const violations = queueFenceViolations(parsed.entries, consumerPhases);
    if (violations.length > 0) {
      console.error(
        `[flume] check: ${violations.length} pending entr${
          violations.length === 1 ? "y" : "ies"
        } declare files outside the consumer phase's fence`,
      );
      for (const v of violations) {
        console.error(`  [${v.tag}] ${v.offending.join(", ")}`);
      }
      return EX_DATAERR;
    }

    console.log(
      `${pendingRel} valid (${parsed.entries.length} entries), fence check passed`,
    );
    return 0;
  }

  if (cmd === "friction") {
    const name = rest[0];
    if (rest.length > 1) {
      console.error("usage: flume friction [name]");
      return 2;
    }

    let chain: Chain;
    try {
      ({ chain } = await diskChainLoader(paths)());
    } catch (err) {
      const cjs = refuseCjsContextHost(err);
      if (cjs !== undefined) return cjs;
      console.error(
        `[flume] friction: chain failed to load: ${err instanceof Error ? err.message : String(err)}`,
      );
      return EX_MOUNT_DEAD;
    }

    // Output is never interpreted — the engine's lifecycle guarantee over
    // the channel (spec/chain.md, "Chain.friction") is interpretation-
    // freedom, not read-freedom (spec/cli.md, "Subcommand surface"); this
    // verb only moves bytes, it never derives meaning from them.
    if (chain.friction === undefined) {
      console.error(
        "[flume] friction refuses: this chain does not declare Chain.friction",
      );
      return 2;
    }
    const frictionDir = join(flumeDir, chain.friction);

    if (name !== undefined) {
      // A user-supplied name must name a direct child of the declared dir —
      // the same scope the bare list enumerates and --help documents. This
      // also rejects a "../" escape the same shape validateFrictionDeclaration
      // (loadChainModule) already refuses for the chain's own declaration;
      // a nested path is refused identically, not resolved.
      const candidate = resolve(frictionDir, name);
      const isDirectChild = dirname(candidate) === resolve(frictionDir);
      let bytes: Buffer | undefined;
      if (isDirectChild) {
        try {
          bytes = readFileSync(namespacedJoin(frictionDir, name));
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
            console.error(
              `[flume] friction: '${name}' failed to read: ${err instanceof Error ? err.message : String(err)}`,
            );
            return EX_IOERR;
          }
          bytes = undefined;
        }
      }
      if (bytes === undefined) {
        console.error(
          `[flume] friction: no note named '${name}' in '${chain.friction}'`,
        );
        return 2;
      }
      process.stdout.write(bytes);
      return 0;
    }

    let entries: Dirent[];
    try {
      entries = readdirSync(namespacedJoin(frictionDir), { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        console.error(
          `[flume] friction: '${chain.friction}' failed to read: ${err instanceof Error ? err.message : String(err)}`,
        );
        return EX_IOERR;
      }
      // Declared-but-absent dir lists empty (spec/cli.md): the directory is
      // created lazily by whichever engine write needs it first, so its
      // absence here is a legitimate, silent, zero-note state.
      return 0;
    }
    const files = entries
      .filter((e) => e.isFile())
      .map((e) => e.name)
      .sort();
    // Every row is stat'd before any is printed: a half-list on stdout
    // followed by a refusal on stderr reads, to anything redirecting the
    // list, as a complete channel. A note readdir enumerated but stat cannot
    // see is an unresolved input, ENOENT included — unlike the dir itself
    // above, absence here is a note that vanished mid-list, never a
    // legitimate zero state — so this arm refuses on any stat failure with
    // the same EX_IOERR the readdir and named-note arms return.
    const rows: string[] = [];
    for (const fileName of files) {
      let stats: Stats;
      try {
        stats = statSync(namespacedJoin(frictionDir, fileName));
      } catch (err) {
        console.error(
          `[flume] friction: '${chain.friction}/${fileName}' failed to read: ${err instanceof Error ? err.message : String(err)}`,
        );
        return EX_IOERR;
      }
      rows.push(`${fileName}  ${stats.size}  ${stats.mtime.toISOString()}`);
    }
    for (const row of rows) console.log(row);
    return 0;
  }

  // The `flume loop` supervisor's run-scoped quarantine crosses the process
  // boundary via this env var (set by `defaultTickRunner`,
  // `src/loopSupervisor.ts`) — an entry whose quarantine key (`slug@hash` of
  // its bytes in the queue) is named here is skipped by this tick's fanout pick
  // without touching pending.json. The values are opaque equality keys, split
  // apart on the comma the writer joined on and never parsed further: the hash
  // half means an entry re-scoped since the failing tick simply stops
  // matching, which is how a re-scope lifts a hold without a relaunch.
  const quarantinedSlugs = process.env.FLUME_QUARANTINED_SLUGS
    ? new Set(process.env.FLUME_QUARANTINED_SLUGS.split(",").filter(Boolean))
    : undefined;
  // spec/loop.md "The loop lock and the tip claim": which pid the wave's own
  // tip-verify checks (`liveForeignClaimPid`, src/Dispatcher.ts) treat as
  // this run's own rather than a foreign concurrent engine — a loop-spawned
  // child's supervisor (told via FLUME_TIP_CLAIM_HELD, set by
  // `defaultTickRunner`), or this process's own pid otherwise, which is
  // exactly the pid a bare tick's own claim (acquired below) is filed under.
  const ownTipClaimPid = process.env.FLUME_TIP_CLAIM_HELD
    ? Number(process.env.FLUME_TIP_CLAIM_HELD)
    : process.pid;
  // This process's teardown, reaching the agent a tick starts: the tick
  // command's signal handlers abort it and await the tick, so the agent tree
  // is gone before the tip claim drops (spec/loop.md, "The loop lock and the
  // tip claim"). Constructed here because the dispatcher is — the signal
  // handlers that abort it are installed in the `tick` branch below, which is
  // the only command that runs one.
  const stopTick = new AbortController();
  // Dispatcher resolves .flume/chain.ts from configDir once at tick start —
  // the one chain-factory application a `flume tick` process makes, which is
  // why every fact a tick needs off its chain is read back off the dispatcher
  // rather than resolved again here (`Dispatcher.agentKillGraceMs` is the
  // teardown's). `flume loop` re-resolves by spawning a fresh `flume tick` per
  // iteration; a chain.ts whose factory returns `agent` overrides the default
  // agent per tick.
  const dispatcher = new Dispatcher({
    repoRoot,
    configDir,
    flumeDir,
    agent: claudeCode(),
    ownTipClaimPid,
    stopSignal: stopTick.signal,
    // Fanout branch namespace: the job resolution above is the one authority;
    // the dispatcher receives it as an option, never re-derives it from
    // flumeDir.
    ...(job !== undefined ? { namespace: job } : {}),
    ...(quarantinedSlugs ? { quarantinedSlugs } : {}),
  });

  if (cmd === "render") {
    const words = [...rest];
    let entryTag: string | undefined;
    const entryIdx = words.indexOf("--entry");
    if (entryIdx >= 0) {
      const value = words[entryIdx + 1];
      if (!value || value.startsWith("-")) {
        console.error("usage: flume render <phase> [--entry <tag>]");
        return 2;
      }
      entryTag = value;
      words.splice(entryIdx, 2);
    }
    const phaseName = words[0];
    // One positional, `<phase>` — same class as `tick`'s stray-arg refusal
    // (spec/cli.md "Subcommand surface", gh#1): rendering a phase other than
    // the one typed is the harm, and it is refused before the chain loads.
    if (!phaseName || words.length > 1) {
      console.error("usage: flume render <phase> [--entry <tag>]");
      return 2;
    }

    let resolution: RenderResolution;
    try {
      resolution = await dispatcher.render({
        phase: phaseName,
        ...(entryTag !== undefined ? { entryTag } : {}),
      });
    } catch (err) {
      const cjs = refuseCjsContextHost(err);
      if (cjs !== undefined) return cjs;
      if (err instanceof RenderUsageError) {
        console.error(`[flume] render refuses: ${err.message}`);
        return 2;
      }
      // The two shapes of "the prompt never resolved" — an unresolved
      // inline-exec span (which names every failing span itself) and a
      // `promptArgs` throw. One exit code because the engine gives them one
      // name: `render-refused` (`NO_COMMIT_MODES`, src/Prompt.ts). This is
      // the refusal a tick would have bought with an invocation, so it is the
      // same EX_DATAERR `check` spends nothing to reach.
      if (
        err instanceof InlineExecRenderError ||
        err instanceof RenderUnresolvedError
      ) {
        console.error(`[flume] render refuses: ${err.message}`);
        return EX_DATAERR;
      }
      // Declared bound (`.claude/rules/engineering.md`, "Loud or nothing"):
      // everything left is the chain failing to come up — it would not load,
      // its queue would not parse, its declared prompt file is not on disk.
      // Classified mount-dead, the same code `tick` and `check` return when
      // the chain cannot be run, rather than left to `main().catch`'s raw
      // stack and exit 1.
      console.error(
        `[flume] render: nothing resolved: ${err instanceof Error ? err.message : String(err)}`,
      );
      return EX_MOUNT_DEAD;
    }

    // Which entry the resolution picked, and what the tick's own pickability
    // verdict says about it — on stderr, so stdout stays the prompt and its
    // one notice line. A hand-named entry a tick would decline to carry is
    // rendered and said so, never silently previewed as if it were next.
    if (resolution.entry) {
      const tag = resolution.entry.tag;
      const carried = resolution.pickable.some((e) => e.tag === tag);
      console.error(
        carried
          ? `[flume] render: ${resolution.phaseName} scoped to entry ${tag}`
          : `[flume] render: ${resolution.phaseName} scoped to entry ${tag} — ` +
              `not pickable at HEAD; a tick would not carry it`,
      );
    }
    // spec/cli.md "Subcommand surface": the block is omitted, and the first
    // line of the output says so — a render outside a tick has no attempt to
    // carry, and one is never reconstructed for it.
    console.log(
      "[flume] render: <prior-attempt> omitted — a render outside a tick " +
        "carries no attempt, and it is never reconstructed.",
    );
    process.stdout.write(resolution.prompt);
    return 0;
  }

  if (cmd === "tick") {
    // `tick` consumes no positionals (spec/cli.md "Subcommand surface") — a
    // stray trailing arg (gh#1's field-reported shape: `flume tick plan`
    // silently ticking whichever phase was awake, instead of the named one)
    // is refused before any tick runs, not honored as something the
    // operator never typed.
    if (rest.length > 0) {
      console.error("usage: flume tick");
      return 2;
    }
    // Clear any stale verdict before this tick's own work — a tick that
    // returns below without an agent having run (chain-load failure,
    // hibernation, terminal misconfiguration, the detached-HEAD refusal below)
    // must leave no record for `flume loop`'s supervisor to misread as its
    // own.
    await clearTickVerdict(flumeDir);
    // Tick and loop both refuse before any tick when HEAD does not name a ref
    // — the tick record's meaning is advancing a named tip, and the
    // (loop-level) claim that guards it keys on a ref. A bare tick takes no
    // claim itself but still refuses here so the behavior is identical whether
    // or not a loop wraps it.
    const tickHeadRef = await currentRefPath(repoRoot);
    if (tickHeadRef.kind !== "ref") {
      console.error(`[flume] tick refuses: ${describeRefFailure(tickHeadRef)}`);
      return 1;
    }
    // spec/loop.md "The loop lock and the tip claim": scope is per run. A
    // loop-spawned child trusts the supervisor's claim — told via
    // FLUME_TIP_CLAIM_HELD (set by `defaultTickRunner`,
    // src/loopSupervisor.ts) —
    // rather than probing pids and inferring parentage, and takes none
    // itself. A bare tick has no supervisor to trust, so it acquires and
    // releases its own claim around this single tick, refusing (exit 1) when
    // another live process already holds it.
    //
    // Release rides the same `exit`/`SIGINT`/`SIGTERM` handlers the loop
    // branch drops its locks through: a `finally` alone runs on neither
    // signal, so a signalled bare tick left its claim standing and the next
    // tick refused over it until a liveness probe happened to catch the pid
    // dead. `claimHeld` gates the drop, so a bare tick refused over another
    // live holder's claim never unlinks the file it lost to, and the handler
    // and the `finally` may both run without the second one deleting a claim
    // a later process has since taken. Handlers precede the acquisition — a
    // signal landing during it must find a handler, not node's default
    // disposition.
    let bareTipClaim: Awaited<ReturnType<typeof acquireTipClaim>> | undefined;
    let claimHeld = false;
    const dropBareTipClaim = () => {
      if (!claimHeld) return;
      claimHeld = false;
      bareTipClaim?.release();
    };
    // The release a signalled tick performs is its agent tree's too, never
    // this process's alone: the agent leads its own process group
    // (`src/Agent.ts`), writes in the worktree under the very state root the
    // claim guards, and outlives a bare `process.exit` here — which handed
    // that root to the next acquirer with a live writer inside it. Aborting
    // `stopTick` takes the tree down through the same SIGTERM-then-SIGKILL
    // teardown the supervisor applies to a tick tree, and awaiting the tick
    // is what makes the release the whole tree's rather than a kill that was
    // merely requested.
    //
    // Both paths install them, claim or no claim. A loop-spawned child holds
    // no claim of its own, but the supervisor's group signal stops at this
    // process — the agent's group is not the child's — so this handler is the
    // only thing that reaches the agent there too.
    //
    // The wait is the tick's, not a timer's: a chain whose agent never settles
    // on its abort holds this exit open, which is the intended outcome rather
    // than a hang to bound — exiting anyway is the release-over-a-live-writer
    // this whole path exists to stop. What bounds a well-behaved agent is its
    // own teardown (`supervisorPolicy.killGraceMs`, `src/Phase.ts`), which is
    // the number the handler writes into the line it prints at receipt: the
    // wait is silent otherwise, and an agent that swallows the SIGTERM makes
    // it a long one. It reads that number off `Dispatcher.agentKillGraceMs` —
    // the engine's own fold over the chain it resolved, reported rather than
    // re-derived from a chain this process would have to apply a second time
    // (`.claude/rules/engineering.md`, "A fact the engine holds is reported,
    // never rediscovered"). Before the chain resolves — and after one that
    // failed to, which `tick()` reports as mount-dead — the getter still
    // names the engine default the teardown would apply anyway
    // (`src/processTree.ts`).
    let tickRun: Promise<TickOutcome> | undefined;
    const releaseAndExit = async (code: number): Promise<never> => {
      stopTick.abort();
      if (tickRun !== undefined) {
        // The wait, announced before it starts rather than explained after it
        // ends — and only where there is one: a signal landing ahead of
        // `dispatcher.tick()` takes this process straight out with no tree
        // behind it, and a line about a wait that never happens is noise.
        console.log(
          signalledWaitLine(
            "the agent tree this tick started",
            dispatcher.agentKillGraceMs,
          ),
        );
        // The tick's own failure is the tick's to report; this path owes the
        // operator a dead agent tree, a released claim, and the signal's exit
        // code, and a throw escaping here would replace all three with an
        // unhandled rejection.
        await tickRun.catch(() => undefined);
      }
      dropBareTipClaim();
      process.exit(code);
    };
    process.on("exit", dropBareTipClaim);
    process.on("SIGINT", () => void releaseAndExit(130));
    process.on("SIGTERM", () => void releaseAndExit(143));
    if (process.env.FLUME_TIP_CLAIM_HELD === undefined) {
      try {
        bareTipClaim = await acquireTipClaim(repoRoot, tickHeadRef.path);
        claimHeld = true;
      } catch (err) {
        if (err instanceof TipClaimHeldError) {
          console.error(`[flume] tick refuses: ${err.message}`);
          return 1;
        }
        throw err;
      }
    }
    try {
      tickRun = dispatcher.tick();
      const outcome = await tickRun;
      console.log(outcome.summary);
      if (outcome.verdict) {
        await writeTickVerdict(flumeDir, outcome.verdict);
      }
      // Fail loudly on the classifying exits so the supervisor — and any human
      // watching exit codes — classifies the failure without reading logs.
      // Which outcome maps to which code is `tickExitCode`'s to state
      // (`src/cliVerdict.ts`); a second copy here is one more thing to go
      // stale against it.
      return tickExitCode(outcome);
    } finally {
      dropBareTipClaim();
    }
  }

  if (cmd === "loop") {
    const maxIdx = rest.indexOf("--max");
    let max = 50;
    const words = [...rest];
    if (maxIdx >= 0) {
      const value = rest[maxIdx + 1];
      const parsed = parseMaxValue(value);
      if (parsed === null) {
        console.error("usage: flume loop [--max N]");
        return 2;
      }
      max = parsed;
      words.splice(words.indexOf("--max"), 2);
    }
    // loop consumes zero positionals — an unexpected trailing token past
    // `--max N` runs something other than what the operator typed, the same
    // harm class as `job run`'s pre-existing `words.length > 1` check
    // (spec/cli.md "Subcommand surface", gh#1).
    if (words.length > 0) {
      console.error("usage: flume loop [--max N]");
      return 2;
    }
    // spec/loop.md "Graceful stop — the stop flag": presence at start
    // refuses the run before any tick — a stale flag must never silently
    // swallow a scheduled run. `job run` reaches this same branch via its
    // `cmd = "loop"` rewrite above, so it refuses identically.
    // Absent is the only silent reading: a flag that is present but
    // unstattable would otherwise start the run, which is the one outcome
    // this guard exists to rule out (`.claude/rules/engineering.md`, "Loud or
    // nothing"). The refusal names the underlying error — the operator must
    // resolve the flag either way before a run starts.
    const loopStopPath = stopFlagPath(flumeDir);
    let loopStopPresent: boolean;
    try {
      loopStopPresent = existsLoud(namespacedJoin(loopStopPath));
    } catch (err) {
      console.error(
        `[flume] loop refuses: stop flag at ${loopStopPath} failed to stat: ${err instanceof Error ? err.message : String(err)}`,
      );
      return EX_IOERR;
    }
    if (loopStopPresent) {
      console.error(
        `[flume] loop refuses: stop flag present at ${loopStopPath} — ` +
          "remove it to acknowledge the stop before starting a new run",
      );
      return 1;
    }
    // Refuse before any tick when HEAD does not name a ref — the tip claim
    // acquired below keys on the ref HEAD resolves to.
    const headRefResult = await currentRefPath(repoRoot);
    if (headRefResult.kind !== "ref") {
      console.error(`[flume] loop refuses: ${describeRefFailure(headRefResult)}`);
      return 1;
    }
    const headRef = headRefResult.path;
    // Cross-process loop lock: one supervisor per state root. A stale pidfile
    // (dead pid) is reclaimed; a live one refuses the second loop — two
    // supervisors against one state root race plan/build state. Lives under
    // flumeDir: the state root is what races, and a relocated dock must carry
    // its lock with it.
    // win32 MAX_PATH: flumeDir can nest deep under a job/state root;
    // namespacedJoin (src/paths.ts) is the shared idiom — see
    // .claude/rules/platform-facts.md.
    const lockPath = namespacedJoin(loopLockPath(flumeDir));
    // Release is installed before either lock is taken, never after both. A
    // signal landing between the two acquisitions must find a handler, not
    // node's default disposition — which runs nothing and leaves whatever is
    // already on disk. The handler drops what is held *at the moment it
    // fires*: `lockHeld` gates the unlink, so a run refused over another
    // supervisor's live `loop.pid` never deletes the file it lost to, and an
    // unacquired `tipClaim` releases nothing. Both drops are idempotent, so
    // the rollback below and the exit handler may both run.
    let lockHeld = false;
    let tipClaim: Awaited<ReturnType<typeof acquireTipClaim>> | undefined;
    const dropLock = () => {
      if (lockHeld) {
        lockHeld = false;
        try {
          unlinkSync(lockPath);
        } catch {
          // already gone
        }
      }
      tipClaim?.release();
    };
    // The release the signal handlers perform is the whole tick tree's, never
    // this process's alone. `superviseLoop` spawns a `flume tick` child that
    // writes under the very state root `loop.pid` and the tip claim guard, so
    // dropping both while that child still runs hands the root to the next
    // acquirer with a live writer inside it — the release the section
    // promises has not happened yet. `stopRun` reaches the supervisor, which
    // signals the in-flight child's group and resolves only once it has
    // exited; the drop and the exit ride that promise.
    //
    // The wait is that child's, not a timer's. `supervisorPolicy.killGraceMs`
    // is the grace the child escalates under, over the agent tree only it can
    // see (`src/Phase.ts`); a bound here would fire first and orphan that
    // agent. A child wedged past its own handler therefore holds this exit
    // open rather than releasing over a live writer — the operator kills it,
    // and the next acquirer's liveness probe reclaims the claim.
    //
    // Before the run starts (and after it returns) `supervisedRun` is
    // undefined and the handler drops immediately: there is no tree to take
    // with it, and waiting on nothing would only delay the exit.
    const stopRun = new AbortController();
    let supervisedRun: Promise<SuperviseResult> | undefined;
    // The grace that wait ends under, read off the resolve below: the
    // supervisor has no window into the child's own, so it names the same
    // declaration the child will read for itself. Initialized to the engine
    // default so a signal landing before that resolve — or after one that
    // failed — still names the number the child's teardown would apply.
    let childKillGraceMs = DEFAULT_KILL_GRACE_MS;
    const releaseAndExit = async (code: number): Promise<never> => {
      stopRun.abort();
      if (supervisedRun !== undefined) {
        // The wait, announced before it starts rather than explained after it
        // ends — and only where there is one: before the run starts there is
        // no child to wait for.
        console.log(
          signalledWaitLine(
            "the in-flight tick child and the tree it spawned",
            childKillGraceMs,
          ),
        );
        // The run's own failure is the run's to report; this path owes the
        // operator a released lock and the signal's exit code, and a throw
        // escaping here would replace both with an unhandled rejection.
        await supervisedRun.catch(() => undefined);
      }
      dropLock();
      process.exit(code);
    };
    process.on("exit", dropLock);
    process.on("SIGINT", () => void releaseAndExit(130));
    process.on("SIGTERM", () => void releaseAndExit(143));
    mkdirSync(toNamespacedPath(flumeDir), { recursive: true });
    const priorPid = await liveLoopPid(flumeDir);
    if (priorPid !== null) {
      console.error(
        `[flume] another loop (pid ${priorPid}) already runs against ${flumeDir}; refusing`,
      );
      return 1;
    }
    writeFileSync(lockPath, String(process.pid));
    lockHeld = true;
    // Advisory per-ref tip claim — one flume writer per tip, the resource
    // multiple jobs under one checkout actually contend on. Guards a different
    // resource than loop.pid (a ref vs. a state root); both stand. A refusal
    // here rolls back the loop.pid claim just taken above — through the same
    // `dropLock` the signal handlers call, so the rollback has one owner.
    try {
      tipClaim = await acquireTipClaim(repoRoot, headRef);
    } catch (err) {
      dropLock();
      if (err instanceof TipClaimHeldError) {
        console.error(`[flume] ${err.message}`);
        return 1;
      }
      throw err;
    }
    // spec/loop.md "Crash equals stop": a merge marker still standing is a
    // pick that died before its ship bookkeeping — the picked commit may sit
    // on trunk ungated with its entry still `open`, and starting would pick
    // it again. Refuse here: under the tip claim (so no concurrent engine is
    // mid-merge against this root) and ahead of both the ignore merge and the
    // startup sweep below, so the run touches nothing and the abandoned
    // branch each marker names survives for the operator. Removal is the
    // acknowledgement — as with the stop flag, no engine verb performs it.
    //
    // The listing's own non-ENOENT failure is classified here, not left to
    // escape: `readMergingMarkers` rethrows anything but absence
    // (src/mergingMarkers.ts), and uncaught the throw reached `main().catch` as a
    // raw stack and an exit 1 — indistinguishable from a harness error, when
    // it is the same unreadable-state refusal every other stat failure in
    // this file maps (`.claude/rules/platform-facts.md`, "Exit codes come
    // from `sysexits.h`"). EX_IOERR, not EX_TERMINAL_MISCONFIG: nothing was
    // read, so whether a marker stands is unknown — the operator must make
    // the dir readable before that question can even be asked.
    const mergingPath = mergingDir(flumeDir);
    let interrupted: Awaited<ReturnType<typeof readMergingMarkers>>;
    try {
      interrupted = await readMergingMarkers(flumeDir);
    } catch (err) {
      console.error(
        `[flume] loop refuses: merging markers at ${mergingPath} failed to list: ${err instanceof Error ? err.message : String(err)}`,
      );
      console.error(
        "[flume] an unreadable merging dir is not an empty one — a marker " +
          "standing behind it would mean a merge interrupted before its ship " +
          "bookkeeping. Nothing was touched and the startup sweep has not " +
          "run. Make the directory readable, then start again.",
      );
      return EX_IOERR;
    }
    if (interrupted.length > 0) {
      console.error(
        "[flume] loop refuses: a merge interrupted before its ship " +
          "bookkeeping is unreconciled",
      );
      for (const { path, marker } of interrupted) {
        console.error(
          marker
            ? `[flume]   ${path}: entry ${marker.tag} on branch ${marker.branch} (span ${marker.baseSha}..${marker.branch})`
            : `[flume]   ${path}: unreadable marker — the interrupted merge it names cannot be identified`,
        );
      }
      console.error(
        "[flume] the picked commit may already sit on trunk ungated with its " +
          "entry still open; reconcile (revert the commit, or mark the entry " +
          "shipped), then remove the file to acknowledge. Nothing was " +
          "touched and the startup sweep has not run, so each branch above " +
          "still stands.",
      );
      return EX_TERMINAL_MISCONFIG;
    }
    // Best-effort read of the chain, for the two consumers below — the
    // `friction` dir the ignore merge folds in, and the `supervisorPolicy`
    // override the supervisor reads. A chain that fails to load here surfaces
    // nothing new: the merge still writes the base runtime set, the first
    // child tick still reports mount-dead exactly as it does today, and
    // `superviseLoop` falls through to the engine defaults meanwhile.
    let supervisorPolicy: Chain["supervisorPolicy"];
    let friction: Chain["friction"];
    try {
      ({
        chain: { supervisorPolicy, friction },
      } = await diskChainLoader(paths)());
      childKillGraceMs = supervisorPolicy?.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
    } catch {
      // unresolved chain — defaults apply; the child tick names the failure
    }
    // spec/jobs.md "Runtime ignores": the default `<repoRoot>/.flume` takes
    // the same runtime-owned merge a job dir takes at `job new` — declared
    // `Chain.friction` included, through the one `frictionIgnoreEntry`
    // spelling (`src/job.ts`) — so a fresh adopter never commits a tick
    // artifact because a line was missing from the repo's own ignore file.
    // Under the tip claim and ahead of the sweep below: the claim is what
    // rules out a concurrent writer against this root, and the sweep is the
    // first thing this run writes under it. Idempotent — a root already
    // carrying the entries is left byte-identical. `job run` reaches this
    // via its `cmd = "loop"` rewrite above, where the root is the job dir
    // `job new` already merged; a bare tick never does.
    await ensureRuntimeIgnores(
      flumeDir,
      friction !== undefined ? [frictionIgnoreEntry(friction)] : [],
    );
    // Startup sweep (spec/worktrees.md "Startup sweep"): once, right after
    // the tip claim above and before the first tick, so a dead prior wave's
    // abandoned worktrees/branches never linger past this start. Safe here
    // and only here — holding the claim just acquired is what rules out a
    // live sibling owning anything under this state root's worktree base.
    // `job run` reaches this same branch via its `cmd = "loop"` rewrite
    // above, so it shares this call; a bare `flume tick` never does.
    await dispatcher.sweepStaleWorktrees();
    // Supervisor: one fresh `flume tick` process per iteration. Past the sweep
    // call above, the dispatcher constructed above is otherwise unused on this
    // path — each child builds its own and resolves chain.ts in its own
    // process. A terminal stop or a mount-dead abort propagates the child's
    // exit code out of `flume loop` too: exiting 0 here would re-mask either
    // as clean at the next process boundary up.
    //
    // `supervisorPolicy` was read above, alongside the ignore merge's
    // `friction`, from the one best-effort chain resolve this start makes.
    supervisedRun = superviseLoop({
      repoRoot,
      flumeDir,
      configDir,
      maxTicks: max,
      stopSignal: stopRun.signal,
      ...(supervisorPolicy?.quarantineScope !== undefined
        ? { quarantineScope: supervisorPolicy.quarantineScope }
        : {}),
      ...(supervisorPolicy?.abortThreshold !== undefined
        ? { abortThreshold: supervisorPolicy.abortThreshold }
        : {}),
    });
    const supervised = await supervisedRun;
    // Name surfaced tick errors in the completion summary even on a 0 exit
    // (partial success) — they must not vanish silently.
    const completion = loopCompletionSummary(supervised);
    if (completion) console.log(completion);
    return loopExitCode(supervised);
  }

  console.error(`unknown command: ${cmd}`);
  console.error("Run `flume --help` for usage.");
  return 2;
}

/**
 * One file's on-disk identity, for the comparison below, beside the error
 * the resolving leg threw when it is the degraded leg that answered. The
 * resolving leg throws on a path that is not on disk — an argv[1] naming a
 * file that was never there — and the raw path is the honest answer then: a
 * file that is absent is not this module either way, and the import must not
 * crash over it.
 *
 * That leg is libuv's `realpathSync.native`, never node's JS `realpathSync`:
 * the fold below hands it a namespaced path, and that is the argument the JS
 * form does not take on a node `engines` admits
 * (`.claude/rules/platform-facts.md`, "realpathSync keeps the \\?\ prefix
 * only where nothing resolved"). The choice is pinned rather than
 * remembered — the namespaced-fs scan (`tests/namespacedFsPaths.test.ts`)
 * reds a composed path spelled at the JS head anywhere in `src/` or
 * `harness/`.
 *
 * Both legs still fold through `plainPath` (`src/paths.ts`), the resolving
 * one and the throwing one alike, so the comparison below is made in one
 * alphabet whatever either side resolved.
 *
 * The degraded leg is declared here, per `.claude/rules/engineering.md`
 * *Loud or nothing*: nothing downstream refuses on it, because a path that
 * names no file is a legitimate argv[1] and a throw out of the module-level
 * call below would take the import with it. What bounds it instead is that
 * the answer is never handed back to an fs call — it is only ever compared —
 * and that it carries what sent it there, so a comparison decided by an
 * unresolved side reds naming the error rather than a second spelling of one
 * file.
 */
type OnDiskIdentity = {
  /** The folded path the comparison is made on, resolved or not. */
  readonly identity: string;
  /**
   * What the resolving leg threw, when the degraded leg is the one that
   * answered. Absent exactly when the path resolved.
   */
  readonly unresolved?: Error;
};

export function onDiskIdentity(path: string): OnDiskIdentity {
  try {
    return { identity: plainPath(realpathSync.native(toNamespacedPath(path))) };
  } catch (err) {
    return { identity: plainPath(path), unresolved: err as Error };
  }
}

/**
 * This module's own on-disk identity — the side of the check below that an
 * invoked path is compared against.
 *
 * Exported because it is the one side a caller cannot spell for itself: the
 * comparison answers against this module's import.meta.url, and any value
 * derived from another module's URL is the tester's re-derivation of the
 * writer's side rather than the writer's own
 * (`.claude/rules/engineering.md`, *A seam gate reads what the real writer
 * wrote*). A case that asserts on it reds naming the two answers one file was
 * read as — each spelling, and the error behind it where a side never
 * resolved — instead of naming a boolean.
 */
export const CLI_MODULE_IDENTITY = onDiskIdentity(fileURLToPath(import.meta.url));

// Run only when invoked as the binary, not when imported (tests reach in for
// `resolveStateDirs` at the resolution seam).
//
// import.meta.url resolves through junctions/symlinks to the file's realpath;
// process.argv[1] keeps the invoked path verbatim. Through a junction- or
// symlink-based install (pnpm's linked store) the two never match on a raw
// string comparison, so both sides go through {@link onDiskIdentity} and the
// comparison is made on what it answered. One derivation is not by itself one
// alphabet — the junction the check exists for is the very thing that moves
// one side out of it — which is why the fold is spent there rather than here.
export function isInvokedDirectly(argv1: string | undefined): boolean {
  if (argv1 === undefined) return false;
  return onDiskIdentity(argv1).identity === CLI_MODULE_IDENTITY.identity;
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
