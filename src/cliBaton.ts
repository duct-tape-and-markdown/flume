/**
 * The verbs whose whole effect is a marker under the state root and a
 * sentence about it — `flume wake`, `flume sleep`, `flume hold` and
 * `flume stop` (spec/cli.md, *Subcommand surface*).
 *
 * One file because that is one job: each takes no flags, writes one path, and
 * prints what it wrote. `wake`, `sleep` and `hold` are the same sequence
 * under three names, so they are one function with a table of what separates
 * them (`.claude/rules/engineering.md`, *A module is one job*) — a validation
 * arm added to one of them cannot go missing from the others.
 *
 * The file is the interface in every case: `touch <flumeDir>/awake/<phase>`,
 * `touch <flumeDir>/held/<phase>` and `touch <flumeDir>/stop` are equally the
 * mechanism (spec/loop.md, *Baton — presence wakes, absence hibernates*;
 * *Graceful stop — the stop flag*). These verbs are discoverability plus a
 * printed statement.
 */

import { Baton } from "./Baton.js";
import { loadChainForObservation } from "./cliChainLoad.js";
import { operatorLog } from "./cliLog.js";
import type { FlumePaths } from "./flumeApi.js";
import { stopFlagPath } from "./paths.js";
import {
  mkdirUnderStateRoot,
  writeFileUnderStateRoot,
} from "./stateRootAccess.js";

/**
 * The mutating verbs' best-effort chain load: a missing or broken chain must
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
 * cost these verbs pay is its own — not a rebased pending count, but a
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

/**
 * What separates `wake`, `sleep` and `hold`: the markers the verb moves, the
 * word for what it did, and — where it moved a second marker the operator did
 * not name — the clause that says so.
 *
 * `hold` is a row here and not a fourth spelling: the usage read, the chain
 * validation and the printed sentence are the same sequence for all three
 * (`.claude/rules/engineering.md`, *A module is one job*).
 *
 * The clause is what makes these verbs each other's undo readable. Two
 * markers decide one phase — the flag under `awake/` and the hold under
 * `held/` — and the verb that stands one up puts the other down, so a
 * sentence naming only the marker the operator typed leaves the other move
 * unreported. `undefined` is the honest silence: the second marker was not
 * standing, so this call moved nothing but its own.
 */
const BATON_MUTATIONS = {
  wake: {
    said: "woke",
    apply: (baton: Baton, phase: string): string | undefined => {
      // Read before the clear, because the clause states what *this* call
      // changed: `flume wake <phase>` removes the hold, wakes the phase and
      // says it did (`spec/loop.md`, *Baton — presence wakes, absence
      // hibernates*), and a wake over an unheld phase has nothing to say
      // about a hold.
      const wasHeld = baton.isHeld(phase);
      // The hold goes down first and the flag up second, so no instant has
      // this phase carrying a flag under a standing hold. That state is one
      // the pick and the handoff's wake filter already decline — a handoff
      // whose own check lost the race with a marker write, `Baton.hold`
      // (`src/Baton.ts`) — and a verb that produced it on purpose would be
      // asking those readers to distinguish a race from an operator's
      // intent. The gap this order leaves instead is a phase
      // neither held nor awake, which every reader of the baton already
      // spells "nothing to run".
      if (wasHeld) baton.unhold(phase);
      baton.wake(phase);
      return wasHeld ? "hold cleared" : undefined;
    },
  },
  sleep: {
    said: "slept",
    apply: (baton: Baton, phase: string): string | undefined => {
      baton.sleep(phase);
      return undefined;
    },
  },
  hold: {
    said: "held",
    apply: (baton: Baton, phase: string): string | undefined => {
      const wasAwake = baton.isAwake(phase);
      // Marker first, flag second, for the reason `Baton.hold`
      // (`src/Baton.ts`) states: no window leaves the phase pickable with the
      // operator's intent recorded nowhere.
      baton.hold(phase);
      baton.sleep(phase);
      return wasAwake ? "awake flag cleared" : undefined;
    },
  },
} as const;

/** Which marker mutation a call of {@link batonVerb} performs. */
type BatonMutation = keyof typeof BATON_MUTATIONS;

/**
 * `flume wake <phase>`, `flume sleep <phase>` and `flume hold <phase>`:
 * exactly one positional, the phase validated against the chain where one
 * loads, then the markers, then the sentence naming every marker this call
 * moved.
 */
export async function batonVerb(
  paths: FlumePaths,
  rest: string[],
  mutation: BatonMutation,
): Promise<number> {
  const phase = rest[0];
  if (!phase || rest.length > 1) {
    operatorLog.error(`usage: flume ${mutation} <phase>`);
    return 2;
  }
  if (await chainRefusesPhase(paths, mutation, phase)) {
    operatorLog.error(
      `[flume] ${mutation} refuses: '${phase}' is not a phase this chain declares`,
    );
    return 2;
  }
  const { apply, said } = BATON_MUTATIONS[mutation];
  const also = apply(new Baton(paths.flumeDir), phase);
  console.log(also === undefined ? `${said} ${phase}` : `${said} ${phase} — ${also}`);
  return 0;
}

/** `flume stop` — the stop flag written, and what it will do said outright. */
export function stopVerb(paths: FlumePaths, rest: string[]): number {
  const { flumeDir } = paths;
  // `stop` consumes no positionals (spec/cli.md "Subcommand surface") — a
  // stray trailing arg is refused before the flag write below, not run as
  // something other than what the operator typed.
  if (rest.length > 0) {
    operatorLog.error("usage: flume stop");
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
