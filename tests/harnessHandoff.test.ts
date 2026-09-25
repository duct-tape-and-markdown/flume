/**
 * The harness package's default handoff (`spec/harness.md`, *The default
 * `handoff`*): the wake set it reads off one tick's reported facts, the one
 * slice that set leaves out, and the declaration that replaces it.
 *
 * Every case drives the real `defaultHandoff` over a real `TickResult`. The
 * facts it reads are the engine's own — `pickableAfter`, `phaseName`,
 * `committed`, `pendingAfter`, `priorAttempts` — so the fixtures here are
 * typed as `TickResult` rather than as the subset this module happens to
 * touch: a field the engine renames is a typecheck failure in these cases,
 * not a silently-undefined read.
 *
 * What the wake set does with a standing refusal is *carry it*, never
 * classify it: which modes only a plan slice can resolve is the inbox
 * window's question, and the two surfaces are held to one answer in
 * `tests/harnessWindows.test.ts`. So the cases below stand the inbox slice
 * up around the real classifier ({@link refusalReader}) and ask what the
 * handoff hands it.
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
import { continuingNotePath, parkedNotePath } from "../harness/layout.ts";
import { standingRefusals } from "../harness/standingRefusal.ts";
import { entryDeclaredKey } from "../src/entryKey.ts";
import {
  buildNotShipped,
  entryAttemptKey,
  recordAttemptKey,
} from "../src/priorAttempts.ts";
import type {
  EntryRefusalContext,
  FanoutEntryOutcome,
  TickResult,
} from "../src/Phase.ts";
import { namespacedJoin, slugify, stopFlagPath } from "../src/paths.ts";
import type { PendingEntry } from "../src/PendingSchema.ts";
import { PRIOR_ATTEMPT_MODES, type PriorAttempt } from "../src/Prompt.ts";

import { mkTempDirSync } from "./helpers/fixtureRoot.ts";

const DERIVE = "plan-derive" as const satisfies PlanSlice;
const SWEEP = "plan-sweep" as const satisfies PlanSlice;

/** The state root every fixture reports, distinct enough to be recognized. */
const FLUME_DIR = "/tmp/flume-handoff-fixture/.flume";

/**
 * The same state root as the repository addresses it — the offset
 * `api.paths.stateRootRel` reports, which is the alphabet a commit's touched
 * paths arrive in and the one a build tick's notes are composed in.
 */
const STATE_ROOT_REL = ".flume";

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
    // A drained store is the neutral fixture: every case that is about a
    // refusal says so by putting a record in it.
    priorAttempts: new Map(),
    flumeDir: FLUME_DIR,
    configDir: "/tmp/flume-handoff-fixture/.flume",
    shippedTags: [],
    revertedTags: [],
    ...overrides,
  };
}

/**
 * The anchor the engine stamps on a fanout record (`priorAttemptRef`,
 * `src/priorAttempts.ts`): the `entry` keyspace, keyed by the tag's slug.
 *
 * Its own name because two builders take it — {@link record} for a body
 * written by hand, and the elided case below for one the real writer
 * produced — and a record filed under a second spelling of the identity
 * would be looked up by nothing the classifier walks.
 */
const entryAnchor = (tag: string) =>
  ({
    key: "entry",
    keyedAs: slugify(tag),
    headSha: "0".repeat(40),
    at: "2026-09-16T00:00:00.000Z",
  }) as const;

/**
 * One standing prior-attempt record for `tag`, anchored as {@link entryAnchor}
 * says.
 *
 * Every mode, because the classifier the slices read discriminates on this
 * field and a fixture that can only build one of them judges the wake set
 * over one arm.
 *
 * `touched` is the footprint the engine records beside a declined ship — the
 * same list the `shipped` predicate was handed (`buildNotShipped`,
 * `src/priorAttempts.ts`) — and the `not-shipped` arm is the only one that
 * carries it, because it is the only mode whose two kinds differ in nothing
 * else. Empty by default, which is the footprint of a case that is about the
 * mode alone.
 */
function record(
  tag: string,
  mode: PriorAttempt["mode"],
  touched: readonly string[] = [],
): PriorAttempt {
  const anchored = entryAnchor(tag);
  switch (mode) {
    case "not-shipped":
      return {
        mode,
        mergedSha: "a".repeat(40),
        touchedPaths: [...touched],
        ...anchored,
      };
    case "clean-exit":
      return {
        mode,
        finalMessage: "nothing to do here",
        spanBase: "1".repeat(40), spanHead: "1".repeat(40),
        ...anchored,
      };
    case "gate-revert":
      return {
        mode,
        when: "afterCommit",
        gate: "tsc",
        message: "failed",
        diffStat: "",
        ...anchored,
      };
    case "platform-preempt":
      return { mode, failureClass: "timeout", ...anchored };
    case "render-refused":
      return { mode, failures: "span failed", ...anchored };
    case "tip-moved":
      return {
        mode,
        expectedTip: "b".repeat(40),
        observedTip: "c".repeat(40),
        ...anchored,
      };
  }
}

/**
 * The record store as a tick left it, filed under the engine's own key for
 * each record (`recordAttemptKey`, `src/priorAttempts.ts`) rather than under
 * the two halves of that key respelled here — the same keying `readAll`
 * files a real store under, so these fixtures cannot agree with the reader
 * on a spelling the engine does not use.
 */
const store = (
  ...records: readonly PriorAttempt[]
): ReadonlyMap<string, PriorAttempt> =>
  new Map(records.map((rec) => [recordAttemptKey(rec), rec]));

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

/**
 * The inbox slice on the one leg these cases are about: a window that opens
 * over a standing refusal, read through the real `standingRefusals`
 * (`harness/standingRefusal.ts`) rather than a mode table respelled here.
 *
 * The rest of `inboxWindow`'s legs read a state root on disk, which this
 * file's fixtures are deliberately without — so the slice is stood up around
 * the classifier, and that the whole window agrees with the handoff over
 * every mode is the windows suite's case.
 */
const refusalReader = (): HandoffSlice & { asked: SliceWindow[] } =>
  slice(
    INBOX_PHASE,
    (window) =>
      standingRefusals(STATE_ROOT_REL, window.pending, window.priorAttempts)
        .length > 0,
  );

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

  it("the default handoff routes a walled entry to the inbox off the reported record set", () => {
    const handoff = defaultHandoff(sliceSet(refusalReader()));
    const queued = {
      pendingAfter: [entry("PARKED")],
      pickableAfter: [entry("PARKED")],
    };

    // A commit that landed and passed every gate which `shipped` declined:
    // the park. Its reason is in the note the tick wrote, and only a plan
    // slice can act on it — so the inbox joins the set. Build stays in it:
    // the walled entry is held back per entry, and the queue's other work is
    // still the wave's.
    //
    // The evidence is the store the engine reports, never this wave's own
    // fates: the tick below reports a clean wave — `committed`, no
    // `noCommit`, every entry `merged` — so an answer carrying the inbox can
    // only have come off the record.
    const parked = tickResult({
      ...queued,
      priorAttempts: store(record("PARKED", "not-shipped")),
      entries: [outcome({ tag: "PARKED" })],
    });
    expect(parked.noCommit).toBeUndefined();
    expect(parked.entries!.every((e) => e.mergeOutcome === "merged")).toBe(true);
    expect(parked.priorAttempts.size).toBe(1);
    expect(handoff(parked)).toEqual([INBOX_PHASE, BUILD_PHASE]);

    // The control, one fact at a time: the same tick with the store drained
    // — which is what a clean ship leaves behind — keeps the inbox out.
    expect(handoff(tickResult({ ...queued, entries: [outcome({ tag: "PARKED" })] }))).toEqual([
      BUILD_PHASE,
    ]);

    // And a record whose entry has left the queue is not this slice's work:
    // it outlived what it was about, so the same record over a drained queue
    // wakes nobody.
    const departed = tickResult({
      pendingAfter: [],
      pickableAfter: [],
      priorAttempts: store(record("PARKED", "not-shipped")),
    });
    expect(departed.priorAttempts.size).toBe(1);
    expect(handoff(departed)).toEqual([]);
  });

  it("a build tick whose prompt never rendered wakes the inbox slice", () => {
    const handoff = defaultHandoff(sliceSet(refusalReader()));
    const queued = {
      pendingAfter: [entry("UNRENDERABLE")],
      pickableAfter: [entry("UNRENDERABLE")],
    };
    const walled = tickResult({
      ...queued,
      committed: false,
      noCommit: "render-refused",
      priorAttempts: store(record("UNRENDERABLE", "render-refused")),
    });

    // Nothing about the tree changes between attempts on a refused render,
    // so a set with no producer in it is the wall, forever.
    expect(handoff(walled)).toEqual([INBOX_PHASE, BUILD_PHASE]);

    // The control: a reverted commit is worth retrying from the same queue,
    // and asks no producer for anything. Both the tick's fate and the record
    // it left move together, because the engine stamps the one onto the
    // other.
    const reverted = tickResult({
      ...queued,
      committed: false,
      noCommit: "gate-revert",
      priorAttempts: store(record("UNRENDERABLE", "gate-revert")),
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
      spanBase: "1".repeat(40),
      spanHead: "1".repeat(40),
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
  it("a standing refusal left by a plan tick puts the inbox slice in the wake set", () => {
    const handoff = defaultHandoff(sliceSet(refusalReader()));
    const queued = {
      pendingAfter: [entry("PARKED")],
      pickableAfter: [entry("PARKED")],
      priorAttempts: store(record("PARKED", "not-shipped")),
    };

    // The record outlives the wave that wrote it, so which phase happens to
    // report it decides nothing: a plan slice's own tick reports the same
    // store, and the entry behind it is still waiting on a producer.
    const planTick = tickResult({ ...queued, phaseName: DERIVE });
    expect(planTick.phaseName).not.toBe(BUILD_PHASE);
    expect(handoff(planTick)).toEqual([INBOX_PHASE, BUILD_PHASE]);

    // The same answer off a build tick: the set is one window's reading of
    // the facts the tick reported, never a branch on who reported them.
    expect(handoff(tickResult({ ...queued }))).toEqual([
      INBOX_PHASE,
      BUILD_PHASE,
    ]);

    // The control, one fact at a time: the same plan tick with the store
    // drained keeps the inbox out, so the name above is the record's doing
    // and not the phase's.
    expect(
      handoff(
        tickResult({ ...queued, phaseName: DERIVE, priorAttempts: new Map() }),
      ),
    ).toEqual([BUILD_PHASE]);
  });

  it("reads a refusal off one entry of a wave whose siblings shipped", () => {
    const handoff = defaultHandoff(sliceSet(refusalReader()));

    // A wave where anything shipped reports no wave-level `noCommit` at all,
    // and the shipped entry's own record is cleared — so the only thing left
    // saying a producer is owed anything is the sibling's standing record.
    const mixed = tickResult({
      shippedTags: ["SHIPPED"],
      pendingAfter: [entry("REFUSED")],
      pickableAfter: [entry("REFUSED")],
      priorAttempts: store(record("REFUSED", "clean-exit")),
      entries: [
        outcome({ tag: "SHIPPED" }),
        outcome({ tag: "REFUSED", committed: false, shipped: false, noCommit: "clean-exit" }),
      ],
    });
    expect(mixed.noCommit).toBeUndefined();
    expect(handoff(mixed)).toEqual([INBOX_PHASE, BUILD_PHASE]);
  });

  it("asks each slice's window with every fact the tick reported and nothing else", () => {
    const inbox = slice(INBOX_PHASE, false);
    const handoff = defaultHandoff(sliceSet(inbox));
    const queue = [entry("READY")];
    const records = store(record("READY", "not-shipped"));

    handoff(
      tickResult({
        pendingAfter: queue,
        pickableAfter: queue,
        priorAttempts: records,
      }),
    );

    // The whole window, not a subset of it: a slice's liveness leg reads the
    // queue and the store off this object, so a fact the handoff failed to
    // carry is a window answering `false` where the same slice's `shouldRun`
    // consult answers `true` — and nothing about either verdict would say so.
    expect(inbox.asked).toEqual([
      {
        flumeDir: FLUME_DIR,
        pickable: true,
        pending: queue,
        priorAttempts: records,
      },
    ]);

    // The control, one fact at a time: a tick reporting nothing pickable and
    // an empty pair hands the same four fields with the values it has.
    handoff(tickResult({ pickableAfter: [] }));
    expect(inbox.asked[1]).toEqual({
      flumeDir: FLUME_DIR,
      pickable: false,
      pending: [],
      priorAttempts: new Map(),
    });
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
    const handoff = defaultHandoff(sliceSet(refusalReader()));

    // An unmarked ship: the ordinary wave, which must leave the loop running.
    expect(handoff(wave(outcome({ tag: "PLAIN" })))).toEqual([BUILD_PHASE]);
    expect(stopped()).toBe(false);

    // Marked but never shipped — a park — is also "no shipped entry is
    // contractTouching": the mark alone does not end the run, and this one
    // routes to the inbox exactly as an unmarked park does, off the record
    // the park left standing against an entry still in the queue.
    const parked: TickResult = {
      ...wave(
        outcome({
          tag: "CONTRACT",
          shipped: false,
          mergeOutcome: "not-shipped",
          extension: { [CONTRACT_TOUCHING_FIELD]: true },
        }),
      ),
      pendingAfter: [entry("CONTRACT")],
      priorAttempts: store(record("CONTRACT", "not-shipped")),
    };
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
        return {
          mode,
          finalMessage: "nothing to do here",
          spanBase: "1".repeat(40), spanHead: "1".repeat(40),
          ...anchor,
        };
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

/**
 * The two statements a declined ship can be, and the opposite ways they route
 * (`spec/harness.md`, *A tick puts work down*).
 *
 * Both cases drive the real `defaultHandoff` over the real classifier, and
 * differ in exactly one path in the record's footprint — which is the whole
 * of what a build tick said. The note paths are composed by `layout.ts`, the
 * same spelling the `shipped` predicate reads and the classifier reads back,
 * so no case here agrees with the reader on a path the package does not
 * write (`.claude/rules/engineering.md`, *A seam gate reads what the real
 * writer wrote*).
 *
 * Top-level rather than inside this file's describes: the wake set is not
 * the only subject — the classifier's own verdict is asserted beside it, so
 * a handoff that happened to answer right over a misclassified record cannot
 * carry either case.
 */
it("a not-shipped record whose commit wrote a continuing note is not a standing refusal", () => {
  const handoff = defaultHandoff(sliceSet(refusalReader()));
  const tag = "CONTINUED";
  const queued = { pendingAfter: [entry(tag)], pickableAfter: [entry(tag)] };

  // A green segment landed, the rest declared another build tick's: the
  // commit carries its work and the continuation it wrote beside it.
  const continued = tickResult({
    ...queued,
    priorAttempts: store(
      record(tag, "not-shipped", [
        "src/a.ts",
        continuingNotePath(STATE_ROOT_REL, tag),
      ]),
    ),
    entries: [outcome({ tag, shipped: false, mergeOutcome: "not-shipped" })],
  });

  // Vacuity: the record is standing and entry-keyed to a tag the queue still
  // carries, so it reaches the classifier — "not a refusal" below is the
  // note's doing and not a store the walk never looked in.
  expect(continued.priorAttempts.size).toBe(1);
  expect(
    continued.priorAttempts.get(entryAttemptKey(continued.pendingAfter[0]!)),
  ).toBeDefined();

  expect({
    standing: standingRefusals(
      STATE_ROOT_REL,
      continued.pendingAfter,
      continued.priorAttempts,
    ),
    // Build carries the entry on from here — its span is on the trunk and the
    // queue still holds it — and the drain is woken by nothing, because a
    // continuation states nothing plan can reconcile.
    woke: handoff(continued),
  }).toEqual({ standing: [], woke: [BUILD_PHASE] });
});

it("a not-shipped record whose commit wrote a park note is a standing refusal", () => {
  const handoff = defaultHandoff(sliceSet(refusalReader()));
  const tag = "PARKED-WITH-A-NOTE";
  const queued = { pendingAfter: [entry(tag)], pickableAfter: [entry(tag)] };

  // The same mode, the same shape of footprint, the one path changed: a park
  // is the entry the tick could not do, and its reason is only plan's to act
  // on.
  const park = record(tag, "not-shipped", [
    "src/a.ts",
    parkedNotePath(STATE_ROOT_REL, tag),
  ]);
  const parked = tickResult({
    ...queued,
    priorAttempts: store(park),
    entries: [outcome({ tag, shipped: false, mergeOutcome: "not-shipped" })],
  });

  // Vacuity: the two note paths really are distinct, so the case is about
  // which one the commit touched rather than about one path under two names.
  expect(parkedNotePath(STATE_ROOT_REL, tag)).not.toBe(
    continuingNotePath(STATE_ROOT_REL, tag),
  );
  expect(parked.priorAttempts.size).toBe(1);

  expect({
    standing: standingRefusals(
      STATE_ROOT_REL,
      parked.pendingAfter,
      parked.priorAttempts,
    ),
    // The drain joins the set, and build stays in it: the walled entry is
    // held back per entry and the queue's other work is still the wave's.
    woke: handoff(parked),
  }).toEqual({ standing: [park], woke: [INBOX_PHASE, BUILD_PHASE] });
});

/**
 * The third kind of footprint: one the record's own writer cut.
 *
 * `buildNotShipped` bounds `touchedPaths` and states the remainder as
 * `omittedPaths` (`src/priorAttempts.ts`), so a commit wide enough can push
 * its own note past the bound and leave the classifier reading a list the
 * deciding path is missing from. The safe direction is the park — the drain
 * opens on a record that states its own elision rather than a continuation
 * being inferred from an absence — and nothing pinned it.
 *
 * The elision is the real writer's, never a hand-set `omittedPaths`: a
 * fixture that stamped the field itself would agree with the classifier on a
 * cut the engine never makes (`.claude/rules/engineering.md`, *A seam gate
 * reads what the real writer wrote*).
 */

/** The widest footprint {@link elidedFootprint} will ask the writer for. */
const MAX_FOOTPRINT_SEARCH = 1 << 16;

/**
 * A declined ship whose footprint ends in `tail` and is wide enough that the
 * writer elides it — whatever bound the engine holds, which is the engine's
 * and is exported nowhere.
 *
 * Doubles until the writer states an omission, and refuses rather than
 * searching forever: a writer that stopped bounding is a fact this case must
 * say out loud, since the cut it is about would no longer happen
 * (`.claude/rules/engineering.md`, *Loud or nothing*).
 */
function elidedFootprint(tail: string): ReturnType<typeof buildNotShipped> {
  for (let width = 64; width <= MAX_FOOTPRINT_SEARCH; width *= 2) {
    const filler = Array.from({ length: width }, (_, i) => `src/f${i}.ts`);
    const built = buildNotShipped("a".repeat(40), [...filler, tail]);
    if (built.omittedPaths !== undefined) return built;
  }
  throw new Error(
    `buildNotShipped elided nothing from ${MAX_FOOTPRINT_SEARCH} paths: the bound this case is about is gone`,
  );
}

it("a not-shipped record whose touchedPaths was elided stays a standing refusal", () => {
  const handoff = defaultHandoff(sliceSet(refusalReader()));
  const tag = "WIDE-CONTINUATION";
  const note = continuingNotePath(STATE_ROOT_REL, tag);

  // The commit a continuing tick would write, widened past the record's
  // bound: the note is in the footprint the predicate was handed and out of
  // the one the record carries.
  const elided = { ...elidedFootprint(note), ...entryAnchor(tag) };
  const wide = tickResult({
    pendingAfter: [entry(tag)],
    pickableAfter: [entry(tag)],
    priorAttempts: store(elided),
    entries: [outcome({ tag, shipped: false, mergeOutcome: "not-shipped" })],
  });

  // Vacuity: the writer really cut the list, and really cut the one path the
  // classification turns on — so the verdict below is the elision's doing
  // and not a note the case forgot to put in.
  expect(elided.omittedPaths).toBeGreaterThan(0);
  expect(elided.touchedPaths).not.toContain(note);
  expect(wide.priorAttempts.get(entryAttemptKey(wide.pendingAfter[0]!))).toBe(
    elided,
  );

  expect({
    standing: standingRefusals(
      STATE_ROOT_REL,
      wide.pendingAfter,
      wide.priorAttempts,
    ),
    // Plan's to resolve: the drain is woken, and what it reads is the record
    // whole, `omittedPaths` included, so the elision is visible to the only
    // phase that can act on it.
    woke: handoff(wide),
  }).toEqual({ standing: [elided], woke: [INBOX_PHASE, BUILD_PHASE] });
});
