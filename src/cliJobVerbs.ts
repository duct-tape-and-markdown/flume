/**
 * `flume job <verb> …` (v0.5 §5), minus `run` — split out of `src/cli.ts`
 * (`.claude/rules/posture-sweep.md`, "A violation counts only when verified
 * on disk this tick").
 */

import { jobNew, jobRm, jobStatus, JobUsageError } from "./job.js";
import { diskChainLoader, CjsContextLoadError } from "./Dispatcher.js";
import type { FlumePaths } from "./flumeApi.js";

/**
 * `flume job <verb> …` (v0.5 §5), minus `run` — that verb is the standard
 * loop under a job resolution and is rewritten in `main()` before dispatch
 * reaches here. Usage-shaped failures exit 2, operational failures 1 —
 * mirroring the JobUsageError split in the job verbs.
 *
 * `paths` is the caller's single `resolveStateDirs()` result (§12/§14) —
 * this function never re-derives a root from `process.env`, so a chain
 * factory `status`/`new` loads sees the same canonicalized values every
 * other subcommand does, `flumeDir` included.
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
      // §6 (v0.6.2): the friction dir is job-dir-relative but declared once
      // on the repo-resident chain — load it here, best-effort (a missing or
      // broken chain must never fail `job status`, only silently withhold
      // the friction counts). `Chain.pendingPath` (spec/pending.md "The
      // pending queue") rides the same best-effort load, alongside it.
      let frictionDir: string | undefined;
      let pendingPath: string | undefined;
      try {
        const { chain } = await diskChainLoader(paths)();
        frictionDir = chain.friction;
        pendingPath = chain.pendingPath;
      } catch {
        frictionDir = undefined;
        pendingPath = undefined;
      }

      const jobs = jobStatus(repoRoot, frictionDir, pendingPath);
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
