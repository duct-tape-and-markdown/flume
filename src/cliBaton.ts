/**
 * The verbs whose whole effect is a marker under the state root and a
 * sentence about it — `flume wake`, `flume sleep` and `flume stop`
 * (spec/cli.md, *Subcommand surface*).
 *
 * One file because that is one job: each takes no flags, writes one path, and
 * prints what it wrote. `wake` and `sleep` are the same sequence under two
 * names, so they are one function with a table of the two differences
 * (`.claude/rules/engineering.md`, *A module is one job*) — a validation arm
 * added to one of them cannot go missing from the other.
 *
 * The file is the interface in every case: `touch <flumeDir>/awake/<phase>`
 * and `touch <flumeDir>/stop` are equally the mechanism (spec/loop.md,
 * *Baton — presence wakes, absence hibernates*; *Graceful stop — the stop
 * flag*). These verbs are discoverability plus a printed statement.
 */

import { Baton } from "./Baton.js";
import { loadChainForObservation } from "./cliChainLoad.js";
import type { FlumePaths } from "./flumeApi.js";
import { stopFlagPath } from "./paths.js";
import {
  mkdirUnderStateRoot,
  writeFileUnderStateRoot,
} from "./stateRootAccess.js";

/**
 * `wake`/`sleep`'s best-effort chain load: a missing or broken chain must
 * never block the marker mutation — there is nothing to validate the phase
 * name against. Only a chain that loads *successfully* and does not declare
 * `phase` among its `chain.phases` refuses. Reached with `configDir`,
 * which `FLUME_CONFIG_DIR` alone relocates, so the chain this validates
 * against is the same one `status` and `tick` load.
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

/** What separates `wake` from `sleep`: the mutation, and the word for it. */
const BATON_MUTATIONS = {
  wake: { apply: (baton: Baton, phase: string) => baton.wake(phase), said: "woke" },
  sleep: { apply: (baton: Baton, phase: string) => baton.sleep(phase), said: "slept" },
} as const;

/** Which marker mutation a call of {@link batonVerb} performs. */
type BatonMutation = keyof typeof BATON_MUTATIONS;

/**
 * `flume wake <phase>` and `flume sleep <phase>`: exactly one positional, the
 * phase validated against the chain where one loads, then the marker.
 */
export async function batonVerb(
  paths: FlumePaths,
  rest: string[],
  mutation: BatonMutation,
): Promise<number> {
  const phase = rest[0];
  if (!phase || rest.length > 1) {
    console.error(`usage: flume ${mutation} <phase>`);
    return 2;
  }
  if (await chainRefusesPhase(paths, mutation, phase)) {
    console.error(
      `[flume] ${mutation} refuses: '${phase}' is not a phase this chain declares`,
    );
    return 2;
  }
  const { apply, said } = BATON_MUTATIONS[mutation];
  apply(new Baton(paths.flumeDir), phase);
  console.log(`${said} ${phase}`);
  return 0;
}

/** `flume stop` — the stop flag written, and what it will do said outright. */
export function stopVerb(paths: FlumePaths, rest: string[]): number {
  const { flumeDir } = paths;
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
  // The other raw `mkdir` under the resolved root, through the one refusal
  // the baton's goes through: a root the seam in `src/cli.ts` found absent is
  // made here, and one it cannot make is this verb's `EX_IOERR` rather than a
  // raw stack, without a second spelling of the report
  // (`.claude/rules/engineering.md`, *The fix lands at the mechanism*).
  // The flag write beside it goes through the same refusal for the same
  // reason: a directory standing at `<flumeDir>/stop` walks past the mkdir
  // and fails the write, and this verb's whole effect is that one leaf.
  mkdirUnderStateRoot(flumeDir, "the root itself", flumeDir);
  writeFileUnderStateRoot(flumeDir, "the stop flag", stopPath, "");
  console.log(
    `[flume] wrote ${stopPath}: a live supervisor finishes its in-flight ` +
      "tick and ends the run; the next `loop` refuses to start until the " +
      "flag is removed.",
  );
  return 0;
}
