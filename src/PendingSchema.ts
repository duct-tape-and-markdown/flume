/**
 * PendingSchema — the contract between plan-phase output and build-phase input.
 *
 * Single source of truth, four enforcement points:
 *   1. Validates plan-phase output at gate time (parse + zod).
 *   2. Injects itself into the plan prompt (renderSchemaForPrompt).
 *   3. Types the build-phase input (PendingEntry).
 *   4. Drives fanout partition via entry.files.edit[].path.
 *
 * Everything the dispatcher mechanically consumes lives here.
 */

import { z } from "zod";

// ---------- atoms ----------

/** A path + free-text description. Used for new/edit; retire is path-only. */
const FileChange = z.object({
  path: z.string().min(1),
  description: z.string().min(1),
});

/** Citation into a spec or rule, identifying the "why" for an entry. */
const PerCitation = z.object({
  /** e.g. "specs/active/coaching/coach-operating-surface.md" */
  path: z.string().min(1),
  /** Section heading text, without the leading "## ". */
  section: z.string().min(1),
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
 * - requiresDockerHost: env gate; dispatcher opts in at runtime (v1).
 */
const Gate = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("open") }),
  z.object({ kind: z.literal("blockedBy"), tag: z.string().min(1) }),
  z.object({ kind: z.literal("parked"), reason: z.string().min(1) }),
  z.object({ kind: z.literal("deferred"), reason: z.string().min(1) }),
  z.object({ kind: z.literal("requiresDockerHost") }),
]);

const TestAssertion = z.object({
  path: z.string().min(1),
  asserts: z.string().min(1),
});

// ---------- entry ----------

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
 * One unit of build work. Plan re-derives the full pending list every tick
 * from spec + open-questions + inbox + current src; build ships entries by
 * tag in order. The shape is enforced by zod at parse time and surfaces both
 * as a runtime schema and a `z.infer`'d static type.
 */
export const PendingEntry = z.object({
  /** Stable identifier; appears in commit messages. */
  tag: z.string().regex(TAG_PATTERN, "tag must match TAG_PATTERN"),
  /** Single-line summary; the "what" in human terms. */
  summary: z.string().min(1).max(200),
  /** The "why" — points at a spec or rule section. */
  per: PerCitation,
  /** Gate state controlling pickability. */
  gate: Gate,
  /** File-level work breakdown. The parallelism partition reads `edit[].path`. */
  files: z.object({
    new: z.array(FileChange).default([]),
    edit: z.array(FileChange).default([]),
    retire: z.array(z.string().min(1)).default([]),
  }),
  /** Prisma/schema changes summary, or the literal string "none". */
  schemaDelta: z.union([z.literal("none"), z.string().min(1)]).default("none"),
  /** Tests that must turn green for acceptance. */
  tests: z.array(TestAssertion).default([]),
  /** What validation turns green to signal this entry is shipped. */
  acceptance: z.string().min(1),
  /** Optional context not in the spec; capped to keep entries scannable. */
  notes: z.string().max(500).optional(),
  /**
   * Dispatcher-maintained: actual paths a merge-reverted attempt touched,
   * unioned into the partition so a retry never rides the same wave as the
   * entry it collided with. Plan may carry or drop this field freely — the
   * dispatcher rebuilds it on the next failed merge.
   */
  observedFiles: z.array(z.string().min(1)).optional(),
});

export type PendingEntry = z.infer<typeof PendingEntry>;

/**
 * A plan's full pending list. Order is meaningful — top is next. Empty array
 * is valid and means nothing pending. Validated as `z.array(PendingEntry)`,
 * with per-entry defaults applied at parse time.
 */
export const PendingList = z.array(PendingEntry);
export type PendingList = z.infer<typeof PendingList>;

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
 * Parse pending.json contents. Returns structured errors rather than throwing
 * so the harness can inject them back into the plan prompt for re-derivation.
 */
export function parsePending(raw: string): ParseResult {
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

  const result = PendingList.safeParse(parsed);
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

// ---------- prompt rendering ----------

/**
 * Render the schema as a compact, prompt-friendly description. Injected into
 * the plan prompt so the schema in the prompt and the parser cannot drift.
 *
 * We don't use zod-to-json-schema here — the rendered form is human/LLM
 * facing, not a JSON Schema document. Brevity matters more than completeness.
 */
export function renderSchemaForPrompt(): string {
  return `Each pending entry MUST conform to this shape:

{
  "tag": "ALL-CAPS-WITH-DASHES" | "TAG-NAME(slice)",   // unique; appears in commit msg
  "summary": "one-line what (≤200 chars)",
  "per": {
    "path": "specs/.../foo.md",                         // the spec or rule that justifies this work
    "section": "Section heading text"                   // exact section, no leading '## '
  },
  "gate": { "kind": "open" }                                  // ready to ship
        | { "kind": "blockedBy", "tag": "OTHER-TAG" }           // upstream blocks
        | { "kind": "parked",    "reason": "workshop on ..." }  // human action needed
        | { "kind": "deferred",  "reason": "no consumer yet" }  // carried indefinitely
        | { "kind": "requiresDockerHost" },                     // env gate (v1)
  "files": {
    "new":  [ { "path": "...", "description": "..." } ],
    "edit": [ { "path": "...", "description": "..." } ],
    "retire": [ "path or symbol", ... ]
  },
  "schemaDelta": "none" | "human-readable prisma diff summary",
  "tests": [ { "path": "...", "asserts": "behavior" } ],
  "acceptance": "what turns green when this is done",
  "notes": "≤500 chars; optional context not in the spec"
}

Output is a JSON array of these entries, ordered by execution priority (top = next).
Empty array is valid (means nothing pending).`;
}

// ---------- pickability ----------

/**
 * An entry is pickable when its gate is open AND it is not waiting on
 * environment capabilities the dispatcher hasn't asserted. The dispatcher
 * filters this further by checking `blockedBy` tags against shipped entries.
 */
export function isPickableNow(
  entry: PendingEntry,
  shippedTags: ReadonlySet<string>,
): boolean {
  switch (entry.gate.kind) {
    case "open":
      return true;
    case "blockedBy":
      return shippedTags.has(entry.gate.tag);
    case "parked":
    case "deferred":
      return false;
    case "requiresDockerHost":
      // The dispatcher decides at runtime; default false so it's opt-in.
      return false;
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
