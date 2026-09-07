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
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Dirent } from "node:fs";

import { Baton } from "./Baton.js";
import {
  acquireTipClaim,
  currentRefPath,
  gitCommonDir,
  liveTipClaimPid,
  tipClaimPath,
  TipClaimHeldError,
} from "./git.js";
import { jobRun, liveLoopPid, readPendingLoose, JobUsageError } from "./job.js";
import {
  Dispatcher,
  diskChainLoader,
  frictionCountLine,
  superviseLoop,
  clearTickVerdict,
  writeTickVerdict,
  readTickVerdicts,
  CjsContextLoadError,
  EX_MOUNT_DEAD,
} from "./Dispatcher.js";
import { claudeCode } from "./Agent.js";
import type { Chain } from "./Phase.js";
import { parsePending, declaredPaths } from "./PendingSchema.js";
import { matchesAny, entryWriteScopeUnion, namespacedJoin } from "./paths.js";
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
import { runJobVerb } from "./cliJobVerbs.js";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * sysexits.h `EX_DATAERR` — a declared-world inconsistency the caller can
 * classify from the exit status alone (`platform-facts.md`, "Exit codes come
 * from sysexits.h"). `flume check`'s only non-zero exit: a `pending.json`
 * that fails to parse or that declares a path outside the consumer phase's
 * fence.
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
 * Shared `--max` numeric parse for `job run` (rewrites into `loop` below)
 * and `loop` itself — a non-numeric or negative value must refuse identically
 * on both surfaces, and `job run` must refuse before its preflight wakes the
 * entry phase (v0.11 §2/§3), not after rewriting into `loop`.
 */
function parseMaxValue(value: string | undefined): number | null {
  const parsed = value !== undefined ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * `wake`/`sleep`'s best-effort chain load, mirroring `status`'s pattern
 * (§3 above): a missing or broken chain must never block the marker
 * mutation — there is nothing to validate the phase name against. Only a
 * chain that loads *successfully* and does not declare `phase` among its
 * `chain.phases` refuses. Reached with `configDir` (repo-resident, §2) —
 * `--job` never retargets it, so a job-dir `chain.ts` is inert here exactly
 * as it is for `status` and `tick`.
 */
async function chainRefusesPhase(
  configDir: string,
  phase: string,
): Promise<boolean> {
  try {
    const { chain } = await diskChainLoader(configDir)();
    return !chain.phases.some((p) => p.name === phase);
  } catch {
    return false;
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

  // `flume job <verb>` (v0.5 §5). `run` is the exception — it IS the
  // standard loop under the job resolution (§5b-3), so it rewrites itself
  // into `--job <name> loop [--max N]` and falls through; only its preflight
  // (branch + entry-phase wake) runs before the loop, below. The other verbs
  // (`status`/`rm`/`new`) are stashed in `jobVerbArgs` and dispatched to
  // `runJobVerb` *after* state-dir resolution below (§12/§14) — they operate
  // on the repo and the job dir named by their own argument, not on a
  // resolved state root, but they still need the single canonicalized
  // `configDir` every other subcommand reads, not a re-derivation from raw
  // `process.env.FLUME_CONFIG_DIR`.
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

  // Resolve both state roots up front and canonicalize them back into the env
  // (§12). `flumeDir` is the mutable-state root (baton, pending, worktrees,
  // prior-attempts); `configDir` is the chain+prompt dir. Both default to
  // `<repoRoot>/.flume`; `FLUME_DIR` / `FLUME_CONFIG_DIR` relocate them, and
  // `--job` / `FLUME_JOB` retargets only the flumeDir default to
  // `.flume/jobs/<name>` — configDir never follows the job (v0.6 §2/§3).
  // Resolving here (not constructing) lets the values survive the
  // `loop` → `tick` process boundary — children inherit the (now
  // absolute-canonical) env vars — and lets a chain loaded later in this
  // process read one authoritative state root. This runs ahead of every
  // subcommand branch, `job status`/`rm`/`new` included, so none of them
  // re-derives `configDir` independently.
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

  if (jobVerbArgs !== undefined) {
    return runJobVerb(jobVerbArgs, repoRoot, configDir);
  }

  // `--job` / `FLUME_JOB` names an existing state root everywhere except
  // `job new` (which creates it — routed above via `runJobVerb`, never
  // reaches this guard) and `job run` (spec/jobs.md "`flume job run <name>`"
  // — no existence precondition, by design: it may materialize a bare state
  // root). `jobRunName` is what distinguishes the `job run` rewrite from a
  // bare `--job`/`FLUME_JOB` use of `status`/`tick`/`loop`/`wake`/`sleep` —
  // the flag alone can't carry that distinction, since `job run` reaches
  // this same resolution by construction (above).
  if (job !== undefined && jobRunName === undefined && !existsSync(flumeDir)) {
    console.error(`[flume] no job '${job}': ${flumeDir} does not exist`);
    return 2;
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
    let supervisorLive = false;
    if (existsSync(namespacedJoin(flumeDir, "loop.pid"))) {
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
    const stopFlagPath = join(flumeDir, "stop");
    if (existsSync(namespacedJoin(stopFlagPath))) {
      console.log(
        supervisorLive
          ? `${stopFlagPath} present: the running supervisor will finish ` +
              "its in-flight tick and end the run"
          : `${stopFlagPath} present: the next \`loop\`/\`job run\` refuses ` +
              "to start until it is removed",
      );
    }
    // v0.11 §4: report the current tip's claim alongside supervisor
    // liveness, observational and best-effort — a detached HEAD (no ref to
    // key the claim on), a non-repository cwd, or a git invocation failure
    // all read as silence, the same precedent as the no-pidfile case above.
    const headRefForStatus = await currentRefPath(repoRoot);
    if (headRefForStatus.kind === "ref") {
      const claimPath = tipClaimPath(
        await gitCommonDir(repoRoot),
        headRefForStatus.path,
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
    // §6 (v0.6.2) / spec/pending.md "The pending queue": best-effort — a
    // missing or broken chain must never fail `status`, only silently
    // withhold the friction line and the chain-declared pendingPath (the
    // pending count below then falls back to the default location).
    let chain: Chain | undefined;
    try {
      ({ chain } = await diskChainLoader(configDir)());
    } catch {
      chain = undefined;
    }
    // §3: the pending entry count, independent of whether the chain loads —
    // `flume job status` probes the same file the same way (`readPendingLoose`,
    // src/job.ts), so a corrupt pending.json reads "unparsable" identically
    // on both surfaces.
    const pending = readPendingLoose(
      join(flumeDir, chain?.pendingPath ?? join("plan", "pending.json")),
    );
    console.log(
      pending.ok ? `pending: ${pending.entries.length}` : "pending: unparsable",
    );
    if (chain) {
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
    }
    return 0;
  }

  if (cmd === "wake") {
    const phase = rest[0];
    if (!phase || rest.length > 1) {
      console.error("usage: flume wake <phase>");
      return 2;
    }
    if (await chainRefusesPhase(configDir, phase)) {
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
    if (await chainRefusesPhase(configDir, phase)) {
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
    const stopPath = join(flumeDir, "stop");
    mkdirSync(flumeDir, { recursive: true });
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
      ({ chain } = await diskChainLoader(configDir)());
    } catch (err) {
      if (err instanceof CjsContextLoadError) {
        console.error(`[flume] ${err.message}`);
        return 2;
      }
      console.error(
        `[flume] check: chain failed to load: ${err instanceof Error ? err.message : String(err)}`,
      );
      return EX_MOUNT_DEAD;
    }

    // spec/pending.md "The pending queue": the queue path is Chain.pendingPath
    // (default plan/pending.json) — the same resolved value the dispatcher,
    // `flume status`, and `pendingGate` read, never a hardcoded copy.
    const pendingRel = chain.pendingPath ?? join("plan", "pending.json");
    const pendingPath = join(flumeDir, pendingRel);
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
    const fence = entryWriteScopeUnion(
      consumerPhases.flatMap((p) => p.writablePaths),
      consumerPhases.flatMap((p) => p.entryChannelPaths ?? []),
    );
    const violations = parsed.entries
      .map((entry) => ({
        tag: entry.tag,
        offending: declaredPaths(entry).filter((p) => !matchesAny(p, fence)),
      }))
      .filter((v) => v.offending.length > 0);
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
      ({ chain } = await diskChainLoader(configDir)());
    } catch (err) {
      if (err instanceof CjsContextLoadError) {
        console.error(`[flume] ${err.message}`);
        return 2;
      }
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
    for (const fileName of files) {
      const stats = statSync(namespacedJoin(frictionDir, fileName));
      console.log(`${fileName}  ${stats.size}  ${stats.mtime.toISOString()}`);
    }
    return 0;
  }

  // Dispatcher resolves .flume/chain.ts from configDir once at tick start
  // (one load per process — `flume loop` re-resolves by spawning a fresh
  // `flume tick` per iteration, §2); a chain.ts that exports `agent`
  // overrides the default agent per tick.
  const resolveChain = diskChainLoader(configDir);
  // §16 (RELEASE-v0.7): the `flume loop` supervisor's run-scoped quarantine
  // crosses the process boundary via this env var (set by
  // `defaultTickRunner`, `src/Dispatcher.ts`) — a slug named here is skipped
  // by this tick's fanout pick without touching pending.json.
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
  const dispatcher = new Dispatcher({
    repoRoot,
    configDir,
    flumeDir,
    agent: claudeCode(),
    ownTipClaimPid,
    // Fanout branch namespace (v0.5 §4): the job resolution above is the one
    // authority; the dispatcher receives it as an option, never re-derives it
    // from flumeDir.
    ...(job !== undefined ? { namespace: job } : {}),
    ...(quarantinedSlugs ? { quarantinedSlugs } : {}),
  });

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
    // v0.8 §5: clear any stale verdict before this tick's own work — a tick
    // that returns below without an agent having run (chain-load failure,
    // hibernation, terminal misconfiguration, the detached-HEAD refusal
    // below) must leave no record for `flume loop`'s supervisor to misread
    // as its own.
    await clearTickVerdict(flumeDir);
    // v0.11 §4: tick and loop both refuse before any tick when HEAD does not
    // name a ref — the tick record's meaning is advancing a named tip, and
    // the (loop-level) claim that guards it keys on a ref. A bare tick
    // takes no claim itself but still refuses here so the behavior is
    // identical whether or not a loop wraps it.
    const tickHeadRef = await currentRefPath(repoRoot);
    if (tickHeadRef.kind !== "ref") {
      console.error(`[flume] tick refuses: ${describeRefFailure(tickHeadRef)}`);
      return 1;
    }
    // spec/loop.md "The loop lock and the tip claim": scope is per run. A
    // loop-spawned child trusts the supervisor's claim — told via
    // FLUME_TIP_CLAIM_HELD (set by `defaultTickRunner`, src/Dispatcher.ts) —
    // rather than probing pids and inferring parentage, and takes none
    // itself. A bare tick has no supervisor to trust, so it acquires and
    // releases its own claim around this single tick, refusing (exit 1) when
    // another live process already holds it.
    let bareTipClaim: Awaited<ReturnType<typeof acquireTipClaim>> | undefined;
    if (process.env.FLUME_TIP_CLAIM_HELD === undefined) {
      try {
        bareTipClaim = await acquireTipClaim(repoRoot, tickHeadRef.path);
      } catch (err) {
        if (err instanceof TipClaimHeldError) {
          console.error(`[flume] tick refuses: ${err.message}`);
          return 1;
        }
        throw err;
      }
    }
    try {
      const outcome = await dispatcher.tick();
      console.log(outcome.summary);
      if (outcome.verdict) {
        await writeTickVerdict(flumeDir, outcome.verdict);
      }
      // Fail loudly on the Axis-C exits (§3) so the supervisor — and any
      // human watching exit codes — classifies the failure without reading
      // logs: 78 terminal misconfiguration, 1 resolution failure, 0
      // otherwise.
      return tickExitCode(outcome);
    } finally {
      bareTipClaim?.release();
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
    // harm class as `job run`'s pre-existing `words.length > 1` check (§ CLI
    // "Subcommand surface", gh#1).
    if (words.length > 0) {
      console.error("usage: flume loop [--max N]");
      return 2;
    }
    // spec/loop.md "Graceful stop — the stop flag": presence at start
    // refuses the run before any tick — a stale flag must never silently
    // swallow a scheduled run. `job run` reaches this same branch via its
    // `cmd = "loop"` rewrite above, so it refuses identically.
    const stopFlagPath = join(flumeDir, "stop");
    if (existsSync(namespacedJoin(stopFlagPath))) {
      console.error(
        `[flume] loop refuses: stop flag present at ${stopFlagPath} — ` +
          "remove it to acknowledge the stop before starting a new run",
      );
      return 1;
    }
    // v0.11 §4: refuse before any tick when HEAD does not name a ref — the
    // tip claim acquired below keys on the ref HEAD resolves to.
    const headRefResult = await currentRefPath(repoRoot);
    if (headRefResult.kind !== "ref") {
      console.error(`[flume] loop refuses: ${describeRefFailure(headRefResult)}`);
      return 1;
    }
    const headRef = headRefResult.path;
    // Cross-process loop lock: one supervisor per state root. A stale
    // pidfile (dead pid) is reclaimed; a live one refuses the second loop —
    // two supervisors against one state root race plan/build state. Lives
    // under flumeDir (§16): the state root is what races, and a relocated
    // dock must carry its lock with it.
    // win32 MAX_PATH: flumeDir can nest deep under a job/state root;
    // namespacedJoin (src/paths.ts) is the shared idiom — see
    // .claude/rules/platform-facts.md.
    const lockPath = namespacedJoin(flumeDir, "loop.pid");
    mkdirSync(flumeDir, { recursive: true });
    const priorPid = await liveLoopPid(flumeDir);
    if (priorPid !== null) {
      console.error(
        `[flume] another loop (pid ${priorPid}) already runs against ${flumeDir}; refusing`,
      );
      return 1;
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
    // Startup sweep (spec/worktrees.md "Startup sweep"): once, right after
    // the tip claim above and before the first tick, so a dead prior wave's
    // abandoned worktrees/branches never linger past this start. Safe here
    // and only here — holding the claim just acquired is what rules out a
    // live sibling owning anything under this state root's worktree base.
    // `job run` reaches this same branch via its `cmd = "loop"` rewrite
    // above, so it shares this call; a bare `flume tick` never does.
    await dispatcher.sweepStaleWorktrees();
    // Supervisor: one fresh `flume tick` process per iteration (§2). Past
    // the sweep call above, the dispatcher constructed above is otherwise
    // unused on this path — each child builds its own and resolves
    // chain.ts in its own process. A terminal
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
