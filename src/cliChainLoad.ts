/**
 * The one best-effort chain load the read-only surfaces take — `flume
 * status` and `flume wake`/`flume sleep` (`src/cli.ts`), `flume job status`
 * (`src/cliJobVerbs.ts`). Each reads chain-declared values (`Chain.pendingPath`,
 * `Chain.friction`, `Chain.capabilities`, `Chain.phases`) to describe or
 * validate against state it will report either way; none may fail on a chain
 * that does not load, because none of them runs an agent.
 *
 * Best-effort is not silent. A chain that fails to load leaves each surface
 * proceeding over engine defaults, and what that costs differs per surface —
 * so the cost sentence is the **caller's**, passed in, while the failure line
 * and the bounding refusals are this module's. This is the declared
 * degraded-but-proceeding path (`.claude/rules/engineering.md`, "Loud or
 * nothing"): it reports the failure and what the failure cost, on stderr so
 * the observational stdout stays byte-unchanged, and names the refusals that
 * bound it — `flume tick` and `flume check` exit non-zero on this same load
 * rather than proceeding.
 */

import { diskChainLoader } from "./Dispatcher.js";
import type { Chain } from "./Phase.js";
import type { FlumePaths } from "./flumeApi.js";

/**
 * Load the repo-resident chain for a read-only verb. Returns the chain, or
 * `undefined` after reporting why it could not be had — never throws, so the
 * caller's exit code is unaffected.
 *
 * `surface` is the verb naming itself in the report (`status`, `job status`,
 * `wake`). `degradedCost` is that verb's own sentence for what proceeding
 * without the chain costs, printed after the failure and before the shared
 * bounding clause. `paths` is the caller's single `resolveStateDirs()`
 * result, so the factory sees the same canonicalized roots every other
 * subcommand passes it.
 */
export async function loadChainForObservation(
  paths: FlumePaths,
  surface: string,
  degradedCost: string,
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
      `[flume] ${surface}: ${degradedCost} \`flume tick\` and \`flume ` +
        `check\` refuse on this same load.`,
    );
    return undefined;
  }
}
