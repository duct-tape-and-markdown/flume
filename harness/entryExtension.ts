/**
 * The entry extension the harness package declares (`spec/harness.md`, *The
 * entry extension*) — `summary`, `per`, `acceptance`, `tests[]`, `pins[]`,
 * `notes`, with their caps and their hints, plus the optional
 * {@link CONTRACT_TOUCHING_FIELD} the package's default handoff acts on.
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
 * The name of the risk flag `spec/loop.md`, *One tick is one fresh process*,
 * calls "marked contract-touching": an entry whose work changes a contract a
 * resident supervisor and a fresh tick child must agree on, which a run that
 * started before it cannot safely absorb.
 *
 * One spelling, two readers: the field declared below, and `handoff.ts`
 * reading it back off a shipped entry's reported extension. A string literal
 * at the reader would be a second copy of this declaration's key, kept in
 * sync by discipline (`.claude/rules/engineering.md`, *Derived state is
 * computed, never restated beside its source*).
 */
export const CONTRACT_TOUCHING_FIELD = "contractTouching";

/**
 * What the running lane will not reach, as a clause on the two named-line
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
 * declaration order — with {@link CONTRACT_TOUCHING_FIELD} last, after the
 * six that section names.
 *
 * Built per composition rather than held as a constant, because two of the
 * hints carry {@link laneClause} and the lanes are the consumer's runner's.
 *
 * No hint here names a test tool. The judge speaks to whatever runner the
 * consumer declared (`spec/harness.md`, *The runner interface*), so a hint
 * that said "vitest" would be the package teaching every consumer's plan
 * phase a tool half of them do not run.
 */
function packageFields(lanes: readonly Lane[]) {
  const lane = laneClause(lanes);
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
    notes: {
      schema: z.string().max(ENTRY_CAPS.notes).optional(),
      hint: `"≤${ENTRY_CAPS.notes} chars; optional context not in the spec"`,
    },
    /**
     * The risk flag the package's default handoff acts on: shipping a marked
     * entry ends the run (`harness/handoff.ts`), because a supervisor resident
     * at its launch version meeting fresh children on the new contract is the
     * livelock `spec/loop.md` documents.
     *
     * Optional and unset by default, so a consumer whose plan never marks an
     * entry never meets the stop. Nothing reads the value but that handoff, so
     * nothing beyond the boolean is enforced on it.
     */
    [CONTRACT_TOUCHING_FIELD]: {
      schema: z.boolean().optional(),
      hint: `true when the work changes a contract a resident loop supervisor and a fresh tick child must agree on — shipping one ends the run; omit otherwise`,
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
 * owner: `composePendingList` already throws on it, so nothing here
 * re-derives that check beside it (*The fix lands at the mechanism*). A
 * consumer refining `tag` is passed through untouched — the engine composes
 * a refinement there as an intersection over its own mechanical floor.
 *
 * `lanes` is the consumer's runner's own (`spec/harness.md`, *The runner
 * interface*): the running lane's exclusions ride the `tests[]` and `pins[]`
 * hints, so plan is told at authorship which globs no judge will reach.
 * Omitted where no runner is in hand — the pending gate composes this for
 * its schemas alone (`gates.ts`), and a schema does not vary by lane.
 */
export function entryExtension(
  consumer?: EntryExtension,
  lanes: readonly Lane[] = [],
): EntryExtension {
  const fields = packageFields(lanes);
  for (const field of Object.keys(consumer ?? {})) {
    if (field in fields) throw new EntryFieldRemovalError(field);
  }
  return { ...fields, ...consumer };
}
