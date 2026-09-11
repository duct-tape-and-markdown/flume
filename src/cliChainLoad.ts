/**
 * The one best-effort chain load the observational surfaces take — `flume
 * status` (`src/cli.ts`) and `flume job status` (`src/cliJobVerbs.ts`). Both
 * read chain-declared values (`Chain.pendingPath`, `Chain.friction`,
 * `Chain.capabilities`) purely to describe state; neither may fail on a
 * chain that does not load, because describing state is all they do.
 *
 * Best-effort is not silent. A chain that fails to load leaves the pending
 * count rebased on the default queue path (`resolvePendingPath`,
 * `src/paths.ts`) — a confident wrong number unless the surface says where
 * it came from. This is the declared degraded-but-proceeding path
 * (`.claude/rules/engineering.md`, "Loud or nothing"): it reports the
 * failure and what the failure cost, on stderr so the observational stdout
 * stays byte-unchanged, and names the refusals that bound it — `flume tick`
 * and `flume check` exit non-zero on this same load rather than proceeding.
 */

import { diskChainLoader } from "./Dispatcher.js";
import type { Chain } from "./Phase.js";
import type { FlumePaths } from "./flumeApi.js";

/**
 * Load the repo-resident chain for an observational verb. Returns the chain,
 * or `undefined` after reporting why it could not be had — never throws, so
 * the caller's exit code is unaffected.
 *
 * `surface` is the verb naming itself in the report (`status`, `job
 * status`). `paths` is the caller's single `resolveStateDirs()` result, so
 * the factory sees the same canonicalized roots every other subcommand
 * passes it.
 */
export async function loadChainForObservation(
  paths: FlumePaths,
  surface: string,
): Promise<Chain | undefined> {
  try {
    const { chain } = await diskChainLoader(paths)();
    return chain;
  } catch (err) {
    console.error(
      `[flume] ${surface}: chain failed to load: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    console.error(
      `[flume] ${surface}: proceeding over engine defaults — the pending ` +
        `count reads the default queue path, and chain-declared friction ` +
        `and capability lines are withheld. \`flume tick\` and \`flume ` +
        `check\` refuse on this same load.`,
    );
    return undefined;
  }
}
