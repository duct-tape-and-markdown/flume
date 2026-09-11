/**
 * `flume job <verb> …`, minus `run` — split out of `src/cli.ts`
 * (`.claude/rules/posture-sweep.md`, "A violation counts only when verified
 * on disk this tick").
 */

import { jobNew, jobRm, jobStatus, JobUsageError } from "./job.js";
import { CjsContextLoadError } from "./Dispatcher.js";
import { loadChainForObservation } from "./cliChainLoad.js";
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
      const chain = await loadChainForObservation(paths, "job status");

      const jobs = jobStatus(repoRoot, chain?.friction, chain?.pendingPath);
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
          j.frictionCount === null
            ? "  friction: unreadable"
            : j.frictionCount !== undefined && j.frictionCount > 0
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
    await jobNew({ repoRoot, name, configDir, flumeDir });
    return 0;
  } catch (err) {
    if (err instanceof CjsContextLoadError) {
      console.error(`[flume] ${err.message}`);
      return 2;
    }
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
