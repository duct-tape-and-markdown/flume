/**
 * The harness package's plan state (`spec/harness.md`, *Plan state as
 * declared state*): the derive and sweep cursors, the sweep's continuation
 * signal, and the per-lane drained-run stamp, as fields of typed artifacts
 * rather than lines read out of prose — **one file per writing slice**.
 *
 * The round-trip cases are agreement gates (`.claude/rules/engineering.md`,
 * *A seam gate reads what the real writer wrote*): the real writer puts the
 * artifact on disk and the real reader decodes those bytes. A hand-authored
 * fixture would re-author the artifact's vocabulary by the tester's hand and
 * let a one-sided rename ship green — which is the whole defect the typed
 * artifact replaces. The refusal cases keep their hand-authored input, since
 * the writer cannot produce the malformed artifact the reader must refuse.
 *
 * Nothing here restates the field list, and nothing here lists the slices.
 * The state a case writes comes off {@link SLICE_STATES}, which is keyed
 * exhaustively by the package's own slice roster, and the required-field case
 * iterates each slice schema's own keys and asks each whether it refuses
 * absence — so a field added to a slice's state is covered by it rather than
 * silently skipped, and a field that reads absence as a state is told apart
 * from a missing cursor by the schema rather than by a name this file
 * hardcodes.
 */

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";

import { afterEach, beforeEach, expect, it } from "vitest";

import {
  INBOX_PHASE,
  PLAN_SLICES,
  type PlanSlice,
} from "../harness/declaration.ts";
import {
  PLAN_STATE_SCHEMAS,
  planStatePath,
  readPlanState,
  writePlanState,
  type PlanStateWriteOf,
} from "../harness/index.ts";
import {
  JUDGED_SLICES,
  judgeSliceState,
  readCursorBounded,
  readPlanStateBounded,
  type SliceStateAt,
} from "../harness/planState.ts";

import { mkTempDir } from "./helpers/fixtureRoot.ts";

/** A fresh, empty state root per case — no directories, the untouched shape. */
let stateRoot: string;

beforeEach(async () => {
  stateRoot = await mkTempDir("flume-plan-state-");
});

afterEach(async () => {
  if (stateRoot) await rm(stateRoot, { recursive: true, force: true });
});

const DERIVED = "4758d60f6de696904d8d5692107889af26bba625";
const SWEPT = "b7972ec41f41adfeaecaf947a4cafe2b9970dee1";

/**
 * A full state per slice, every field that slice owns populated; cases vary
 * one thing off the slice they are about.
 *
 * Keyed exhaustively by the package's own roster, so a slice that gains a
 * state file is a typecheck failure here rather than a slice this file never
 * exercises.
 */
const SLICE_STATES = {
  "plan-derive": { derivedThrough: DERIVED },
  "plan-sweep": { sweptThrough: SWEPT, rotation: { kind: "closed" } },
  "plan-inbox": {},
} as const satisfies { [S in PlanSlice]: PlanStateWriteOf<S> };

/** One slice's populated state, as a case hands it to the real writer. */
const stateOf = <S extends PlanSlice>(slice: S): PlanStateWriteOf<S> =>
  structuredClone(SLICE_STATES[slice]) as PlanStateWriteOf<S>;

/** The host form of the package's slash-joined path — how a case reads disk. */
const onDisk = (slice: PlanSlice): string =>
  normalize(planStatePath(stateRoot, slice));

/**
 * A slice's state laid down by hand, where what is under test is a spelling
 * the package's own writer cannot produce — a malformed one, or one a
 * released version wrote before a field took its current shape.
 */
async function writeArtifact(slice: PlanSlice, bytes: string): Promise<void> {
  await mkdir(dirname(onDisk(slice)), { recursive: true });
  await writeFile(onDisk(slice), bytes);
}

/** The refusal message a malformed artifact on disk produces, as a string. */
async function refusalFor(slice: PlanSlice, bytes: string): Promise<string> {
  await writeArtifact(slice, bytes);
  try {
    readPlanState(stateRoot, slice);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error(`expected a refusal, got a parse: ${bytes}`);
}

/**
 * One slice's state as a judge of two refs holds it: written by the package's
 * own writer, read back as the bytes that landed.
 *
 * The real writer, for the same reason every round-trip case here uses it —
 * a hand-authored pair would re-author, by the tester's hand, exactly the
 * artifact the rules read (`.claude/rules/engineering.md`, *A seam gate reads
 * what the real writer wrote*).
 */
async function artifactOf<S extends PlanSlice>(
  slice: S,
  state: PlanStateWriteOf<S>,
): Promise<SliceStateAt> {
  writePlanState(stateRoot, slice, state);
  return {
    parsed: JSON.parse(await readFile(onDisk(slice), "utf8")),
    locus: `plan state for ${slice}`,
  };
}

/** The sweep's state with a rotation open over `covered`, stamped at `sha`. */
const openAt = (
  sha: string,
  covered: readonly string[],
): PlanStateWriteOf<"plan-sweep"> => ({
  sweptThrough: sha,
  rotation: { kind: "open", covered: [...covered] },
});

it("a slice's state at a commit is judged against its state at the base through one table", async () => {
  const covered = ["src/paths.ts", "src/Gate.ts"];
  const base = await artifactOf("plan-sweep", openAt(SWEPT, covered));
  // Vacuity pin: the base really carries the coverage every arm below is
  // about, so none of them rules over an empty set.
  expect(
    (base.parsed as { rotation: { covered: string[] } }).rotation.covered,
  ).toEqual(covered);

  // Coverage growing under the same stamp is the sweep's ordinary tick.
  const grown = await artifactOf("plan-sweep", openAt(SWEPT, [...covered, "src/git.ts"]));
  expect(judgeSliceState("plan-sweep", grown, base)).toEqual({
    problems: [],
    cursors: [{ field: "sweptThrough", value: SWEPT, before: SWEPT }],
  });

  // Shrinking it is the loss no cursor can show: the stamp never moved.
  const shrunk = await artifactOf("plan-sweep", openAt(SWEPT, covered.slice(1)));
  const dropped = judgeSliceState("plan-sweep", shrunk, base).problems;
  expect(dropped).toHaveLength(1);
  expect(dropped[0]).toContain("src/paths.ts");

  // The stamp's own rule is the table's other instance over the same pair.
  expect(
    judgeSliceState("plan-sweep", await artifactOf("plan-sweep", openAt(DERIVED, covered)), base)
      .problems,
  ).toEqual([
    "sweptThrough moved while the rotation it stamps under is still open, so the frontier that rotation has covered is lost to the next tick",
  ]);

  // Closing the rotation drops the covered set by construction, and that is
  // the rotation's verdict rather than a loss — both rules read the pair and
  // leave the closing tick alone.
  const closing = await artifactOf("plan-sweep", {
    sweptThrough: DERIVED,
    rotation: { kind: "closed" },
  });
  expect(judgeSliceState("plan-sweep", closing, base).problems).toEqual([]);

  // No artifact at the base is no pair: a state root with no file yet has no
  // prior state a rule could judge a move against, and the cursor says so.
  expect(judgeSliceState("plan-sweep", shrunk, undefined)).toEqual({
    problems: [],
    cursors: [{ field: "sweptThrough", value: SWEPT, before: undefined }],
  });
});

/**
 * The retired-claim cursor moves on its own tick, ahead of a stamp the
 * rotation pins in place — so it is a field of the sweep's own file rather
 * than a second hand on `sweptThrough`, and absent reads as the stamp
 * (`.claude/rules/posture-sweep.md`, *The stamp*).
 */
it("the sweep's retired-claim cursor is carried as a field, and dropping it under a standing stamp is not a move the sweep's own invariants allow", async () => {
  const searching: PlanStateWriteOf<"plan-sweep"> = {
    ...stateOf("plan-sweep"),
    retiredThrough: DERIVED,
  };
  writePlanState(stateRoot, "plan-sweep", searching);
  expect(readPlanState(stateRoot, "plan-sweep")).toEqual({
    sweptThrough: SWEPT,
    rotation: { kind: "closed" },
    retiredThrough: DERIVED,
  });

  // Absent is a state, never a refusal: every sweep file written before this
  // field existed carries none, and the sweep slice is the only writer of its
  // own file — so a required field would refuse the very window whose tick
  // would have added one.
  writePlanState(stateRoot, "plan-sweep", stateOf("plan-sweep"));
  expect(
    readPlanState(stateRoot, "plan-sweep")?.retiredThrough,
  ).toBeUndefined();

  const base = await artifactOf("plan-sweep", searching);
  // Vacuity pin: the base really carries the cursor every arm below is about.
  expect((base.parsed as { retiredThrough?: string }).retiredThrough).toBe(
    DERIVED,
  );

  // Advancing it under a standing stamp is the sweep's ordinary tick: where
  // it moves to is git's to order, not this file's.
  const advanced = await artifactOf("plan-sweep", {
    ...searching,
    retiredThrough: SWEPT,
  });
  expect(judgeSliceState("plan-sweep", advanced, base).problems).toEqual([]);

  // Dropping it is the loss no cursor can show: absent reads as the stamp, so
  // the next tick re-renders every line the locus retired since it.
  const dropped = judgeSliceState(
    "plan-sweep",
    await artifactOf("plan-sweep", stateOf("plan-sweep")),
    base,
  ).problems;
  expect(dropped).toHaveLength(1);
  expect(dropped[0]).toContain("retired-claim cursor");

  // The closing tick drops it with the rotation it indexed, and that is the
  // rotation's verdict rather than a loss — the next delta is drawn over the
  // paths the new stamp's own range touched.
  expect(
    judgeSliceState(
      "plan-sweep",
      await artifactOf("plan-sweep", {
        sweptThrough: DERIVED,
        rotation: { kind: "closed" },
      }),
      base,
    ).problems,
  ).toEqual([]);
});

it("a slice stating no rule over its own state is spelled at the table, not left out", async () => {
  // Derive's cursor is bounded by its step through history and by nothing its
  // own file says, so even a value stepped backwards is no problem of this
  // table's — the bound that catches it is the judge's, not the artifact's.
  const before = await artifactOf("plan-derive", { derivedThrough: SWEPT });
  const after = await artifactOf("plan-derive", { derivedThrough: DERIVED });
  expect(judgeSliceState("plan-derive", after, before)).toEqual({
    problems: [],
    cursors: [{ field: "derivedThrough", value: DERIVED, before: SWEPT }],
  });

  // And the judged set is read off the two tables rather than listed: the
  // inbox holds no cursor at all, so it is in this set exactly because it
  // states a rule over its own lane stamps.
  expect(JUDGED_SLICES).toContain(INBOX_PHASE);
  expect([...JUDGED_SLICES].sort()).toEqual([...PLAN_SLICES].sort());
});

it("a plan commit that drops a lane's drained-run stamp is not a move the inbox's own invariants allow", async () => {
  const base = await artifactOf(INBOX_PHASE, {
    drainedRuns: { lint: { run: "17", titles: ["a lint title"] }, e2e: "41" },
  });
  // Vacuity pin: the base really stamps the two lanes every arm below is
  // about, so none of them rules over an empty map.
  expect(
    Object.keys((base.parsed as { drainedRuns: object }).drainedRuns),
  ).toEqual(["lint", "e2e"]);

  // Advancing one standing lane and adding a third beside it is the slice's
  // ordinary tick: nothing left the file.
  const advanced = await artifactOf(INBOX_PHASE, {
    drainedRuns: {
      lint: { run: "23", titles: [] },
      e2e: "41",
      types: { run: "5", titles: ["a types title"] },
    },
  });
  expect(judgeSliceState(INBOX_PHASE, advanced, base)).toEqual({
    problems: [],
    // The inbox holds no cursor, so the judged pair is its rule alone.
    cursors: [],
  });

  // Dropping one is the loss no cursor and no later read can show: the lane
  // reads as never drained again, and the slice re-wakes over the same run.
  const dropped = judgeSliceState(
    INBOX_PHASE,
    await artifactOf(INBOX_PHASE, { drainedRuns: { e2e: "41" } }),
    base,
  ).problems;
  expect(dropped).toHaveLength(1);
  expect(dropped[0]).toContain("lint");
  expect(dropped[0]).not.toContain("e2e");

  // Dropping the map whole is the same loss spelled as an absent field, and
  // a base with no artifact at all is no pair for the rule to read.
  const emptied = await artifactOf(INBOX_PHASE, {});
  expect(judgeSliceState(INBOX_PHASE, emptied, base).problems).toHaveLength(1);
  expect(judgeSliceState(INBOX_PHASE, emptied, undefined).problems).toEqual([]);
});

it("each plan slice reads and writes only its own state file", async () => {
  // Vacuity pin: one slice would make every disjointness arm below trivial,
  // and the property is about what two slices writing at once cannot do
  // (`.claude/rules/engineering.md`, *A green verdict is proven
  // non-vacuous*).
  expect(PLAN_SLICES.length).toBeGreaterThan(1);

  // One path per slice, all distinct — which is what makes a wave of two
  // stamping slices two files to merge rather than two hands on one page.
  const paths = PLAN_SLICES.map((slice) => planStatePath(stateRoot, slice));
  expect(new Set(paths).size).toBe(paths.length);

  // Every slice's state written, through the real writer.
  for (const slice of PLAN_SLICES) writePlanState(stateRoot, slice, stateOf(slice));
  const before = new Map<PlanSlice, string>();
  for (const slice of PLAN_SLICES) {
    before.set(slice, await readFile(onDisk(slice), "utf8"));
  }

  // Each slice rewritten in turn leaves every sibling's file byte-identical:
  // the writer touches one path, so there is no read-modify-write of a shared
  // page for a concurrent sibling to lose (`spec/harness.md`, *Plan state as
  // declared state*).
  for (const slice of PLAN_SLICES) {
    writePlanState(stateRoot, slice, stateOf(slice));
    for (const other of PLAN_SLICES) {
      if (other === slice) continue;
      expect({ slice, other, bytes: await readFile(onDisk(other), "utf8") }).toEqual({
        slice,
        other,
        bytes: before.get(other),
      });
    }
  }

  // And the read side is as narrow as the write side: a slice's accessor
  // answers off that slice's own file, so removing one leaves every sibling
  // reading exactly what it wrote.
  for (const slice of PLAN_SLICES) {
    await rm(onDisk(slice));
    expect({ slice, read: readPlanState(stateRoot, slice) }).toEqual({
      slice,
      read: undefined,
    });
    for (const other of PLAN_SLICES) {
      if (other === slice) continue;
      expect({ slice, other, read: readPlanState(stateRoot, other) }).toEqual({
        slice,
        other,
        read: PLAN_STATE_SCHEMAS[other].parse(stateOf(other)),
      });
    }
    writePlanState(stateRoot, slice, stateOf(slice));
  }

  // No slice may so much as spell a field it does not own: each schema is
  // strict, so a sibling's field handed to this slice's writer is refused by
  // name rather than written into a file no reader of it will look at.
  for (const slice of PLAN_SLICES) {
    for (const other of PLAN_SLICES) {
      if (other === slice) continue;
      const foreign = Object.keys(SLICE_STATES[other]);
      if (foreign.length === 0) continue;
      const message = await refusalFor(
        slice,
        JSON.stringify({ ...stateOf(slice), ...SLICE_STATES[other] }),
      );
      for (const field of foreign) {
        expect({ slice, field, named: message.includes(field) }).toEqual({
          slice,
          field,
          named: true,
        });
      }
      expect(message).toContain("unknown field");
      writePlanState(stateRoot, slice, stateOf(slice));
    }
  }
});

it("the plan state accessor reads the derive and sweep cursors as fields", async () => {
  writePlanState(stateRoot, "plan-derive", stateOf("plan-derive"));
  writePlanState(stateRoot, "plan-sweep", stateOf("plan-sweep"));

  expect(readPlanState(stateRoot, "plan-derive")?.derivedThrough).toBe(DERIVED);
  expect(readPlanState(stateRoot, "plan-sweep")?.sweptThrough).toBe(SWEPT);

  // Fields of a structured artifact, not lines in a document: each cursor is
  // a key on the JSON the writer actually wrote, at the path the package
  // hands a fence.
  const derive = JSON.parse(await readFile(onDisk("plan-derive"), "utf8")) as Record<
    string,
    unknown
  >;
  const sweep = JSON.parse(await readFile(onDisk("plan-sweep"), "utf8")) as Record<
    string,
    unknown
  >;
  expect(derive["derivedThrough"]).toBe(DERIVED);
  expect(sweep["sweptThrough"]).toBe(SWEPT);

  // And being fields is what buys the property the section is about: the
  // same facts reformatted — reordered keys, collapsed whitespace, no
  // trailing newline — read back identically. A line regexed out of prose
  // is what this reflow would break.
  const read = readPlanState(stateRoot, "plan-sweep");
  await writeFile(
    onDisk("plan-sweep"),
    JSON.stringify({ rotation: sweep["rotation"], sweptThrough: SWEPT }),
  );
  expect(readPlanState(stateRoot, "plan-sweep")).toEqual(read);

  // The two cursors are independent, and now by construction: advancing the
  // derive cursor is a write to a file the sweep's cursor is not in.
  writePlanState(stateRoot, "plan-derive", { derivedThrough: SWEPT });
  expect(readPlanState(stateRoot, "plan-sweep")?.sweptThrough).toBe(SWEPT);
  expect(readPlanState(stateRoot, "plan-derive")?.derivedThrough).toBe(SWEPT);
});

it("the plan state accessor reads the continuation signal and its covered set", async () => {
  const covered = ["src/paths.ts", "src/Gate.ts"];
  writePlanState(stateRoot, "plan-sweep", {
    ...stateOf("plan-sweep"),
    rotation: { kind: "open", covered },
  });

  const open = readPlanState(stateRoot, "plan-sweep")?.rotation;
  expect(open).toEqual({ kind: "open", covered });

  // A closed rotation is a stated kind, not the absence of an open one —
  // the signal reads the same way whichever state it is in.
  writePlanState(stateRoot, "plan-sweep", stateOf("plan-sweep"));
  expect(readPlanState(stateRoot, "plan-sweep")?.rotation).toEqual({ kind: "closed" });

  // An armed rotation that has swept nothing yet is a real state: a frontier
  // exists, no neighborhood is covered. Empty is carried, never confused
  // with closed.
  writePlanState(stateRoot, "plan-sweep", {
    ...stateOf("plan-sweep"),
    rotation: { kind: "open", covered: [] },
  });
  expect(readPlanState(stateRoot, "plan-sweep")?.rotation).toEqual({
    kind: "open",
    covered: [],
  });

  // And a covered set cannot outlive the rotation it belongs to: it rides
  // the open arm alone, so bytes carrying one beside a closed rotation are
  // refused rather than read as a stale list a later tick might believe.
  const message = await refusalFor(
    "plan-sweep",
    JSON.stringify({ ...stateOf("plan-sweep"), rotation: { kind: "closed", covered } }),
  );
  expect(message).toContain("rotation.covered");
  expect(message).toContain("unknown field");
});

it("a plan state artifact missing a required field is refused, naming the field", async () => {
  // Asked of each slice's schema, never listed here: a field whose absence
  // is a state the artifact carries on purpose (the lane stamps) is not a
  // lost cursor, and which fields those are is the schema's to say.
  const required = PLAN_SLICES.flatMap((slice) =>
    Object.entries(PLAN_STATE_SCHEMAS[slice].shape)
      .filter(([, field]) => !field.safeParse(undefined).success)
      .map(([name]) => ({ slice, field: name })),
  );
  // Vacuity pin: a roster with no required fields would pass every arm
  // below by running none of them.
  expect(required.length).toBeGreaterThan(0);

  for (const { slice, field } of required) {
    const artifact = stateOf(slice) as unknown as Record<string, unknown>;
    delete artifact[field];

    const message = await refusalFor(slice, JSON.stringify(artifact));

    expect({ slice, field, names: message.includes(field) }).toEqual({
      slice,
      field,
      names: true,
    });
    expect(message).toContain("required field is missing");
    expect(message).toContain(onDisk(slice));
  }

  // A nested field is named at its own path, so an open rotation that lost
  // its covered set says which half of which field is at fault.
  const nested = await refusalFor(
    "plan-sweep",
    JSON.stringify({ ...stateOf("plan-sweep"), rotation: { kind: "open" } }),
  );
  expect(nested).toContain("rotation.covered");

  // A field present but malformed is refused too, and is told apart from an
  // absent one: a cursor git cannot resolve fails here, where the field can
  // be named, rather than at the process boundary of the window it arms.
  const malformed = await refusalFor(
    "plan-sweep",
    JSON.stringify({ ...stateOf("plan-sweep"), sweptThrough: "HEAD~3" }),
  );
  expect(malformed).toContain("sweptThrough");
  expect(malformed).not.toContain("required field is missing");
});

it("an absent plan state artifact reads as no cursor rather than throwing", async () => {
  // A state root with no plan directory at all — a consumer that has just
  // been initialized and derived nothing yet.
  expect(readPlanState(stateRoot, "plan-derive")).toBeUndefined();

  // Still absent once the directory exists around it: the file is the
  // subject, not the tree it sits in — and a sibling slice's file in that
  // same directory is not this slice's state either.
  writePlanState(stateRoot, "plan-sweep", stateOf("plan-sweep"));
  expect(readPlanState(stateRoot, "plan-derive")).toBeUndefined();

  writePlanState(stateRoot, "plan-derive", stateOf("plan-derive"));
  await rm(onDisk("plan-derive"));
  expect(readPlanState(stateRoot, "plan-derive")).toBeUndefined();

  // And absence is the *only* answer that reads as no cursor. Bytes that are
  // present but unreadable are loud, never swallowed into the same verdict —
  // answering those as "no cursor" would re-derive a whole spec history
  // confidently (`.claude/rules/engineering.md`, *Loud or nothing*).
  expect(
    await refusalFor("plan-derive", "Spec derived through: `4758d60`\n"),
  ).toContain("not JSON");
});

/**
 * The bounded read beside the accessor: the one caller shape that cannot take
 * a throw is a slice's liveness predicate, which runs inside a wake set that
 * walks every slice (`harness/planState.ts`, `boundedRead`).
 *
 * The bound is over the failure alone. Absence still reads as absence, and a
 * written state still reads back whole — a bound that folded either into
 * `failure` would have the windows refuse over a first tick
 * (`.claude/rules/engineering.md`, *Loud or nothing*).
 */
it("the bounded plan state read answers a failure where the accessor throws", async () => {
  // Absent, and then present: the two arms the accessor already answers,
  // which the bound must hand back unchanged.
  expect(readPlanStateBounded(stateRoot, "plan-derive")).toEqual({
    read: undefined,
  });
  expect(readCursorBounded(stateRoot, "derivedThrough")).toEqual({
    read: undefined,
  });

  writePlanState(stateRoot, "plan-derive", stateOf("plan-derive"));
  const written = readPlanState(stateRoot, "plan-derive");
  expect(written).toBeDefined();
  expect(readPlanStateBounded(stateRoot, "plan-derive")).toEqual({
    read: written,
  });
  expect(readCursorBounded(stateRoot, "derivedThrough")).toEqual({
    read: written?.derivedThrough,
  });

  // And the arm the bound exists for: the same bytes the accessor refuses,
  // carried as the refusal's own words rather than raised — the file named,
  // so the window that renders this names what to repair.
  const bytes = "Spec derived through: `4758d60`\n";
  const thrown = await refusalFor("plan-derive", bytes);
  const bounded = readPlanStateBounded(stateRoot, "plan-derive");
  const cursor = readCursorBounded(stateRoot, "derivedThrough");
  expect({ bounded, cursor }).toEqual({
    bounded: { failure: thrown },
    cursor: { failure: thrown },
  });
  expect(thrown).toContain(onDisk("plan-derive"));
});

it("the plan state accessor round-trips a per-lane drained-run stamp", async () => {
  const drainedRuns = {
    windows: { run: "17420993001", titles: ["paths.test.ts > a long path"] },
    posix: { run: "17420993002", titles: [] },
  };
  writePlanState(stateRoot, "plan-inbox", { drainedRuns });

  expect(readPlanState(stateRoot, "plan-inbox")?.drainedRuns).toEqual(drainedRuns);

  // A field on the JSON the writer actually wrote, keyed by lane name — the
  // same key the declaration files a lane's findings under, so the slice
  // looks a stamp up by the name it already holds.
  const raw = JSON.parse(await readFile(onDisk("plan-inbox"), "utf8")) as Record<
    string,
    unknown
  >;
  expect(raw["drainedRuns"]).toEqual(drainedRuns);

  // The stamps are per lane, not one stamp for CI: draining one lane's new
  // run leaves every other lane stamped where it was, which is what keeps a
  // still-red second lane from reading as drained.
  writePlanState(stateRoot, "plan-inbox", {
    drainedRuns: { ...drainedRuns, windows: { run: "17421004417", titles: [] } },
  });
  expect(readPlanState(stateRoot, "plan-inbox")?.drainedRuns).toEqual({
    windows: { run: "17421004417", titles: [] },
    posix: { run: "17420993002", titles: [] },
  });

  // And the stamps ride beside the cursors rather than through them —
  // now because they are in another file entirely: writing a stamp leaves
  // both cursors and the rotation byte-identical.
  writePlanState(stateRoot, "plan-derive", stateOf("plan-derive"));
  writePlanState(stateRoot, "plan-sweep", stateOf("plan-sweep"));
  const cursors = await readFile(onDisk("plan-derive"), "utf8");
  const sweep = await readFile(onDisk("plan-sweep"), "utf8");
  writePlanState(stateRoot, "plan-inbox", {
    drainedRuns: { windows: { run: "17421004418", titles: [] } },
  });
  expect(await readFile(onDisk("plan-derive"), "utf8")).toBe(cursors);
  expect(await readFile(onDisk("plan-sweep"), "utf8")).toBe(sweep);
});

it("a plan state artifact carrying no lane stamp reads as no lane drained", async () => {
  // The inbox slice's state as every state root written before any lane was
  // declared holds it: no stamp field at all — which is the whole file, so
  // absence of the field and absence of the file are one statement. Absent is
  // a lane never drained, not a refusal: the reader runs on the selection
  // path, so refusing here would shut the loop at the commit that adopts it.
  expect(readPlanState(stateRoot, "plan-inbox")?.drainedRuns?.["windows"]).toBeUndefined();

  writePlanState(stateRoot, "plan-inbox", stateOf("plan-inbox"));
  expect(readPlanState(stateRoot, "plan-inbox")?.drainedRuns?.["windows"]).toBeUndefined();

  // Declared lanes, none drained yet: an empty map is the same verdict, so a
  // slice that stamps its first lane never has to invent the field's absence.
  writePlanState(stateRoot, "plan-inbox", { drainedRuns: {} });
  expect(readPlanState(stateRoot, "plan-inbox")?.drainedRuns?.["windows"]).toBeUndefined();

  // And a stamp is a claim about its own lane alone: one lane drained leaves
  // every lane missing from the map reading as never drained, which is what
  // makes a lane declared after the last drain live on its first red run.
  writePlanState(stateRoot, "plan-inbox", {
    drainedRuns: { posix: { run: "17420993002", titles: [] } },
  });
  const read = readPlanState(stateRoot, "plan-inbox");
  expect(read?.drainedRuns?.["windows"]).toBeUndefined();
  expect(read?.drainedRuns?.["posix"]?.run).toBe("17420993002");
});

it("a drained-run stamp already on disk as a bare run identity reads as that run with no titles", async () => {
  // Hand-authored on purpose, and the one place in this file that is right:
  // the writer below normalizes, so no run of it can put this spelling on
  // disk — while every artifact written before a stamp carried a title set,
  // and every plan tick that spelled one by hand, holds exactly this.
  await writeArtifact(
    "plan-inbox",
    JSON.stringify({ drainedRuns: { windows: "17420993001" } }),
  );

  const bare = readPlanState(stateRoot, "plan-inbox")?.drainedRuns?.["windows"];
  expect(bare).toEqual({ run: "17420993001", titles: [] });

  // Vacuity: the same artifact spelled the other way reads the same run, so
  // the arm above is a second spelling of one stamp rather than a shape a
  // reader has to tell apart (`harness/planState.ts`, `DrainedRun`).
  writePlanState(stateRoot, "plan-inbox", {
    drainedRuns: { windows: { run: "17420993001", titles: [] } },
  });
  expect(readPlanState(stateRoot, "plan-inbox")?.drainedRuns?.["windows"]).toEqual(bare);

  // And the writer hands back the one spelling every reader of this artifact
  // sees: a bare identity written through it lands as the stamp it means.
  writePlanState(stateRoot, "plan-inbox", { drainedRuns: { windows: "17421004417" } });
  const raw = JSON.parse(await readFile(onDisk("plan-inbox"), "utf8")) as {
    drainedRuns: Record<string, unknown>;
  };
  expect(raw.drainedRuns["windows"]).toEqual({ run: "17421004417", titles: [] });
});

it("a drained-run stamp whose titles are not a list of titles is refused, naming the field", async () => {
  // The stamp's own half: a run with a title set is one value, and a set
  // that is not one would read as a lane drained at titles nothing stated.
  const listed = await refusalFor(
    "plan-inbox",
    JSON.stringify({ drainedRuns: { windows: { run: "17420993001", titles: "a title" } } }),
  );
  expect(listed).toContain("drainedRuns.windows");
  expect(listed).not.toContain("unknown field");

  // An empty title is not a title: a stamp carrying one would compare equal
  // to nothing a reader can report.
  const blank = await refusalFor(
    "plan-inbox",
    JSON.stringify({ drainedRuns: { windows: { run: "17420993001", titles: [""] } } }),
  );
  expect(blank).toContain("drainedRuns.windows");

  // And the set is spelled, never inherited: a stamp naming a run and no
  // titles at all is refused rather than read as the empty set, which is
  // what the bare identity above already spells.
  const missing = await refusalFor(
    "plan-inbox",
    JSON.stringify({ drainedRuns: { windows: { run: "17420993001" } } }),
  );
  expect(missing).toContain("drainedRuns.windows");
});

it("a plan state artifact whose lane stamp is malformed is refused, naming the field", async () => {
  // Named down to the lane: a stamp naming no run would read as that lane
  // drained while matching nothing the forge can report, and the refusal
  // says which lane's stamp is at fault rather than that the map is bad.
  const empty = await refusalFor(
    "plan-inbox",
    JSON.stringify({ drainedRuns: { windows: "" } }),
  );
  expect(empty).toContain("drainedRuns.windows");
  expect(empty).toContain(onDisk("plan-inbox"));
  // The field is read, not merely tolerated: an artifact carrying a stamp is
  // parsed as a stamp map, never refused wholesale as an unknown key.
  expect(empty).not.toContain("unknown field");

  // A run identity the forge could not have reported — a number where the
  // stamp is the identity as read — is named at the same path.
  const typed = await refusalFor(
    "plan-inbox",
    JSON.stringify({ drainedRuns: { windows: 17420993001 } }),
  );
  expect(typed).toContain("drainedRuns.windows");
  expect(typed).not.toContain("unknown field");

  // And a stamp field that is not a per-lane map at all — one stamp for all
  // of CI — is refused at the field rather than silently keyed by nothing.
  const flat = await refusalFor(
    "plan-inbox",
    JSON.stringify({ drainedRuns: "17420993001" }),
  );
  expect(flat).toContain("drainedRuns");
  expect(flat).not.toContain("unknown field");
});

it("readPlanState refuses a state root that is present and is not a directory", async () => {
  // Non-vacuity: the real root, absent of any plan directory, really is the
  // "no cursor yet" answer this case exists to tell an obstruction apart
  // from — so the refusal below is the obstruction's and not the read's.
  expect(readPlanState(stateRoot, "plan-derive")).toBeUndefined();

  // A plain file where a consumer's state root should stand: a chain
  // pointed at a path someone else took, or a clone that landed a file over
  // the directory. Everything a slice would read sits beneath it, so every
  // window opens on nothing — and a derive window opening on nothing
  // re-derives the whole spec history (`.claude/rules/engineering.md`,
  // *Loud or nothing*).
  const obstructed = join(stateRoot, "taken-by-a-file");
  await writeFile(obstructed, "not a state root\n");

  // Named down to the rung an operator has to go fix, which is the root
  // itself here. Asserted as a substring of the refusal rather than as the
  // whole message: posix reaches the same refusal through `ENOTDIR` on the
  // file read, and this case is the proof that holds on the host where that
  // lookup answers `ENOENT` instead (`.claude/rules/platform-facts.md`,
  // *win32 reports a path through a non-directory as not found*).
  expect(() => readPlanState(obstructed, "plan-derive")).toThrow(obstructed);

  // Every slice, since each composes its own path under that same root.
  for (const slice of PLAN_SLICES) {
    expect(() => readPlanState(obstructed, slice)).toThrow(obstructed);
  }
});
