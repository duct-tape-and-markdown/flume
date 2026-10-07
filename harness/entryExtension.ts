/**
 * The entry extension the harness package declares (`spec/harness.md`, *The
 * entry extension*) — `summary`, `per`, `acceptance`, `tests[]`, `pins[]`,
 * `laneTests[]`, `notes`, with their caps and their hints, plus the optional
 * {@link CONTRACT_TOUCHING_FIELD} the package's default handoff acts on and
 * the optional interface an entry states when it changes what its callers
 * call.
 *
 * Each field is declared **once**, as the engine's `EntryExtensionField`:
 * the `schema` side validates at parse and gate time, the `hint` side
 * renders into the plan prompt through the engine's own
 * `renderSchemaForPrompt`. A prompt paragraph restating a hint, or a judge
 * re-checking a cap, is a second copy of a fact this module owns
 * (`.claude/rules/engineering.md`, *Derived state is computed, never
 * restated beside its source*).
 *
 * A consumer adds fields here; it cannot take one away. {@link
 * entryExtension} merges the consumer's own beside the package's and refuses
 * a key that would displace one, naming it. That is the whole of the
 * "may add, may not remove" rule as mechanism rather than as prose.
 *
 * This module is shape alone. Whether a `per` path lands inside the declared
 * `specLocus`, whether the cited section is a heading in the gated commit,
 * and whether a `tests[]` line runs red on the base belong to the cite
 * resolver, the `per` gate and the judge that read this.
 */

import { z } from "zod";

import type { EntryExtension, EntryExtensionField } from "../src/PendingSchema.js";
import type { Declaration } from "./declaration.js";
import type { Lane } from "./runner.js";

/**
 * The caps the package enforces, in characters. Public because they are the
 * package's opinion about entry prose, and because the hints below render
 * them rather than restating them — one number, read by the schema that
 * enforces it and by the prompt that announces it.
 */
export const ENTRY_CAPS = Object.freeze({
  /** `summary` is a one-liner; past this it is prose that belongs in `notes`. */
  summary: 200,
  /** `notes` is context, not a design document. */
  notes: 500,
});

/**
 * The cite that justifies the work: which file, which section of it. Shape
 * only — whether the path lands inside the consumer's declared `specLocus`
 * and whether the section is in the cited file belong to the cite resolver
 * (`citeResolver.ts`), which reads a cite as exactly this rather than as a
 * second `{ path, section }` beside it (`.claude/rules/engineering.md`,
 * *Derived state is computed, never restated beside its source*). An entry
 * that cannot carry a clean cite is a question for a human rather than a
 * queue entry.
 */
export const PerSchema = z.strictObject({
  path: z.string().min(1),
  section: z.string().min(1),
});

/**
 * A list of named lines — the shape `tests[]` and `pins[]` share. One
 * schema, three readers: the two fields below, and the judge gate that
 * narrows an entry's lines before ruling on them. A second spelling beside
 * this one is a lane the gate reads under a shape the queue was never
 * validated against (`.claude/rules/engineering.md`, *Derived state is
 * computed, never restated beside its source*).
 *
 * Defaulted rather than optional: an entry that names no line has an empty
 * list, and a reader that had to tell `undefined` from `[]` would be
 * deciding the same thing twice.
 */
export const NamedLinesSchema = z.array(z.string().min(1)).default([]);

/**
 * The entry's `laneTests[]`: a case only another host runs, named by the lane
 * that runs it and the title it carries (`spec/harness.md`, *The judges*).
 *
 * `lane` is the **CI lane's** name — the key that lane already files its
 * findings under (*CI lanes as a findings source*) — and not a runner lane,
 * which is a selection of the suite the judge itself drives. The two senses
 * meet on this field, and the one that decides a `laneTests[]` line's proof
 * is the CI lane: the line is owed there, so the lane's own red closes or
 * files it.
 *
 * Shape alone, which is what a reader narrowing a value that already parsed
 * takes (`judgeGate.ts`). The composed field below holds `lane` to the lanes
 * the declaration carries — {@link laneTestsSchema}, since that set is the
 * consumer's and this constant is the package's. Whether a case carrying the
 * title is skipped on this host stays the judge's.
 *
 * Defaulted rather than optional, for the reason {@link NamedLinesSchema}
 * is.
 */
export const LaneTestsSchema = z
  .array(
    z.strictObject({
      lane: z.string().min(1),
      title: z.string().min(1),
    }),
  )
  .default([]);

/**
 * The declared CI lane names — the one derivation the schema below refuses
 * against and the hint beside it announces, so the set a line is judged on
 * and the set a plan tick is told cannot drift apart.
 *
 * An absent `ci` reads as the empty set: a consumer who declared no lane and a
 * composition handed none have the same lanes available, which is none.
 */
const ciLaneNames = (ci: Declaration["ci"]): readonly string[] =>
  (ci ?? []).map((lane) => lane.name);

/**
 * {@link LaneTestsSchema} with every line's `lane` held to the CI lanes the
 * declaration carries — the field as {@link packageFields} composes it, and
 * the only place the two declared senses of a lane name are checked against
 * each other.
 *
 * A lane no declaration names is **refused**, not parsed: the line is owed to
 * that lane and nothing else can close it, because the judge reports the lane
 * verbatim and the inbox slice reads findings per declared lane
 * (`spec/harness.md`, *CI lanes as a findings source*). A typo'd or retired
 * name is therefore a line owed forever — never green, never filed — which is
 * a degraded input the queue carries indefinitely unless something refuses on
 * it (`.claude/rules/engineering.md`, *Loud or nothing*).
 *
 * A declaration carrying no `ci` refuses every line, which is the same rule
 * over an empty set rather than a case beside it. The cost is stated rather
 * than hidden: a consumer whose second host is a human at a keyboard cannot
 * file a `laneTests[]` line, because there is no lane whose run could ever
 * close one — that case is a question for that human.
 */
function laneTestsSchema(ci: Declaration["ci"]) {
  const declared = ciLaneNames(ci);
  return LaneTestsSchema.superRefine((lines, ctx) => {
    lines.forEach((line, index) => {
      if (declared.includes(line.lane)) return;
      ctx.addIssue({
        code: "custom",
        path: [index, "lane"],
        message:
          `\`${line.lane}\` is not a declared CI lane — ` +
          (declared.length === 0
            ? "the declaration carries no `ci` at all"
            : `the declaration carries ${declared.map((name) => `\`${name}\``).join(", ")}`) +
          `. A laneTests[] line is owed to its lane until that lane's own run ` +
          `reports the title green, so a lane nothing reports is a line owed ` +
          `forever (spec/harness.md, The judges).`,
      });
    });
  });
}

/**
 * The lanes a `laneTests[]` line may name, as the hint announces them: the
 * declared names, or the sentence that says there are none.
 *
 * Rendered from the same list {@link laneTestsSchema} refuses on, because a
 * refusal whose valid values a plan tick cannot read is a gate that reverts a
 * tick for a fact nothing told it — and only `plan-inbox`'s prompt carries
 * the lanes otherwise (`inboxWindow.ts`).
 */
function ciLaneClause(ci: Declaration["ci"]): string {
  const declared = ciLaneNames(ci).map((name) => `\`${name}\``);
  if (declared.length === 0) {
    return (
      "; this declaration carries no CI lane, so no laneTests[] line can be " +
      "filed — a host-gated case with no lane to be owed to is a question " +
      "for a human"
    );
  }
  return (
    `; the declared lanes are ${declared.join(", ")}, and a line naming ` +
    `anything else is refused`
  );
}

/**
 * One `laneTests[]` line as the judge rules on it — the shape
 * {@link LaneTestsSchema} parses to, named here rather than respelled at the
 * judge (`.claude/rules/engineering.md`, *Derived state is computed, never
 * restated beside its source*).
 */
export type LaneTest = z.output<typeof LaneTestsSchema>[number];

/**
 * The name of the risk flag `spec/loop.md`, *One tick is one fresh process*,
 * calls "marked contract-touching": an entry whose work changes a contract a
 * run already in flight cannot safely absorb.
 *
 * Two kinds of contract, one flag. One is supervisor-to-child — the
 * claim-inheritance env, the verdict paths, the exit-code map — frozen on a
 * supervisor resident at its launch version and live on every child it
 * spawns. The other is child-to-child: a wave that refills outlasts merges,
 * so it runs the code it started on beside siblings spawned after one
 * changed it, and every path two children read and write as one — the entry
 * claims, the locks, the branch grammar — is a contract of the same kind. A
 * move of one of those leaves an older wave's claims invisible to a newer
 * drain, which is the second kind's shape of the same livelock.
 *
 * One spelling, two readers: the field declared below, and `handoff.ts`
 * reading it back off a shipped entry's reported extension. A string literal
 * at the reader would be a second copy of this declaration's key, kept in
 * sync by discipline (`.claude/rules/engineering.md`, *Derived state is
 * computed, never restated beside its source*).
 */
export const CONTRACT_TOUCHING_FIELD = "contractTouching";

/**
 * What the running lane will not reach, as a clause on the three named-line
 * hints — the reader `spec/harness.md`, *The runner interface* names for
 * `Runner.lanes`.
 *
 * Informs, never refuses. An entry's `files` is a prediction build is not
 * held to, so no gate can rule on where a line's test will land; what plan
 * can be given is the globs at authorship, while it is still choosing which
 * behavior to name. The globs are the consumer's own, in the consumer's own
 * glob vocabulary, so the clause stays as tool-neutral as the hints it rides
 * (`.claude/rules/engine-boundary.md`, *Surface, not prescription*).
 *
 * Empty for a runner whose running lane excludes nothing, and for one that
 * declared no lanes at all: a clause naming no glob is a sentence every plan
 * tick pays for and no plan tick can act on.
 */
function laneClause(lanes: readonly Lane[]): string {
  const running = lanes.find((lane) => lane.runs);
  if (running === undefined || running.excludes.length === 0) return "";
  return (
    `; the lane that runs (${running.name}) does not run ` +
    `${running.excludes.join(", ")}, so a line whose test lands there is ` +
    `carried by nothing the judge sees`
  );
}

/**
 * The package's fields, in the order `spec/harness.md` lists them — which is
 * the order they render in, since `renderSchemaForPrompt` follows
 * declaration order — with {@link CONTRACT_TOUCHING_FIELD} and the intended
 * interface last, after the six that section names.
 *
 * Built per composition rather than held as a constant, because three of the
 * hints carry {@link laneClause} and one field's schema is held to the
 * declared CI lanes ({@link laneTestsSchema}) — both the consumer's, neither
 * the package's to hold as a constant.
 *
 * No hint here names a test tool. The judge speaks to whatever runner the
 * consumer declared (`spec/harness.md`, *The runner interface*), so a hint
 * that said "vitest" would be the package teaching every consumer's plan
 * phase a tool half of them do not run.
 */
function packageFields(context: ExtensionContext) {
  const lane = laneClause(context.lanes ?? []);
  return {
    summary: {
      schema: z.string().min(1).max(ENTRY_CAPS.summary),
      hint: `"one-line what (≤${ENTRY_CAPS.summary} chars)"`,
    },
    per: {
      schema: PerSchema,
      hint: `{ "path": "the file that justifies this work, inside the declared spec locus", "section": "exact heading text, no leading '#'" }`,
    },
    acceptance: {
      schema: z.string().min(1),
      hint: `"what turns green when this is done"`,
    },
    /**
     * Acceptance decomposed: one line per behavior the work must pin, written
     * as a test title. The behavior only — which file the test lands in is
     * build's call, and a declared path would be both a second copy of `files`
     * and plan prescribing inside build's lane.
     */
    tests: {
      schema: NamedLinesSchema,
      hint: `[ "behavior this entry introduces or changes" ] — one per behavior, written as a test title: build titles a passing test with the line verbatim; the judge proves it passes, then proves it fails on the pre-fix tree; the file is build's call${lane}`,
    },
    /**
     * A property that already holds and gains its check here — an agreement
     * pin, a doc-to-source scan. Judged green only: red-on-base cannot apply
     * to a test whose subject was true before the entry, and refusing it turns
     * a real pin back into prose. Plan chooses the list a line belongs to.
     */
    pins: {
      schema: NamedLinesSchema,
      hint: `[ "property that already holds and gains its check here" ] — same title discipline as tests[]; judged green, never red on the base${lane}`,
    },
    /**
     * A behavior only another host can run — the case a host-gated defect
     * ships (`.claude/rules/engineering.md`, *A fix ships the test that would
     * have caught it*). Named by the CI lane that runs it and the title it
     * carries: on the build host the case is skipped, so the judge reports the
     * line owed to that lane rather than green, and the lane's own red is
     * what files or closes it.
     */
    laneTests: {
      schema: laneTestsSchema(context.ci),
      hint: `[ { "lane": "a declared CI lane's name", "title": "behavior only that lane's host can run" } ] — for a case this host cannot run at all: same title discipline as tests[], written skipped on every other host so the suite reports it skipped and never failed. The judge reports each owed to its lane and never green, so the lane is the proof: a red title files as that lane's finding and a run on the tip reporting it green closes it. A behavior this host can run belongs in tests[]${ciLaneClause(context.ci)}${lane}`,
    },
    notes: {
      schema: z.string().max(ENTRY_CAPS.notes).optional(),
      hint: `"≤${ENTRY_CAPS.notes} chars; optional context not in the spec"`,
    },
    /**
     * The risk flag the package's default handoff acts on: shipping a marked
     * entry ends the run (`harness/handoff.ts`), because a run meeting its own
     * changed contract mid-flight is the livelock `spec/loop.md` documents.
     * Both kinds of contract {@link CONTRACT_TOUCHING_FIELD} names arm it, and
     * the hint carries both, because nothing but a plan tick's judgment sets
     * this field and the hint is where that tick reads the rule.
     *
     * Optional and unset by default, so a consumer whose plan never marks an
     * entry never meets the stop. Nothing reads the value but that handoff, so
     * nothing beyond the boolean is enforced on it.
     */
    [CONTRACT_TOUCHING_FIELD]: {
      schema: z.boolean().optional(),
      hint: `true when the work changes a contract a run already in flight cannot absorb — one a resident loop supervisor and a fresh tick child must agree on (the claim-inheritance env, the verdict paths, the exit-code map), or one two tick children share, since a wave that refills runs the code it started on beside siblings spawned after a merge changed it: every path two children read and write as one — the entry claims, the locks, the branch grammar — is the second kind. Shipping one ends the run; omit otherwise`,
    },
    /**
     * The interface the work intends, for an entry that adds to or changes
     * what code outside the modules it touches calls. Build reads it beside
     * the acceptance criterion: acceptance says what turns green, this says
     * what shape turns it.
     *
     * Three parts, and a present field carries all three or is **refused**
     * naming the one it is missing. Two of them state the surface from both
     * sides — what a caller gains and what it no longer has to know — and the
     * third is the alternative that lost, with why. A design handed over
     * without its rejected shape reads as the only one anyone considered, so
     * build re-opens the choice it was supposed to inherit; a partial one is a
     * degraded input, and nothing downstream can refuse on it later
     * (`.claude/rules/engineering.md`, *Loud or nothing*).
     *
     * Optional, because most entries change no caller's view, and **whether
     * an entry needs one is plan's judgment** — no gate re-decides it. The
     * schema rules on completeness alone: a strict object, so a fourth part
     * is refused rather than reaching build as shape nothing announced.
     */
    interface: {
      schema: z
        .strictObject({
          changes: z.string().min(1),
          hides: z.string().min(1),
          rejected: z.string().min(1),
        })
        .optional(),
      hint: `{ "changes": "what callers outside the touched modules gain or call differently", "hides": "what the shape stops asking a caller to know", "rejected": "the alternative shape this turns down, and why it lost" } — optional, for an entry that adds to or changes what code outside its own modules calls; all three parts or the entry is refused, and omitted entirely where no caller's view moves`,
    },
  } satisfies Record<string, EntryExtensionField>;
}

/** Thrown when a consumer's extension would displace a package field. */
export class EntryFieldRemovalError extends Error {
  constructor(readonly field: string) {
    super(
      `entry extension field "${field}" is the harness package's own and ` +
        `cannot be redeclared or removed (spec/harness.md, The entry ` +
        `extension). Add fields under other names.`,
    );
    this.name = "EntryFieldRemovalError";
  }
}

/**
 * The consumer's own values the package's fields are composed against — the
 * two senses of a lane this package carries, each reaching a different half
 * of the composition.
 *
 * Both are optional, and an omitted one is a composition that was handed
 * nothing rather than a consumer who declared nothing: the two coincide,
 * because what a field does with an empty set is what it does with a set the
 * declaration left empty.
 */
export interface ExtensionContext {
  /**
   * The consumer's runner's lanes (`spec/harness.md`, *The runner interface*):
   * the running lane's exclusions ride the `tests[]`, `pins[]` and
   * `laneTests[]` hints, so plan is told at authorship which globs no judge
   * will reach. Informs alone — omitted where no runner is in hand, and a
   * hint is not something a parse can refuse on.
   */
  readonly lanes?: readonly Lane[] | undefined;
  /**
   * The CI lanes the declaration carries (`spec/harness.md`, *CI lanes as a
   * findings source*) — the names a `laneTests[]` line's `lane` is held to,
   * so every composition that parses a queue is handed these. Read off
   * {@link Declaration} rather than respelled, so a lane field the schema
   * gains arrives here without a second edit.
   */
  readonly ci?: Declaration["ci"];
}

/**
 * The package's entry extension, with the consumer's own fields merged in
 * beside it.
 *
 * A consumer key naming a package field is refused rather than merged: a
 * redeclaration displaces the package's schema and hint, which is removal
 * spelled as addition, and it is exactly what the spec denies. The refusal
 * throws at chain load, where a half-adopted extension leaves nothing to run
 * a tick against (`.claude/rules/engineering.md`, *Loud or nothing*).
 *
 * Shadowing an **engine-core** field is a different refusal with a different
 * owner: `composePendingEntry` already throws on it, so nothing here
 * re-derives that check beside it (*The fix lands at the mechanism*). A
 * consumer refining `tag` is passed through untouched — the engine composes
 * a refinement there as an intersection over its own mechanical floor.
 *
 * Both halves of {@link ExtensionContext} reach a different half of the
 * composition: `lanes` informs three hints, `ci` is what the `laneTests[]`
 * schema refuses against ({@link laneTestsSchema}). Every composition that
 * parses a queue is handed `ci` — the chain's and the pending gate's alike —
 * or one field is held to two rules by the two readers of it.
 */
export function entryExtension(
  consumer?: EntryExtension,
  context: ExtensionContext = {},
): EntryExtension {
  const fields = packageFields(context);
  for (const field of Object.keys(consumer ?? {})) {
    if (field in fields) throw new EntryFieldRemovalError(field);
  }
  return { ...fields, ...consumer };
}
