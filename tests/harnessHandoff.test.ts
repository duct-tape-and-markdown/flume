/**
 * The harness package's default handoff (`spec/harness.md`, *The default
 * `handoff`*): the ladder from one tick's reported facts to the phases the
 * next tick wakes, and the declaration that replaces it.
 *
 * Every case drives the real `defaultHandoff` over a real `TickResult`. The
 * facts it reads are the engine's own — `pickableAfter`, `phaseName`,
 * `committed`, `noCommit`, `entries[].mergeOutcome` — so the fixtures here
 * are typed as `TickResult` rather than as the subset this module happens to
 * touch: a field the engine renames is a typecheck failure in these cases,
 * not a silently-undefined read.
 *
 * Each routing case carries its control — the same result with the one fact
 * changed — so "routes to the inbox" is proven to be that fact's doing and
 * not the ladder's default answer for the whole fixture.
 *
 * The stop-flag cases run over a real temp state root, and ask about the
 * flag through the engine's own `stopFlagPath` — the accessor the supervisor
 * reads the flag back through (`src/loopSupervisor.ts`). A literal `"stop"`
 * here would pin the tester's spelling of the name rather than the one the
 * two real sides share.
 */

import { existsSync, rmSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CONTRACT_TOUCHING_FIELD,
  defaultHandoff,
  defaultRefusesEntry,
  resolveHandoff,
  type Handoff,
  type HandoffSlice,
  type SliceWindow,
} from "../harness/index.ts";
import {
  BUILD_PHASE,
  INBOX_PHASE,
  type PlanSlice,
} from "../harness/declaration.ts";
import type {
  EntryRefusalContext,
  FanoutEntryOutcome,
  TickResult,
} from "../src/Phase.ts";
import { namespacedJoin, stopFlagPath } from "../src/paths.ts";
import type { PendingEntry } from "../src/PendingSchema.ts";
import {
  NO_COMMIT_MODES,
  PRIOR_ATTEMPT_MODES,
  type NoCommitMode,
  type PriorAttempt,
} from "../src/Prompt.ts";

import { mkTempDirSync } from "./helpers/fixtureRoot.ts";

const DERIVE = "plan-derive" as const satisfies PlanSlice;
const SWEEP = "plan-sweep" as const satisfies PlanSlice;

/** The state root every fixture reports, distinct enough to be recognized. */
const FLUME_DIR = "/tmp/flume-handoff-fixture/.flume";

/** One queue entry — the ladder reads only whether the set is non-empty. */
const entry = (tag: string): PendingEntry => ({
  tag,
  gate: { kind: "open" },
  dependsOnForks: [],
  files: { new: [], edit: [], retire: [] },
});

function tickResult(overrides: Partial<TickResult> = {}): TickResult {
  return {
    phaseName: BUILD_PHASE,
    committed: true,
    gateResults: [],
    pendingAfter: [],
    pickableAfter: [],
    flumeDir: FLUME_DIR,
    configDir: "/tmp/flume-handoff-fixture/.flume",
    shippedTags: [],
    revertedTags: [],
    ...overrides,
  };
}

/** One fanout entry outcome, shipped clean unless a case says otherwise. */
const outcome = (
  overrides: Partial<FanoutEntryOutcome> = {},
): FanoutEntryOutcome => ({
  tag: "SOME-ENTRY",
  extension: {},
  committed: true,
  shipped: true,
  reverted: false,
  mergeOutcome: "merged",
  ...overrides,
});

/** A slice whose window is whatever the case says, recording what it was asked. */
function slice(
  name: PlanSlice,
  live: boolean | ((window: SliceWindow) => boolean) = false,
): HandoffSlice & { asked: SliceWindow[] } {
  const asked: SliceWindow[] = [];
  return {
    name,
    asked,
    live: (window) => {
      asked.push(window);
      return typeof live === "boolean" ? live : live(window);
    },
  };
}

/** The package's three slices in order, each dead unless a case revives it. */
const ladder = (
  ...over: HandoffSlice[]
): HandoffSlice[] => {
  const byName = new Map<PlanSlice, HandoffSlice>(over.map((s) => [s.name, s]));
  return [INBOX_PHASE, DERIVE, SWEEP].map(
    (name) => byName.get(name) ?? slice(name, false),
  );
};

describe("the harness package's default handoff", () => {
  it("the default handoff names the first live slice ahead of build", () => {
    const handoff = defaultHandoff(ladder(slice(INBOX_PHASE, true), slice(SWEEP, true)));

    // Build is a live alternative here — the queue has pickable work — so
    // naming a slice is the ladder's ordering, not the absence of a choice.
    const result = tickResult({ pickableAfter: [entry("READY")] });
    expect(result.pickableAfter.length).toBeGreaterThan(0);
    expect(handoff(result)).toEqual([INBOX_PHASE]);

    // "First live", not "first declared": with the inbox window shut, the
    // next open one is named rather than the head of the list.
    const later = defaultHandoff(ladder(slice(DERIVE, true), slice(SWEEP, true)));
    expect(later(result)).toEqual([DERIVE]);
  });

  it("the default handoff names build when no slice is live and the engine reports a pickable entry", () => {
    const handoff = defaultHandoff(ladder());

    const result = tickResult({
      pendingAfter: [entry("READY"), entry("BLOCKED")],
      pickableAfter: [entry("READY")],
    });

    // The pickable set the engine reported is what is read — not the queue
    // beside it, which here holds an entry the dispatcher did not pick.
    expect(result.pickableAfter.map((e) => e.tag)).toEqual(["READY"]);
    expect(handoff(result)).toEqual([BUILD_PHASE]);
  });

  it("the default handoff hibernates when no slice is live and nothing is pickable", () => {
    const handoff = defaultHandoff(ladder());

    // A queue that still holds an entry the dispatcher did not report as
    // pickable is the case hibernation must survive: reading `pendingAfter`
    // here instead would wake build over work it cannot take.
    const result = tickResult({
      pendingAfter: [entry("BLOCKED")],
      pickableAfter: [],
    });

    expect(handoff(result)).toEqual([]);
  });

  it("a build tick the chain declined routes to the inbox slice whatever is pickable", () => {
    const handoff = defaultHandoff(ladder());
    const pickable = { pickableAfter: [entry("PARKED")] };

    // A commit that landed and passed every gate which `shipped` declined:
    // the park. Its reason is in the note the tick wrote, and only a plan
    // slice can act on it.
    const parked = tickResult({
      ...pickable,
      entries: [outcome({ tag: "PARKED", shipped: false, mergeOutcome: "not-shipped" })],
    });
    expect(handoff(parked)).toEqual([INBOX_PHASE]);

    // The control: the same wave with the park's one fact changed goes back
    // to build, so the routing above is the refusal's doing.
    const shipped = tickResult({ ...pickable, entries: [outcome({ tag: "PARKED" })] });
    expect(handoff(shipped)).toEqual([BUILD_PHASE]);

    // A cherry-pick conflict is nobody's refusal — the next wave retries it
    // from the new base rather than asking plan to resolve anything.
    const conflicted = tickResult({
      ...pickable,
      entries: [
        outcome({ tag: "PARKED", shipped: false, mergeOutcome: "cherry-pick-conflict" }),
      ],
    });
    expect(handoff(conflicted)).toEqual([BUILD_PHASE]);
  });

  it("a build tick whose prompt never rendered routes to the inbox slice", () => {
    const handoff = defaultHandoff(ladder());
    const walled = tickResult({
      committed: false,
      noCommit: "render-refused",
      pickableAfter: [entry("UNRENDERABLE")],
    });

    // Nothing about the tree changes between attempts on a refused render,
    // so the ladder naming build again is the wall, forever.
    expect(handoff(walled)).toEqual([INBOX_PHASE]);

    // The control: a reverted commit is worth retrying from the same queue.
    const reverted = tickResult({
      committed: false,
      noCommit: "gate-revert",
      pickableAfter: [entry("UNRENDERABLE")],
    });
    expect(handoff(reverted)).toEqual([BUILD_PHASE]);
  });

  it("a slice that committed nothing is not named by its own handoff", () => {
    const handoff = defaultHandoff(ladder(slice(DERIVE, true), slice(SWEEP, true)));
    const ran = { phaseName: DERIVE, pickableAfter: [entry("READY")] };

    // Committed nothing: its window is open for the reason it was open last
    // tick, so naming itself would spend the run on the same wall.
    expect(handoff(tickResult({ ...ran, committed: false }))).toEqual([SWEEP]);

    // Committed: a window larger than one tick's budget is progress, and the
    // slice re-wakes itself.
    expect(handoff(tickResult({ ...ran, committed: true }))).toEqual([DERIVE]);
  });

  it("a declared handoff replaces the package's default", () => {
    const slices = ladder(slice(INBOX_PHASE, true));
    const declaredBuild: Handoff = () => [SWEEP];

    // The default would name the live inbox slice for either phase; the
    // declaration replaces that decision outright for the phase it names.
    expect(defaultHandoff(slices)(tickResult())).toEqual([INBOX_PHASE]);

    const forBuild = resolveHandoff({
      phase: BUILD_PHASE,
      declared: { [BUILD_PHASE]: declaredBuild },
      slices,
    });
    expect(forBuild).toBe(declaredBuild);
    expect(forBuild(tickResult())).toEqual([SWEEP]);

    // Per phase: a phase the declaration does not name keeps the package's
    // ladder rather than inheriting build's override.
    const forInbox = resolveHandoff({
      phase: INBOX_PHASE,
      declared: { [BUILD_PHASE]: declaredBuild },
      slices,
    });
    expect(forInbox).not.toBe(declaredBuild);
    expect(forInbox(tickResult({ phaseName: INBOX_PHASE, committed: true }))).toEqual([
      INBOX_PHASE,
    ]);

    // No declaration at all is the default, same as naming no phase.
    expect(resolveHandoff({ phase: BUILD_PHASE, slices })(tickResult())).toEqual([
      INBOX_PHASE,
    ]);
  });
});

describe("the default handoff's reading of the engine's facts", () => {
  it("routes exactly the no-commit modes only a plan slice can resolve", () => {
    const handoff = defaultHandoff(ladder());
    const routed = NO_COMMIT_MODES.filter(
      (mode: NoCommitMode) =>
        handoff(
          tickResult({
            committed: false,
            noCommit: mode,
            pickableAfter: [entry("READY")],
          }),
        )[0] === INBOX_PHASE,
    );

    // Read off the engine's own list, so a mode it gains is classified here
    // rather than passing unexercised as "not a refusal".
    expect(NO_COMMIT_MODES.length).toBeGreaterThan(0);
    expect([...routed].sort()).toEqual(["clean-exit", "render-refused"]);
    expect(routed.length).toBeLessThan(NO_COMMIT_MODES.length);
  });

  it("reads a refusal off one entry of a wave whose siblings shipped", () => {
    const handoff = defaultHandoff(ladder());

    // A wave where anything shipped reports no wave-level `noCommit` at all,
    // so the sibling's refusal is visible only per entry.
    const mixed = tickResult({
      shippedTags: ["SHIPPED"],
      pickableAfter: [entry("REFUSED")],
      entries: [
        outcome({ tag: "SHIPPED" }),
        outcome({ tag: "REFUSED", committed: false, shipped: false, noCommit: "clean-exit" }),
      ],
    });
    expect(mixed.noCommit).toBeUndefined();
    expect(handoff(mixed)).toEqual([INBOX_PHASE]);
  });

  it("asks each slice's window with the tick's own state root and pickable verdict", () => {
    const inbox = slice(INBOX_PHASE, false);
    const handoff = defaultHandoff(ladder(inbox));

    handoff(tickResult({ pickableAfter: [entry("READY")] }));
    expect(inbox.asked).toEqual([{ flumeDir: FLUME_DIR, pickable: true }]);

    handoff(tickResult({ pickableAfter: [] }));
    expect(inbox.asked[1]).toEqual({ flumeDir: FLUME_DIR, pickable: false });
  });

  it("refuses a slice set with nothing to route a build refusal to", () => {
    expect(() => defaultHandoff([slice(DERIVE, true), slice(SWEEP, true)])).toThrow(
      new RegExp(`${INBOX_PHASE}[\\s\\S]*${DERIVE}, ${SWEEP}`),
    );

    // The same set with the refusal's target present constructs fine — the
    // refusal is about that slice's absence, not about the set's shape.
    expect(() =>
      defaultHandoff([slice(INBOX_PHASE), slice(DERIVE), slice(SWEEP)]),
    ).not.toThrow();
  });
});

describe("the default handoff's stop after a contract-touching ship", () => {
  let flumeDir: string;

  beforeEach(() => {
    flumeDir = mkTempDirSync("flume-handoff-stop-");
  });
  afterEach(() => {
    rmSync(flumeDir, { recursive: true, force: true });
  });

  /** Whether the graceful-stop flag stands in this case's state root. */
  const stopped = (): boolean => existsSync(namespacedJoin(stopFlagPath(flumeDir)));

  /** A build wave over the case's real state root, with work still queued. */
  const wave = (...entries: FanoutEntryOutcome[]): TickResult =>
    tickResult({
      flumeDir,
      shippedTags: entries.filter((e) => e.shipped).map((e) => e.tag),
      pickableAfter: [entry("READY")],
      entries,
    });

  it("the default handoff writes the stop flag after a contractTouching entry ships", () => {
    const handoff = defaultHandoff(ladder());
    const shipped = wave(
      outcome({ tag: "CONTRACT", extension: { [CONTRACT_TOUCHING_FIELD]: true } }),
    );

    // The flag is the tick's doing, not the fixture's: nothing wrote it into
    // the fresh state root before the handoff ran.
    expect(stopped()).toBe(false);

    // Routing is untouched — the queue still holds pickable work and the
    // ladder still names build. The run ends at the supervisor's next tick
    // boundary, with build awake for the relaunch.
    expect(shipped.pickableAfter.length).toBeGreaterThan(0);
    expect(handoff(shipped)).toEqual([BUILD_PHASE]);
    expect(stopped()).toBe(true);
  });

  it("the default handoff writes no stop flag when no shipped entry is contractTouching", () => {
    const handoff = defaultHandoff(ladder());

    // An unmarked ship: the ordinary wave, which must leave the loop running.
    expect(handoff(wave(outcome({ tag: "PLAIN" })))).toEqual([BUILD_PHASE]);
    expect(stopped()).toBe(false);

    // Marked but never shipped — a park — is also "no shipped entry is
    // contractTouching": the mark alone does not end the run, and this one
    // routes to the inbox exactly as an unmarked park does.
    const parked = wave(
      outcome({
        tag: "CONTRACT",
        shipped: false,
        mergeOutcome: "not-shipped",
        extension: { [CONTRACT_TOUCHING_FIELD]: true },
      }),
    );
    expect(handoff(parked)).toEqual([INBOX_PHASE]);
    expect(stopped()).toBe(false);

    // The control for both: the same wave with the one fact changed does
    // write the flag, so the absences above are the missing ship and the
    // missing mark — not a handoff that never writes at all.
    expect(
      handoff(wave(outcome({ tag: "CONTRACT", extension: { [CONTRACT_TOUCHING_FIELD]: true } }))),
    ).toEqual([BUILD_PHASE]);
    expect(stopped()).toBe(true);
  });

  it("a singleton slice's tick writes no stop flag", () => {
    const handoff = defaultHandoff(ladder(slice(DERIVE, true)));

    // A plan slice reports no `entries` at all, so the mark has nowhere to
    // be read from and the write is scoped to a fanout wave by that fact
    // rather than by a branch on the phase name.
    const planned = tickResult({ flumeDir, phaseName: DERIVE, committed: true });
    expect(planned.entries).toBeUndefined();
    expect(handoff(planned)).toEqual([DERIVE]);
    expect(stopped()).toBe(false);
  });
});

/**
 * The per-entry half of the same routing decision (`spec/harness.md`, *The
 * default `handoff`*): which entries the engine may hand a build wave, judged
 * from the record it already read and the tip it read it at.
 *
 * Every case drives the real `defaultRefusesEntry` over a real
 * `EntryRefusalContext` — the shape the engine composes at selection
 * (`bindEntryRefusal`, `src/selection.ts`) — with records built through the
 * engine's own `PriorAttempt` union, so a field it renames is a typecheck
 * failure here rather than a silently-undefined read.
 *
 * Each refusal carries its control: the same record with the one fact changed
 * — a different anchor, a different mode — so "refused" is proven to be that
 * fact's doing rather than the predicate's answer for the whole fixture.
 */
describe("the default handoff's per-entry refusal", () => {
  /** The tip every selection below is taken at. */
  const HEAD = "9".repeat(40);

  /** Some earlier tip — a world that has moved since the record was written. */
  const OLDER = "1".repeat(40);

  /**
   * One prior-attempt record at the given anchor, minted through the engine's
   * own union. Exhaustive over `PriorAttempt["mode"]`, so a mode the engine
   * adds must be given a fixture here before these cases can judge it.
   */
  function attempt(mode: PriorAttempt["mode"], headSha: string): PriorAttempt {
    const anchor = {
      key: "entry" as const,
      keyedAs: "some-entry",
      headSha,
      at: "2026-09-16T00:00:00.000Z",
    };
    switch (mode) {
      case "clean-exit":
        return { mode, finalMessage: "nothing to do here", ...anchor };
      case "gate-revert":
        return {
          mode,
          when: "afterCommit",
          gate: "tsc",
          message: "failed",
          diffStat: "",
          ...anchor,
        };
      case "platform-preempt":
        return { mode, failureClass: "timeout", ...anchor };
      case "render-refused":
        return { mode, failures: "span failed", ...anchor };
      case "not-shipped":
        return { mode, mergedSha: "a".repeat(40), touchedPaths: [], ...anchor };
      case "tip-moved":
        return {
          mode,
          expectedTip: "b".repeat(40),
          observedTip: "c".repeat(40),
          ...anchor,
        };
    }
  }

  /** The context the engine composes for one entry, at {@link HEAD}. */
  const context = (priorAttempt?: PriorAttempt): EntryRefusalContext => ({
    entry: entry("SOME-ENTRY"),
    ...(priorAttempt ? { priorAttempt } : {}),
    headSha: HEAD,
  });

  it("an entry whose latest clean exit is at the current HEAD is not handed to build", () => {
    const record = attempt("clean-exit", HEAD);

    // Non-vacuity: the record really is anchored at the tip the selection is
    // taken at, so the refusal below is the comparison and not a predicate
    // that refuses every clean exit it sees.
    expect(record.headSha).toBe(HEAD);

    expect(defaultRefusesEntry(context(record))).toBe(true);
  });

  it("an entry whose latest clean exit is at an older HEAD is handed to build", () => {
    // The same mode against a world that has moved: the agent's decision was
    // about a tree that is no longer there, so the entry is the wave's again
    // without anyone editing the queue.
    expect(defaultRefusesEntry(context(attempt("clean-exit", OLDER)))).toBe(false);

    // The control: only the anchor differs between this and the refusal above.
    expect(attempt("clean-exit", OLDER)).toEqual({
      ...attempt("clean-exit", HEAD),
      headSha: OLDER,
    });
  });

  it("an entry whose latest attempt is a gate revert at the current HEAD is handed to build", () => {
    // The anchor matches; the mode does not. A reverted commit left the
    // gate's own verdict on the record, which is a fact the next attempt
    // reads and the tree it reads it against never had to move.
    expect(defaultRefusesEntry(context(attempt("gate-revert", HEAD)))).toBe(false);
  });

  it("every mode but a clean exit is handed to build at the current HEAD", () => {
    const modes = PRIOR_ATTEMPT_MODES.filter((mode) => mode !== "clean-exit");

    // Non-vacuity: the sweep judges the engine's whole roster minus the one
    // refused mode, so a roster that collapsed would pass over nothing.
    expect(modes.length).toBeGreaterThan(0);

    expect(
      modes.filter((mode) => defaultRefusesEntry(context(attempt(mode, HEAD)))),
    ).toEqual([]);
  });

  it("an entry nothing has attempted yet is handed to build", () => {
    // A first attempt carries no record at all — the engine passes one only
    // where one stands (`bindEntryRefusal`, `src/selection.ts`).
    const first = context();
    expect(first).not.toHaveProperty("priorAttempt");
    expect(defaultRefusesEntry(first)).toBe(false);
  });
});
