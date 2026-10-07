/**
 * PendingSchema — the contract between plan-phase output and build-phase input.
 *
 * Boundary rule: the engine owns only what its mechanics consume — `tag`
 * (identity), `files` (the fence), `gate`/`dependsOnForks` (pickability),
 * `kind`/`parent` (the forest the queue is, and the one kind it picks),
 * `observedFiles` (dispatcher-maintained collision record). Everything else a
 * project wants on an entry is a **chain-declared extension**: each field is
 * declared once with both its Standard Schema validator and its prompt hint,
 * and the engine composes the adapted validator and the rendered prompt schema
 * from that single declaration — so the prompt and the parser cannot drift.
 *
 * Single source of truth, four enforcement points:
 *   1. Validates plan-phase output at gate time (parse + adapted validators).
 *   2. Injects itself into the plan prompt (renderSchemaForPrompt).
 *   3. Types the build-phase input (PendingEntry).
 *   4. Drives fanout partition via entry.files.edit[].path.
 *
 * The engine adapts each declared validator, never merges a chain-constructed
 * schema object into its own graph — `zod` here is a private engine dependency
 * for the *core* fields only, not a channel a chain's own schema objects pass
 * through.
 */

import { z } from "zod";

import type { StandardSchemaV1 } from "./standardSchema.js";
import { thrownMessage } from "./thrown.js";

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
 * - blockedBy:          upstream pending entries (named by tag, one or more)
 *                       must all ship first. A DAG with several parents is
 *                       stated as such — never flattened to a single tag —
 *                       so `tags` is non-empty by construction: an author
 *                       who meant to name blockers and named none gets a
 *                       parse error, never a silently-open gate.
 * - parked:             a human action the entry waits on, named by
 *                       `reason`; no harness step clears it.
 * - deferred:           carried indefinitely; no consumer surface yet.
 * - requiresCapability: pickable iff the named capability is asserted in the
 *                       chain's declared `capabilities` (Chain.capabilities,
 *                       src/Phase.ts) — generic environment-gated
 *                       pickability.
 */
const Gate = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("open") }),
  z.object({
    kind: z.literal("blockedBy"),
    tags: z.array(z.string().min(1)).min(1, "blockedBy.tags must be non-empty"),
  }),
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
 * platforms): the ceiling any single path component must clear. Here rather
 * than at a consumer because both sides of the bound reach it — the schema's
 * own {@link TAG_MAX_LENGTH} below, and `boundedName` (`src/paths.ts`), the
 * truncation every name composed around a tag passes through.
 */
export const NAME_MAX = 255;

/**
 * The raw-tag length the schema admits: {@link NAME_MAX} less the fixed
 * filename scaffolding of the revert note — `<stamp>--<tag>--reverted.md`,
 * written by `writeRevertNote` (`src/tickAttempt.ts`) — which is the
 * tightest consumer that composes a name from a raw tag and *nothing else
 * variable*, so the bound can hold it by construction. That arithmetic lives
 * at the writer, not restated here. Pinned against the real writer by
 * tests/Dispatcher.test.ts, "revert note to the friction channel": a
 * gate-revert on the longest tag this module accepts asserts the real
 * filename lands on disk within NAME_MAX.
 *
 * It bounds *this* tag, never every name built from one. A consumer that
 * composes a tag with a second variable-length part — `harvestFriction`'s
 * `<tag>--<stamp>--<source filename>` (`src/friction.ts`) — can exceed
 * NAME_MAX at any tag length this pattern accepts, and takes `boundedName`
 * (`src/paths.ts`) rather than inheriting a ceiling that was never sized for
 * it. The worktree/branch slug and the commit-message token do not compose,
 * and are covered here.
 */
export const TAG_MAX_LENGTH = NAME_MAX - 39;

/**
 * Tag grammar reduces to mechanical safety only: the engine requires of a tag
 * only what its mechanics need — non-empty, a charset safe everywhere the
 * engine writes it (a commit-message token, a worktree/branch slug via
 * `slugify`, a raw filename component), and a length bound derived from the
 * tightest real consumer above. No whitespace, no path separators.
 *
 *   DAL-REWIRE(usp_Filter_Get)
 *   SURFACE-CTA-MIG
 *   OBS4.2
 *   MAINTAIN-tsc-a31893e
 *
 * A chain wanting stricter grammar (e.g. an ALL-CAPS convention) layers a
 * refinement on `tag` via its declared extension — see `composePendingEntry`.
 */
const TAG_PATTERN = new RegExp(`^[A-Za-z0-9._()-]{1,${TAG_MAX_LENGTH}}$`);

/**
 * The engine-core entry shape: one unit of build work, reduced to what the
 * dispatcher mechanically consumes. Strict — a field that is neither core
 * nor declared in the chain's extension fails validation loudly (silent
 * stripping would destroy plan-authored fields when the dispatcher rewrites
 * its file on ship).
 */
const PendingEntryCore = z.strictObject({
    /** Stable identifier; appears in commit messages. */
    tag: z.string().regex(TAG_PATTERN, "tag must match TAG_PATTERN"),
    /** Gate state controlling pickability. */
    gate: Gate,
    /**
     * Foundations governor. Fork slugs this entry's foundation rests on.
     * The dispatcher skips the entry while any slug is unresolved —
     * a cross-cutting predicate that precedes every gate kind, so an `open`
     * entry sitting on an undecided fork is not built. Empty (the default)
     * means no foundational dependency. The slug is opaque to the runtime: it
     * is keyed and resolved by the consuming project.
     */
    dependsOnForks: z.array(z.string().min(1)).default([]),
    /**
     * What this entry is in the queue's forest, defaulting to `work`:
     *
     * - `work` — the dispatch unit, one build session's job, and the only
     *   kind selection offers (`gateEligible`, `src/selection.ts`).
     * - `step` — part of a `work` entry, done and shipped in that entry's
     *   session, never dispatched on its own.
     * - `group` — organizes (a goal, an epic); never picked, and leaves the
     *   queue with its last descendant.
     *
     * Declared, never read off whether an entry has children: a group not yet
     * decomposed has none and is still not work.
     */
    kind: z.enum(["work", "step", "group"]).default("work"),
    /**
     * The entry this one is part of, by tag — one parent, so the queue is a
     * forest. Absent is a root.
     *
     * Containment only: precedence is `gate`, and the forest rules a queue
     * must satisfy (which kind may parent which, the depth bound, a step's
     * blockers) are the queue-wide read's ({@link queueForestErrors}), not
     * this field's — all this field holds is that the value is a tag the
     * grammar admits, since a parent that could not be a tag names no entry
     * any queue could hold.
     */
    parent: z
      .string()
      .regex(TAG_PATTERN, "parent must match TAG_PATTERN")
      .optional(),
    /**
     * File-level work breakdown. The parallelism partition reads `edit[].path`.
     *
     * Load-bearing on entry-scoped fanout phases: the write guard narrows a
     * scoped tick to exactly these paths ∪ the phase's `entryChannelPaths`, so
     * the entry must declare EVERY path the work legitimately touches — tests
     * and incidentals included. An entry that under-declares is a declaration
     * defect, not a guard defect.
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
 * once — `composePendingEntry` builds the adapted validator and
 * `renderSchemaForPrompt` builds the rendered schema block from the same
 * record, so the two surfaces cannot drift.
 *
 * Any library publishing `~standard` (zod ≥3.24, valibot, arktype, ...)
 * satisfies this, as does a hand-written object — the engine never imports or
 * merges the chain's schema, only calls its `~standard.validate`.
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

/**
 * The engine-core entry field names, in declaration order — an extension may
 * not shadow them, except `tag` (refined, not replaced; see below).
 *
 * Exported because this vocabulary is a fact the engine holds and acts on:
 * it gates extension composition and it is the set the rendered prompt
 * schema claims to enumerate. A consumer that needs the names otherwise
 * rebuilds them by reaching through `composePendingEntry`'s returned
 * `z.ZodType` into zod's `.element.shape` — internals this module keeps
 * private precisely so a zod major cannot rename them out from under a
 * reader.
 */
export const CORE_ENTRY_FIELDS: readonly string[] = Object.keys(
  PendingEntryCore.shape,
);

/** O(1) shadow lookup, derived from {@link CORE_ENTRY_FIELDS} — one home. */
const CORE_FIELDS = new Set(CORE_ENTRY_FIELDS);

/**
 * The chain-declared half of one parsed entry: every field it carries that
 * {@link CORE_ENTRY_FIELDS} does not name. `{}` for an entry carrying only
 * core fields.
 *
 * Split by the engine's own vocabulary — the same {@link CORE_FIELDS} set
 * that refuses a shadowing extension at composition — so what this reports
 * as payload and what the chain was permitted to declare cannot disagree.
 * `tag` stays core even when an extension refines it: a refinement adds a
 * check, never a second value.
 *
 * Values stay `unknown`, as they are on {@link PendingEntry}: the chain that
 * declared the field knows its shape and narrows locally.
 */
export function entryExtensionPayload(
  entry: PendingEntry,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(entry)) {
    if (!CORE_FIELDS.has(name)) payload[name] = value;
  }
  return payload;
}

/**
 * The extension one entry's file carries. One spelling, because the listing
 * that decides what is an entry (`readQueueOnDisk`, `src/pendingLedger.ts`)
 * and the name one is written under ({@link entryFileName}) are two halves of
 * one rule.
 */
export const ENTRY_FILE_EXT = ".json";

/**
 * The file one entry lives in, named by its tag (`spec/pending.md`, *The
 * ledger is a directory — one entry per file*). Queue-wide tag uniqueness is
 * this function's consequence and not a check anywhere: two entries claiming
 * one tag would be one file.
 *
 * Exported because the ship composes it — the ledger rewrite `git rm`s
 * exactly the shipped entries' files and holds only their tags
 * (`commitPendingUpdate`, `src/pendingLedger.ts`) — and a caller spelling
 * `${tag}.json` itself is the second copy of the rule the agreement check
 * below exists to enforce.
 */
export function entryFileName(tag: string): string {
  return `${tag}${ENTRY_FILE_EXT}`;
}

/**
 * The tag a queue file's name claims, or `null` when the name is no entry
 * file's — {@link entryFileName}'s inverse, spelled beside it rather than at
 * the caller that needs it.
 *
 * A reader walking a commit's touched paths holds names, not entries: a file
 * the commit *removed* is in no listing it can parse, and its tag is
 * recoverable from the name alone (`pendingGate`'s claim check,
 * `src/builtinGates.ts`). The rule is the one {@link entryFileName} states,
 * read backwards, so a change to the extension moves both halves at once.
 *
 * The bare extension is not an entry file: it names the empty tag, which
 * `TAG_PATTERN` admits none of.
 */
export function entryTagFromFileName(file: string): string | null {
  return file.length > ENTRY_FILE_EXT.length && file.endsWith(ENTRY_FILE_EXT)
    ? file.slice(0, -ENTRY_FILE_EXT.length)
    : null;
}

/**
 * Thrown when a chain-declared `~standard.validate` returns a `Promise`.
 * `parsePendingQueue` is synchronous and feeds decision and rewrite paths — a
 * `Promise` read as a result object has no `issues`, so it would be treated as
 * passing and accept the entry vacuously. This is a chain-config defect (the
 * same class as an extension shadowing a core field), so the adapter throws it
 * rather than folding it into `ParseResult.errors`: it surfaces at first
 * parse, since asynchrony is only observable by calling `validate`.
 */
export class AsyncEntryExtensionValidatorError extends Error {
  constructor(fieldName: string) {
    super(
      `entryExtension field "${fieldName}"'s ~standard.validate returned a ` +
        `Promise; the queue parser is synchronous and cannot await it. ` +
        `Declare a synchronous Standard Schema validator for this field.`,
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
 * Adapt a chain-declared Standard Schema validator into an engine-instance zod
 * schema: a value-preserving position, never a bare check. Every downstream
 * mechanic — strictness, the composed error paths, the `tag` intersection
 * floor — stays on the zod side; this is the one seam that calls into the
 * chain's declared validator.
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
 * the validator one entry file is parsed by. Strict: fields neither core nor
 * declared fail. Throws on an extension that shadows a core field — that is a
 * chain-config defect, not a queue defect.
 *
 * `tag` is the one core field an extension MAY declare: a chain wanting
 * stricter grammar (e.g. an ALL-CAPS convention) than the engine's
 * mechanical-safety charset layers a refinement there. It composes as an
 * intersection — both the core pattern and the *adapted* chain validator must
 * pass — so a chain declaring `tag` narrows the grammar, it can never widen
 * past (or replace) the engine's mechanical floor.
 *
 * One entry, never a list: the queue is a directory and its uniqueness is the
 * filesystem's ({@link entryFileName}), so there is no queue-wide check left
 * for a composed array schema to carry.
 */
export function composePendingEntry(
  extension?: EntryExtension,
): z.ZodType<PendingEntry> {
  if (!extension || Object.keys(extension).length === 0) {
    return PendingEntryCore as unknown as z.ZodType<PendingEntry>;
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
  return PendingEntryCore.extend(shape) as unknown as z.ZodType<PendingEntry>;
}

/**
 * A producer's full pending queue, as a reader hands it on. Position carries
 * nothing: the order every selection takes is computed at selection time
 * (`byFilingThenTag`, `src/filingOrder.ts`). Empty is valid and means nothing
 * pending.
 */
export type PendingList = PendingEntry[];

// ---------- parse helpers ----------

/**
 * One entry file, as a queue reader hands it to the parse: its name directly
 * under the queue directory, and its bytes.
 *
 * The name rides along because it is *input* to the parse, not decoration —
 * the tag a file claims has to agree with the name it is reachable under
 * ({@link parsePendingEntry}), and a failure names the file it read
 * (`spec/pending.md`, *The ledger is a directory — one entry per file*).
 */
export interface QueueFile {
  /** The entry file's own name, with no directory part — `<tag>.json`. */
  readonly file: string;
  /** The file's bytes, exactly as the tip or the disk holds them. */
  readonly raw: string;
}

/**
 * Outcome of {@link parsePendingQueue}. On success, `ok` is true, `entries`
 * holds the queue in its declared order, and `errors` is empty. On failure,
 * `entries` is `[]` and `errors` carries one `ParseError` per issue so the
 * caller can surface them — typically by injecting them into the next plan
 * prompt.
 *
 * All-or-nothing over the directory, for the reason the strict read exists:
 * a decision or a rewrite derived from a queue one of whose files did not
 * resolve is acting on a queue it never read (`.claude/rules/engineering.md`,
 * *Loud or nothing*).
 */
export interface ParseResult {
  ok: boolean;
  entries: PendingList;
  errors: ParseError[];
}

/**
 * One validation failure produced by {@link parsePendingQueue}. The harness
 * injects these into the next plan prompt so the agent can re-derive without
 * needing to read zod's raw error format.
 */
export interface ParseError {
  /**
   * The entry file the failure was read out of, with no directory part — the
   * whole point of the per-file queue: a producer repairing the queue is told
   * which file to open, never an index into a page every writer shared.
   */
  file: string;
  /** Path within the entry, e.g. "files.edit.0.path"; empty for the file itself. */
  path: string;
  message: string;
}

/** Outcome of parsing one entry file. */
interface EntryParseResult {
  ok: boolean;
  /** The parsed entry, or `undefined` when `ok` is false. */
  entry: PendingEntry | undefined;
  errors: ParseError[];
}

/**
 * Parse `raw` as JSON, wrapped as a failed `ParseResult` on failure. Shared
 * by `parsePendingQueue` and `parsePendingQueueLoose` so the invalid-JSON error shape
 * has one source instead of two copies that can drift.
 */
function parseJsonOrFail(
  file: string,
  raw: string,
): { ok: true; value: unknown } | { ok: false; result: EntryParseResult } {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (err) {
    return {
      ok: false,
      result: {
        ok: false,
        entry: undefined,
        errors: [
          {
            file,
            path: "",
            message: `invalid JSON: ${thrownMessage(err)}`,
          },
        ],
      },
    };
  }
}

/**
 * Map zod's issue list to `ParseError[]`, keyed to the file it was read from.
 * Shared by {@link parsePendingEntry} and {@link parsePendingEntryLoose} so
 * the mapping has one source instead of two copies that can drift.
 */
function issuesToParseErrors(
  file: string,
  issues: z.core.$ZodIssue[],
): ParseError[] {
  return issues.map((issue) => ({
    file,
    path: issue.path.join("."),
    message: issue.message,
  }));
}

/**
 * The same refusal as a **fact a phase reads**, for the one phase the strict
 * read must not stop: the one whose declared writable paths include the queue
 * itself, whose rewrite is the repair (spec/pending.md, *Queue reads are
 * strict*). `readPendingForDecision` (`src/pendingLedger.ts`) hands it to that
 * phase on `TickContext.queueParseFailure` and reports it on
 * `TickResult.queueParseFailure`, in place of the throw below.
 *
 * A fact, never a verdict (`.claude/rules/engine-boundary.md`, *Routing
 * rule (plan, build, and interactive sessions)*): the engine states which
 * file did not resolve and what the parse said about it, and what to do
 * about that stays the phase's.
 */
export interface QueueParseFailure {
  /**
   * The queue **directory**'s path relative to the repo root, in git's own
   * alphabet. Which files did not resolve is {@link ParseError.file} on each
   * error below — the same names the fence that carved this failure out was
   * matched against, composed under this directory.
   */
  path: string;
  /** One per validation failure, exactly as {@link parsePendingQueue} reported them. */
  errors: readonly ParseError[];
}

/**
 * The throwing form of a {@link parsePendingQueue} refusal, for the reads that act
 * on the result rather than report it: `readPending` (`src/pendingLedger.ts`
 * — the reads that decide pickable work, and each pick's ledger rewrite)
 * raises it when a file in the queue directory fails to parse. Per
 * .claude/rules/engineering.md "Loud or nothing": a queue that never resolved
 * must not read as an empty one, and nothing downstream may derive a decision
 * or a rewrite from it. `tick()` (`src/Dispatcher.ts`) catches it exactly
 * where it catches chain-resolution failure and folds it into the same
 * mount-dead failed-outcome shape — a queue no agent can parse is
 * exactly as unusable next tick as this one. The one read that answers with
 * {@link QueueParseFailure} instead is the decide-read taken for a phase that
 * can write the queue (`readPendingForDecision`, `src/pendingLedger.ts`).
 *
 * `path` is a field a catcher reads, and the same value the message opens
 * with, taken from the engine's one spelling of where the ledger lives
 * (`reportedPendingDir`, `src/pendingLedger.ts`): git's own alphabet
 * relative to the repo root, or the absolute path when a relocated dock puts
 * the directory where git cannot name it. Which *file* did not resolve rides
 * every `ParseError` (`spec/pending.md`, *The ledger is a directory — one
 * entry per file*: a parse failure names a file), so the refusal states the
 * queue and each line states the entry a producer opens. It is
 * carried structurally for the reason the twin {@link QueueParseFailure}
 * carries one: a chain's gate reaching this class through `FlumeApi` would
 * otherwise have to take the path back out of the message with a regex —
 * rebuilding a fact the engine already holds, in the shape
 * `.claude/rules/engine-boundary.md`, *Told, not inferred* refuses
 * (`.claude/rules/engineering.md`, *A fact the engine holds is reported,
 * never rediscovered*).
 *
 * `detail` is the refusing read's own reason, appended to the message: the
 * decide-read names the fence verdict that kept the refusal standing, so the
 * operator reading the failed tick sees *why* this phase could not be handed
 * the failure as a fact rather than only that the file is broken
 * (`.claude/rules/engineering.md`, *A fact the engine holds is reported,
 * never rediscovered*). The reads that have no reason beyond the parse pass
 * none.
 *
 * Lives beside the parse it wraps rather than at the reader, because the wave
 * leg's own ledger refusal carries one as its cause (`WaveLedgerRefusal`,
 * `src/waveMerge.ts`) and a chain's gate reaches it through
 * `FlumeApi.PendingParseFailure` (`src/flumeApi.ts`).
 */
export class PendingParseFailure extends Error {
  /**
   * The ledger directory's path as every report of this module spells it
   * (`reportedPendingDir`, `src/pendingLedger.ts`): git's own alphabet
   * relative to the repo root, or the absolute path when a relocated dock
   * puts the directory where git cannot name it — the same alphabet the twin
   * {@link QueueParseFailure} reports it in.
   */
  readonly path: string;
  readonly errors: readonly ParseError[];
  constructor(path: string, errors: readonly ParseError[], detail?: string) {
    super(
      `${path} failed to parse (${errors.length} error(s)): ` +
        errors.map((e) => `[${e.file}] ${e.path}: ${e.message}`).join("; ") +
        (detail ? `; ${detail}` : ""),
    );
    this.name = "PendingParseFailure";
    this.path = path;
    this.errors = errors;
  }
}

/**
 * Parse one entry file against core + the chain's declared extension, and
 * hold it to the name it is reachable under.
 *
 * **The filename is the tag's second statement, and they must agree.** The
 * directory's listing is the queue and every tag-keyed lookup the engine
 * makes — `cli`'s find-by-tag, the dispatcher's `blockedBy` and
 * `shippedTags`, the ship's `git rm` — composes the file back from the tag
 * ({@link entryFileName}). A file reachable under one name and claiming
 * another therefore resolves to the wrong entry, or to none, so the
 * disagreement is refused naming both rather than one side being preferred
 * (`spec/pending.md`, *Tag grammar is mechanical safety, nothing more*).
 *
 * Returns structured errors rather than throwing so the harness can inject
 * them back into the plan prompt for re-derivation.
 */
function parsePendingEntry(
  file: string,
  raw: string,
  extension?: EntryExtension,
): EntryParseResult {
  const parsed = parseJsonOrFail(file, raw);
  if (!parsed.ok) return parsed.result;

  const result = composePendingEntry(extension).safeParse(parsed.value);
  if (!result.success) {
    return {
      ok: false,
      entry: undefined,
      errors: issuesToParseErrors(file, result.error.issues),
    };
  }
  return withFileNameAgreement(file, result.data);
}

/**
 * Lenient core-only parse of one entry file, for chain-less informational
 * reads (`status`-class commands that count/inspect entries without loading
 * the chain). Validates the core fields and passes unknown (presumably
 * extension) fields through unvalidated. Never used on a write path —
 * rewriting an entry from a parse that didn't know the extension is how
 * declared fields get destroyed.
 */
function parsePendingEntryLoose(
  file: string,
  raw: string,
): EntryParseResult {
  const parsed = parseJsonOrFail(file, raw);
  if (!parsed.ok) return parsed.result;

  const result = PendingEntryCore.catchall(z.unknown()).safeParse(parsed.value);
  if (!result.success) {
    return {
      ok: false,
      entry: undefined,
      errors: issuesToParseErrors(file, result.error.issues),
    };
  }
  return withFileNameAgreement(file, result.data as PendingEntry);
}

/**
 * The agreement check both parses end on, so the strict reader and the
 * chain-less one cannot disagree about which files name their own entry.
 */
function withFileNameAgreement(
  file: string,
  entry: PendingEntry,
): EntryParseResult {
  const claimed = entryFileName(entry.tag);
  if (claimed !== file) {
    return {
      ok: false,
      entry: undefined,
      errors: [
        {
          file,
          path: "tag",
          message:
            `tag "${entry.tag}" disagrees with the file it is in: ` +
            `an entry tagged "${entry.tag}" is ${claimed}`,
        },
      ],
    };
  }
  return { ok: true, entry, errors: [] };
}

/**
 * Parse a whole queue directory's listing: every file, each against core +
 * the chain's declared extension, into the queue in its declared order.
 *
 * **One verdict over the directory.** Every file's issues are collected —
 * a producer handed one repair per tick pays a tick per broken file — but a
 * single failure fails the read, because the queue a decision or a rewrite
 * acts on is all of it (`spec/pending.md`, *Queue reads are strict*).
 *
 * The listing is also where the queue's `parent` links are a graph, so the
 * forest's own rules are read here ({@link queueForestErrors}) and not on the
 * per-entry schema. `maxEntryDepth` is the cap as this tick's chain declared
 * it (`Chain.maxEntryDepth`, `src/Phase.ts`), or
 * {@link DEFAULT_MAX_ENTRY_DEPTH} where it declares none.
 */
export function parsePendingQueue(
  files: readonly QueueFile[],
  extension?: EntryExtension,
  maxEntryDepth: number = DEFAULT_MAX_ENTRY_DEPTH,
): ParseResult {
  return collectQueue(
    files.map((f) => parsePendingEntry(f.file, f.raw, extension)),
    maxEntryDepth,
  );
}

/**
 * {@link parsePendingQueue}'s chain-less twin, over
 * {@link parsePendingEntryLoose}. The forest is core shape, so this read
 * judges it too — `maxEntryDepth` rides in from whatever declaration the
 * caller holds (`flume status` has the chain even where it loads no
 * extension), and falls to {@link DEFAULT_MAX_ENTRY_DEPTH} where there is
 * none to read, so a chain that could not be loaded is still told about a
 * queue no cap could admit.
 */
export function parsePendingQueueLoose(
  files: readonly QueueFile[],
  maxEntryDepth: number = DEFAULT_MAX_ENTRY_DEPTH,
): ParseResult {
  return collectQueue(
    files.map((f) => parsePendingEntryLoose(f.file, f.raw)),
    maxEntryDepth,
  );
}

/**
 * Fold per-file outcomes into the one queue verdict both parses answer with.
 *
 * Entries come back in the order the listing handed them, which carries
 * nothing: the order a selection picks in is computed at the one home that
 * owns it (`byFilingThenTag`, `src/filingOrder.ts`).
 */
function collectQueue(
  results: readonly EntryParseResult[],
  maxEntryDepth: number,
): ParseResult {
  const errors = results.flatMap((r) => r.errors);
  if (errors.length > 0) return { ok: false, entries: [], errors };
  const entries = results.map((r) => r.entry!);
  // The parent graph is a graph only once every file resolved: run over a
  // listing one of whose files failed, a parent naming that file would report
  // as a parent naming nothing — a second, invented failure beside the real
  // one. So the forest is read after the per-file verdict and never beside it.
  const forest = queueForestErrors(entries, maxEntryDepth);
  if (forest.length > 0) return { ok: false, entries: [], errors: forest };
  return { ok: true, entries, errors: [] };
}

// ---------- the queue's forest ----------

/**
 * How deep a chain of `parent` links a queue may carry where no chain
 * declared a cap: goal, epic, work, step (`spec/pending.md`, *The queue is a
 * forest*). Counted from a root, so a root alone is depth 1.
 *
 * Here rather than at `Chain.maxEntryDepth` (`src/Phase.ts`) because the
 * check that counts a chain of parents is here, and the chain-less parse
 * ({@link parsePendingQueueLoose}) has no declaration to read: a default
 * living at the declaration would leave this parse with none.
 */
export const DEFAULT_MAX_ENTRY_DEPTH = 4;

/** What an entry is in the forest, as the core field's own enum spells it. */
type EntryKind = z.infer<typeof PendingEntryCore>["kind"];

/**
 * Which kinds may parent each kind, and how a refusal names the rule it
 * broke: everything above a `work` entry organizes and everything below it
 * is a step of that entry's session (`spec/pending.md`, *The queue is a
 * forest*). A `work` ancestor above a `work` entry is this table's
 * consequence and not a second check — `work` admits only a `group` parent
 * and `group` only a `group`, so no walk up from a `work` entry can reach
 * one.
 */
const PARENT_KINDS: Record<
  EntryKind,
  { readonly kinds: readonly EntryKind[]; readonly phrase: string }
> = {
  group: { kinds: ["group"], phrase: "a group" },
  work: { kinds: ["group"], phrase: "a group" },
  step: {
    kinds: ["work", "step"],
    phrase: "its work entry or another of its steps",
  },
};

/**
 * The rules a whole queue must keep for its `parent` links to be the forest
 * `spec/pending.md`, *The queue is a forest* describes, refused like any
 * other malformed queue (*Queue reads are strict*).
 *
 * Checked here and not on `PendingEntryCore.parent`, because every one of
 * them reads a second entry or a chain of them: a parent is a tag until the
 * listing is in hand, and only the queue-wide read can say which entry it
 * names. The per-entry field holds the one thing it can hold on its own —
 * that the value is a tag the grammar admits.
 *
 * **An absent parent is a root**, for every kind: the pairings bound a
 * *declared* parent, and a kind has no claim on the entry above it when there
 * is none. A queue of nothing but root `work` entries — what a producer
 * writes before it groups anything — is a forest of one-entry trees.
 *
 * Each refusal names the file the offending entry lives in, recomposed
 * through {@link entryFileName}: the agreement check every parse ends on
 * ({@link withFileNameAgreement}) has already proved that is the name it was
 * read under, so the name is derived rather than carried a second time
 * (`.claude/rules/engineering.md`, *Derived state is computed, never restated
 * beside its source*).
 */
function queueForestErrors(
  entries: readonly PendingEntry[],
  maxEntryDepth: number,
): ParseError[] {
  const byTag = new Map(entries.map((entry) => [entry.tag, entry]));
  const errors: ParseError[] = [];
  const refuse = (entry: PendingEntry, path: string, message: string): void => {
    errors.push({ file: entryFileName(entry.tag), path, message });
  };
  const parentOf = (entry: PendingEntry): PendingEntry | undefined =>
    entry.parent === undefined ? undefined : byTag.get(entry.parent);
  /**
   * The nearest `work` entry at or above `entry` — whose steps a step's
   * `blockedBy` may name. Bounded by the cap rather than by a visited set:
   * a chain long enough to exhaust it is one the depth rule below has
   * already refused, so the walk only has to terminate, never to diagnose.
   */
  const workEntryOf = (entry: PendingEntry): PendingEntry | undefined => {
    let cursor: PendingEntry | undefined = entry;
    for (let step = 0; cursor !== undefined && step <= maxEntryDepth; step++) {
      if (cursor.kind === "work") return cursor;
      cursor = parentOf(cursor);
    }
    return undefined;
  };

  for (const entry of entries) {
    if (entry.parent === undefined) continue;
    const parent = parentOf(entry);
    if (parent === undefined) {
      refuse(
        entry,
        "parent",
        `parent "${entry.parent}" names no entry in the queue`,
      );
      continue;
    }
    const { kinds, phrase } = PARENT_KINDS[entry.kind];
    if (!kinds.includes(parent.kind)) {
      refuse(
        entry,
        "parent",
        `a ${entry.kind} entry's parent is ${phrase}, and "${parent.tag}" ` +
          `is a ${parent.kind} entry`,
      );
    }
  }

  for (const entry of entries) {
    const chain = [entry.tag];
    let cursor = entry;
    while (cursor.parent !== undefined) {
      const parent = parentOf(cursor);
      // Unresolved above here, and already refused as such: an open chain
      // bounds nothing, so there is no depth left to judge.
      if (parent === undefined) break;
      if (chain.includes(parent.tag)) {
        refuse(
          entry,
          "parent",
          `the chain of parents above "${entry.tag}" closes on ` +
            `"${parent.tag}" (${chain.join(" under ")}): an entry above ` +
            `itself is no chain of parents at all`,
        );
        break;
      }
      chain.push(parent.tag);
      cursor = parent;
      if (chain.length > maxEntryDepth) {
        refuse(
          entry,
          "parent",
          `the chain of parents from "${entry.tag}" up ` +
            `(${chain.join(" under ")}) is deeper than maxEntryDepth ` +
            `(${maxEntryDepth})`,
        );
        break;
      }
    }
  }

  for (const entry of entries) {
    if (entry.kind !== "step" || entry.gate.kind !== "blockedBy") continue;
    const own = workEntryOf(entry);
    entry.gate.tags.forEach((tag, index) => {
      const outside = (what: string): void =>
        refuse(
          entry,
          `gate.tags.${index}`,
          `a step's blockedBy names only steps of the same work entry, and ` +
            `"${tag}" ${what}; a dependency reaching outside it is declared ` +
            `on the work entry`,
        );
      const blocker = byTag.get(tag);
      if (blocker === undefined) {
        outside("names no entry in the queue");
        return;
      }
      if (blocker.kind !== "step") {
        outside(`is a ${blocker.kind} entry`);
        return;
      }
      const theirs = workEntryOf(blocker);
      if (theirs?.tag !== own?.tag) {
        outside(
          theirs === undefined
            ? "is a step of no work entry"
            : `is a step of "${theirs.tag}"`,
        );
      }
    });
  }

  return errors;
}

/**
 * Every entry below `tag` in the queue's forest — the whole subtree, not the
 * direct children: a goal's epics, their work entries, and those entries'
 * steps all come back from one call.
 *
 * The depth is the point. A group leaves the queue with its *last descendant*
 * and a work entry's footprint is its steps' too (`spec/pending.md`, *The
 * queue is a forest*), and both read a subtree a child lookup cannot see: a
 * group whose only child shipped while that child's own step did not is a
 * group with a descendant still queued, and a child lookup calls it empty.
 * So the walk is one function with two callers rather than two spellings of
 * the same descent (`.claude/rules/engineering.md`, *A module is one job*).
 *
 * The order the subtree comes back in carries nothing — both callers read it
 * as a set. What the walk does owe is termination, and the visited set is
 * what makes that a guarantee rather than an assumption about the caller's
 * listing: a chain of parents that closes on itself is refused by the
 * queue-wide read ({@link queueForestErrors}), but this function is handed a
 * list, not that verdict. A tag naming no entry has no subtree and comes back
 * empty.
 */
export function descendantsOf(
  entries: readonly PendingEntry[],
  tag: string,
): PendingEntry[] {
  const children = new Map<string, PendingEntry[]>();
  for (const entry of entries) {
    if (entry.parent === undefined) continue;
    const siblings = children.get(entry.parent);
    if (siblings === undefined) children.set(entry.parent, [entry]);
    else siblings.push(entry);
  }
  const below: PendingEntry[] = [];
  const seen = new Set<string>([tag]);
  const frontier = [tag];
  while (frontier.length > 0) {
    for (const child of children.get(frontier.pop()!) ?? []) {
      if (seen.has(child.tag)) continue;
      seen.add(child.tag);
      below.push(child);
      frontier.push(child.tag);
    }
  }
  return below;
}

// ---------- prompt rendering ----------

/**
 * Append the field-list separator to a rendered block, landing it on the
 * block's last line *before* any trailing `// comment` rather than after —
 * a "," past "//" is swallowed into the comment text instead of delimiting
 * the field that follows. A bare `indexOf("//")` also matches "//" occurring
 * inside a hint's own text (e.g. a URL like "https://..."), so require the
 * whitespace that only a real trailing comment marker carries.
 *
 * One home for both junctions the render has: extension-to-extension, and
 * core-to-extension — whose last core line carries a trailing comment too.
 */
function withListSeparator(block: string): string {
  const lastBreak = block.lastIndexOf("\n");
  const head = block.slice(0, lastBreak + 1);
  const line = block.slice(lastBreak + 1);
  const commentIndex = line.lastIndexOf(" // ");
  if (commentIndex === -1) return `${head}${line},`;
  return `${head}${line.slice(0, commentIndex).trimEnd()},  ${line.slice(commentIndex + 1)}`;
}

/**
 * Render the schema — core plus the chain's declared extension — as a
 * compact, prompt-friendly description. Injected into the plan prompt so
 * the schema in the prompt and the parser cannot drift: both are built from
 * the same declaration.
 *
 * The header's "fields not listed here are rejected" is a claim about the
 * composed validator, so every core field that validator accepts is named
 * here — including the ones a producer never authors, which render with the
 * instruction to carry or omit rather than as authorable shape. Pinned
 * against the real validator by tests/PendingSchema.test.ts, "every
 * engine-core field the composed validator accepts is named in the rendered
 * schema".
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
      return i === extensionEntries.length - 1 ? line : withListSeparator(line);
    })
    .join("\n");

  const coreLines = `  "tag": ${tagHint},   // unique; appears in commit msg; mechanical safety is the floor, a chain-declared refinement (if any) narrows further
  "gate": { "kind": "open" }                                  // ready to ship
        | { "kind": "blockedBy", "tags": ["OTHER-TAG", ...] }   // upstream blocks; non-empty, name every parent
        | { "kind": "parked",    "reason": "decision on ..." }  // human action needed
        | { "kind": "deferred",  "reason": "no consumer yet" }  // carried indefinitely
        | { "kind": "requiresCapability", "capability": "some-env-fact" },  // env gate; pickable iff the chain asserts this capability
  "dependsOnForks": [ "fork-slug", ... ],               // optional; foundational forks this rests on — not picked until the chain resolves every one. Omit if none.
  "kind": "work" | "step" | "group",                    // optional, default "work"; "work" is the dispatch unit and the only kind selection picks, "step" is part of a work entry and ships in its session, "group" organizes and leaves the queue with its last descendant. Omit for work.
  "parent": "OTHER-TAG",                                // optional; the entry this one is part of, by tag — one parent, so the queue is a forest. Omit for a root.
  "files": {                                            // EVERY path the work legitimately touches — tests and incidentals included. Enforced on fanout: a scoped tick may write ONLY these paths ∪ the phase's channel paths; an under-declared entry trips the write guard.
    "new":  [ { "path": "...", "description": "..." } ],
    "edit": [ { "path": "...", "description": "..." } ],
    "retire": [ "path", ... ]
  },
  "observedFiles": [ "path", ... ]                      // engine-maintained, never authored here: the dispatcher records the real footprint of an attempt that did not ship, so a retry partitions away from whatever it collided with. Carry it through unchanged when an entry already has one; omit it otherwise.`;

  const fields = extensionLines
    ? `${withListSeparator(coreLines)}\n${extensionLines}`
    : coreLines;

  return `Each pending entry MUST conform to this shape (fields not listed here are rejected):

{
${fields}
}

One entry per file, named "<tag>.json" directly under the queue directory — the filename and the "tag" field must agree. The queue's order is computed at every selection, never carried by a position or a filename. An empty directory is valid (means nothing pending).`;
}

// ---------- pickability ----------

/**
 * An entry is pickable when every foundational fork it declares is resolved
 * AND its gate is open AND it is not waiting on a capability the chain
 * hasn't asserted.
 *
 * Pickability's one switch over `gate.kind` lives here, and both of its
 * readers take it from here. Tooling holding its own shipped-tags set reads
 * it off the package's exports and the chain API (`FlumeApi`,
 * `src/flumeApi.ts`); the dispatcher's own selection reaches it through
 * `isPickable` (`src/selection.ts`), which composes `shippedTags` off the
 * pending queue, where a blocker has settled exactly when it is no longer
 * in it. A second spelling of the switch on either side is how the two
 * could come to disagree about what "pickable" means.
 *
 * `isForkResolved` is the foundations governor's injected predicate: it
 * answers "is this fork slug resolved?" for the consuming project. It
 * defaults to always-resolved, so a caller that supplies none — or an entry
 * that declares no `dependsOnForks` — behaves exactly as before.
 *
 * `blockedBy` is pickable iff every named blocker tag has shipped — a DAG
 * with several parents resolves only once all of them land, never on the
 * first.
 *
 * `capabilities` is the chain's declared `Chain.capabilities` — the
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
      return entry.gate.tags.every((tag) => shippedTags.has(tag));
    case "parked":
    case "deferred":
      return false;
    case "requiresCapability":
      return capabilities.has(entry.gate.capability);
  }
}

/**
 * One entry's own `files.new`/`edit`/`retire`, in declaration order — the
 * paths that entry's record states, with nothing read off the queue around
 * it. The two footprints below fold this over a subtree; nothing else reads
 * it, because no consumer of a footprint wants one entry's share of it.
 */
function ownDeclaredPaths(entry: PendingEntry): string[] {
  return [
    ...entry.files.new.map((f) => f.path),
    ...entry.files.edit.map((f) => f.path),
    ...entry.files.retire,
  ];
}

/**
 * A footprint: one entry's share of it, folded over that entry and every
 * descendant {@link descendantsOf} finds below it, deduped with first-seen
 * order kept.
 *
 * The one fold both footprints are made of, so the subtree a fence is composed
 * from and the subtree a partition collides on cannot be two different walks
 * (`.claude/rules/engineering.md`, *A module is one job*).
 */
function foldFootprint(
  listing: readonly PendingEntry[],
  entry: PendingEntry,
  share: (member: PendingEntry) => string[],
): string[] {
  const union = new Set<string>();
  for (const member of [entry, ...descendantsOf(listing, entry.tag)]) {
    for (const path of share(member)) union.add(path);
  }
  return [...union];
}

/**
 * The set of file paths an entry declares it will touch — its own
 * `files.new`/`edit`/`retire` and every one of its steps' together
 * (`spec/pending.md`, *The queue is a forest*). This is what the entry's
 * author committed to; it excludes dispatcher-observed writes
 * (`observedFiles`), which the entry never declared.
 *
 * A footprint is a property of an entry **in a listing**, never of the entry
 * alone, so the listing leads — as it does for {@link descendantsOf}, whose
 * walk this shares with the group's retirement rather than spelling a second
 * descent. `listing` is any listing the entry's descendants are in: the queue
 * a selection read, or the `steps` the engine already resolved for the slot
 * carrying the entry (`ShipContext.steps`, `src/Phase.ts`) — the walk reads
 * `parent` links alone, so either answers.
 *
 * Required and never defaulted: a listing that holds none of the descendants
 * yields a *narrower* footprint, which is a fence and a partition that both
 * read short, and silently (`.claude/rules/engineering.md`, *Loud or
 * nothing*). An empty listing is the caller saying there are no steps, which
 * every call site that has no queue to hand means literally.
 *
 * The fold is downward only. A leaf's subtree is empty, so an entry a
 * producer never decomposed reads exactly its own files, and a step reads its
 * own alone — never the work entry's above it.
 */
export function declaredPaths(
  listing: readonly PendingEntry[],
  entry: PendingEntry,
): string[] {
  return foldFootprint(listing, entry, ownDeclaredPaths);
}

/**
 * The set of file paths an entry would touch: {@link declaredPaths} over the
 * same subtree plus whatever `observedFiles` each of those entries carries.
 * Used by the fanout partitioner to decide which entries can run in parallel
 * worktrees, so two entries colliding only through a step never share a batch.
 *
 * `listing` is read exactly as {@link declaredPaths} reads it.
 */
export function touchedPaths(
  listing: readonly PendingEntry[],
  entry: PendingEntry,
): string[] {
  return foldFootprint(listing, entry, (member) => [
    ...ownDeclaredPaths(member),
    ...(member.observedFiles ?? []),
  ]);
}
