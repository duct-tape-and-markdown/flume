/**
 * The two arms every chain-loading CLI surface shares.
 *
 * `refuseCjsContextHost` is the refusal: the one home for the
 * `CjsContextLoadError` -> headline + exit 2 contract (spec/cli.md, "A
 * CJS-context host is refused, never relayed"), reached by `flume check` and
 * `flume friction` alike rather than re-typed in each catch (`.claude/rules/engineering.md`, "The fix lands at
 * the mechanism"). `flume tick` holds the same contract one layer down, where
 * the refusal is a `TickOutcome.usageError` rather than an exit code.
 *
 * `loadChainForObservation` is the best-effort load the read-only surfaces
 * take — `flume status` and `flume wake`/`flume sleep` (`src/cli.ts`). Each
 * reads chain-declared values
 * (`Chain.pendingDir`, `Chain.friction`, `Chain.capabilities`,
 * `Chain.phases`) to describe or validate against state it will report either
 * way; none may fail on a chain that does not load, because none of them runs
 * an agent.
 *
 * Best-effort is not silent. A chain that fails to load leaves each surface
 * proceeding over engine defaults, and what that costs differs per surface —
 * so the cost sentence is the **caller's**, passed in, while the failure line
 * and the bounding refusals are this module's. This is the declared
 * degraded-but-proceeding path (`.claude/rules/engineering.md`, "Loud or
 * nothing"): it reports the failure and what the failure cost on stderr, and
 * names the refusals that bound it — `flume tick` and `flume check` exit
 * non-zero on this same load rather than proceeding.
 *
 * The stderr report is not the whole obligation, because one of these
 * surfaces is a *listing*: `flume status` renders the failure as a row of its
 * own output (spec/cli.md, "`flume status` owes exactly this"), so a status
 * over a dead chain never has the shape of a healthy one on stdout. The
 * report shared here cannot know that — so the failure comes back as a fact
 * on `ChainObservation` as well as going out as a line, and the surface that
 * has somewhere to put it renders it (`.claude/rules/engineering.md`, "A fact
 * the engine holds is reported, never rediscovered").
 */

import { CjsContextLoadError, diskChainLoader } from "./chainLoad.js";
import type { Chain } from "./Phase.js";
import type { FlumePaths } from "./flumeApi.js";

/**
 * The shared CJS-context arm, for a `catch` that owns an exit code: prints
 * the refusal as the headline and returns `2` when `err` is the refusal,
 * `undefined` otherwise so the caller's own arms run on everything else.
 *
 * Exit 2 is the usage code, consistent with the rest of the CLI's usage
 * refusals — this is a nameable fix on the host repo, not a dead mount.
 * Detection stays `loadChainModule`'s (`src/chainLoad.ts`): a load failure
 * that is not that signature is never shadowed here, it falls through to the
 * caller unchanged.
 */
export function refuseCjsContextHost(err: unknown): number | undefined {
  if (!(err instanceof CjsContextLoadError)) return undefined;
  console.error(`[flume] ${err.message}`);
  return 2;
}

/**
 * What a best-effort load leaves its caller: the chain, or the reason it
 * could not be had. `loadFailure` is present exactly when `chain` is absent,
 * so a surface with somewhere to render the failure reads it off the same
 * result it reads the chain off, rather than re-deciding from `chain ===
 * undefined` what the load already knew.
 *
 * Module-local: every caller destructures the result at the callsite, so
 * nothing outside this file names the type (`.claude/rules/engineering.md`,
 * "An export earns its consumer"). It widens when a caller needs to hold one.
 */
type ChainObservation =
  | { readonly chain: Chain; readonly loadFailure?: undefined }
  | { readonly chain: undefined; readonly loadFailure: string };

/**
 * Load the repo-resident chain for a read-only verb. Returns the chain, or
 * the reason it could not be had after reporting that reason on stderr —
 * never throws, so the caller's exit code is unaffected.
 *
 * `surface` is the verb naming itself in the report (`status`, `wake`). `degradedCost` is that verb's own sentence for what proceeding
 * without the chain costs, printed after the failure and before the shared
 * bounding clause. `paths` is the caller's single `resolveStateDirs()`
 * result, so the factory sees the same canonicalized roots every other
 * subcommand passes it.
 *
 * `loadFailure` carries the bare reason — no `[flume]` prefix, no surface
 * name — because the caller rendering it is placing it in its own output,
 * where the surface is already established and the engine's stderr prefix
 * would read as an error line escaping into a listing.
 */
export async function loadChainForObservation(
  paths: FlumePaths,
  surface: string,
  degradedCost: string,
): Promise<ChainObservation> {
  try {
    const { chain } = await diskChainLoader(paths)();
    return { chain };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[flume] ${surface}: chain failed to load: ${reason}`);
    console.error(
      `[flume] ${surface}: ${degradedCost} \`flume tick\` and \`flume ` +
        `check\` refuse on this same load.`,
    );
    return { chain: undefined, loadFailure: reason };
  }
}
