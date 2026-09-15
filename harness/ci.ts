/**
 * The CI lane reader (`spec/harness.md`, *CI lanes as a findings source*):
 * for each lane a consumer declared, the latest completed run of that lane's
 * workflow job for the tip's branch, as the forge's own CLI reports it.
 *
 * **The forge holds the evidence; this module only asks.** A run is durable
 * state on the forge, so nothing here decides anything from a process's
 * stdout beyond what the forge stated in it
 * (`.claude/rules/engine-boundary.md`, *Told, not inferred*): the run's
 * identity, the declared job's conclusion, and — when that conclusion is a
 * failure — the log the forge kept for it. No test title is parsed out of
 * that log here. The titles are findings, and taking a finding out of
 * material the package did not author is the slice's agent's job, exactly as
 * it is for a record's prose.
 *
 * **What the forge wrote around the log is the forge's, and comes off.** The
 * per-line frame keyed by the declared job's name, the ANSI a test runner
 * coloured its output with, the workflow-command markers: the package is
 * reading back decoration it knows the shape of because it chose this forge
 * — the same opinion as {@link FORGE_CLI} and the lane's workflow-and-job
 * vocabulary — not reconstructing a statement out of prose the log's author
 * wrote. What the author wrote survives byte for byte.
 *
 * **A lane is failing, green, or unread — never green by default.** Every way
 * the read can come up short — no forge CLI on the host, no completed run
 * yet, a run the declared job is not in, a conclusion that is neither a pass
 * nor a failure, a CLI that refused, a log the forge would not hand over —
 * resolves to the `unread` arm {@link CiLaneStatus} declares, carrying the
 * reason. The degraded path is declared, and the
 * refusal that bounds it is the render's: unread says so in the prompt and
 * the slice files nothing against it (`.claude/rules/engineering.md`, *Loud
 * or nothing*).
 *
 * **The branch is the repo's, not the tick's worktree's.** A tick runs on a
 * scratch branch the forge has never seen (`spec/worktrees.md`), so a run
 * keyed to it would never exist and every lane would read unread forever.
 * The branch that has runs is the one the repository's own tip sits on, which
 * is also the only tree a liveness predicate can consult — `SliceInputs`
 * carries no working tree — so reading it here is what lets the two readers
 * of one window agree on which runs they are talking about (`windows.ts`).
 *
 * This module is the reader alone: how a reading is rendered into a prompt,
 * and which slice that prompt belongs to, are `windows.ts`'s.
 */

import {
  execFileSync,
  type ExecFileSyncOptionsWithStringEncoding,
} from "node:child_process";

import { z } from "zod";

import { isWin32ShimSpawnFailure } from "../src/spawnShim.js";

import type { Declaration } from "./declaration.js";

/**
 * One CI lane as the declaration carries it — read off the declaration's own
 * shape rather than restated here, so a field the schema gains or renames
 * arrives without a second edit (`.claude/rules/engineering.md`, *Derived
 * state is computed, never restated beside its source*).
 *
 * Named for the CI it partitions. `Lane` in this package is already a
 * partition of a consumer's *test suite* (`runner.ts`), and nothing keys one
 * by the other.
 */
type CiLane = NonNullable<Declaration["ci"]>[number];

/**
 * The forge CLI a lane is read through. The package's opinion, like the
 * workflow-and-job vocabulary the declaration spells a lane in: both are
 * GitHub Actions' shape, and a consumer on another forge declares no lane at
 * all rather than a lane this cannot locate.
 */
const FORGE_CLI = "gh";

/**
 * The timestamp the runner stamps a framed line with, where it stamped one.
 * Optional in {@link framing}: the forge frames every line of a job log, but
 * only some of those lines carry a stamp, and a frame read as absent because
 * its third field was blank is a frame left on the line.
 */
const FORGE_STAMP = String.raw`(?:\d{4}-\d{2}-\d{2}T[\d:.]+Z ?)?`;

/**
 * The frame the forge puts on every line of one job's log: that job's name
 * and the step name, tab-separated, then the runner's stamp where there is
 * one.
 *
 * Keyed by the name the lane *declared* for the job, never by the shape of
 * two leading fields — the job name is a fact the declaration states
 * (`.claude/rules/engine-boundary.md`, *Told, not inferred*), and without it
 * a two-field strip over an unstamped line would eat the leading
 * tab-separated columns of whatever the log's own author wrote.
 */
function framing(job: string): RegExp {
  return new RegExp(String.raw`^${escapeRegExp(job)}\t[^\t]*\t` + FORGE_STAMP);
}

/**
 * One literal as a regex source — every special character spelled inert. A
 * matrix job's declared name routinely carries `(`, `)` and `.`, and none of
 * them is this frame's syntax. Not `src/paths.ts`'s escape, which leaves `*`
 * live on purpose because its literals are glob tokens.
 */
function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+^${}()|[\]\\?]/g, "\\$&");
}

/**
 * ANSI control sequences a test runner colours its output with — CSI
 * (`ESC [ … `), and the OSC window-title sequences some runners emit around
 * their progress lines.
 */
const ANSI = /\u001B(?:\[[0-?]*[ -\/]*[@-~]|\][^\u0007\u001B]*(?:\u0007|\u001B\\))/g;

/**
 * The forge's workflow-command marker at the head of a line — `##[group]`,
 * `##[endgroup]`, `##[error]` and their siblings. The marker comes off and
 * whatever the command carried stays, so an `##[error]` keeps its message and
 * a bare `##[endgroup]` is left holding nothing.
 */
const WORKFLOW_COMMAND = /^##\[[a-z]+\]/;

/** Enough headroom for a failing job's whole log on stdout. */
const MAX_BUFFER = 64 << 20;

/** The conclusion the forge reports for a job that passed. */
const PASSED = "success";

/**
 * The conclusions that are a failure with material to drain. Everything else
 * the forge can report — `cancelled`, `skipped`, `neutral`, a job still
 * without one — is neither a pass nor a drainable failure, and reads as
 * unread rather than being folded into either.
 */
const FAILED: ReadonlySet<string> = new Set([
  "failure",
  "timed_out",
  "startup_failure",
]);

/**
 * The run fields the reader asks the forge for, and the shape it reads back.
 * The request is composed from the schema's own keys, so the two cannot name
 * different fields.
 */
const RunSchema = z.object({
  databaseId: z.number(),
  displayTitle: z.string(),
  url: z.string(),
  conclusion: z.string(),
  createdAt: z.string(),
});

/** The `--json` argument that asks for exactly {@link RunSchema}'s fields. */
const RUN_FIELDS = Object.keys(RunSchema.shape).join(",");

/** What `run list` prints: the runs matching the filters, newest first. */
const RunListSchema = z.array(RunSchema);

/** The jobs of one run, as `run view --json jobs` prints them. */
const RunJobsSchema = z.object({
  jobs: z.array(
    z.object({
      databaseId: z.number(),
      name: z.string(),
      conclusion: z.string(),
    }),
  ),
});

/** One completed run, as the slice names and stamps it. */
interface CiRun {
  /** The run's identity on the forge — the value a `drainedRuns` stamp holds. */
  readonly id: string;
  /** The run's own title, for a reader deciding what landed in it. */
  readonly title: string;
  /** Where the run sits on the forge. */
  readonly url: string;
  /** When the forge started it. */
  readonly at: string;
}

/** A lane the forge named a run for, with the run and the branch it keys to. */
interface CiLaneRun {
  readonly lane: CiLane;
  /** The branch the run is keyed to — the repository's, not the tick's. */
  readonly branch: string;
  readonly run: CiRun;
}

/**
 * One lane's latest completed run as the forge states it, before any of a
 * failing job's material is fetched: the run's identity, and whether the
 * declared job failed.
 *
 * **This is the half a liveness predicate reads.** A lane makes the inbox
 * slice live exactly while its latest completed run failed and is not the run
 * already stamped for it (`spec/harness.md`, *CI lanes as a findings
 * source*), and both facts that verdict needs are here — so the selection
 * path asks the forge only the two questions it would have asked anyway, and
 * never buys a job log to answer a yes or no.
 *
 * A stated kind rather than a run that may be absent: "unread" and "green"
 * want opposite moves from the slice, and a reading that spelled the
 * difference as a missing field would let one be read as the other.
 */
export type CiLaneStatus =
  | (CiLaneRun & {
      readonly kind: "failing";
      /**
       * The forge's own id for the declared job — the handle its log is
       * fetched by, reported rather than re-derived by whoever wants it
       * (`.claude/rules/engineering.md`, *A fact the engine holds is
       * reported, never rediscovered*).
       */
      readonly jobId: number;
    })
  | (CiLaneRun & { readonly kind: "green" })
  | {
      readonly kind: "unread";
      readonly lane: CiLane;
      readonly reason: string;
    };

/**
 * One lane's status with a failing job's material on it — what the slice's
 * prompt renders, and the half only a render pays for.
 *
 * A material fetch that fails resolves to `unread` like every other way the
 * read can come up short, so a lane whose log could not be read never renders
 * as a failure with nothing in it.
 */
export type CiLaneReading =
  | (Extract<CiLaneStatus, { kind: "failing" }> & {
      /**
       * The forge's log for the failing job: the forge's own decoration shed
       * off it, then tail-trimmed to the budget.
       */
      readonly log: string;
    })
  | Extract<CiLaneStatus, { kind: "green" | "unread" }>;

/** What any lane read needs: the repository the runs are keyed through. */
interface CiRepoOptions {
  /**
   * The repository whose tip's branch names the runs to read. The repo root,
   * never a tick's worktree — see this module's head.
   */
  readonly repoRoot: string;
}

/** What {@link readCiLanes} needs to read a consumer's lanes for one tick. */
interface CiReadOptions extends CiRepoOptions {
  /**
   * How many lines of a failing job's log one lane carries. The tail is
   * kept: a suite reports its failing titles at the end of its output, and
   * the head of a long log is the install steps that passed.
   *
   * Counted over the shed log, never the forge's: the budget exists to bound
   * what a tick reads, and a line the forge framed and left empty is not
   * something to read.
   */
  readonly logLines: number;
}

/**
 * Every declared lane's latest completed run as the forge states it, in the
 * order the declaration names them — identity and verdict, no material.
 *
 * The branch is resolved once for the whole list — one fact about one tree,
 * and a per-lane read would be the same answer bought several times.
 */
export function readCiLaneStatuses(
  lanes: readonly CiLane[],
  options: CiRepoOptions,
): CiLaneStatus[] {
  const branch = branchAt(options.repoRoot);
  if ("reason" in branch) {
    return lanes.map((lane) => ({ kind: "unread", lane, reason: branch.reason }));
  }
  return lanes.map((lane) => readLaneStatus(lane, branch.branch, options));
}

/**
 * The same readings with each failing lane's job log on it.
 *
 * One derivation, two depths: the statuses are read exactly as the liveness
 * half reads them, and the material is layered on top rather than fetched by
 * a second walk that could name a different run.
 */
export function readCiLanes(
  lanes: readonly CiLane[],
  options: CiReadOptions,
): CiLaneReading[] {
  return readCiLaneStatuses(lanes, options).map((status) =>
    withMaterial(status, options),
  );
}

/**
 * The branch the repository's tip sits on, or the reason it cannot be named.
 *
 * `symbolic-ref --quiet` exits 1 on a detached HEAD and fails otherwise, so
 * the two are told apart by git's own exit status rather than by reading its
 * message (`.claude/rules/engine-boundary.md`, *Told, not inferred*). The
 * engine's own `currentRefPath` makes the same distinction and is the home of
 * that taxonomy; it is `async`, and a window's `args` is not, so the sync
 * spelling stays here rather than turning every slice render asynchronous.
 */
function branchAt(repoRoot: string): { branch: string } | { reason: string } {
  try {
    const name = execFileSync(
      "git",
      ["symbolic-ref", "--quiet", "--short", "HEAD"],
      { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
    if (name === "") {
      return { reason: `HEAD in ${repoRoot} names no branch` };
    }
    return { branch: name };
  } catch (err) {
    const status = (err as { status?: unknown }).status;
    return {
      reason:
        status === 1
          ? `HEAD in ${repoRoot} is detached, so no forge run is keyed to a branch this tick could name`
          : `the branch at ${repoRoot} could not be read: ${detailOf(err)}`,
    };
  }
}

/** One lane's status, with every failure of the read carried as its reason. */
function readLaneStatus(
  lane: CiLane,
  branch: string,
  options: CiRepoOptions,
): CiLaneStatus {
  const unread = (reason: string): CiLaneStatus => ({
    kind: "unread",
    lane,
    reason,
  });
  try {
    const runs = forgeJson(RunListSchema, options.repoRoot, [
      "run",
      "list",
      "--workflow",
      lane.workflow,
      "--branch",
      branch,
      "--status",
      "completed",
      "--limit",
      "1",
      "--json",
      RUN_FIELDS,
    ]);
    const latest = runs[0];
    if (latest === undefined) {
      return unread(
        `the forge reports no completed run of ${lane.workflow} for branch ${branch}`,
      );
    }

    const run: CiRun = {
      id: String(latest.databaseId),
      title: latest.displayTitle,
      url: latest.url,
      at: latest.createdAt,
    };
    const { jobs } = forgeJson(RunJobsSchema, options.repoRoot, [
      "run",
      "view",
      run.id,
      "--json",
      "jobs",
    ]);
    const job = jobs.find((candidate) => candidate.name === lane.job);
    if (job === undefined) {
      return unread(
        `run ${run.id} holds no job named ${lane.job}; it ran ` +
          `${jobs.map((candidate) => candidate.name).join(", ") || "no jobs"}`,
      );
    }

    if (job.conclusion === PASSED) return { kind: "green", lane, branch, run };
    if (!FAILED.has(job.conclusion)) {
      return unread(
        `job ${lane.job} of run ${run.id} concluded ${job.conclusion || "nothing"}, ` +
          `which is neither a pass nor a failure with material to drain`,
      );
    }

    return { kind: "failing", lane, branch, run, jobId: job.databaseId };
  } catch (err) {
    return unread(readFailure(err));
  }
}

/**
 * One status with the failing job's log fetched and trimmed, or the same
 * lane unread when the forge could not be asked for it.
 */
function withMaterial(
  status: CiLaneStatus,
  options: CiReadOptions,
): CiLaneReading {
  if (status.kind !== "failing") return status;
  try {
    const log = tail(
      shed(
        forge(options.repoRoot, [
          "run",
          "view",
          "--job",
          String(status.jobId),
          "--log-failed",
        ]),
        status.lane.job,
      ),
      options.logLines,
    );
    return { ...status, log };
  } catch (err) {
    return { kind: "unread", lane: status.lane, reason: readFailure(err) };
  }
}

/** The forge CLI's stdout for one invocation, or a throw carrying its stderr. */
function forge(cwd: string, args: readonly string[]): string {
  const options: ExecFileSyncOptionsWithStringEncoding = {
    cwd,
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
    stdio: ["ignore", "pipe", "pipe"],
  };
  try {
    return execFileSync(FORGE_CLI, args, options);
  } catch (err) {
    // The shim case alone, and the engine's own detection of it
    // (`src/spawnShim.ts`): on win32 a CLI installed as a `.cmd` cannot be
    // spawned without a shell, and every other failure — including an ENOENT
    // anywhere else — is the real one this reader reports.
    if (!isWin32ShimSpawnFailure(err)) throw err;
    return execFileSync(FORGE_CLI, args, { ...options, shell: true });
  }
}

/** One invocation's stdout, decoded against the shape the reader asked for. */
function forgeJson<T>(schema: z.ZodType<T>, cwd: string, args: readonly string[]): T {
  const raw = forge(cwd, args);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `\`${FORGE_CLI} ${args.join(" ")}\` did not print JSON — ${detailOf(err)}`,
    );
  }
  const verdict = schema.safeParse(parsed);
  if (!verdict.success) {
    throw new Error(
      `\`${FORGE_CLI} ${args.join(" ")}\` printed a payload this reader does ` +
        `not recognize: ${verdict.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; ")}`,
    );
  }
  return verdict.data;
}

/** Why a lane could not be read, in the reader's own vocabulary. */
function readFailure(err: unknown): string {
  if ((err as NodeJS.ErrnoException).code === "ENOENT") {
    return `no \`${FORGE_CLI}\` on this host's PATH, so no run can be read`;
  }
  return `the forge could not be asked: ${detailOf(err)}`;
}

/** A failure's own text — its stderr where it has one, else its message. */
function detailOf(err: unknown): string {
  const stderr = (err as { stderr?: unknown }).stderr;
  if (typeof stderr === "string" && stderr.trim() !== "") return stderr.trim();
  return (err instanceof Error ? err.message : String(err)).trim();
}

/**
 * A job log's own lines, with the forge's decoration off each and the lines
 * that carried nothing else dropped. `job` is the declared name the forge
 * framed those lines with — see {@link framing}.
 *
 * Run *before* {@link tail}, and that order is the point: shedding a prefix
 * buys no room in a budget counted in lines, but the frame the forge writes
 * around a blank line and around each of its own group markers is a line, and
 * a budget spent on those is a budget not spent on the failing titles the
 * slice is here to read.
 */
function shed(log: string, job: string): string[] {
  const frame = framing(job);
  const kept: string[] = [];
  for (const line of log.split("\n")) {
    const bare = line
      .replace(frame, "")
      .replace(ANSI, "")
      .replace(WORKFLOW_COMMAND, "")
      .trimEnd();
    if (bare !== "") kept.push(bare);
  }
  return kept;
}

/** The last `budget` of `lines`, with the trimming said out loud. */
function tail(lines: readonly string[], budget: number): string {
  if (lines.length <= budget) return lines.join("\n");
  return [
    `=== the first ${lines.length - budget} line(s) of this log are above ` +
      `this tick's budget and are not shown ===`,
    ...lines.slice(-budget),
  ].join("\n");
}
