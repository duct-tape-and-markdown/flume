/**
 * The harness package's entry extension (`spec/harness.md`, *The entry
 * extension*), driven through the two engine surfaces that consume it: the
 * parser a gate runs and the renderer a prompt is built from.
 *
 * Every case here is an agreement gate (`.claude/rules/engineering.md`, *A
 * seam gate reads what the real writer wrote*). The claim under test is that
 * the declaration the prompt announces and the declaration the parser
 * enforces are one declaration, so both sides run for real: the package's
 * own `entryExtension()` goes into the engine's `renderSchemaForPrompt` and
 * into the engine's `parsePendingQueue`, and no hint text or cap is restated by
 * the tester's hand.
 *
 * The removal case hand-authors its input, which is the sanctioned shape —
 * no real consumer produces the extension a refusal exists to catch.
 */

import { expect, it } from "vitest";

import {
  CONTRACT_TOUCHING_FIELD,
  ENTRY_CAPS,
  EntryFieldRemovalError,
  entryExtension,
} from "../harness/index.ts";
import type { Lane } from "../harness/index.ts";
import { parsePendingQueue, renderSchemaForPrompt } from "../src/index.ts";
// The naming rule, not the package surface: a fixture composing an entry's
// own file takes the engine's spelling of `<tag>.json` rather than a second
// copy of it (`spec/pending.md`, *The ledger is a directory — one entry per
// file*).
import { entryFileName } from "../src/PendingSchema.ts";
import type { EntryExtension, QueueFile } from "../src/index.ts";

/** The six the spec section lists, in the order it lists them. */
const SPEC_FIELDS = ["summary", "per", "acceptance", "tests", "pins", "notes"];

/** Those six plus the package's risk flag, which renders and parses beside them. */
const PACKAGE_FIELDS = [...SPEC_FIELDS, CONTRACT_TOUCHING_FIELD];

/**
 * One core-valid entry as its own queue file, with the extension fields a
 * caller wants over it — the queue is a directory of one entry per file
 * (`spec/pending.md`, *The ledger is a directory — one entry per file*), so
 * the fixture is the listing the real reader hands the parse.
 */
const entryQueue = (fields: Record<string, unknown>): QueueFile[] => [
  {
    file: entryFileName("SOME-TAG"),
    raw: JSON.stringify({
      tag: "SOME-TAG",
      gate: { kind: "open" },
      dependsOnForks: [],
      files: { new: [], edit: [], retire: [] },
      summary: "extract the package's entry extension",
      per: { path: "spec/harness.md", section: "The entry extension" },
      acceptance: "the six fields render and parse",
      tests: ["a behavior"],
      pins: [],
      ...fields,
    }),
  },
];

/**
 * A value for every field the package declares, so a parse over it reaches
 * the whole set the render leg already does. The values are the tester's —
 * only a human can choose one each field's schema accepts — but the *keys*
 * are checked against `entryExtension()`'s own before the parse, so a field
 * the package adds reds here instead of going unparsed behind a populated
 * set narrower than the claim.
 */
const everyPackageField: Record<string, unknown> = {
  summary: "extract the package's entry extension",
  per: { path: "spec/harness.md", section: "The entry extension" },
  acceptance: "every declared field parses",
  tests: ["a behavior this entry introduces"],
  pins: ["a property that already holds"],
  notes: "context the spec does not carry",
  [CONTRACT_TOUCHING_FIELD]: true,
};

/** A Standard Schema that accepts anything — this file judges wiring, not validation. */
const anything = { "~standard": { version: 1, vendor: "test", validate: (value: unknown) => ({ value }) } } as const;

/** A consumer's own field — a name the package never declares. */
const riskField: EntryExtension = {
  risk: { schema: anything, hint: `"low" | "high"` },
};

it("the package's entry extension declares summary, per, acceptance, tests, pins and notes", () => {
  const extension = entryExtension();

  // The six the title names, in the spec's order, ahead of whatever the
  // package declares beside them — the risk flag's own case is below.
  expect(Object.keys(extension).slice(0, SPEC_FIELDS.length)).toEqual(SPEC_FIELDS);

  // The acceptance: every declared field reaches a prompt through the
  // engine's own renderer, each carrying the hint its declaration holds.
  // Read off the declaration rather than restated here — a hint list by the
  // tester's hand is the second copy this module exists to prevent.
  const rendered = renderSchemaForPrompt(extension);
  for (const [name, field] of Object.entries(extension)) {
    expect(rendered).toContain(`"${name}": `);
    expect(rendered).toContain(field.hint);
  }

  // Each hint appears once: a field rendered twice would satisfy the
  // `toContain` above while handing the agent two schemas for one field.
  for (const field of Object.values(extension)) {
    expect(rendered.split(field.hint)).toHaveLength(2);
  }

  // And the same declaration is what the parser enforces: the render is a
  // claim about a schema only if that schema is the one a gate runs.
  const parsed = parsePendingQueue(entryQueue({}), extension);
  expect(parsed.errors).toEqual([]);
  expect(parsed.entries).toHaveLength(1);
});

it("parsePendingQueue accepts an entry carrying a value for every field the package's entry extension declares", () => {
  const extension = entryExtension();

  // Ahead of the parse: the fixture covers the declaration's whole key set,
  // read off the declaration rather than off this file's own list. Without
  // this the parse below would pass over whichever fields the fixture
  // happened to value, while reading as a claim about all of them.
  expect(Object.keys(everyPackageField).sort()).toEqual(Object.keys(extension).sort());

  // And every one of them survives the real parser, carrying its value out:
  // an optional field the schema silently dropped would leave the render
  // leg's set and the parse leg's disagreeing.
  const parsed = parsePendingQueue(entryQueue(everyPackageField), extension);
  expect(parsed.errors).toEqual([]);
  expect(parsed.entries).toHaveLength(1);
  expect(parsed.entries[0]).toMatchObject(everyPackageField);
});

it("a consumer field is merged into the entry extension beside the package's own", () => {
  const extension = entryExtension(riskField);

  expect(Object.keys(extension)).toEqual([...PACKAGE_FIELDS, "risk"]);

  // Beside, not instead: the package's own still parse and still render.
  const parsed = parsePendingQueue(entryQueue({ risk: "low" }), extension);
  expect(parsed.errors).toEqual([]);
  expect(parsed.entries[0]).toMatchObject({ risk: "low", summary: expect.any(String) });

  const rendered = renderSchemaForPrompt(extension);
  expect(rendered).toContain(riskField.risk!.hint);
  for (const name of PACKAGE_FIELDS) expect(rendered).toContain(`"${name}": `);
});

it("a consumer extension that drops a package field is refused, naming the field", () => {
  // Redeclaring a package field displaces its schema and its hint — removal
  // spelled as addition, which is what the spec section denies.
  for (const name of PACKAGE_FIELDS) {
    const usurper: EntryExtension = { [name]: { schema: anything, hint: `"anything"` } };
    expect(() => entryExtension(usurper)).toThrow(EntryFieldRemovalError);
    expect(() => entryExtension(usurper)).toThrow(new RegExp(`"${name}"`));
  }
  expect(SPEC_FIELDS.length).toBe(6);
  expect(PACKAGE_FIELDS.length).toBeGreaterThan(SPEC_FIELDS.length);
});

it("a summary past the package's cap is refused", () => {
  const extension = entryExtension();

  // At the cap, through the real parser — without this the refusal below
  // would pass over a schema that rejected every summary.
  const atCap = parsePendingQueue(
    entryQueue({ summary: "x".repeat(ENTRY_CAPS.summary) }),
    extension,
  );
  expect(atCap.errors).toEqual([]);

  const past = parsePendingQueue(
    entryQueue({ summary: "x".repeat(ENTRY_CAPS.summary + 1) }),
    extension,
  );
  expect(past.ok).toBe(false);
  expect(past.errors.map((e) => e.path)).toContain("summary");
});

it("a notes value past the package's cap is refused through the real parser", () => {
  const extension = entryExtension();

  // At the cap first, for the reason the summary pair above has one: a
  // schema that rejected every `notes` would satisfy the refusal alone.
  const atCap = parsePendingQueue(
    entryQueue({ notes: "x".repeat(ENTRY_CAPS.notes) }),
    extension,
  );
  expect(atCap.errors).toEqual([]);
  expect(atCap.entries[0]).toMatchObject({ notes: "x".repeat(ENTRY_CAPS.notes) });

  const past = parsePendingQueue(
    entryQueue({ notes: "x".repeat(ENTRY_CAPS.notes + 1) }),
    extension,
  );
  expect(past.ok).toBe(false);
  expect(past.errors.map((e) => e.path)).toContain("notes");
});

it("the package entry extension accepts an entry that omits contractTouching", () => {
  const extension = entryExtension();

  // Non-vacuity first: the field is really declared, so "omitting it parses"
  // is a statement about an optional field rather than about a key the
  // extension never had.
  expect(Object.keys(extension)).toContain(CONTRACT_TOUCHING_FIELD);

  // The ordinary entry — no risk flag — through the real parser.
  const omitted = parsePendingQueue(entryQueue({}), extension);
  expect(omitted.errors).toEqual([]);
  expect(omitted.entries).toHaveLength(1);
  expect(omitted.entries[0]).not.toHaveProperty(CONTRACT_TOUCHING_FIELD);

  // And the marked entry parses to the boolean the handoff reads back off
  // `FanoutEntryOutcome.extension`, so the two sides of that read agree.
  const marked = parsePendingQueue(
    entryQueue({ [CONTRACT_TOUCHING_FIELD]: true }),
    extension,
  );
  expect(marked.errors).toEqual([]);
  expect(marked.entries[0]).toMatchObject({ [CONTRACT_TOUCHING_FIELD]: true });

  // A non-boolean is refused, naming the field — without this the two cases
  // above would pass over a schema that accepted anything.
  const bogus = parsePendingQueue(
    entryQueue({ [CONTRACT_TOUCHING_FIELD]: "yes" }),
    extension,
  );
  expect(bogus.ok).toBe(false);
  expect(bogus.errors.map((e) => e.path)).toContain(CONTRACT_TOUCHING_FIELD);
});

it("the rendered contract-touching hint names the contracts two tick children share", () => {
  const extension = entryExtension();
  const field = extension[CONTRACT_TOUCHING_FIELD];
  if (field === undefined) {
    throw new Error(`the package declares no "${CONTRACT_TOUCHING_FIELD}" field`);
  }

  // The hint under test is the declared one reaching a prompt through the
  // engine's own renderer — the agreement this file exists for, so the
  // phrases below are judged on what a plan tick actually reads.
  const rendered = renderSchemaForPrompt(extension);
  expect(rendered).toContain(field.hint);

  // Nothing but a plan tick's judgment sets this field, so the hint is the
  // whole rule as that tick meets it. Both sides of `spec/loop.md`, *One
  // tick is one fresh process*: the supervisor-to-child contract, and the
  // one two children share.
  expect(field.hint).toContain("supervisor");
  expect(field.hint).toContain("two tick children");

  // And the paths that spell the second kind, so "children" is not the word
  // standing alone: an entry moving any of them is one to mark.
  for (const shared of ["entry claims", "locks", "branch grammar"]) {
    expect(field.hint).toContain(shared);
  }
});

/**
 * A split suite's lanes, as a consumer's runner reports them: the lane that
 * runs excludes two globs, the idle one excludes something else entirely so
 * a hint quoting the wrong lane is visible.
 */
const SPLIT: readonly Lane[] = [
  { name: "fast", excludes: ["tests/**/*.slow.test.ts", "bench/**"], runs: true },
  { name: "nightly", excludes: ["tests/unit/**"], runs: false },
];

/** The lane that runs, read off the declaration above rather than respelled. */
const RUNNING = SPLIT[0]!;

/** The lane that does not run — whose exclusions plan is told nothing about. */
const IDLE = SPLIT[1]!;

/** One field's hint off a composed extension, or a failure naming the field. */
const hintOf = (extension: ReturnType<typeof entryExtension>, field: string): string => {
  const declared = extension[field];
  if (declared === undefined) throw new Error(`no "${field}" field on the extension`);
  return declared.hint;
};

it("the tests[] hint names the globs the running lane excludes", () => {
  // Non-vacuity: the lane under test really excludes something, so the
  // assertions below are about globs rather than about an empty list.
  expect(RUNNING.excludes.length).toBeGreaterThan(0);

  const hint = hintOf(entryExtension(undefined, SPLIT), "tests");

  for (const glob of RUNNING.excludes) expect(hint).toContain(glob);
  expect(hint).toContain(RUNNING.name);

  // The running lane's, not every lane's: a hint naming what the idle lane
  // skips would send plan away from the files the judge does reach.
  expect(hint).not.toContain(IDLE.name);
  for (const glob of IDLE.excludes) expect(hint).not.toContain(glob);

  // And it reaches plan: the hint is what the engine's own renderer puts in
  // the schema block, not a string this module keeps to itself.
  expect(renderSchemaForPrompt(entryExtension(undefined, SPLIT))).toContain(hint);
});

it("the pins[] hint names the globs the running lane excludes", () => {
  expect(RUNNING.excludes.length).toBeGreaterThan(0);

  const hint = hintOf(entryExtension(undefined, SPLIT), "pins");

  for (const glob of RUNNING.excludes) expect(hint).toContain(glob);
  expect(hint).toContain(RUNNING.name);
  expect(hint).not.toContain(IDLE.name);
  for (const glob of IDLE.excludes) expect(hint).not.toContain(glob);

  expect(renderSchemaForPrompt(entryExtension(undefined, SPLIT))).toContain(hint);
});

it("a running lane with no exclusions renders the hint without a lane clause", () => {
  const unsplit: readonly Lane[] = [{ name: "default", excludes: [], runs: true }];
  const quiet = entryExtension(undefined, unsplit);
  const laneless = entryExtension();

  // Nothing excluded, nothing said: the hints are byte-identical to the ones
  // a runner that declared no lanes at all composes.
  expect(hintOf(quiet, "tests")).toBe(hintOf(laneless, "tests"));
  expect(hintOf(quiet, "pins")).toBe(hintOf(laneless, "pins"));

  // And the clause it is missing is a real one — without this the case above
  // passes over a composition that never renders a lane clause for anyone.
  expect(hintOf(entryExtension(undefined, SPLIT), "tests")).not.toBe(
    hintOf(laneless, "tests"),
  );
  expect(hintOf(entryExtension(undefined, SPLIT), "pins")).not.toBe(
    hintOf(laneless, "pins"),
  );

  // The clause is the only difference: every other field renders the same
  // whatever the lanes, so nothing else moved with it.
  for (const field of PACKAGE_FIELDS.filter((f) => f !== "tests" && f !== "pins")) {
    expect(hintOf(entryExtension(undefined, SPLIT), field)).toBe(hintOf(laneless, field));
  }
});
