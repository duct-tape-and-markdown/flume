/**
 * PendingSchema — the contract between plan-phase output and build-phase input.
 *
 * Boundary rule (v0.8 §2): the engine owns only what its mechanics consume —
 * `tag` (identity), `files` (the fence), `gate`/`dependsOnForks` (pickability),
 * `observedFiles` (dispatcher-maintained collision record). Everything else a
 * project wants on an entry is a **chain-declared extension**: each field is
 * declared once with both its zod schema and its prompt hint, and the engine
 * composes the merged validator and the rendered prompt schema from that
 * single declaration — so the prompt and the parser cannot drift.
 *
 * Single source of truth, four enforcement points:
 *   1. Validates plan-phase output at gate time (parse + zod).
 *   2. Injects itself into the plan prompt (renderSchemaForPrompt).
 *   3. Types the build-phase input (PendingEntry).
 *   4. Drives fanout partition via entry.files.edit[].path.
 */

import { z } from "zod";

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
 * Tag format: ALL-CAPS body, dot- or dash-separated segments, optional
 * (slice) suffix.
 *   SURFACE-CTA-MIG
 *   ROSTER-TRIAGE-MIG(a)
 *   OBS4.2
 *   PT4.7(c)
 *   PT4.5c
 *   MAINTAIN-tsc-a31893e
 *
 * Dots support version-like cascade numbering (OBS4.2, PT4.7); dashes
 * support the canonical MIG / MAINTAIN / decision-name format. Lowercase
 * segments are allowed after the first dash for things like `tsc-a31893e`.
 */
const TAG_PATTERN = /^[A-Z][A-Z0-9]*(?:[-.][A-Za-z0-9]+)*(?:\([a-z0-9]+\))?$/;

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
 * One chain-declared entry field: the zod schema that validates it and the
 * prompt hint that renders it. Declared once — `composePendingList` builds
 * the merged validator and `renderSchemaForPrompt` builds the rendered
 * schema block from the same record, so the two surfaces cannot drift.
 */
export interface EntryExtensionField {
  /** Validates the field's value at parse time. */
  schema: z.ZodTypeAny;
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

/** Core field names — an extension may not shadow them. */
const CORE_FIELDS = new Set(Object.keys(PendingEntryCore.shape));

/**
 * Compose the core entry schema with a chain's extension declaration into
 * the list validator. Strict: fields neither core nor declared fail.
 * Throws on an extension that shadows a core field — that is a chain-config
 * defect, not a pending.json defect.
 */
export function composePendingList(
  extension?: EntryExtension,
): z.ZodType<PendingEntry[]> {
  if (!extension || Object.keys(extension).length === 0) {
    return z.array(PendingEntryCore) as unknown as z.ZodType<PendingEntry[]>;
  }
  for (const name of Object.keys(extension)) {
    if (CORE_FIELDS.has(name)) {
      throw new Error(
        `entryExtension field "${name}" shadows an engine-core field`,
      );
    }
  }
  const shape = Object.fromEntries(
    Object.entries(extension).map(([name, field]) => [name, field.schema]),
  );
  // .extend on a strictObject stays strict: core + declared fields only.
  return z.array(PendingEntryCore.extend(shape)) as unknown as z.ZodType<
    PendingEntry[]
  >;
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
 * Parse pending.json contents against core + the chain's declared extension.
 * Returns structured errors rather than throwing so the harness can inject
 * them back into the plan prompt for re-derivation.
 */
export function parsePending(
  raw: string,
  extension?: EntryExtension,
): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      ok: false,
      entries: [],
      errors: [
        {
          index: -1,
          path: "",
          message: `invalid JSON: ${(err as Error).message}`,
        },
      ],
    };
  }

  const result = composePendingList(extension).safeParse(parsed);
  if (result.success) {
    return { ok: true, entries: result.data, errors: [] };
  }

  const errors: ParseError[] = result.error.issues.map((issue) => {
    const [first, ...rest] = issue.path;
    const index = typeof first === "number" ? first : -1;
    return {
      index,
      path: rest.join("."),
      message: issue.message,
    };
  });

  return { ok: false, entries: [], errors };
}

/**
 * Lenient core-only parse for chain-less informational reads (`status`-class
 * commands that count/inspect entries without loading the chain). Validates
 * the core fields and passes unknown (presumably extension) fields through
 * unvalidated. Never used on a write path — rewriting pending.json from a
 * parse that didn't know the extension is how fields get destroyed.
 */
export function parsePendingLoose(raw: string): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      ok: false,
      entries: [],
      errors: [
        {
          index: -1,
          path: "",
          message: `invalid JSON: ${(err as Error).message}`,
        },
      ],
    };
  }

  const result = z
    .array(PendingEntryCore.catchall(z.unknown()))
    .safeParse(parsed);
  if (result.success) {
    return {
      ok: true,
      entries: result.data as PendingEntry[],
      errors: [],
    };
  }

  const errors: ParseError[] = result.error.issues.map((issue) => {
    const [first, ...rest] = issue.path;
    const index = typeof first === "number" ? first : -1;
    return {
      index,
      path: rest.join("."),
      message: issue.message,
    };
  });

  return { ok: false, entries: [], errors };
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
  const extensionLines = Object.entries(extension ?? {})
    .map(([name, field]) => `  "${name}": ${field.hint}`)
    .join(",\n");

  const coreLines = `  "tag": "ALL-CAPS-WITH-DASHES" | "TAG-NAME(slice)",   // unique; appears in commit msg
  "gate": { "kind": "open" }                                  // ready to ship
        | { "kind": "blockedBy", "tag": "OTHER-TAG" }           // upstream blocks
        | { "kind": "parked",    "reason": "workshop on ..." }  // human action needed
        | { "kind": "deferred",  "reason": "no consumer yet" }  // carried indefinitely
        | { "kind": "requiresCapability", "capability": "some-env-fact" },  // env gate; pickable iff the chain asserts this capability
  "dependsOnForks": [ "open-question-slug", ... ],      // optional; forks this rests on — not built until each is RESOLVED. Omit if none.
  "files": {                                            // EVERY path the work legitimately touches — tests and incidentals (lockfile, barrel export) included. Enforced on fanout: the build tick may write ONLY these paths ∪ the phase's channel paths; an under-declared entry is a plan defect.
    "new":  [ { "path": "...", "description": "..." } ],
    "edit": [ { "path": "...", "description": "..." } ],
    "retire": [ "path or symbol", ... ]
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
 * The set of file paths an entry would touch. Used by the fanout partitioner
 * to decide which entries can run in parallel worktrees.
 */
export function touchedPaths(entry: PendingEntry): string[] {
  return [
    ...entry.files.new.map((f) => f.path),
    ...entry.files.edit.map((f) => f.path),
    ...entry.files.retire,
    ...(entry.observedFiles ?? []),
  ];
}
