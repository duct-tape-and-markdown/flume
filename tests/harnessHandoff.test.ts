/**
 * The harness package's default handoff (`spec/harness.md`, *The default
 * `handoff`*): the wake set it reads off one tick's reported facts, the one
 * slice that set leaves out, and the declaration that replaces it.
 *
 * Every case drives the real `defaultHandoff` over a real `TickResult`. The
 * facts it reads are the engine's own — `pickableAfter`, `phaseName`,
 * `committed`, `noCommit`, `entries[].mergeOutcome` — so the fixtures here
 * are typed as `TickResult` rather than as the subset this module happens to
 * touch: a field the engine renames is a typecheck failure in these cases,
 * not a silently-undefined read.
 *
 * Each case carries its control — the same result with the one fact changed
 * — so "the inbox is in the set" is proven to be that fact's doing and not
 * the answer this handoff gives the whole fixture.
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
import { entryDeclaredKey } from "../src/entryKey.ts";
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

/** One queue entry — the handoff reads only whether the set is non-empty. */
const entry = (tag: string): PendingEntry => ({
  tag,
  gate: { kind: "open" },
  dependsOnForks: [],
  priority: 0,
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
const sliceSet = (
  ...over: HandoffSlice[]
): HandoffSlice[] => {
  const byName = new Map<PlanSlice, HandoffSlice>(over.map((s) => [s.name, s]));
  return [INBOX_PHASE, DERIVE, SWEEP].map(
    (name) => byName.get(name) ?? slice(name, false),
  );
};

describe("the harness package's default handoff", () => {
  it("the default handoff names every live slice and build in one answer", () => {
    const handoff = defaultHandoff(sliceSet(slice(INBOX_PHASE, true), slice(SWEEP, true)));

    // Two open windows and a pickable queue: three phases the next tick may
    // run, and nothing here to choose between them — which of them run at
    // once is the supervisor's budget, and which runs first is the chain's
    // declared order.
    const result = tickResult({ pickableAfter: [entry("READY")] });
    expect(result.pickableAfter.length).toBeGreaterThan(0);
    expect(handoff(result)).toEqual([INBOX_PHASE, SWEEP, BUILD_PHASE]);

    // The control, one fact at a time: each name in that answer is the leg
    // that put it there, not a set this handoff returns for any fixture.
    const noSweep = defaultHandoff(sliceSet(slice(INBOX_PHASE, true)));
    expect(noSweep(result)).toEqual([INBOX_PHASE, BUILD_PHASE]);
    expect(handoff(tickResult({ pickableAfter: [] }))).toEqual([
      INBOX_PHASE,
      SWEEP,
    ]);
  });

  it("the default handoff names build when no slice is live and the engine reports a pickable entry", () => {
    const handoff = defaultHandoff(sliceSet());

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
    const handoff = defaultHandoff(sliceSet());

    // A queue that still holds an entry the dispatcher did not report as
    // pickable is the case hibernation must survive: reading `pendingAfter`
    // here instead would wake build over work it cannot take.
    const result = tickResult({
      pendingAfter: [entry("BLOCKED")],
      pickableAfter: [],
    });

    expect(handoff(result)).toEqual([]);
  });

  it("a build tick the chain declined wakes the inbox slice beside build", () => {
    const handoff = defaultHandoff(sliceSet());
    const pickable = { pickableAfter: [entry("PARKED")] };

    // A commit that landed and passed every gate which `shipped` declined:
    // the park. Its reason is in the note the tick wrote, and only a plan
    // slice can act on it — so the inbox joins the set. Build stays in it:
    // the walled entry is held back per entry, and the queue's other work is
    // still the wave's.
    const parked = tickResult({
      ...pickable,
      entries: [outcome({ tag: "PARKED", shipped: false, mergeOutcome: "not-shipped" })],
    });
    expect(handoff(parked)).toEqual([INBOX_PHASE, BUILD_PHASE]);

    // The control: the same wave with the park's one fact changed leaves the
    // inbox out, so the wake above is the refusal's doing.
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

  it("a build tick whose prompt never rendered wakes the inbox slice", () => {
    const handoff = defaultHandoff(sliceSet());
    const walled = tickResult({
      committed: false,
      noCommit: "render-refused",
      pickableAfter: [entry("UNRENDERABLE")],
    });

    // Nothing about the tree changes between attempts on a refused render,
    // so a set with no producer in it is the wall, forever.
    expect(handoff(walled)).toEqual([INBOX_PHASE, BUILD_PHASE]);

    // The control: a reverted commit is worth retrying from the same queue,
    // and asks no producer for anything.
    const reverted = tickResult({
      committed: false,
      noCommit: "gate-revert",
      pickableAfter: [entry("UNRENDERABLE")],
    });
    expect(handoff(reverted)).toEqual([BUILD_PHASE]);
  });

  it("the slice that just ran and committed nothing is not re-woken", () => {
    const handoff = defaultHandoff(sliceSet(slice(DERIVE, true), slice(SWEEP, true)));
    const ran = { phaseName: DERIVE, pickableAfter: [entry("READY")] };

    // Committed nothing: its window is open for the reason it was open last
    // tick, so naming itself would spend the run on the same wall. Its live
    // sibling and build are in the answer regardless — the exception takes
    // one name out of the set, it does not collapse the set to one.
    expect(handoff(tickResult({ ...ran, committed: false }))).toEqual([
      SWEEP,
      BUILD_PHASE,
    ]);

    // Committed: a window larger than one tick's budget is progress, and the
    // slice re-wakes itself beside the same two.
    expect(handoff(tickResult({ ...ran, committed: true }))).toEqual([
      DERIVE,
      SWEEP,
      BUILD_PHASE,
    ]);

    // And the exception is the slice's, never build's: a wave that committed
    // nothing because a gate reverted it is the one the next tick retries.
    expect(
      handoff(
        tickResult({
          phaseName: BUILD_PHASE,
          committed: false,
          noCommit: "gate-revert",
          pickableAfter: [entry("READY")],
        }),
      ),
    ).toEqual([DERIVE, SWEEP, BUILD_PHASE]);
  });

  it("a declared handoff is resolved per phase, never wholesale", () => {
    const slices = sliceSet(slice(INBOX_PHASE, true));
    const declaredBuild: Handoff = () => [SWEEP];
    const declared = { [BUILD_PHASE]: declaredBuild };

    // The default would name the live inbox slice for either phase; the
    // declaration replaces that decision outright for the phase it names.
    expect(defaultHandoff(slices)(tickResult())).toEqual([INBOX_PHASE]);
    expect(
      resolveHandoff({ phase: BUILD_PHASE, declared, slices })(tickResult()),
    ).toEqual([SWEEP]);

    // Per phase: a phase the declaration does not name keeps the package's
    // own answer rather than inheriting build's override.
    expect(
      resolveHandoff({ phase: INBOX_PHASE, declared, slices })(
        tickResult({ phaseName: INBOX_PHASE, committed: true }),
      ),
    ).toEqual([INBOX_PHASE]);

    // No declaration at all is the default, same as naming no phase.
    expect(resolveHandoff({ phase: BUILD_PHASE, slices })(tickResult())).toEqual([
      INBOX_PHASE,
    ]);
  });

  it("a consumer's declared handoff replaces the wake set and still runs beneath the per-entry refusal", () => {
    const slices = sliceSet(slice(INBOX_PHASE, true), slice(SWEEP, true));
    const declaredBuild: Handoff = () => [SWEEP];
    const result = tickResult({ pickableAfter: [entry("READY")] });

    // What the declaration displaces, stated: the package's answer for this
    // same result names three phases, and the consumer's names one.
    expect(defaultHandoff(slices)(result)).toEqual([
      INBOX_PHASE,
      SWEEP,
      BUILD_PHASE,
    ]);
    expect(
      resolveHandoff({
        phase: BUILD_PHASE,
        declared: { [BUILD_PHASE]: declaredBuild },
        slices,
      })(result),
    ).toEqual([SWEEP]);

    // And what it does not displace: the per-entry refusal is the package's
    // floor on the chain's own surface, so an entry walled at this very tip
    // is no more dispatchable for the consumer having named build's next
    // phases itself. Re-dispatching it is the same outcome whoever schedules.
    const head = "9".repeat(40);
    const walled: PriorAttempt = {
      mode: "clean-exit",
      finalMessage: "nothing to do here",
      key: "entry",
      keyedAs: "ready",
      declaredAs: entryDeclaredKey(entry("READY")),
      headSha: head,
      at: "2026-09-16T00:00:00.000Z",
    };
    const ctx = {
      entry: entry("READY"),
      headSha: head,
      declaredAs: entryDeclaredKey(entry("READY")),
    };
    expect(defaultRefusesEntry({ ...ctx, priorAttempt: walled })).toBe(true);

    // Non-vacuity for that floor: the same predicate hands over an entry
    // nothing has walled on, so the refusal above is the record's doing.
    expect(defaultRefusesEntry(ctx)).toBe(false);
  });
});

describe("the default handoff's reading of the engine's facts", () => {
  it("wakes the inbox on exactly the no-commit modes only a plan slice can resolve", () => {
    const handoff = defaultHandoff(sliceSet());
    const routed = NO_COMMIT_MODES.filter((mode: NoCommitMode) =>
      handoff(
        tickResult({
          committed: false,
          noCommit: mode,
          pickableAfter: [entry("READY")],
        }),
      ).includes(INBOX_PHASE),
    );

    // Read off the engine's own list, so a mode it gains is classified here
    // rather than passing unexercised as "not a refusal".
    expect(NO_COMMIT_MODES.length).toBeGreaterThan(0);
    expect([...routed].sort()).toEqual(["clean-exit", "render-refused"]);
    expect(routed.length).toBeLessThan(NO_COMMIT_MODES.length);
  });

  it("reads a refusal off one entry of a wave whose siblings shipped", () => {
    const handoff = defaultHandoff(sliceSet());

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
    expect(handoff(mixed)).toEqual([INBOX_PHASE, BUILD_PHASE]);
  });

  it("asks each slice's window with the tick's own state root and pickable verdict", () => {
    const inbox = slice(INBOX_PHASE, false);
    const handoff = defaultHandoff(sliceSet(inbox));

    handoff(tickResult({ pickableAfter: [entry("READY")] }));
    expect(inbox.asked).toEqual([{ flumeDir: FLUME_DIR, pickable: true }]);

    handoff(tickResult({ pickableAfter: [] }));
    expect(inbox.asked[1]).toEqual({ flumeDir: FLUME_DIR, pickable: false });
  });

  it("refuses a slice set with nothing to wake on a build refusal", () => {
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
    const handoff = defaultHandoff(sliceSet());
    const shipped = wave(
      outcome({ tag: "CONTRACT", extension: { [CONTRACT_TOUCHING_FIELD]: true } }),
    );

    // The flag is the tick's doing, not the fixture's: nothing wrote it into
    // the fresh state root before the handoff ran.
    expect(stopped()).toBe(false);

    // The wake set is untouched — the queue still holds pickable work and
    // build is still in the answer. The run ends at the supervisor's next
    // tick boundary, with build awake for the relaunch.
    expect(shipped.pickableAfter.length).toBeGreaterThan(0);
    expect(handoff(shipped)).toEqual([BUILD_PHASE]);
    expect(stopped()).toBe(true);
  });

  it("the default handoff writes no stop flag when no shipped entry is contractTouching", () => {
    const handoff = defaultHandoff(sliceSet());

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
    expect(handoff(parked)).toEqual([INBOX_PHASE, BUILD_PHASE]);
    expect(stopped()).toBe(false);

    // The control for both: the same wave with the one fact changed does
    // write the flag, so the absences above are the missing ship and the
    // missing mark — not a handoff that never writes at all.
    expect(
      handoff(wave(outcome({ tag: "CONTRACT", extension: { [CONTRACT_TOUCHING_FIELD]: true } }))),
    ).toEqual([BUILD_PHASE]);
    expect(stopped()).toBe(true);
  });

  it("a consumer's declared handoff still writes the stop flag", () => {
    const declared: Handoff = () => [];
    const handoff = resolveHandoff({
      phase: BUILD_PHASE,
      declared: { [BUILD_PHASE]: declared },
      slices: sliceSet(),
    });
    const shipped = wave(
      outcome({ tag: "CONTRACT", extension: { [CONTRACT_TOUCHING_FIELD]: true } }),
    );

    // The consumer's answer stands — no phase woken, which the package's own
    // would never say over a queue with pickable work in it — and the write
    // beneath it happened anyway: the mark is the package's entry extension,
    // and declaring a handoff is not a request to opt out of it.
    expect(stopped()).toBe(false);
    expect(handoff(shipped)).toEqual([]);
    expect(stopped()).toBe(true);
  });

  it("a singleton slice's tick writes no stop flag", () => {
    const handoff = defaultHandoff(sliceSet(slice(DERIVE, true)));

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
 * from the record it already read and the declaration it read that record
 * against.
 *
 * Every case drives the real `defaultRefusesEntry` over a real
 * `EntryRefusalContext` — the shape the engine composes at selection
 * (`bindEntryRefusal`, `src/selection.ts`) — with records built through the
 * engine's own `PriorAttempt` union and keyed through the engine's own
 * `entryDeclaredKey` (`src/entryKey.ts`), so neither a field it renames nor a
 * key it derives differently can leave a case green on the tester's own
 * spelling.
 *
 * Each refusal carries its control: the same record with the one fact changed
 * — a different declaration, a different mode — so "refused" is proven to be
 * that fact's doing rather than the predicate's answer for the whole fixture.
 */
describe("the default handoff's per-entry refusal", () => {
  /** The tip the first selection below is taken at. */
  const HEAD = "9".repeat(40);

  /** A later tip: an operator commit has landed since the record was written. */
  const MOVED = "1".repeat(40);

  /** The entry every case is about, as a producer first declared it. */
  const DECLARED = entry("SOME-ENTRY");

  /**
   * The same entry after a producer rewrote it — the reconciliation the
   * refusal is waiting for, and the only kind of change that lifts it.
   */
  const REWRITTEN: PendingEntry = {
    ...DECLARED,
    summary: "re-scoped: the fence the first attempt asked for",
  };

  /**
   * One prior-attempt record standing against the given declaration, minted
   * through the engine's own union. Exhaustive over `PriorAttempt["mode"]`, so
   * a mode the engine adds must be given a fixture here before these cases can
   * judge it.
   *
   * `headSha` is the tip the record was written at, defaulting to the one the
   * first selection is taken at: a case about a moved tip moves the *selection*
   * instead, which is what actually happens when a commit lands.
   */
  function attempt(
    mode: PriorAttempt["mode"],
    declaration: PendingEntry = DECLARED,
  ): PriorAttempt {
    const anchor = {
      key: "entry" as const,
      keyedAs: "some-entry",
      declaredAs: entryDeclaredKey(declaration),
      headSha: HEAD,
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

  /**
   * The context the engine composes for one entry at one tip — both keys read
   * off the engine's own derivation, never spelled here.
   */
  const context = (
    priorAttempt?: PriorAttempt,
    over: { entry?: PendingEntry; headSha?: string } = {},
  ): EntryRefusalContext => {
    const subject = over.entry ?? DECLARED;
    return {
      entry: subject,
      ...(priorAttempt ? { priorAttempt } : {}),
      headSha: over.headSha ?? HEAD,
      declaredAs: entryDeclaredKey(subject),
    };
  };

  it("an entry whose latest clean exit stands against its current declaration is not handed to build", () => {
    const record = attempt("clean-exit");

    // Non-vacuity: the record really does stand against the declaration this
    // selection is about, so the refusal below is the comparison and not a
    // predicate that refuses every clean exit it sees.
    expect(record.declaredAs).toBe(entryDeclaredKey(DECLARED));

    expect(defaultRefusesEntry(context(record))).toBe(true);
  });

  it("a standing build refusal survives an operator commit that moves the tip", () => {
    // An operator commit, a docs fix, a sibling entry shipping: the tip the
    // selection is taken at is no longer the tip the record was written at,
    // and nothing about the entry was reconciled. The refusal is about the
    // declaration, so it still stands — a build wave re-offered this entry
    // would read exactly what the last one declined.
    const record = attempt("clean-exit");
    const moved = context(record, { headSha: MOVED });

    // Non-vacuity: the tip really did move, and the declaration really did
    // not — the two halves this case separates.
    expect(moved.headSha).not.toBe(record.headSha);
    expect(moved.declaredAs).toBe(record.declaredAs);

    expect(defaultRefusesEntry(moved)).toBe(true);
  });

  it("a producer's rewrite of the refused entry lifts the refusal", () => {
    // The reconciliation the refusal was waiting for: the producer read the
    // record and re-scoped the entry. The rewrite hashes to a new key, the
    // record no longer stands against what the queue declares, and the entry
    // is the wave's again with no tip having moved and nobody hand-editing a
    // record.
    const record = attempt("clean-exit");
    const rewritten = context(record, { entry: REWRITTEN });

    // Non-vacuity: the rewrite really did re-key the entry, and the tip
    // really did not move.
    expect(rewritten.declaredAs).not.toBe(record.declaredAs);
    expect(rewritten.headSha).toBe(record.headSha);

    expect(defaultRefusesEntry(rewritten)).toBe(false);

    // The control: the same record against the declaration it was written
    // for is still refused, so the lift above is the rewrite's doing.
    expect(defaultRefusesEntry(context(record))).toBe(true);
  });

  it("an entry whose latest attempt is a gate revert is handed to build", () => {
    // The declaration matches; the mode does not. A reverted commit left the
    // gate's own verdict on the record, which is a fact the next attempt
    // reads without any producer touching the entry.
    expect(defaultRefusesEntry(context(attempt("gate-revert")))).toBe(false);
  });

  it("every mode but a clean exit is handed to build against the same declaration", () => {
    const modes = PRIOR_ATTEMPT_MODES.filter((mode) => mode !== "clean-exit");

    // Non-vacuity: the sweep judges the engine's whole roster minus the one
    // refused mode, so a roster that collapsed would pass over nothing.
    expect(modes.length).toBeGreaterThan(0);

    expect(
      modes.filter((mode) => defaultRefusesEntry(context(attempt(mode)))),
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
