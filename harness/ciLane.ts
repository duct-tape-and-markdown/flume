/**
 * The inbox slice's CI lane leg (`spec/harness.md`, *CI lanes as a findings
 * source*): whether a declared lane makes the slice live, and the block the
 * slice's prompt carries for every lane.
 *
 * **One reading, two readers.** The ladder asks whether any lane is undrained;
 * the render asks which, and says so per lane. Both come off the one status
 * read {@link laneLeg} memoizes, so the render can never name a different lane
 * than the one that woke the tick (`.claude/rules/engineering.md`, *Derived
 * state is computed, never restated beside its source*).
 *
 * The reading itself is `ci.ts`'s — what a forge was asked, and what its
 * answer means for a lane's status. This module is the slice's half of it:
 * the stamp comparison that turns a status into a wake, and the words a
 * woken agent reads.
 */

import {
  readCiLaneStatuses,
  withCiLaneMaterial,
  type CiLaneReading,
  type CiLaneStatus,
  type CiRun,
} from "./ci.js";
import type { Declaration } from "./declaration.js";
import { readPlanState } from "./planState.js";

/** What a lane leg reads a consumer's lanes through. */
interface LaneLegOptions {
  /**
   * The lanes the consumer declared, as the declaration carries them —
   * `undefined` where it declared none, which is the empty case this leg
   * spells rather than reads a forge for.
   */
  readonly lanes: Declaration["ci"];
  /**
   * The repository the runs are keyed through. The repo root, never a tick's
   * worktree: a tick runs on a scratch branch the forge has never seen
   * (`ci.ts`).
   */
  readonly repoRoot: string;
  /** How many lines of a failing job's log one lane's block carries. */
  readonly budget: number;
}

/** One tick's lane leg: the liveness verdict, and the block it renders. */
export interface LaneLeg {
  /**
   * Whether any declared lane's latest completed run failed past its stamp —
   * the lane leg's half of the inbox slice's liveness.
   */
  readonly live: (flumeDir: string) => boolean;
  /** Every declared lane's latest completed run, one block each. */
  readonly render: (flumeDir: string) => string;
}

/**
 * The lane leg for one tick.
 *
 * **The statuses are read from the forge on first ask and handed out
 * unchanged after** — one lane read per tick, shared by the liveness leg and
 * the render. A tick the disk already woke never asks at all, so the inbox
 * window's short-circuit still spares it the network; a tick that does ask
 * pays once rather than once per reader.
 *
 * One lane leg is one tick — the chain factory builds the windows once and
 * each tick is a fresh child (`harness/chain.ts`) — so the memo's lifetime is
 * exactly the span over which the forge's answer is the same answer.
 *
 * The memo holds the statuses alone, never {@link withCiLaneMaterial}: the
 * liveness verdict is over run identity and conclusion, and fetching a failing
 * job's whole log to answer a boolean would put a multi-megabyte read on the
 * selection path. The render layers material on top of these readings.
 */
export function laneLeg(options: LaneLegOptions): LaneLeg {
  const { lanes } = options;
  let read: readonly CiLaneStatus[] | undefined;
  const statuses = (): readonly CiLaneStatus[] => {
    read ??=
      lanes === undefined
        ? []
        : readCiLaneStatuses(lanes, { repoRoot: options.repoRoot });
    return read;
  };
  return {
    live: (flumeDir) => wokenLanes(statuses(), flumeDir).size > 0,
    render: (flumeDir) => {
      if (lanes === undefined) return "(no CI lanes declared)";
      const woke = wokenLanes(statuses(), flumeDir);
      return withCiLaneMaterial(statuses(), {
        repoRoot: options.repoRoot,
        logLines: options.budget,
      })
        .map((reading) => renderLane(reading, woke.has(reading.lane.name)))
        .join("\n\n");
    },
  };
}

/**
 * The declared lanes whose latest completed run failed at a run this
 * consumer's plan state has not stamped as drained (`spec/harness.md`, *CI
 * lanes as a findings source*) — the lanes making the inbox slice live, by
 * name.
 *
 * **The stamp is what closes the lane.** A red lane with no stamp leg would
 * hold this slice live for as long as the lane stays red, re-filing the same
 * run's titles every tick; a lane read with no liveness leg at all would
 * never wake the slice, so a queue-drained tree hibernates over a failing
 * lane. Both are the same missing comparison, read here off the run identity
 * the reader reports (`ci.ts`) against the stamp the slice wrote last time it
 * drained (`planState.ts`, `drainedRuns`).
 *
 * A lane read as green, and a lane that could not be read at all, are live
 * for nothing: unread is not a reason to wake, only a thing to say on a tick
 * something else woke. A consumer declaring no lanes never asks the forge,
 * and never reads the plan state to ask this either.
 *
 * **A set rather than a boolean, because the render owes the same verdict by
 * name.** The leg's two readers are one derivation: the ladder asks whether
 * any lane is in here, the render asks which, and a render recomputing its own
 * answer would be free to disagree with the one that woke the tick.
 */
function wokenLanes(
  statuses: readonly CiLaneStatus[],
  flumeDir: string,
): ReadonlySet<string> {
  if (statuses.length === 0) return new Set();
  const drained = readPlanState(flumeDir)?.drainedRuns ?? {};
  return new Set(
    statuses.flatMap((status) =>
      status.kind === "failing" && drained[status.lane.name] !== status.run.id
        ? [status.lane.name]
        : [],
    ),
  );
}

/** One run as every block names it: its identity, its branch, and where it sits. */
function renderRun(run: CiRun, branch: string): string {
  return `run ${run.id} on branch ${branch} — ${run.title} (${run.at})\n${run.url}`;
}

/**
 * The stamp that closes a lane, named rather than left for the agent to
 * compose out of the run line beside it — a lane the slice woke on and did
 * not stamp is a lane this render re-opens on next tick over the same run
 * (`.claude/rules/posture-sweep.md`, *The stamp*, for the cursor this is the
 * sibling of).
 *
 * One sentence for both arms that own a run, because both close the same way:
 * the slice stamps the run it woke on, drained or unread (`spec/harness.md`,
 * *CI lanes as a findings source*). `lead` is the only difference — what the
 * arm has this tick do with the run before stamping it.
 */
function renderStamp(laneName: string, run: CiRun, lead: string): string {
  return (
    `${lead} stamp \`drainedRuns.${laneName}\` at \`${run.id}\`: this lane ` +
    `holds the inbox slice live until it is the run stamped there.`
  );
}

/**
 * One lane's reading, under the lane name its findings are keyed by, saying
 * whether this lane is what made the slice live.
 *
 * **Every block answers the wake question, in both directions.** A marker on
 * the woken lane alone would leave a reader inferring silence, and the lane
 * that woke a tick is the one thing a drain has to start from
 * (`spec/harness.md`, *CI lanes as a findings source*). The verdict is
 * {@link wokenLanes}'s, handed in rather than recomputed here, so the render
 * cannot name a different lane than the one the ladder woke over.
 *
 * `woke` is the lane's verdict, not the reading's — a lane whose failing run
 * is past its stamp woke the slice whether or not the job's log then came
 * back, which is exactly the case the unread arm below names its run for.
 *
 * Unbounded by the window's own refusal, and deliberately: every way the read
 * can fail is already one of the reader's own unread readings (`ci.ts`), so a
 * refusal wrapped around it would be a second, unreachable spelling of a
 * degradation this block states per lane. What the render owes instead is that
 * unread never reads as green — which is what the block below says in its own
 * words.
 */
function renderLane(reading: CiLaneReading, woke: boolean): string {
  const { lane } = reading;
  const head = `lane \`${lane.name}\` (workflow ${lane.workflow}, job ${lane.job})`;
  const wake = woke
    ? `Woke this slice: this lane's latest completed run failed and is not ` +
      `the run stamped at \`drainedRuns.${lane.name}\`.`
    : `Not what woke this slice.`;
  if (reading.kind === "unread") {
    return [
      `=== ${head}: UNREAD ===`,
      wake,
      // The run a failing lane degraded to unread over, which the reader
      // reports rather than dropping (`ci.ts`, `CiUnreadOver`): without it a
      // tick this lane woke renders a bare unread over an invisible cause.
      ...(reading.over === undefined
        ? []
        : [
            `The run this lane was read at, whose log this tick could not fetch:`,
            renderRun(reading.over.run, reading.over.branch),
          ]),
      `${reading.reason}.`,
      `Unread is not green: this tick knows nothing about the lane's state, ` +
        `so file nothing and close nothing against it.`,
      // And the stamp that closes it anyway, on the one unread that names a
      // run: this lane woke the slice over that run, so leaving it unstamped
      // costs a wake every tick for as long as the forge withholds the log.
      ...(reading.over === undefined
        ? []
        : [
            renderStamp(
              lane.name,
              reading.over.run,
              `There is nothing to drain out of this run and nothing to file ` +
                `against it — even so,`,
            ),
            `Its findings arrive from the next run that fails: the lane runs ` +
              `on every push, and a failure that persists reports again. Say ` +
              `in the commit body that this lane's run went unread.`,
          ]),
    ].join("\n");
  }
  const { run, branch } = reading;
  if (reading.kind === "green") {
    return [
      `=== ${head}: GREEN ===`,
      wake,
      renderRun(run, branch),
      `Nothing to drain. A finding already filed under this lane's name that ` +
        `this run no longer reports closes in the commit body.`,
    ].join("\n");
  }
  return [
    `=== ${head}: FAILING ===`,
    wake,
    renderRun(run, branch),
    renderStamp(lane.name, run, `Once you have drained this run,`),
    `--- the failing job's log ---`,
    reading.log,
  ].join("\n");
}
