/**
 * `flume job <verb> …`, minus `run` — split out of `src/cli.ts`
 * (`.claude/rules/posture-sweep.md`, "A violation counts only when verified
 * on disk this tick").
 */

import { jobNew, jobRm, jobStatus, JobUsageError } from "./job.js";
import {
  loadChainForObservation,
  refuseCjsContextHost,
} from "./cliChainLoad.js";
import { renderFrictionCount } from "./friction.js";
import type { FlumePaths } from "./flumeApi.js";

/**
 * `flume job <verb> …`, minus `run` — that verb is the standard loop under a
 * job resolution and is rewritten in `main()` before dispatch reaches here.
 * Usage-shaped failures exit 2, operational failures 1 — mirroring the
 * JobUsageError split in the job verbs.
 *
 * `paths` is the caller's single `resolveStateDirs()` result — this function
 * never re-derives a root from `process.env`, so a chain factory
 * `status`/`new` loads sees the same canonicalized values every other
 * subcommand does, `flumeDir` included.
 */
export async function runJobVerb(
  args: readonly string[],
  paths: FlumePaths,
): Promise<number> {
  const { repoRoot, configDir, flumeDir } = paths;
  const [verb, ...rest] = args;

  if (verb === "status") {
    if (rest.length > 0) {
      console.error("usage: flume job status");
      return 2;
    }
    try {
      // The friction dir is job-dir-relative but declared once on the
      // repo-resident chain — and `Chain.pendingPath` (spec/pending.md "The
      // pending queue") rides the same load. Best-effort so a missing or
      // broken chain never fails `job status`, and loud so it never quietly
      // rebases every job's pending count on the default queue path: the
      // shared load (`loadChainForObservation`, src/cliChainLoad.ts) reports
      // the failure and what it withholds.
      const chain = await loadChainForObservation(
        paths,
        "job status",
        "proceeding over engine defaults — the pending count reads the " +
          "default queue path for every job, and the chain-declared friction " +
          "dir is withheld.",
      );

      const jobs = jobStatus(repoRoot, chain?.friction, chain?.pendingPath);
      if (jobs.length === 0) {
        console.log("no jobs");
        return 0;
      }
      const width = Math.max(...jobs.map((j) => j.name.length));
      for (const j of jobs) {
        // Three readings, not two: an `awake/` dir that exists but cannot be
        // read is neither a phase list nor a hibernating baton, and printing
        // it as `hibernating` would be the lie the null exists to prevent
        // (`.claude/rules/engineering.md`, "Loud or nothing"). Worded like
        // the friction segment's `friction: unreadable` below.
        const state =
          j.awake === null
            ? "awake: unreadable"
            : j.awake.length
              ? `awake: ${j.awake.join(", ")}`
              : "hibernating";
        const pending =
          j.pending === null ? "pending: unparsable" : `pending: ${j.pending}`;
        // The wording is `renderFrictionCount`'s (`src/friction.ts`), the
        // same function `flume status` and the loop-end summary print
        // through — this surface owns only the two-space separator that
        // joins the segment to the row
        // (`.claude/rules/engineering.md`, "The fix lands at the
        // mechanism").
        const frictionLine = renderFrictionCount(j.frictionCount);
        const friction = frictionLine === undefined ? "" : `  ${frictionLine}`;
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
    await jobNew({ repoRoot, name, configDir, flumeDir });
    return 0;
  } catch (err) {
    const cjs = refuseCjsContextHost(err);
    if (cjs !== undefined) return cjs;
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
