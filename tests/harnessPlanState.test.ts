/**
 * The harness package's plan state (`spec/harness.md`, *Plan state as
 * declared state*): the derive and sweep cursors, the sweep's continuation
 * signal, and the per-lane drained-run stamp, as fields of a typed artifact
 * rather than lines read out of prose.
 *
 * The round-trip cases are agreement gates (`.claude/rules/engineering.md`,
 * *A seam gate reads what the real writer wrote*): the real writer puts the
 * artifact on disk and the real reader decodes those bytes. A hand-authored
 * fixture would re-author the artifact's vocabulary by the tester's hand and
 * let a one-sided rename ship green — which is the whole defect the typed
 * artifact replaces. The refusal cases keep their hand-authored input, since
 * the writer cannot produce the malformed artifact the reader must refuse.
 *
 * Nothing here restates the field list. The required-field case iterates the
 * schema's own keys and asks each whether it refuses absence, so a field
 * added to the artifact is covered by it rather than silently skipped, and a
 * field that reads absence as a state is told apart from a missing cursor by
 * the schema rather than by a name this file hardcodes.
 */

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, normalize } from "node:path";

import { afterEach, beforeEach, expect, it } from "vitest";

import {
  PlanStateSchema,
  planStatePath,
  readPlanState,
  writePlanState,
  type PlanState,
} from "../harness/index.ts";

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

/** A full artifact, every field populated; cases vary one thing off this. */
const planState = (): PlanState => ({
  derivedThrough: DERIVED,
  sweptThrough: SWEPT,
  rotation: { kind: "closed" },
});

/** The host form of the package's slash-joined path — how a case reads disk. */
const onDisk = (): string => normalize(planStatePath(stateRoot));

/** The refusal message a malformed artifact on disk produces, as a string. */
async function refusalFor(bytes: string): Promise<string> {
  await mkdir(dirname(onDisk()), { recursive: true });
  await writeFile(onDisk(), bytes);
  try {
    readPlanState(stateRoot);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error(`expected a refusal, got a parse: ${bytes}`);
}

it("the plan state accessor reads the derive and sweep cursors as fields", async () => {
  writePlanState(stateRoot, planState());

  const read = readPlanState(stateRoot);
  expect(read?.derivedThrough).toBe(DERIVED);
  expect(read?.sweptThrough).toBe(SWEPT);

  // Fields of a structured artifact, not lines in a document: each cursor is
  // a key on the JSON the writer actually wrote, at the path the package
  // hands a fence.
  const bytes = await readFile(onDisk(), "utf8");
  const raw = JSON.parse(bytes) as Record<string, unknown>;
  expect(raw["derivedThrough"]).toBe(DERIVED);
  expect(raw["sweptThrough"]).toBe(SWEPT);

  // And being fields is what buys the property the section is about: the
  // same facts reformatted — reordered keys, collapsed whitespace, no
  // trailing newline — read back identically. A line regexed out of prose
  // is what this reflow would break.
  await writeFile(
    onDisk(),
    JSON.stringify({ rotation: raw["rotation"], sweptThrough: SWEPT, derivedThrough: DERIVED }),
  );
  expect(readPlanState(stateRoot)).toEqual(read);

  // The two cursors are independent: one slice advancing its own never moves
  // the other's, which is the whole reason they are separate fields.
  writePlanState(stateRoot, { ...planState(), derivedThrough: SWEPT });
  expect(readPlanState(stateRoot)?.sweptThrough).toBe(SWEPT);
  expect(readPlanState(stateRoot)?.derivedThrough).toBe(SWEPT);
});

it("the plan state accessor reads the continuation signal and its covered set", async () => {
  const covered = ["src/paths.ts", "src/Gate.ts"];
  writePlanState(stateRoot, { ...planState(), rotation: { kind: "open", covered } });

  const open = readPlanState(stateRoot)?.rotation;
  expect(open).toEqual({ kind: "open", covered });

  // A closed rotation is a stated kind, not the absence of an open one —
  // the signal reads the same way whichever state it is in.
  writePlanState(stateRoot, planState());
  expect(readPlanState(stateRoot)?.rotation).toEqual({ kind: "closed" });

  // An armed rotation that has swept nothing yet is a real state: a frontier
  // exists, no neighborhood is covered. Empty is carried, never confused
  // with closed.
  writePlanState(stateRoot, { ...planState(), rotation: { kind: "open", covered: [] } });
  expect(readPlanState(stateRoot)?.rotation).toEqual({ kind: "open", covered: [] });

  // And a covered set cannot outlive the rotation it belongs to: it rides
  // the open arm alone, so bytes carrying one beside a closed rotation are
  // refused rather than read as a stale list a later tick might believe.
  const message = await refusalFor(
    JSON.stringify({ ...planState(), rotation: { kind: "closed", covered } }),
  );
  expect(message).toContain("rotation.covered");
  expect(message).toContain("unknown field");
});

it("a plan state artifact missing a required field is refused, naming the field", async () => {
  // Asked of the schema, never listed here: a field whose absence is a state
  // the artifact carries on purpose (the lane stamps) is not a lost cursor,
  // and which fields those are is the schema's to say.
  const fields = Object.entries(PlanStateSchema.shape)
    .filter(([, field]) => !field.safeParse(undefined).success)
    .map(([name]) => name);
  // Vacuity pin: an artifact with no required fields would pass every arm
  // below by running none of them.
  expect(fields.length).toBeGreaterThan(0);

  for (const field of fields) {
    const artifact = planState() as unknown as Record<string, unknown>;
    delete artifact[field];

    const message = await refusalFor(JSON.stringify(artifact));

    expect({ field, names: message.includes(field) }).toEqual({ field, names: true });
    expect(message).toContain("required field is missing");
    expect(message).toContain(onDisk());
  }

  // A nested field is named at its own path, so an open rotation that lost
  // its covered set says which half of which field is at fault.
  const nested = await refusalFor(
    JSON.stringify({ ...planState(), rotation: { kind: "open" } }),
  );
  expect(nested).toContain("rotation.covered");

  // A field present but malformed is refused too, and is told apart from an
  // absent one: a cursor git cannot resolve fails here, where the field can
  // be named, rather than at the process boundary of the window it arms.
  const malformed = await refusalFor(
    JSON.stringify({ ...planState(), sweptThrough: "HEAD~3" }),
  );
  expect(malformed).toContain("sweptThrough");
  expect(malformed).not.toContain("required field is missing");
});

it("an absent plan state artifact reads as no cursor rather than throwing", async () => {
  // A state root with no plan directory at all — a consumer that has just
  // been initialized and derived nothing yet.
  expect(readPlanState(stateRoot)).toBeUndefined();

  // Still absent once the directory exists around it: the artifact is the
  // subject, not the tree it sits in.
  writePlanState(stateRoot, planState());
  await rm(onDisk());
  expect(readPlanState(stateRoot)).toBeUndefined();

  // And absence is the *only* answer that reads as no cursor. Bytes that are
  // present but unreadable are loud, never swallowed into the same verdict —
  // answering those as "no cursor" would re-derive a whole spec history
  // confidently (`.claude/rules/engineering.md`, *Loud or nothing*).
  expect(await refusalFor("Spec derived through: `4758d60`\n")).toContain("not JSON");
});

it("the plan state accessor round-trips a per-lane drained-run stamp", async () => {
  const drainedRuns = { windows: "17420993001", posix: "17420993002" };
  writePlanState(stateRoot, { ...planState(), drainedRuns });

  expect(readPlanState(stateRoot)?.drainedRuns).toEqual(drainedRuns);

  // A field on the JSON the writer actually wrote, keyed by lane name — the
  // same key the declaration files a lane's findings under, so the slice
  // looks a stamp up by the name it already holds.
  const raw = JSON.parse(await readFile(onDisk(), "utf8")) as Record<string, unknown>;
  expect(raw["drainedRuns"]).toEqual(drainedRuns);

  // The stamps are per lane, not one stamp for CI: draining one lane's new
  // run leaves every other lane stamped where it was, which is what keeps a
  // still-red second lane from reading as drained.
  writePlanState(stateRoot, {
    ...planState(),
    drainedRuns: { ...drainedRuns, windows: "17421004417" },
  });
  expect(readPlanState(stateRoot)?.drainedRuns).toEqual({
    windows: "17421004417",
    posix: "17420993002",
  });

  // And the stamps ride beside the cursors rather than through them: writing
  // a stamp leaves the two cursors and the rotation byte-identical.
  const read = readPlanState(stateRoot);
  expect({
    derivedThrough: read?.derivedThrough,
    sweptThrough: read?.sweptThrough,
    rotation: read?.rotation,
  }).toEqual({
    derivedThrough: DERIVED,
    sweptThrough: SWEPT,
    rotation: { kind: "closed" },
  });
});

it("a plan state artifact carrying no lane stamp reads as no lane drained", async () => {
  // The artifact as every state root written before any lane was declared
  // holds it: no stamp field at all. Absent is a lane never drained, not a
  // refusal — the reader runs on the selection path, so refusing here would
  // shut the loop at the commit that adopts the field.
  writePlanState(stateRoot, planState());
  expect(readPlanState(stateRoot)?.drainedRuns?.["windows"]).toBeUndefined();

  // Declared lanes, none drained yet: an empty map is the same verdict, so a
  // slice that stamps its first lane never has to invent the field's absence.
  writePlanState(stateRoot, { ...planState(), drainedRuns: {} });
  expect(readPlanState(stateRoot)?.drainedRuns?.["windows"]).toBeUndefined();

  // And a stamp is a claim about its own lane alone: one lane drained leaves
  // every lane missing from the map reading as never drained, which is what
  // makes a lane declared after the last drain live on its first red run.
  writePlanState(stateRoot, { ...planState(), drainedRuns: { posix: "17420993002" } });
  const read = readPlanState(stateRoot);
  expect(read?.drainedRuns?.["windows"]).toBeUndefined();
  expect(read?.drainedRuns?.["posix"]).toBe("17420993002");
});

it("a plan state artifact whose lane stamp is malformed is refused, naming the field", async () => {
  // Named down to the lane: a stamp naming no run would read as that lane
  // drained while matching nothing the forge can report, and the refusal
  // says which lane's stamp is at fault rather than that the map is bad.
  const empty = await refusalFor(
    JSON.stringify({ ...planState(), drainedRuns: { windows: "" } }),
  );
  expect(empty).toContain("drainedRuns.windows");
  expect(empty).toContain(onDisk());
  // The field is read, not merely tolerated: an artifact carrying a stamp is
  // parsed as a stamp map, never refused wholesale as an unknown key.
  expect(empty).not.toContain("unknown field");

  // A run identity the forge could not have reported — a number where the
  // stamp is the identity as read — is named at the same path.
  const typed = await refusalFor(
    JSON.stringify({ ...planState(), drainedRuns: { windows: 17420993001 } }),
  );
  expect(typed).toContain("drainedRuns.windows");
  expect(typed).not.toContain("unknown field");

  // And a stamp field that is not a per-lane map at all — one stamp for all
  // of CI — is refused at the field rather than silently keyed by nothing.
  const flat = await refusalFor(
    JSON.stringify({ ...planState(), drainedRuns: "17420993001" }),
  );
  expect(flat).toContain("drainedRuns");
  expect(flat).not.toContain("unknown field");
});
