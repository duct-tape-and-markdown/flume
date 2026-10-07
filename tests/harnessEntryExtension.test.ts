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

import { readFile } from "node:fs/promises";

import { expect, it } from "vitest";

import {
  CONTRACT_TOUCHING_FIELD,
  ENTRY_CAPS,
  EntryFieldRemovalError,
  entryExtension,
} from "../harness/index.ts";
import type { Declaration, Lane } from "../harness/index.ts";
import { parsePendingQueue, renderSchemaForPrompt } from "../src/index.ts";
// The naming rule, not the package surface: a fixture composing an entry's
// own file takes the engine's spelling of `<tag>.json` rather than a second
// copy of it (`spec/pending.md`, *The ledger is a directory — one entry per
// file*).
import { entryFileName } from "../src/PendingSchema.ts";
import type { EntryExtension, QueueFile } from "../src/index.ts";
import { bulletOf, sectionOf } from "./helpers/docSections.ts";

/** The six the spec section lists, in the order it lists them. */
const SPEC_FIELDS = ["summary", "per", "acceptance", "tests", "pins", "notes"];

/**
 * The key the package declares the intended interface under, and the three
 * parts a present one carries. Spelled here because this is the side a parse
 * is driven from — an entry's author types these keys by hand — and because
 * every case below is about which of the three is missing, which no reader of
 * the declaration can say.
 */
const INTERFACE_FIELD = "interface";
const INTERFACE_PARTS = ["changes", "hides", "rejected"] as const;

/** One complete interface, as an entry carrying all three parts states it. */
const wholeInterface: Record<string, string> = {
  changes: "entryExtension() declares one more optional field",
  hides: "which part of a present interface the schema refused on",
  rejected: "three optional strings — a two-part interface would reach build",
};

/**
 * The fields the running lane's exclusions ride: the two the spec section
 * lists and the host-gated one declared beside them, which shares their bar
 * on where a line's test may land.
 */
const NAMED_LINE_FIELDS = ["tests", "pins", "laneTests"];

/**
 * Every field the package declares, in declaration order — which is render
 * order: those six, with the host-gated named-line field among them beside
 * the two it shares a bar with, and the package's risk flag last.
 */
const PACKAGE_FIELDS = [
  ...SPEC_FIELDS.flatMap((field) => (field === "notes" ? ["laneTests", field] : [field])),
  CONTRACT_TOUCHING_FIELD,
  INTERFACE_FIELD,
];

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
 * The CI lanes a declaration carries, as the composition is handed them — the
 * lane every `laneTests[]` line in this file is owed to.
 *
 * Typed as the declaration's own field rather than a bag shaped like one, so
 * a `ci` lane field the schema gains or renames reds here instead of leaving
 * a fixture the real chain would never compose from
 * (`.claude/rules/engineering.md`, *A seam gate reads what the real writer
 * wrote*).
 */
const CI = [
  { name: "win32", workflow: "ci.yml", job: "windows" },
] satisfies Declaration["ci"];

/** The lane name those lanes declare, read off them rather than respelled. */
const DECLARED_LANE = CI[0]!.name;

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
  laneTests: [{ lane: DECLARED_LANE, title: "a behavior only that lane's host runs" }],
  notes: "context the spec does not carry",
  [CONTRACT_TOUCHING_FIELD]: true,
  [INTERFACE_FIELD]: wholeInterface,
};

/** A Standard Schema that accepts anything — this file judges wiring, not validation. */
const anything = { "~standard": { version: 1, vendor: "test", validate: (value: unknown) => ({ value }) } } as const;

/** A consumer's own field — a name the package never declares. */
const riskField: EntryExtension = {
  risk: { schema: anything, hint: `"low" | "high"` },
};

it("the package's entry extension declares summary, per, acceptance, tests, pins and notes", () => {
  const extension = entryExtension();

  // The six the title names, in the spec's order — read as a subsequence of
  // the declaration rather than its prefix, since `laneTests[]` is declared
  // among them, beside the two named-line fields it shares a bar with. The
  // risk flag's own case is below.
  expect(Object.keys(extension).filter((key) => SPEC_FIELDS.includes(key))).toEqual(
    SPEC_FIELDS,
  );

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
  // Composed with the declared lanes the fixture's `laneTests[]` line names:
  // `lane` is held to them, so a composition handed none would refuse the
  // line and this case would judge the refusal rather than the field set.
  const extension = entryExtension(undefined, { ci: CI });

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

/**
 * The roster a consumer reads before the hover text, read against the
 * declaration itself (`.claude/rules/engineering.md`, *Narration is the
 * ladder's bottom rung*, the `docs/` carve-out): the page states which fields
 * the package brings to an entry, so it is pinned for what it says against
 * the interface it describes.
 *
 * The names come from `entryExtension()` — the same call every other case here
 * drives — so a field added to the declaration reds this until the page names
 * it, and a rename carries the page with it. A list field is rostered with its
 * brackets, `tests[]` for `tests`: that is the page spelling a shape, not a
 * second name, so the suffix folds out before the compare.
 *
 * The span is the parenthetical roster inside the harness-package bullet,
 * rather than the bullet or the page whole: `docs/CHAIN-AUTHORING.md` walks a
 * consumer's *own* entry extension further down, under an example naming
 * `summary` and `per`, so a wider read would report a roster naming none of
 * the package's fields as complete. Nothing here restates a hint or a cap —
 * what a field means is the declaration's, and this is only which fields
 * exist.
 */
it("docs/CHAIN-AUTHORING.md names every field the package's entry extension declares", async () => {
  const fields = Object.keys(entryExtension());

  // Vacuity pin on the demand: the declaration handed over its whole set, the
  // risk flag included, before a page is read against it. A demand read as
  // empty is rostered in full by every page there is.
  expect(fields).toEqual(expect.arrayContaining(PACKAGE_FIELDS));

  const page = await readFile(
    new URL("../docs/CHAIN-AUTHORING.md", import.meta.url),
    "utf8",
  );
  const bullet = bulletOf(
    sectionOf(page, "## First: do you need to write one?"),
    "- **The harness package** — ",
  );
  const roster = /\bthe entry extension \(([^)]*)\)/.exec(bullet)?.[1] ?? "";
  const rostered = [...roster.matchAll(/`([^`]+)`/g)].map((match) =>
    match[1]!.replace(/\[\]$/, ""),
  );

  // Vacuity pin on the subject: the cut reached a roster of names. `bulletOf`
  // throws on an absent lead, and this is the other half — a parenthetical the
  // page reworded away would leave the verdict below green over no names. The
  // floor is one name rather than the declared count, so a page short of the
  // set reds at the verdict, where the diff names the field it is missing.
  expect(rostered.length).toBeGreaterThan(0);

  // The verdict, both ways over a closed roster: a field the package adds
  // cannot ship beside a page still naming the old set, and a field it retires
  // leaves no name standing there.
  expect([...rostered].sort()).toEqual([...fields].sort());
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

it("the laneTests[] field parses a lane and a title, and is declared beside tests and pins", () => {
  const extension = entryExtension(undefined, { ci: CI });
  const declared = [{ lane: DECLARED_LANE, title: "walls a path only win32 refuses" }];

  // Declared among the named-line fields, so the prompt renders the three
  // bars together rather than leaving the host-gated one past `notes`.
  expect(Object.keys(extension).filter((key) => NAMED_LINE_FIELDS.includes(key))).toEqual(
    NAMED_LINE_FIELDS,
  );

  // Both halves survive the real parser, carrying their values out.
  const named = parsePendingQueue(entryQueue({ laneTests: declared }), extension);
  expect(named.errors).toEqual([]);
  expect(named.entries[0]).toMatchObject({ laneTests: declared });

  // Omitted parses as the empty list, so the judge reads one shape rather
  // than telling `undefined` from `[]`.
  const omitted = parsePendingQueue(entryQueue({}), extension);
  expect(omitted.errors).toEqual([]);
  expect(omitted.entries[0]).toMatchObject({ laneTests: [] });

  // And a line missing either half is refused, naming the field — without
  // this the two cases above would pass over a schema accepting anything.
  for (const bogus of [
    [{ lane: "win32" }],
    [{ title: "a case" }],
    ["a case"],
    [{ lane: "", title: "a case" }],
    [{ lane: "win32", title: "a case", extra: true }],
  ]) {
    const refused = parsePendingQueue(entryQueue({ laneTests: bogus }), extension);
    expect(refused.ok).toBe(false);
    expect(refused.errors.map((e) => e.path).join(" ")).toContain("laneTests");
  }
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

it("the laneTests[] hint announces the CI lanes its own schema accepts", () => {
  // The two sides of one seam: the lanes a line may name are refused by the
  // schema and announced by the hint, and only the `plan-inbox` prompt carries
  // the declared lanes otherwise (`inboxWindow.ts`) — so a plan slice filing a
  // line reads them here or guesses at a refusal.
  const declaredHint = hintOf(entryExtension(undefined, { ci: CI }), "laneTests");
  expect(declaredHint).toContain(DECLARED_LANE);

  // The schema half, over the same composition: the announced lane parses.
  const parsed = parsePendingQueue(
    entryQueue({ laneTests: [{ lane: DECLARED_LANE, title: "a host-gated case" }] }),
    entryExtension(undefined, { ci: CI }),
  );
  expect(parsed.errors).toEqual([]);

  // And a composition handed no lanes announces that instead of a name — the
  // hint is derived from the set, not a constant that happens to read right
  // where one is declared.
  const laneless = hintOf(entryExtension(), "laneTests");
  expect(laneless).not.toBe(declaredHint);
  expect(laneless).toContain("no CI lane");
});

it("the tests[] hint names the globs the running lane excludes", () => {
  // Non-vacuity: the lane under test really excludes something, so the
  // assertions below are about globs rather than about an empty list.
  expect(RUNNING.excludes.length).toBeGreaterThan(0);

  const hint = hintOf(entryExtension(undefined, { lanes: SPLIT }), "tests");

  for (const glob of RUNNING.excludes) expect(hint).toContain(glob);
  expect(hint).toContain(RUNNING.name);

  // The running lane's, not every lane's: a hint naming what the idle lane
  // skips would send plan away from the files the judge does reach.
  expect(hint).not.toContain(IDLE.name);
  for (const glob of IDLE.excludes) expect(hint).not.toContain(glob);

  // And it reaches plan: the hint is what the engine's own renderer puts in
  // the schema block, not a string this module keeps to itself.
  expect(renderSchemaForPrompt(entryExtension(undefined, { lanes: SPLIT }))).toContain(hint);
});

it("the laneTests[] hint names the globs the running lane excludes", () => {
  expect(RUNNING.excludes.length).toBeGreaterThan(0);

  const hint = hintOf(entryExtension(undefined, { lanes: SPLIT }), "laneTests");

  for (const glob of RUNNING.excludes) expect(hint).toContain(glob);
  expect(hint).toContain(RUNNING.name);
  expect(hint).not.toContain(IDLE.name);
  for (const glob of IDLE.excludes) expect(hint).not.toContain(glob);

  expect(renderSchemaForPrompt(entryExtension(undefined, { lanes: SPLIT }))).toContain(hint);
});

it("the pins[] hint names the globs the running lane excludes", () => {
  expect(RUNNING.excludes.length).toBeGreaterThan(0);

  const hint = hintOf(entryExtension(undefined, { lanes: SPLIT }), "pins");

  for (const glob of RUNNING.excludes) expect(hint).toContain(glob);
  expect(hint).toContain(RUNNING.name);
  expect(hint).not.toContain(IDLE.name);
  for (const glob of IDLE.excludes) expect(hint).not.toContain(glob);

  expect(renderSchemaForPrompt(entryExtension(undefined, { lanes: SPLIT }))).toContain(hint);
});

it("a running lane with no exclusions renders the hint without a lane clause", () => {
  const unsplit: readonly Lane[] = [{ name: "default", excludes: [], runs: true }];
  const quiet = entryExtension(undefined, { lanes: unsplit });
  const laneless = entryExtension();

  // Nothing excluded, nothing said: the hints are byte-identical to the ones
  // a runner that declared no lanes at all composes.
  for (const field of NAMED_LINE_FIELDS) {
    expect(hintOf(quiet, field)).toBe(hintOf(laneless, field));
  }

  // And the clause it is missing is a real one — without this the case above
  // passes over a composition that never renders a lane clause for anyone.
  for (const field of NAMED_LINE_FIELDS) {
    expect(hintOf(entryExtension(undefined, { lanes: SPLIT }), field)).not.toBe(
      hintOf(laneless, field),
    );
  }

  // The clause is the only difference: every other field renders the same
  // whatever the lanes, so nothing else moved with it.
  for (const field of PACKAGE_FIELDS.filter((f) => !NAMED_LINE_FIELDS.includes(f))) {
    expect(hintOf(entryExtension(undefined, { lanes: SPLIT }), field)).toBe(hintOf(laneless, field));
  }
});

it("an entry whose interface carries all three parts parses", () => {
  const extension = entryExtension();

  // Non-vacuity: the field is really declared, so what follows is a
  // statement about the package's own schema rather than about a key a
  // strict parse would have refused outright.
  expect(Object.keys(extension)).toContain(INTERFACE_FIELD);

  // The whole fixture's keys are the three parts, read off the parts list
  // rather than trusted: a fixture short of one would make the parse below
  // the refusal case wearing this case's title.
  expect(Object.keys(wholeInterface).sort()).toEqual([...INTERFACE_PARTS].sort());

  // Through the real parser, with every part surviving to the entry build
  // reads: a part the schema dropped would leave build two-thirds of a design
  // while this case still read green.
  const parsed = parsePendingQueue(
    entryQueue({ [INTERFACE_FIELD]: wholeInterface }),
    extension,
  );
  expect(parsed.errors).toEqual([]);
  expect(parsed.entries[0]).toMatchObject({ [INTERFACE_FIELD]: wholeInterface });
});

it("an interface missing one of its three parts is refused at parse", () => {
  const extension = entryExtension();

  // Each part dropped in turn, so the refusal is about completeness rather
  // than about one part the schema happens to require.
  for (const missing of INTERFACE_PARTS) {
    const partial = { ...wholeInterface };
    delete partial[missing];
    const refused = parsePendingQueue(
      entryQueue({ [INTERFACE_FIELD]: partial }),
      extension,
    );
    expect({ missing, ok: refused.ok }).toEqual({ missing, ok: false });

    // Naming the part, not merely the field: an entry refused for "interface"
    // sends a plan tick back to a field it has to re-read in full.
    expect(refused.errors.map((error) => error.path)).toContain(
      `${INTERFACE_FIELD}.${missing}`,
    );
  }

  // A part the declaration never named is refused too — a fourth key is
  // shape nothing announced, and build would inherit it as design.
  const extra = parsePendingQueue(
    entryQueue({ [INTERFACE_FIELD]: { ...wholeInterface, why: "a fourth part" } }),
    extension,
  );
  expect(extra.ok).toBe(false);

  // And an empty part is as absent as a missing one: a field present and
  // blank is the degraded input the three-part rule exists to refuse.
  for (const blank of INTERFACE_PARTS) {
    const emptied = parsePendingQueue(
      entryQueue({ [INTERFACE_FIELD]: { ...wholeInterface, [blank]: "" } }),
      extension,
    );
    expect({ blank, ok: emptied.ok }).toEqual({ blank, ok: false });
  }
});

it("an entry that declares no interface parses", () => {
  const extension = entryExtension();

  // Non-vacuity: the field is declared, so this is a statement about an
  // optional field rather than about a key the extension never had.
  expect(Object.keys(extension)).toContain(INTERFACE_FIELD);

  // Whether an entry needs one is plan's judgment, and no gate re-decides
  // it: the ordinary entry — most of the queue — carries none and parses.
  const omitted = parsePendingQueue(entryQueue({}), extension);
  expect(omitted.errors).toEqual([]);
  expect(omitted.entries).toHaveLength(1);
  expect(omitted.entries[0]).not.toHaveProperty(INTERFACE_FIELD);
});
