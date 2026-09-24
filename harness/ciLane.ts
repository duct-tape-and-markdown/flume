/**
 * The inbox slice's CI lane leg (`spec/harness.md`, *CI lanes as a findings
 * source*): whether a declared lane makes the slice live, and the block the
 * slice's prompt carries for every lane.
 *
 * **One reading, two readers.** The wake set asks whether a lane is undrained;
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
  ciLaneReading,
  readCiLaneStatuses,
  sameTitleSet,
  type CiLaneReading,
  type CiLaneStatus,
  type CiRun,
} from "./ci.js";
import { INBOX_PHASE, type Declaration } from "./declaration.js";
import { readPlanState, type PlanStateOf } from "./planState.js";

/**
 * A lane's drained-run stamp as the inbox slice's own state file holds it,
 * once read — the stamps are that slice's, and this leg is that slice's leg.
 */
type Stamp = NonNullable<
  PlanStateOf<typeof INBOX_PHASE>["drainedRuns"]
>[string];

/** One lane's reading, fetched on first ask and handed out unchanged after. */
type Readings = (status: CiLaneStatus) => CiLaneReading;

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
 * The material is memoized beside the statuses, and asked for one lane at a
 * time. A liveness verdict is over run identity and conclusion alone for
 * every lane that declares no title reader, so fetching a failing job's whole
 * log to answer a boolean stays off the selection path where nothing needs
 * it; a lane that *does* declare a reader buys its log there, once, and the
 * render reads back the same bytes rather than fetching them again
 * (`.claude/rules/engineering.md`, *Derived state is computed, never restated
 * beside its source*).
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

  // Keyed by lane name, which the declaration refuses to let two lanes share.
  const material = new Map<string, CiLaneReading>();
  const reading: Readings = (status) => {
    const memo = material.get(status.lane.name);
    if (memo !== undefined) return memo;
    const fresh = ciLaneReading(status, {
      repoRoot: options.repoRoot,
      logLines: options.budget,
    });
    material.set(status.lane.name, fresh);
    return fresh;
  };

  return {
    live: (flumeDir) => wokenLanes(statuses(), flumeDir, reading).size > 0,
    render: (flumeDir) => {
      if (lanes === undefined) return "(no CI lanes declared)";
      const woke = wokenLanes(statuses(), flumeDir, reading);
      return statuses()
        .map((status) => renderLane(reading(status), woke.has(status.lane.name)))
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
 * and never reads the inbox slice's state to ask this either.
 *
 * **A set rather than a boolean, because the render owes the same verdict by
 * name.** The leg's two readers are one derivation: the wake set asks whether
 * any lane is in here, the render asks which, and a render recomputing its own
 * answer would be free to disagree with the one that woke the tick.
 */
function wokenLanes(
  statuses: readonly CiLaneStatus[],
  flumeDir: string,
  reading: Readings,
): ReadonlySet<string> {
  if (statuses.length === 0) return new Set();
  const drained = readPlanState(flumeDir, INBOX_PHASE)?.drainedRuns ?? {};
  return new Set(
    statuses.flatMap((status) =>
      woke(status, drained[status.lane.name], reading)
        ? [status.lane.name]
        : [],
    ),
  );
}

/**
 * Whether one lane's reading wakes the slice, against the stamp that lane
 * carries (`spec/harness.md`, *CI lanes as a findings source*).
 *
 * Three questions in the order that decides what the tick pays for. A lane
 * that is not failing, or one already stamped at this very run, is settled
 * off the cheap status alone — so the material fetch below is reached only
 * by a lane that is red at a run past its stamp *and* declares a reader to
 * read that run's titles with.
 *
 * A lane declaring no reader stops at the run: it wakes once per failing
 * run, which is the rule spelled rather than inherited from an empty set
 * that would otherwise read as "matching" every stamp holding none.
 *
 * A stamp the lane has never carried wakes it whatever the titles say: the
 * lane has been drained by nothing, and an absent stamp carries no set for a
 * set to match.
 *
 * A reader whose run degraded to unread — the forge held the run and
 * withheld its log — wakes the lane too. The titles are unknown there, and
 * the render owes the agent that wake by name; reading unknown as "matching"
 * would silently close a red lane on a log nobody read
 * (`.claude/rules/engineering.md`, *Loud or nothing*).
 */
function woke(
  status: CiLaneStatus,
  stamp: Stamp | undefined,
  reading: Readings,
): boolean {
  if (status.kind !== "failing") return false;
  if (stamp === undefined) return true;
  if (stamp.run === status.run.id) return false;
  if (status.lane.titles === undefined) return true;
  const material = reading(status);
  if (material.kind !== "failing") return true;
  return !sameTitleSet(material.titles ?? [], stamp.titles);
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
 *
 * The value is spelled out whole, titles included, rather than described: the
 * titles are the reader's answer over a log this agent is about to read for
 * itself, and an agent composing the set by hand would stamp its own reading
 * of the log while the wake compares the declared reader's
 * (`.claude/rules/engineering.md`, *A fact the engine holds is reported,
 * never rediscovered*). A lane with no reader, and an unread run whose log
 * never reached one, stamp the empty set — which is what they state.
 */
function renderStamp(
  laneName: string,
  run: CiRun,
  titles: readonly string[],
  lead: string,
): string {
  const stamp = JSON.stringify({ run: run.id, titles });
  return (
    `${lead} stamp \`drainedRuns.${laneName}\` at \`${stamp}\`: this lane ` +
    `holds the inbox slice live until it is the run stamped there, reporting ` +
    `the titles stamped with it.`
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
 * cannot name a different lane than the one the wake set woke over.
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
    ? `Woke this slice: this lane's latest completed run failed at a run — ` +
      `and, where this lane declares a title reader, at a set of failing ` +
      `titles — that \`drainedRuns.${lane.name}\` does not already stamp.`
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
              // No titles: the log this lane's reader would have read is the
              // one the forge withheld, so the stamp states the empty set
              // and the next run that fails reports against it.
              [],
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
    // Stamped either way. A red lane this tick was not woken by reports
    // nothing its stamp does not already carry, and advancing the stamp on
    // the tick that ran anyway is what keeps a red that persists across runs
    // from re-waking the slice on failures already filed (`spec/harness.md`,
    // *CI lanes as a findings source*).
    renderStamp(
      lane.name,
      run,
      reading.titles ?? [],
      woke
        ? `Once you have drained this run,`
        : `This run states nothing this lane's stamp does not already carry, ` +
          `so there is nothing to drain out of it —`,
    ),
    `--- the failing job's log ---`,
    reading.log,
  ].join("\n");
}
