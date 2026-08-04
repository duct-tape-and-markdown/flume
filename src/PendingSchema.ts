/**
 * PendingSchema — the contract between plan-phase output and build-phase input.
 *
 * Boundary rule (v0.8 §2): the engine owns only what its mechanics consume —
 * `tag` (identity), `files` (the fence), `gate`/`dependsOnForks` (pickability),
 * `observedFiles` (dispatcher-maintained collision record). Everything else a
 * project wants on an entry is a **chain-declared extension**: each field is
 * declared once with both its Standard Schema validator and its prompt hint,
 * and the engine composes the adapted validator and the rendered prompt
 * schema from that single declaration — so the prompt and the parser cannot
 * drift.
 *
 * Single source of truth, four enforcement points:
 *   1. Validates plan-phase output at gate time (parse + adapted validators).
 *   2. Injects itself into the plan prompt (renderSchemaForPrompt).
 *   3. Types the build-phase input (PendingEntry).
 *   4. Drives fanout partition via entry.files.edit[].path.
 *
 * The engine adapts each declared validator, never merges a chain-constructed
 * schema object into its own graph (RELEASE-v0.11 §11) — `zod` here is a
 * private engine dependency for the *core* fields only, not a channel a
 * chain's own schema objects pass through.
 */

import { z } from "zod";

import type { StandardSchemaV1 } from "./standardSchema.js";

// ---------- atoms ----------

/** A path + free-text description. Used for new/edit; retire is path-only. */
const FileChange = z.object({
  path: z.string().min(1),
  description: z.string().min(1),
});

/**
 * Gate state. All non-"open" variants are non-pickable; the variant carries
 * *why* so the plan-phase can reason about lifecycle when it refreshes.
 *
 * - open:               ready to ship.
 * - blockedBy:          upstream pending entry must ship first.
 * - parked:             human action required (workshop, design call) before
 *                       the entry can be refined enough to ship.
 * - deferred:           carried indefinitely; no consumer surface yet.
 * - requiresCapability: pickable iff the named capability is asserted in the
 *                       chain's declared `capabilities` (Chain.capabilities,
 *                       src/Phase.ts) — generic environment-gated
 *                       pickability (v0.8 §4).
 */
const Gate = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("open") }),
  z.object({ kind: z.literal("blockedBy"), tag: z.string().min(1) }),
  z.object({ kind: z.literal("parked"), reason: z.string().min(1) }),
  z.object({ kind: z.literal("deferred"), reason: z.string().min(1) }),
  z.object({
    kind: z.literal("requiresCapability"),
    capability: z.string().min(1),
  }),
]);

// ---------- entry core ----------

/**
 * Filesystem NAME_MAX (Linux ext4/APFS/NTFS, conservatively shared across
 * platforms): the ceiling any single path component must clear. The
 * tightest raw-tag consumer is the revert-note filename (Dispatcher.ts
 * `writeRevertNote`, `<stamp>--<tag>--reverted.md`) — every other consumer
 * (worktree/branch slug, commit-message token) is looser, so this bound
 * covers them too. The subtracted overhead is `writeRevertNote`'s fixed
 * filename scaffolding around the raw tag; that arithmetic lives at the
 * writer (Dispatcher.ts), not restated here. Pinned against the real writer
 * by tests/Dispatcher.test.ts, "revert note to the friction channel (§5)":
 * a gate-revert on the longest tag this module accepts asserts the real
 * filename lands on disk within NAME_MAX.
 */
export const TAG_MAX_LENGTH = 255 - 39;

/**
 * Tag grammar reduces to mechanical safety only (v0.8 §3): the engine
 * requires of a tag only what its mechanics need — non-empty, a charset
 * safe everywhere the engine writes it (a commit-message token, a
 * worktree/branch slug via `slugify`, a raw filename component), and a
 * length bound derived from the tightest real consumer above. No
 * whitespace, no path separators.
 *
 *   DAL-REWIRE(usp_Filter_Get)
 *   SURFACE-CTA-MIG
 *   OBS4.2
 *   MAINTAIN-tsc-a31893e
 *
 * A chain wanting stricter grammar (e.g. an ALL-CAPS convention) layers a
 * refinement on `tag` via its declared extension (§2) — see
 * `composePendingList`.
 */
const TAG_PATTERN = new RegExp(`^[A-Za-z0-9._()-]{1,${TAG_MAX_LENGTH}}$`);

/**
 * The engine-core entry shape: one unit of build work, reduced to what the
 * dispatcher mechanically consumes. Strict — a field that is neither core
 * nor declared in the chain's extension fails validation loudly (silent
 * stripping would destroy plan-authored fields when the dispatcher rewrites
 * pending.json on ship).
 */
const PendingEntryCore = z.strictObject({
    /** Stable identifier; appears in commit messages. */
    tag: z.string().regex(TAG_PATTERN, "tag must match TAG_PATTERN"),
    /** Gate state controlling pickability. */
    gate: Gate,
    /**
     * Foundations governor (v0.3). Open-question fork slugs this entry's
     * foundation rests on. The dispatcher skips the entry while any slug is
     * unresolved — a cross-cutting predicate that precedes every gate kind, so
     * an `open` entry sitting on an undecided fork is not built. Empty (the
     * default) means no foundational dependency. The slug is opaque to the
     * runtime: it is keyed and resolved by the consuming project (§3).
     */
    dependsOnForks: z.array(z.string().min(1)).default([]),
    /**
     * File-level work breakdown. The parallelism partition reads `edit[].path`.
     *
     * Load-bearing on entry-scoped fanout phases: the write guard narrows a
     * scoped tick to exactly these paths ∪ the phase's `entryChannelPaths`, so
     * plan must declare EVERY path the work legitimately touches — tests,
     * incidentals (lockfile, barrel export) included. An entry that
     * under-declares is a plan defect, not a guard defect.
     */
    files: z.object({
      new: z.array(FileChange).default([]),
      edit: z.array(FileChange).default([]),
      retire: z.array(z.string().min(1)).default([]),
    }),
    /**
     * Dispatcher-maintained: actual paths a merge-reverted attempt touched,
     * unioned into the partition so a retry never rides the same wave as the
     * entry it collided with. Plan may carry or drop this field freely — the
     * dispatcher rebuilds it on the next failed merge.
     */
    observedFiles: z.array(z.string().min(1)).optional(),
});

/**
 * Parsed entry type: the core fields, plus whatever extension fields the
 * chain declared (typed `unknown` here — the chain that declared them knows
 * their shape and narrows locally, e.g. `entry.per as PerCitation`).
 */
export type PendingEntry = z.infer<typeof PendingEntryCore> &
  Record<string, unknown>;

// ---------- chain-declared extension ----------

/**
 * One chain-declared entry field: the Standard Schema (`~standard`)
 * validator that validates it and the prompt hint that renders it. Declared
 * once — `composePendingList` builds the adapted validator and
 * `renderSchemaForPrompt` builds the rendered schema block from the same
 * record, so the two surfaces cannot drift.
 *
 * Any library publishing `~standard` (zod ≥3.24, valibot, arktype, ...)
 * satisfies this, as does a hand-written object — the engine never imports
 * or merges the chain's schema, only calls its `~standard.validate` (v0.11
 * §11).
 */
export interface EntryExtensionField {
  /** Validates the field's value at parse time. */
  schema: StandardSchemaV1;
  /**
   * Rendered verbatim as the field's value in the prompt schema block:
   * `"<name>": <hint>`. Include quotes for string-shaped hints, e.g.
   * `"one-line what (≤200 chars)"`.
   */
  hint: string;
}

/**
 * A chain's full entry-extension declaration, keyed by field name. Optional
 * on `Chain`; a chain declaring none gets the bare core.
 */
export type EntryExtension = Record<string, EntryExtensionField>;

/** Core field names — an extension may not shadow them, except `tag` (refined, not replaced; see below). */
const CORE_FIELDS = new Set(Object.keys(PendingEntryCore.shape));

/**
 * Reject a duplicate `tag` value within the queue (v0.8 §3: tag identity
 * must be unique — cli's find-by-tag and Dispatcher's blockedBy/shippedTags
 * lookups key on it, so a duplicate silently resolves to the wrong entry).
 * Every index sharing a tag gets its own issue naming the others, so a
 * three-way collision is fully attributed rather than only the second
 * occurrence being flagged.
 */
function withUniqueTagCheck<T extends z.ZodTypeAny>(
  arraySchema: T,
): z.ZodType<PendingEntry[]> {
  return (arraySchema as unknown as z.ZodArray<z.ZodTypeAny>).superRefine(
    (entries, ctx) => {
      const indicesByTag = new Map<string, number[]>();
      entries.forEach((entry, index) => {
        const tag = (entry as { tag: string }).tag;
        const indices = indicesByTag.get(tag) ?? [];
        indices.push(index);
        indicesByTag.set(tag, indices);
      });
      for (const [tag, indices] of indicesByTag) {
        if (indices.length < 2) continue;
        for (const index of indices) {
          const others = indices.filter((i) => i !== index);
          ctx.addIssue({
            code: "custom",
            path: [index, "tag"],
            message: `tag "${tag}" duplicates entr${
              others.length === 1 ? "y" : "ies"
            } at index ${others.join(", ")}`,
          });
        }
      }
    },
  ) as unknown as z.ZodType<PendingEntry[]>;
}

/**
 * Thrown when a chain-declared `~standard.validate` returns a `Promise`.
 * `parsePending` is synchronous and feeds decision and rewrite paths — a
 * `Promise` read as a result object has no `issues`, so it would be treated
 * as passing and accept the entry vacuously. This is a chain-config defect
 * (the same class as an extension shadowing a core field), so the adapter
 * throws it rather than folding it into `ParseResult.errors`: it surfaces at
 * first parse, since asynchrony is only observable by calling `validate`
 * (RELEASE-v0.11 §11).
 */
export class AsyncEntryExtensionValidatorError extends Error {
  constructor(fieldName: string) {
    super(
      `entryExtension field "${fieldName}"'s ~standard.validate returned a ` +
        `Promise; parsePending is synchronous and cannot await it. Declare ` +
        `a synchronous Standard Schema validator for this field.`,
    );
    this.name = "AsyncEntryExtensionValidatorError";
  }
}

function standardIssuePath(
  path: StandardSchemaV1.Issue["path"],
): PropertyKey[] {
  return (path ?? []).map((segment) =>
    typeof segment === "object" ? segment.key : segment,
  );
}

/**
 * Adapt a chain-declared Standard Schema validator into an engine-instance
 * zod schema: a value-preserving position, never a bare check. Every
 * downstream mechanic — strictness, entry-indexed error paths, the `tag`
 * intersection floor — stays on the zod side; this is the one seam that
 * calls into the chain's declared validator (RELEASE-v0.11 §11).
 *
 * `z.any().optional()` (rather than bare `z.any()`) is load-bearing: it
 * marks the wrapping schema optional-in, so the enclosing `z.object` defers
 * entirely to the validator's own verdict on an absent key instead of
 * synthesizing its own "required" issue and dropping the validator's
 * result — the mechanic `.default([])`-style fields on an absent key
 * depend on.
 */
function adaptStandardSchemaField(
  fieldName: string,
  field: EntryExtensionField,
): z.ZodTypeAny {
  return z
    .any()
    .optional()
    .transform((value, ctx) => {
      const result = field.schema["~standard"].validate(value);
      if (result instanceof Promise) {
        throw new AsyncEntryExtensionValidatorError(fieldName);
      }
      if (result.issues) {
        for (const issue of result.issues) {
          ctx.issues.push({
            code: "custom",
            message: issue.message,
            path: standardIssuePath(issue.path),
            input: value,
          });
        }
        return z.NEVER;
      }
      return result.value;
    });
}

/**
 * Compose the core entry schema with a chain's extension declaration into
 * the list validator. Strict: fields neither core nor declared fail.
 * Throws on an extension that shadows a core field — that is a chain-config
 * defect, not a pending.json defect.
 *
 * `tag` is the one core field an extension MAY declare (v0.8 §3): a chain
 * wanting stricter grammar (e.g. an ALL-CAPS convention) than the engine's
 * mechanical-safety charset layers a refinement there. It composes as an
 * intersection — both the core pattern and the *adapted* chain validator
 * must pass — so a chain declaring `tag` narrows the grammar, it can never
 * widen past (or replace) the engine's mechanical floor.
 *
 * The composed list schema also enforces tag uniqueness across the queue —
 * mechanical safety (§3), not convention: the engine's own tag-keyed lookups
 * (cli find-by-tag, Dispatcher blockedBy/shippedTags) require it.
 */
export function composePendingList(
  extension?: EntryExtension,
): z.ZodType<PendingEntry[]> {
  if (!extension || Object.keys(extension).length === 0) {
    return withUniqueTagCheck(z.array(PendingEntryCore));
  }
  for (const name of Object.keys(extension)) {
    if (name !== "tag" && CORE_FIELDS.has(name)) {
      throw new Error(
        `entryExtension field "${name}" shadows an engine-core field`,
      );
    }
  }
  const shape = Object.fromEntries(
    Object.entries(extension)
      .filter(([name]) => name !== "tag")
      .map(([name, field]) => [name, adaptStandardSchemaField(name, field)]),
  );
  const tagRefinement = extension.tag;
  if (tagRefinement) {
    shape.tag = PendingEntryCore.shape.tag.and(
      adaptStandardSchemaField("tag", tagRefinement),
    );
  }
  // .extend on a strictObject stays strict: core + declared fields only.
  return withUniqueTagCheck(z.array(PendingEntryCore.extend(shape)));
}

/**
 * A plan's full pending list. Order is meaningful — top is next. Empty array
 * is valid and means nothing pending.
 */
export type PendingList = PendingEntry[];

// ---------- parse helpers ----------

/**
 * Outcome of `parsePending`. On success, `ok` is true, `entries` holds the
 * parsed list, and `errors` is empty. On failure, `entries` is `[]` and
 * `errors` carries one `ParseError` per zod issue so the caller can surface
 * them — typically by injecting them into the next plan prompt.
 */
export interface ParseResult {
  ok: boolean;
  entries: PendingList;
  errors: ParseError[];
}

/**
 * One validation failure produced by `parsePending`. The harness injects
 * these into the next plan prompt so the agent can re-derive without
 * needing to read zod's raw error format.
 */
export interface ParseError {
  /** Index into the raw array, or -1 if structure itself was malformed. */
  index: number;
  /** Path within the entry, e.g. "files.edit[0].path". */
  path: string;
  message: string;
}

/**
 * Parse `raw` as JSON, wrapped as a failed `ParseResult` on failure. Shared
 * by `parsePending` and `parsePendingLoose` so the invalid-JSON error shape
 * has one source instead of two copies that can drift.
 */
function parseJsonOrFail(
  raw: string,
): { ok: true; value: unknown } | { ok: false; result: ParseResult } {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (err) {
    return {
      ok: false,
      result: {
        ok: false,
        entries: [],
        errors: [
          {
            index: -1,
            path: "",
            message: `invalid JSON: ${(err as Error).message}`,
          },
        ],
      },
    };
  }
}

/**
 * Map zod's issue list to `ParseError[]`. Shared by `parsePending` and
 * `parsePendingLoose` so the mapping has one source instead of two copies
 * that can drift.
 */
function issuesToParseErrors(issues: z.core.$ZodIssue[]): ParseError[] {
  return issues.map((issue) => {
    const [first, ...rest] = issue.path;
    const index = typeof first === "number" ? first : -1;
    return {
      index,
      path: rest.join("."),
      message: issue.message,
    };
  });
}

/**
 * Parse pending.json contents against core + the chain's declared extension.
 * Returns structured errors rather than throwing so the harness can inject
 * them back into the plan prompt for re-derivation.
 */
export function parsePending(
  raw: string,
  extension?: EntryExtension,
): ParseResult {
  const parsed = parseJsonOrFail(raw);
  if (!parsed.ok) return parsed.result;

  const result = composePendingList(extension).safeParse(parsed.value);
  if (result.success) {
    return { ok: true, entries: result.data, errors: [] };
  }

  return {
    ok: false,
    entries: [],
    errors: issuesToParseErrors(result.error.issues),
  };
}

/**
 * Lenient core-only parse for chain-less informational reads (`status`-class
 * commands that count/inspect entries without loading the chain). Validates
 * the core fields and passes unknown (presumably extension) fields through
 * unvalidated. Never used on a write path — rewriting pending.json from a
 * parse that didn't know the extension is how fields get destroyed.
 */
export function parsePendingLoose(raw: string): ParseResult {
  const parsed = parseJsonOrFail(raw);
  if (!parsed.ok) return parsed.result;

  const result = z
    .array(PendingEntryCore.catchall(z.unknown()))
    .safeParse(parsed.value);
  if (result.success) {
    return {
      ok: true,
      entries: result.data as PendingEntry[],
      errors: [],
    };
  }

  return {
    ok: false,
    entries: [],
    errors: issuesToParseErrors(result.error.issues),
  };
}

// ---------- prompt rendering ----------

/**
 * Render the schema — core plus the chain's declared extension — as a
 * compact, prompt-friendly description. Injected into the plan prompt so
 * the schema in the prompt and the parser cannot drift: both are built from
 * the same declaration.
 *
 * We don't use zod-to-json-schema here — the rendered form is human/LLM
 * facing, not a JSON Schema document. Brevity matters more than completeness.
 */
export function renderSchemaForPrompt(extension?: EntryExtension): string {
  const tagRefinement = extension?.tag;
  const coreTagHint = `"<letters/digits/._()- only, no whitespace, ≤${TAG_MAX_LENGTH} chars>"`;
  const tagHint = tagRefinement
    ? `${coreTagHint} AND ${tagRefinement.hint}`
    : coreTagHint;

  const extensionEntries = Object.entries(extension ?? {}).filter(
    ([name]) => name !== "tag",
  );
  const extensionLines = extensionEntries
    .map(([name, field], i) => {
      const line = `  "${name}": ${field.hint}`;
      if (i === extensionEntries.length - 1) return line;
      // The separator must land before a hint's trailing "// comment", not
      // after it — appending "," past "//" gets swallowed into the comment
      // text instead of delimiting the next field. A bare `indexOf("//")`
      // also matches "//" occurring inside the hint's own text (e.g. a URL
      // like "https://..."), so require the whitespace that only a real
      // trailing comment marker carries.
      const commentIndex = line.lastIndexOf(" // ");
      if (commentIndex === -1) return `${line},`;
      return `${line.slice(0, commentIndex).trimEnd()},  ${line.slice(commentIndex + 1)}`;
    })
    .join("\n");

  const coreLines = `  "tag": ${tagHint},   // unique; appears in commit msg; mechanical safety is the floor, a chain-declared refinement (if any) narrows further
  "gate": { "kind": "open" }                                  // ready to ship
        | { "kind": "blockedBy", "tag": "OTHER-TAG" }           // upstream blocks
        | { "kind": "parked",    "reason": "workshop on ..." }  // human action needed
        | { "kind": "deferred",  "reason": "no consumer yet" }  // carried indefinitely
        | { "kind": "requiresCapability", "capability": "some-env-fact" },  // env gate; pickable iff the chain asserts this capability
  "dependsOnForks": [ "open-question-slug", ... ],      // optional; forks this rests on — not built until each is RESOLVED. Omit if none.
  "files": {                                            // EVERY path the work legitimately touches — tests and incidentals (lockfile, barrel export) included. Enforced on fanout: the build tick may write ONLY these paths ∪ the phase's channel paths; an under-declared entry is a plan defect.
    "new":  [ { "path": "...", "description": "..." } ],
    "edit": [ { "path": "...", "description": "..." } ],
    "retire": [ "path", ... ]
  }`;

  return `Each pending entry MUST conform to this shape (fields not listed here are rejected):

{
${coreLines}${extensionLines ? `,\n${extensionLines}` : ""}
}

Output is a JSON array of these entries, ordered by execution priority (top = next).
Empty array is valid (means nothing pending).`;
}

// ---------- pickability ----------

/**
 * An entry is pickable when every foundational fork it declares is resolved
 * AND its gate is open AND it is not waiting on a capability the chain
 * hasn't asserted. The dispatcher filters this further by checking
 * `blockedBy` tags against shipped entries.
 *
 * `isForkResolved` is the foundations governor's injected predicate (§3): it
 * answers "is this open-question fork resolved?" for the consuming project.
 * It defaults to always-resolved, so a caller that supplies none — or an entry
 * that declares no `dependsOnForks` — behaves exactly as before.
 *
 * `capabilities` is the chain's declared `Chain.capabilities` (v0.8 §4) — the
 * environment facts it asserts. Defaults to empty, so a `requiresCapability`
 * gate is opt-in: unasserted by default, exactly as the env-gate variant it
 * generalized defaulted to non-pickable.
 */
export function isPickableNow(
  entry: PendingEntry,
  shippedTags: ReadonlySet<string>,
  isForkResolved: (slug: string) => boolean = () => true,
  capabilities: ReadonlySet<string> = new Set(),
): boolean {
  // Foundations governor: a settled gate is not enough — every declared fork
  // must resolve. Cross-cuts every gate kind, so it precedes the switch.
  if (!entry.dependsOnForks.every(isForkResolved)) return false;
  switch (entry.gate.kind) {
    case "open":
      return true;
    case "blockedBy":
      return shippedTags.has(entry.gate.tag);
    case "parked":
    case "deferred":
      return false;
    case "requiresCapability":
      return capabilities.has(entry.gate.capability);
  }
}

/**
 * The set of file paths an entry declares it will touch — files.new/edit/retire
 * only. This is what the entry's author committed to; it excludes
 * dispatcher-observed writes (`observedFiles`), which the entry never declared.
 */
export function declaredPaths(entry: PendingEntry): string[] {
  return [
    ...entry.files.new.map((f) => f.path),
    ...entry.files.edit.map((f) => f.path),
    ...entry.files.retire,
  ];
}

/**
 * The set of file paths an entry would touch. Used by the fanout partitioner
 * to decide which entries can run in parallel worktrees.
 */
export function touchedPaths(entry: PendingEntry): string[] {
  return [...declaredPaths(entry), ...(entry.observedFiles ?? [])];
}
