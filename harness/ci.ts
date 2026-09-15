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
 * **A lane is failing, green, or unread — never green by default.** Every way
 * the read can come up short — no forge CLI on the host, no completed run
 * yet, a run the declared job is not in, a conclusion that is neither a pass
 * nor a failure, a CLI that refused — resolves to {@link CiLaneReading}'s
 * `unread` arm carrying the reason. The degraded path is declared, and the
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

/**
 * One lane's latest completed run, as the slice reads it: a failure with its
 * material, a pass, or a lane this tick could not read and why.
 *
 * A stated kind rather than a run that may be absent: "unread" and "green"
 * want opposite moves from the slice, and a reading that spelled the
 * difference as a missing field would let one be read as the other.
 */
export type CiLaneReading =
  | {
      readonly kind: "failing";
      readonly lane: CiLane;
      readonly branch: string;
      readonly run: CiRun;
      /** The forge's log for the failing job, tail-trimmed to the budget. */
      readonly log: string;
    }
  | {
      readonly kind: "green";
      readonly lane: CiLane;
      readonly branch: string;
      readonly run: CiRun;
    }
  | {
      readonly kind: "unread";
      readonly lane: CiLane;
      readonly reason: string;
    };

/** What {@link readCiLanes} needs to read a consumer's lanes for one tick. */
interface CiReadOptions {
  /**
   * The repository whose tip's branch names the runs to read. The repo root,
   * never a tick's worktree — see this module's head.
   */
  readonly repoRoot: string;
  /**
   * How many lines of a failing job's log one lane carries. The tail is
   * kept: a suite reports its failing titles at the end of its output, and
   * the head of a long log is the install steps that passed.
   */
  readonly logLines: number;
}

/**
 * Every declared lane's latest completed run, in the order the declaration
 * names them.
 *
 * The branch is resolved once for the whole list — one fact about one tree,
 * and a per-lane read would be the same answer bought several times.
 */
export function readCiLanes(
  lanes: readonly CiLane[],
  options: CiReadOptions,
): CiLaneReading[] {
  const branch = branchAt(options.repoRoot);
  if ("reason" in branch) {
    return lanes.map((lane) => ({ kind: "unread", lane, reason: branch.reason }));
  }
  return lanes.map((lane) => readLane(lane, branch.branch, options));
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

/** One lane's reading, with every failure of the read carried as its reason. */
function readLane(
  lane: CiLane,
  branch: string,
  options: CiReadOptions,
): CiLaneReading {
  const unread = (reason: string): CiLaneReading => ({
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

    const log = tail(
      forge(options.repoRoot, [
        "run",
        "view",
        "--job",
        String(job.databaseId),
        "--log-failed",
      ]),
      options.logLines,
    );
    return { kind: "failing", lane, branch, run, log };
  } catch (err) {
    return unread(readFailure(err));
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

/** The last `lines` lines of `text`, with the trimming said out loud. */
function tail(text: string, lines: number): string {
  const all = text.replace(/\n+$/, "").split("\n");
  if (all.length <= lines) return all.join("\n");
  return [
    `=== the first ${all.length - lines} line(s) of this log are above this ` +
      `tick's budget and are not shown ===`,
    ...all.slice(-lines),
  ].join("\n");
}
