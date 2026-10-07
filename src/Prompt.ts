/**
 * Prompt — renders a phase's prompt template for one tick.
 *
 * The template is taken as bytes, not as an address: `readPhaseTemplate`
 * loads a phase's prompt file once, where the tick loads its chain, and every
 * slot that tick renders is handed that same string. A render that re-read the
 * file would hand a refilled slot whatever the primary checkout held at
 * refill time — a template edited on trunk mid-wave, filled by the code the
 * process started on (spec/loop.md, *One tick is one fresh process*).
 *
 * Two transformations are applied to the raw template:
 *
 *   1. `{{KEY}}` placeholders are replaced from the promptArgs map.
 *   2. `` !`shell command` `` inline-exec blocks are evaluated in the tick's
 *      cwd and replaced with their stdout. This lets prompts bake in dynamic
 *      context (the current queue, recent `git log`, `pnpm tsc` output)
 *      without an authoring round-trip.
 *
 * A `<harness>` block is prepended to every rendered prompt with the phase's
 * declared capabilities (writable paths, gate names). This keeps prompts DRY
 * — the human-authored prompt file states the task; the harness injects what
 * it will enforce.
 *
 * A `<prior-attempt>` block follows it whenever the dispatcher hands in a
 * persisted {@link PriorAttempt} — the bounded record of a previous no-commit
 * attempt, tagged with exactly one member of {@link NO_COMMIT_MODES} — the
 * taxonomy's one home, below — plus two sibling facts rather than further
 * {@link NoCommitMode} members: `tip-moved`, the agent's span soft-reset away
 * because its branch base was rewritten out from under it, and `not-shipped`, a commit that
 * landed and passed every gate which the chain's own `shipped` predicate
 * declined. Neither is a defect the four modes classify. Each renders
 * distinctly so the retry knows what actually happened. Like `<harness>` it is
 * dispatcher-owned and structural: no `{{token}}` in the prompt file, no
 * `promptArgs`. Absent on a first attempt; cleared once an attempt ships, and
 * cleared as stale once the entry its key names leaves the queue.
 */

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { toNamespacedPath } from "node:path";

import { agentEndingWords, type AgentEnding } from "./Agent.js";
import type { Phase } from "./Phase.js";
import { entryWriteScope, phasePromptPath } from "./paths.js";
import type { PendingEntry } from "./PendingSchema.js";
import { thrownMessage } from "./thrown.js";

const PLACEHOLDER_RE = /\{\{([A-Z][A-Z0-9_]*)\}\}/g;
const INLINE_EXEC_RE = /!\s*`([^`]+)`/g;

/**
 * What a declared data key's inline-exec span is broken with: a zero-width
 * space (U+200B) wedged between the bang and the whitespace-then-backtick the
 * grammar admits. U+200B is outside `INLINE_EXEC_RE`'s `\s` class, so the span
 * stops matching, and it renders as nothing, so the command text the value
 * quotes reaches the agent exactly as its author wrote it. Deliberately not a
 * deletion or a placeholder: the value is content the prompt exists to show,
 * and dropping it would be the silent degradation `.claude/rules/engineering.md`
 * *Loud or nothing* names.
 */
const SPAN_BREAK = "​";

/**
 * Output cap for one inline-exec span. `spawn` has no `maxBuffer` (unlike
 * `execFile`), so the cap is enforced by hand: overrun kills the child and
 * rejects rather than truncating silently.
 */
const INLINE_EXEC_MAX_BUFFER = 4 * 1024 * 1024;

/**
 * The four causally-distinct ways a tick produces no usable commit:
 *
 *  - `gate-revert`      a commit was made and a gate reverted it,
 *  - `clean-exit`       the agent exited cleanly with no usable commit —
 *                       none at all, or a span whose diff against its base
 *                       is empty — and what that meant is the chain's
 *                       reading of the recorded final message, never an
 *                       engine label,
 *  - `platform-preempt` the agent process failed for non-work reasons
 *                       (rate-limit, auth, dispatcher-killed, timeout) —
 *                       NOT a defect in the work,
 *  - `render-refused`   the tick refused before invocation — the prompt
 *                       itself never resolved, or a pre-invocation hook
 *                       threw — so the agent was never invoked at all.
 *
 * The taxonomy's one home, and a runtime value rather than a type alone so a
 * prompt or a chain names the modes from the engine instead of from a copy
 * that an engine rename would strand. `tipMoved` and `declined` sit beside
 * these four and are never folded in: neither is a cause they classify.
 */
export const NO_COMMIT_MODES = [
  "gate-revert",
  "clean-exit",
  "platform-preempt",
  "render-refused",
] as const;

/**
 * One member of {@link NO_COMMIT_MODES}, derived from it so the two cannot
 * disagree. The discriminant of {@link PriorAttempt} and the value carried on
 * `TickOutcome.noCommit`; exactly one per no-commit tick.
 */
export type NoCommitMode = (typeof NO_COMMIT_MODES)[number];

/**
 * Every mode a {@link PriorAttempt} record can carry: the four
 * {@link NO_COMMIT_MODES}, spread in rather than respelled, plus the two
 * siblings that classify no cause at all — `tip-moved`, whose span was
 * discarded before any gate ran, and `not-shipped`, whose commit landed and
 * was then declined by the chain. The roster's one home: whatever decodes a
 * record off disk, enumerates the modes for a prompt, or asserts a builder
 * minted one reads this rather than keeping a list of its own.
 *
 * Tied to the union in both directions, so neither side can grow alone: the
 * `satisfies` here refuses a mode no variant carries, and {@link modeLines}
 * — the switch the renderer is exhaustive over — refuses a variant this
 * roster does not name.
 */
export const PRIOR_ATTEMPT_MODES = [
  ...NO_COMMIT_MODES,
  "tip-moved",
  "not-shipped",
] as const satisfies readonly PriorAttempt["mode"][];

/**
 * One member of {@link PRIOR_ATTEMPT_MODES}, derived from it so the two
 * cannot disagree — the discriminant of {@link PriorAttempt}.
 */
export type PriorAttemptMode = (typeof PRIOR_ATTEMPT_MODES)[number];

/**
 * Whether an untrusted value names a mode on {@link PRIOR_ATTEMPT_MODES} —
 * the acceptance a persisted record is decoded by (`src/priorAttempts.ts`),
 * so the modes the engine mints and the modes it will read back again are
 * one set rather than two that drift.
 */
export function isPriorAttemptMode(value: unknown): value is PriorAttemptMode {
  return (PRIOR_ATTEMPT_MODES as readonly unknown[]).includes(value);
}

/**
 * Which keyspace a persisted record's key belongs to: `"entry"` for a fanout
 * entry's tag slug, `"phase"` for a singleton phase's name. The key's own
 * text cannot say — a stem the queue no longer carries is a retired tag in
 * one keyspace and a live phase in the other — so every record states it,
 * and the wave that clears stale entry-keyed records reads this rather than
 * guessing from the filename (spec/loop.md "No false signal").
 */
export type PriorAttemptKeyspace = "entry" | "phase";

/**
 * What every {@link PriorAttempt} record carries whatever mode tagged it:
 * where the record is keyed, the identity it was keyed under, the entry
 * declaration it was written against, and the world it was written in. Each
 * variant below extends this and declares only the facts its own mode holds,
 * so a fact the envelope gains is gained by all six at once rather than by
 * six edits that have to agree.
 */
export interface PriorAttemptEnvelope {
  /**
   * Which keyspace this record's key lives in (spec/loop.md "No false
   * signal") — stamped by the writer, never derived from the key's text.
   */
  key: PriorAttemptKeyspace;
  /**
   * The identity this record was written under — the entry tag slug
   * (fanout) or the phase name as the chain spells it (singleton), stamped
   * by the writer from the same ref that chose the file's path.
   * `TickContext.priorAttempts` keys by {@link key} and this together —
   * `entry:<tag slug>`, `phase:<phase name>` — rather than by the filename
   * stem, so a phase whose name `slugify` rewrites still finds its own
   * record under the name it already holds, and a phase and a tag that slug
   * alike stay two records. The stem stays slugged, under its keyspace's own
   * directory; only the map key is the written identity.
   */
  keyedAs: string;
  /**
   * The entry **as declared** when this record was written — its slug and a
   * hash of the declaration its queue file carried for it (`entryDeclaredKey`,
   * `src/entryKey.ts`), stamped by the writer from the same ref that chose the
   * file's path. Entry-keyed records only: a singleton phase has no
   * declaration to hash, and a record whose `key` says `entry` and carries
   * none reads as absent (`PriorAttemptStore` (`src/priorAttempts.ts`)) rather
   * than as a stale slot standing against the entry a queue holds now.
   *
   * What a standing per-entry refusal keys on (`spec/harness.md`, *The
   * phases*): {@link headSha} says which world the attempt was made in, this
   * says which declaration it was made against. A producer's rewrite is a new
   * key and lifts the refusal; a commit that only moves the tip leaves it
   * standing.
   */
  declaredAs?: string;
  /** Trunk tip when this record was written (spec/loop.md "Every record is anchored"). */
  headSha: string;
  /** ISO timestamp alongside {@link headSha}. */
  at: string;
}

/**
 * A prior attempt that committed and was then REVERTED by a gate
 * (`afterCommit` or `afterMerge`).
 */
export interface GateRevertAttempt extends PriorAttemptEnvelope {
  mode: "gate-revert";
  /** Which gate phase reverted the prior commit. */
  when: "afterCommit" | "afterMerge";
  /** Failing gate's stable `name`. */
  gate: string;
  /** Gate's one-line verdict (`GateResult.message`). */
  message: string;
  /**
   * The gate's own chain-authored discriminant (`GateResult.verdict`),
   * copied verbatim beside {@link message} and interpreted no further
   * (spec/chain.md "What a gate returns"). A retry keying on *why* the gate
   * refused reads this rather than pattern-matching the prose above.
   */
  verdict?: string;
  /** Gate's full captured output (`GateResult.details`), bounded. */
  details?: string;
  /**
   * `git show --stat` digest of the span the reverted work added, bounded —
   * every commit between the tip it landed onto and the tip it reached, never
   * that tip's own diff. Over a span the tip already held whole the span added
   * no commit, and this says so in words rather than naming the commit another
   * writer left standing there.
   */
  diffStat: string;
  /**
   * The gate's own `GateResult.failingFiles` (`./Gate.js`), copied verbatim:
   * the repo-relative paths the gate attributed the failure to, absent when
   * it named none. The engine derives nothing from it — a span's edits can
   * red a file they never touched, so disjointness from the footprint proves
   * nothing (spec/chain.md "What a gate returns").
   */
  failingFiles?: string[];
  /**
   * The gate's own `GateResult.blamesSpan` (`./Gate.js`), copied verbatim:
   * present and `false` when the gate declared this failure not the reverted
   * span's. The record then carries no blame on the entry, and neither does
   * the tick's stage failure (spec/loop.md "Prior-outcome feedback to the
   * retrying tick"). Absent is the ordinary revert — the gate attributed
   * nothing, and the span is the suspect. Declared by the gate, never
   * inferred by the engine.
   */
  blamesSpan?: false;
}

/**
 * The agent exited cleanly and left no usable commit — none at all, or a
 * span whose diff against its base is empty. No gate ran, and no reason is
 * recorded: a refused constraint, a deliberate park, or simply nothing to do
 * are one chain's readings of one chain's prompt, never an engine label
 * (`.claude/rules/engine-boundary.md`, *Told, not inferred*). The engine
 * records the facts it holds — that the exit was clean and produced nothing
 * usable, the span it produced nothing across, and the
 * tail of what the agent last said — and leaves the reading to whoever
 * reads {@link finalMessage}.
 */
export interface CleanExitAttempt extends PriorAttemptEnvelope {
  mode: "clean-exit";
  /**
   * The tail of the agent's own final message, bounded — lifted from the
   * transcript by the adapter's `extractFinalMessage` (`src/claudeCode.ts`) and
   * quoted verbatim. Whatever the exit meant, the agent said it here; the
   * engine neither names nor paraphrases it.
   */
  finalMessage: string;
  /**
   * The tip the attempt's worktree branch started from — the base its span
   * would have been picked from had the span carried anything.
   */
  spanBase: string;
  /**
   * The worktree HEAD the agent left. Equal to {@link spanBase} when the
   * agent committed nothing at all; ahead of it when the agent committed and
   * the span's cumulative diff against the base came out empty. The pair is
   * what tells those two exits apart — the engine states which happened and
   * never labels why — and, in the second case, what makes the span's
   * commits reachable in the shared object store until gc, since an empty
   * span dies with its worktree rather than reaching the merge stage.
   */
  spanHead: string;
}

/**
 * The agent process failed for non-work reasons (rate-limit, auth, per-tick
 * timeout, dispatcher-killed). Explicitly NOT a defect in the prior
 * attempt's work — its reasoning is not discredited; the retry resumes the
 * work rather than treating the cut-off as a wall.
 */
export interface PlatformPreemptAttempt extends PriorAttemptEnvelope {
  mode: "platform-preempt";
  /** The non-work failure class, bounded. */
  failureClass: string;
  /**
   * How the agent process ended — its exit code, or on POSIX the signal
   * that ended it ({@link AgentEnding}). The retry reads the wall it hit as
   * the host stated it, rather than a sentinel code standing in for a kill
   * (`spec/loop.md`, *The no-commit taxonomy*).
   *
   * Absent exactly when the attempt reached no ending at all — the spawn
   * failed, or the abort fired before it. The render says so in those words
   * instead of filling the field.
   */
  ending?: AgentEnding;
}

/**
 * The tick aborted before the agent was invoked. Two writers reach this
 * record: one or more inline-exec spans in the prompt did not resolve, or a
 * pre-invocation hook — `shouldRun` or `promptArgs` (`spec/chain.md`, *What a
 * hook receives*) — threw. Distinct from `clean-exit` (the agent ran and
 * committed nothing) and from `platform-preempt` (the agent process itself
 * failed): under either writer the agent never ran at all, so a chain's
 * `handoff` can tell "could not see" from "chose not to act".
 */
export interface RenderRefusedAttempt extends PriorAttemptEnvelope {
  mode: "render-refused";
  /**
   * What refused, bounded: every failing span's command text and stderr, or
   * the hook that threw and what it said. One field for both writers — the
   * retrying tick reads the text, and the two have no error type in common.
   */
  failures: string;
}

/**
 * The agent's span was discarded because the base its private `flume/**` branch
 * started from is no longer an ancestor of the HEAD it left — something reset or
 * rewrote that base out from under the one legitimate writer — so the dispatcher
 * soft-reset the span away on that branch before any gate ran. Not a
 * {@link NoCommitMode}: the agent's work was not at fault. A sibling fact beside
 * the four `NoCommitMode` variants, not a fifth member of that type — `mode`
 * here is its own literal, `"tip-moved"`, never assigned to a
 * `NoCommitMode`-typed field.
 *
 * That ancestry leg is this record's only writer. A wave that refuses to
 * cherry-pick because another process holds a live claim on the tip reports
 * `tipMoved` as a tick fact (`TickVerdict.tipMoved`) and writes no record here:
 * it discarded nothing, and the refused entry's commit is still on its own
 * worktree branch.
 */
export interface TipMovedAttempt extends PriorAttemptEnvelope {
  mode: "tip-moved";
  /** The base the agent's branch was recorded at, which the observed HEAD no longer descends from. */
  expectedTip: string;
  /**
   * The observed HEAD itself — never its parent, which would read the agent's
   * own top commit as the intruder and leave it undiscoverable.
   */
  observedTip: string;
}

/**
 * The commit landed on trunk and passed every gate, and the chain's own
 * `shipped` predicate then did not ship it (`spec/pending.md`, *Ship
 * detection trusts the agent's own account*) — it returned `false`, or it
 * threw, and {@link threw} says which. The commit stays, the entry stays
 * pending. A sibling fact beside the four {@link NoCommitMode} variants,
 * exactly like {@link TipMovedAttempt} — a tick that committed is not a
 * no-commit tick at all, and the cause here is the chain's verdict rather
 * than any failure the four modes classify.
 *
 * **No reason vocabulary.** The engine records that the chain said no, never
 * why: a park, a partial, a deliberate hand-off are one chain's words for
 * one chain's workflow (`.claude/rules/engine-boundary.md`, *Told, not
 * inferred*). The facts carried are the ones the engine itself holds — the
 * merged sha, what that commit touched, and whether the predicate ran to a
 * verdict at all.
 */
export interface NotShippedAttempt extends PriorAttemptEnvelope {
  mode: "not-shipped";
  /** The cherry-picked commit on trunk the predicate declined — still reachable, so the next tick can read it. */
  mergedSha: string;
  /**
   * What a `shipped` predicate the engine could not read did instead of
   * answering — a throw's own message, or the engine's sentence naming the
   * tags it would not remove (`spec/chain.md`, *What a hook receives*: a
   * throw is not an answer),
   * bounded like every other captured text on a record. Absent when the
   * predicate deliberately named nothing, so the retrying tick and every
   * `shouldRun` reading `TickContext.priorAttempts` tells a declined ship
   * from a broken predicate instead of collapsing the two into one record —
   * the same split `TickResult`'s merge outcome already reports for the tick
   * that wrote this. Not a reason: it is the engine's own account of a
   * predicate that never reached a verdict, never the chain's words for
   * declining one.
   */
  threw?: string;
  /**
   * Paths that commit touched, bounded (see {@link omittedPaths}) — the same
   * list the predicate itself was handed on `ShipContext.touchedPaths`.
   */
  touchedPaths: string[];
  /** How many further paths the commit touched beyond {@link touchedPaths}'s bound. Absent when the list is whole. */
  omittedPaths?: number;
}

/**
 * A prior attempt that left the queue unchanged, for one entry (fanout,
 * keyed by tag) or phase (singleton, keyed by phase name) — a mode-tagged
 * union, exactly one variant. The dispatcher persists this to disk when a
 * tick yields nothing the queue could consume — no usable commit, or (the
 * {@link NotShippedAttempt} leg) a commit the chain declined to count as
 * shipped — and reads it back on the next tick: the carry is cross-process by
 * construction (each tick is a fresh process; there is no in-memory
 * handoff). Bounded by construction: a digest, not a transcript.
 */
export type PriorAttempt =
  | GateRevertAttempt
  | CleanExitAttempt
  | PlatformPreemptAttempt
  | RenderRefusedAttempt
  | TipMovedAttempt
  | NotShippedAttempt;

/**
 * Inputs to `renderPrompt`. The dispatcher loads `template` once per tick
 * through {@link readPhaseTemplate}; `args` and `cwd` come from the per-tick
 * `TickContext` and the phase's `promptArgs` builder.
 */
export interface RenderOptions {
  phase: Phase;
  /**
   * The prompt template's bytes, as {@link readPhaseTemplate} loaded them for
   * this tick. Bytes rather than a path because the load is the tick's, made
   * once beside the chain resolution and reused for every slot: a render that
   * took an address would re-read the file per slot, and a refilled slot would
   * be handed a template the process's own code never matched.
   */
  template: string;
  /** Working directory for inline-exec evaluation. */
  cwd: string;
  /**
   * Resolved flume state root. Auto-injected as the reserved `{{FLUME_DIR}}`
   * substitution key, so any prompt can reference state-relative paths
   * (`{{FLUME_DIR}}/plan/pending/`) with no `promptArgs` boilerplate. A
   * chain-supplied `FLUME_DIR` in `args` does not override it — the resolved
   * root is authoritative.
   */
  flumeDir: string;
  /** Substitution map. */
  args: Record<string, string>;
  /**
   * A prior no-commit attempt for this entry/phase (any {@link NoCommitMode},
   * or a `tip-moved`/`not-shipped` sibling), read from disk by the dispatcher.
   * Injected as the dispatcher-owned `<prior-attempt>` block. Omitted on a
   * first attempt — the block is then absent entirely.
   */
  priorAttempt?: PriorAttempt;
  /**
   * Pending entry assigned to this tick (fanout phases only), read from the
   * same `TickContext` the dispatcher already threads through. When present,
   * the `<harness>` block states the *effective* fence — `entry.files ∪
   * phase.entryChannelPaths` — as what the write guard (`runAfterCommitGates`,
   * `src/tickAttempt.ts`) actually enforces on this tick, naming
   * `phase.writablePaths` separately as the outer ceiling. Absent (singleton
   * ticks, or a fanout tick with no assignment) renders the unscoped block —
   * exact byte shape pinned by tests/Prompt.test.ts's "byte-identical to the
   * collapsed rendering that predates the effective fence" case.
   */
  assignedEntry?: PendingEntry;
}

/**
 * A phase's declared prompt file could not be read — nothing at the address,
 * a directory standing where the file belongs, a permission denial. Raised by
 * {@link readPhaseTemplate} in place of the `fs` error it wrapped, so every
 * caller classifies this wall off a type rather than off an errno's prose
 * (`.claude/rules/engine-boundary.md`, *Told, not inferred*).
 *
 * Deliberately not a {@link RenderRefusal}: that class ends one slot of a wave
 * and its siblings carry on, where this load is the whole tick's, made once
 * beside the chain load and before any worktree is provisioned. A phase whose
 * prompt will not read has nothing to render for any slot, so the refusal is
 * the tick's — reported as `TickOutcome.promptUnreadable` (`src/Dispatcher.ts`)
 * and classified mount-dead by `tickExitCode` (`src/cliVerdict.ts`), which is
 * what `flume render` already answers the same input with.
 */
export class PromptTemplateUnreadableError extends Error {
  /** `Phase.promptPath` exactly as the chain declared it. */
  readonly promptPath: string;
  /** What that address resolved to against the chain's config directory. */
  readonly resolvedPath: string;

  constructor(promptPath: string, resolvedPath: string, cause: unknown) {
    super(
      `declared prompt file could not be read: ${resolvedPath} ` +
        `(promptPath: ${promptPath}) — ` +
        (thrownMessage(cause)),
      { cause },
    );
    this.name = "PromptTemplateUnreadableError";
    this.promptPath = promptPath;
    this.resolvedPath = resolvedPath;
  }
}

/**
 * Load a phase's prompt template: the bytes at `phase.promptPath` resolved
 * against the chain's config directory (`phasePromptPath`, `src/paths.ts`).
 *
 * One call per tick, made where the chain is loaded, and its result is what
 * every slot of that tick renders with — so the words an agent is handed and
 * the code that filled them are one version, and a template edited on trunk
 * after the process started reaches no slot of the tick, a refilled one
 * included (spec/loop.md, *One tick is one fresh process*).
 *
 * A file that cannot be read raises {@link PromptTemplateUnreadableError}
 * here, before any worktree is provisioned: a phase whose prompt is missing
 * has nothing to render for any slot, and the refusal is the whole tick's
 * rather than one slot's.
 */
export async function readPhaseTemplate(
  configDir: string,
  promptPath: string,
): Promise<string> {
  const resolvedPath = phasePromptPath(configDir, promptPath);
  try {
    return await readFile(toNamespacedPath(resolvedPath), "utf8");
  } catch (cause) {
    throw new PromptTemplateUnreadableError(promptPath, resolvedPath, cause);
  }
}

/**
 * Render a phase's prompt for one tick from the template bytes it was handed
 * ({@link readPhaseTemplate}): substitute `{{KEY}}`
 * placeholders from `args` — with the spans in every key the phase declared
 * in {@link Phase.promptDataKeys} neutralized first — evaluate `` !`cmd` ``
 * inline-exec blocks in `cwd`, prepend the optional `<prior-attempt>` block, then prepend the
 * `<harness>` block describing writable paths and gates. Returns the
 * fully-rendered prompt ready to feed an Agent. Block order in the result:
 * `<harness>` first, then `<prior-attempt>` (if any), then the task body —
 * what is enforced, then what failed last time, then the work.
 */
export async function renderPrompt(opts: RenderOptions): Promise<string> {
  const raw = opts.template;
  // FLUME_DIR is reserved and dispatcher-authoritative: merge it last so a
  // chain-supplied arg of the same name cannot shadow the resolved root.
  const args = {
    ...neutralizeDataArgs(opts.args, opts.phase.promptDataKeys),
    FLUME_DIR: opts.flumeDir,
  };
  const withArgs = substitutePlaceholders(raw, args);
  const withExec = await evaluateInlineExec(withArgs, opts.cwd);
  const withPrior = prependPriorAttemptBlock(opts.priorAttempt, withExec);
  return prependHarnessBlock(opts.phase, opts.assignedEntry, withPrior);
}

// ---------- transformations ----------

/**
 * The render's own refusal: a stage of {@link renderPrompt} that could not
 * resolve what the prompt asked for, thrown before the agent is invoked. The
 * tick's name for the whole class is `render-refused` ({@link NO_COMMIT_MODES})
 * — a render that does not resolve is one outcome whatever refused it, so the
 * attempt ends its own slot with a persisted record while its siblings carry
 * on, and it never tears the tick down (spec/prompt.md, *The render
 * pipeline*). The base exists so the catch that classifies it names a class
 * rather than a roster of stages: a stage that gains a refusal extends this
 * and is classified without the catch being touched.
 *
 * {@link RenderRefusal.signature} is the wall this refusal keys on — the
 * stable identity of what would not resolve, never what it printed, so the
 * same wall hit twice counts twice for the repeated-failure backstop
 * (spec/loop.md, *Repeated identical failures — quarantine, then abort*).
 * That backstop is also what a config defect answers to: a template no arg
 * can fill refuses identically for every entry, which is a repeated failure
 * rather than a class of its own. `message` carries the full picture, for a
 * caller that only logs it.
 */
export abstract class RenderRefusal extends Error {
  abstract readonly signature: string;
}

/**
 * Thrown by stage 1 when the prompt names a `{{KEY}}` the merged `promptArgs`
 * map — the phase's, plus the reserved `FLUME_DIR` — has no entry for. The
 * render aborts before any span is evaluated and the agent is never invoked,
 * so no prompt is ever sent carrying an unsubstituted placeholder and no
 * substituted marker stands in for a value that never came
 * (`.claude/rules/engineering.md`, *Loud or nothing*).
 *
 * `missing` names every such key, sorted — the whole set in one refusal
 * rather than the first found, so a chain fixes its args once.
 */
export class MissingPlaceholderRenderError extends RenderRefusal {
  readonly missing: readonly string[];
  readonly signature: string;

  constructor(missing: readonly string[]) {
    super(`prompt references missing args: ${missing.join(", ")}`);
    this.name = "MissingPlaceholderRenderError";
    this.missing = missing;
    // The keys that would not resolve, never the prompt text around them: two
    // templates missing the same key are one wall.
    this.signature = `missing args: ${missing.join(", ")}`;
  }
}

function substitutePlaceholders(
  raw: string,
  args: Record<string, string>,
): string {
  const missing = new Set<string>();
  for (const [, key] of raw.matchAll(PLACEHOLDER_RE)) {
    if (!(key! in args)) missing.add(key!);
  }
  if (missing.size > 0) {
    throw new MissingPlaceholderRenderError([...missing].sort());
  }
  return raw.replace(PLACEHOLDER_RE, (_, key: string) => args[key]!);
}

/**
 * Every value whose key the phase declared in {@link Phase.promptDataKeys},
 * with its inline-exec spans made inert; every other value is passed through
 * untouched. Applied to the values rather than to stage 1's output, which is
 * the same text either way — `substitutePlaceholders` never rescans what it
 * substituted, so a span can only reach stage 2 through the value it was
 * carried in.
 */
function neutralizeDataArgs(
  args: Record<string, string>,
  dataKeys: readonly string[] | undefined,
): Record<string, string> {
  if (dataKeys === undefined || dataKeys.length === 0) return args;
  const declared = new Set(dataKeys);
  const out: Record<string, string> = { ...args };
  for (const key of Object.keys(out)) {
    if (declared.has(key)) out[key] = neutralizeInlineExec(out[key]!);
  }
  return out;
}

/** One value's spans, each opener broken by {@link SPAN_BREAK}. */
function neutralizeInlineExec(value: string): string {
  return value.replace(
    INLINE_EXEC_RE,
    (match) => `!${SPAN_BREAK}${match.slice(1)}`,
  );
}

/** One inline-exec span that failed to resolve — its command text and stderr. */
export interface InlineExecFailure {
  cmd: string;
  stderr: string;
}

/**
 * Thrown by {@link evaluateInlineExec} when at least one inline-exec span
 * cannot be resolved (non-zero exit, spawn failure, `sh` not found, cap
 * overrun): the render aborts and the agent is never invoked. `message` names
 * every failing span's command text and stderr, so a caller that just logs
 * `.message` (rather than reading `.failures`) still surfaces the full
 * picture. The sibling refusal stage 1 raises is
 * {@link MissingPlaceholderRenderError}; both are {@link RenderRefusal}, which
 * is the class the tick classifies on.
 */
export class InlineExecRenderError extends RenderRefusal {
  readonly failures: InlineExecFailure[];
  readonly signature: string;

  constructor(failures: InlineExecFailure[]) {
    super(
      [
        `prompt render aborted: ${failures.length} inline-exec span(s) failed to resolve`,
        ...failures.map((f) => `  cmd: ${f.cmd}\n  stderr: ${f.stderr}`),
      ].join("\n"),
    );
    this.name = "InlineExecRenderError";
    this.failures = failures;
    // The commands that would not resolve, never what they printed: the same
    // span failing twice with two different stderrs is one wall, and the
    // stderr is on `message` either way.
    this.signature = failures.map((f) => f.cmd).join("; ");
  }
}

type InlineExecOutcome =
  | { ok: true; match: string; replacement: string }
  | { ok: false; match: string; cmd: string; stderr: string };

async function evaluateInlineExec(raw: string, cwd: string): Promise<string> {
  // Collect all matches first so we can run them in parallel.
  const matches = [...raw.matchAll(INLINE_EXEC_RE)];
  if (matches.length === 0) return raw;

  const results: InlineExecOutcome[] = await Promise.all(
    matches.map(async (m): Promise<InlineExecOutcome> => {
      const cmd = m[1]!.trim();
      try {
        const { stdout } = await runInlineExec(cmd, cwd);
        return { ok: true, match: m[0], replacement: stdout.trimEnd() };
      } catch (err) {
        const e = err as { stdout?: string; stderr?: string; message: string };
        return { ok: false, match: m[0], cmd, stderr: e.stderr ?? e.message };
      }
    }),
  );

  // Loud or nothing: any unresolved span aborts the whole render before the
  // agent is invoked — no substituted marker standing in for output that never
  // came.
  const failures = results.filter((r): r is Extract<InlineExecOutcome, { ok: false }> => !r.ok);
  if (failures.length > 0) {
    throw new InlineExecRenderError(
      failures.map((f) => ({ cmd: f.cmd, stderr: f.stderr })),
    );
  }

  // Replace by walking the original string with computed offsets — multiple
  // matches with the same text would otherwise alias on naive String.replace.
  let out = "";
  let cursor = 0;
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]!;
    const start = m.index!;
    out += raw.slice(cursor, start) + (results[i] as Extract<InlineExecOutcome, { ok: true }>).replacement;
    cursor = start + m[0].length;
  }
  out += raw.slice(cursor);
  return out;
}

/**
 * Evaluate one inline-exec command: spawn `sh` with no command argv and write
 * `cmd` to its stdin as UTF-8, then close it. Measured
 * (`.claude/rules/platform-facts.md`, "MSYS2 corrupts non-ASCII in argv; use
 * stdin"): `["-c", cmd]` corrupts any non-ASCII byte on win32 under MSYS2's
 * re-parsing of the Windows command line — stdin transport does not. `sh`
 * consumes stdin, so a span whose command itself reads stdin sees EOF; no span
 * in this repo's prompts does.
 */
function runInlineExec(
  cmd: string,
  cwd: string,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("sh", [], { cwd });
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let decided = false;
    let capOverrun: Error | undefined;

    // The cap overrun kills the child and then waits for it: `close` is what
    // settles the promise, so the render never returns while the `sh` it
    // abandoned is still alive holding the tick's cwd open. The stream
    // listeners stay attached past `decided` (discarding what they read) so
    // the pipes keep draining and the dying child cannot block on a full one.
    const abortAtCap = (err: Error): void => {
      if (decided) return;
      decided = true;
      capOverrun = err;
      child.kill();
    };

    const capture =
      (target: "stdout" | "stderr") => (chunk: Buffer): void => {
        if (decided) return;
        const prior = target === "stdout" ? stdout : stderr;
        const next = Buffer.concat([prior, chunk]);
        if (next.length > INLINE_EXEC_MAX_BUFFER) {
          abortAtCap(
            new Error(
              `inline-exec output exceeded ${INLINE_EXEC_MAX_BUFFER} bytes: ${cmd}`,
            ),
          );
          return;
        }
        if (target === "stdout") stdout = next;
        else stderr = next;
      };

    child.stdout.on("data", capture("stdout"));
    child.stderr.on("data", capture("stderr"));
    // A spawn failure is the one case with no child to wait for — the process
    // never started, so `error` settles on its own.
    child.on("error", (err) => {
      if (decided) return;
      decided = true;
      reject(err);
    });
    child.on("close", (code) => {
      if (capOverrun) {
        reject(capOverrun);
        return;
      }
      if (decided) return;
      decided = true;
      if (code === 0) {
        resolve({
          stdout: stdout.toString("utf8"),
          stderr: stderr.toString("utf8"),
        });
      } else {
        reject(
          Object.assign(new Error(`sh exited ${code}`), {
            stdout: stdout.toString("utf8"),
            stderr: stderr.toString("utf8"),
          }),
        );
      }
    });

    child.stdin.end(cmd, "utf8");
  });
}

function prependHarnessBlock(
  phase: Phase,
  assignedEntry: PendingEntry | undefined,
  body: string,
): string {
  const gateLines = phase.gates
    .map((g) => `  - ${g.name} (${g.when})` + (g.command ? `: ${g.command}` : ""))
    .join("\n");

  // Scoped-or-not is decided once, in `src/paths.ts` — the same call the
  // dispatcher makes to configure `writablePathsGate`, so the fence this
  // block renders and the fence that guard enforces are one value.
  const entryScope = entryWriteScope(phase, assignedEntry);

  const harness = [
    `<harness>`,
    `Phase: ${phase.name}`,
    `Concurrency: ${phase.concurrency}`,
    ...(entryScope
      ? effectiveFenceLines(phase, entryScope)
      : unscopedFenceLines(phase)),
    `Gates (run automatically after your commit):`,
    gateLines || "  (none)",
    `</harness>`,
    "",
  ].join("\n");

  return harness + body;
}

/**
 * Unscoped rendering. Byte shape pinned by tests/Prompt.test.ts's
 * "byte-identical to the collapsed rendering that predates the effective
 * fence" case.
 */
function unscopedFenceLines(phase: Phase): string[] {
  const pathLines = phase.writablePaths.map((p) => `  - ${p}`).join("\n");
  return [
    `Writable paths (anything else you modify will revert the commit):`,
    pathLines,
  ];
}

/**
 * Scoped rendering: states the fence the write guard actually enforces on this
 * tick — `entry.files ∪ phase.entryChannelPaths` — separately from
 * `phase.writablePaths`, the outer ceiling both this fence and the guard's
 * ceiling check must clear. `fence` arrives already derived from
 * `entryWriteScope` (`src/paths.ts`); this function renders it and derives
 * nothing, so it cannot state a scope the guard does not enforce.
 */
function effectiveFenceLines(phase: Phase, fence: string[]): string[] {
  const ceilingLines = phase.writablePaths.map((p) => `  - ${p}`).join("\n");

  return [
    `Effective fence (your commit may touch exactly these; anything else reverts the commit whole):`,
    fence.map((p) => `  - ${p}`).join("\n") || "  (none)",
    `Outer ceiling (also enforced, independently of the fence above — a path must clear both):`,
    ceilingLines,
  ];
}

function indentBlock(s: string): string {
  const trimmed = s.replace(/\s+$/, "");
  if (trimmed.length === 0) return "  (none)";
  return trimmed
    .split("\n")
    .map((l) => `  ${l}`)
    .join("\n");
}

/**
 * Prepend the dispatcher-owned `<prior-attempt>` block. Mirrors
 * `prependHarnessBlock`: structural, not authored — there is no `{{token}}`
 * for it in the prompt file. Absent (identity transform) on a first attempt,
 * so the slot carries no false signal. When present it tells the retrying
 * tick exactly which {@link PriorAttempt} variant the prior attempt hit,
 * rendered distinctly per variant so the agent reads what actually happened
 * — a reverted commit, a clean exit that produced nothing, a platform
 * cut-off that is explicitly NOT its predecessor's fault, or a commit that
 * landed and the chain declined — rather than blindly reconstructing a wall
 * that may not exist.
 */
function prependPriorAttemptBlock(
  prior: PriorAttempt | undefined,
  body: string,
): string {
  if (!prior) return body;

  const block = [
    `<prior-attempt>`,
    ...priorAttemptLines(prior),
    `</prior-attempt>`,
    "",
  ].join("\n");

  return block + body;
}

/**
 * The `<prior-attempt>` block body: the mode-specific lines, followed by the
 * anchor every variant now carries (spec/loop.md "Every record is
 * anchored") — one shared trailer rather than repeating it per case.
 */
function priorAttemptLines(prior: PriorAttempt): string[] {
  return [
    ...modeLines(prior),
    `Recorded ${prior.at}, trunk tip ${prior.headSha}.`,
  ];
}

/**
 * The mode-specific body of the `<prior-attempt>` block. Exhaustive over the
 * union, and over {@link PRIOR_ATTEMPT_MODES} with it.
 */
function modeLines(prior: PriorAttempt): string[] {
  // The roster's other half of the tie (see {@link PRIOR_ATTEMPT_MODES}): the
  // switch below is exhaustive over the union, and this statement is what
  // makes that exhaustiveness the roster's too — a seventh variant whose mode
  // PRIOR_ATTEMPT_MODES does not name fails here, rather than reading back off
  // disk as no-prior with its write/read seam unjudged.
  prior.mode satisfies PriorAttemptMode;
  switch (prior.mode) {
    case "gate-revert":
      return [
        `A previous attempt at this work committed and was REVERTED by a gate.`,
        // The gate's own attribution decides what the agent is told to do
        // about the revert, and nothing else does (spec/loop.md
        // "Prior-outcome feedback to the retrying tick"): a gate that
        // declared the failure not the span's leaves a record with no blame
        // on the entry, so the block states the revert and stops. Telling a
        // disowned retry to change its approach would be the engine
        // inventing the blame the gate withheld.
        ...(prior.blamesSpan === false
          ? [
              `The gate DISOWNED the blame: it declared this failure not the`,
              `reverted span's. The revert happened, and nothing about the`,
              `reverted work is discredited by it — do not treat this as a`,
              `wall in the task. Read what the gate did say below.`,
            ]
          : [
              `Read the failure below and change your approach — do not blindly`,
              `reconstruct the reverted change.`,
            ]),
        `Reverted at: ${prior.when}`,
        `Failing gate: ${prior.gate}`,
        // `message` and `verdict` are two statements the gate made, not one
        // read two ways, so each is labelled by the field that holds it —
        // the bare `Verdict:` this line once carried named the prose while
        // the chain-authored discriminant had no line at all.
        `Gate message: ${prior.message}`,
        ...(prior.verdict === undefined
          ? []
          : [`Gate verdict: ${prior.verdict}`]),
        // A gate that named no file and one that named an empty list said
        // the same thing, and a lead over `(none)` would read as a third.
        ...(prior.failingFiles && prior.failingFiles.length > 0
          ? [
              `Files the gate blamed:`,
              indentBlock(prior.failingFiles.join("\n")),
            ]
          : []),
        `Gate details:`,
        indentBlock(prior.details ?? ""),
        `Reverted change digest (git show --stat):`,
        indentBlock(prior.diffStat),
      ];
    case "clean-exit":
      return [
        `A previous attempt at this work exited cleanly and committed`,
        `nothing usable. No gate ran. The harness records that it exited and`,
        `what it last said, never what the exit meant — read the message`,
        `below and this chain's own rules before redoing anything, rather`,
        `than assuming a wall that may not exist.`,
        // The two shas say which of the mode's two exits happened, and
        // nothing about why either did: an unmoved head is an attempt that
        // never committed, a moved one an attempt whose commits changed
        // nothing against the base and so were never picked.
        prior.spanHead === prior.spanBase
          ? `Span: ${prior.spanBase}, unmoved — the attempt committed nothing.`
          : `Span: ${prior.spanBase}..${prior.spanHead} — the attempt did ` +
            `commit, and the span's diff against its base was empty, so it ` +
            `never reached the merge stage. Those commits are still ` +
            `reachable; read them before redoing the work.`,
        `Prior attempt's final message (tail, verbatim):`,
        indentBlock(prior.finalMessage),
      ];
    case "platform-preempt":
      return [
        `A previous attempt was cut short by a PLATFORM failure — NOT a`,
        `defect in the work. The prior reasoning is not discredited; do not`,
        `treat this as a wall in the task. Resume the work. No commit, no gate.`,
        // The ending as the host stated it, or the absence said out loud:
        // a retry reading a blank cannot tell "the process died this way"
        // from "nothing reported how it died".
        prior.ending === undefined
          ? `How the agent process ended: not reported — the attempt never ` +
            `reached an ending (the spawn itself failed, or the abort fired ` +
            `before it).`
          : `How the agent process ended: the process ` +
            `${agentEndingWords(prior.ending)}.`,
        `Failure class (not your fault):`,
        indentBlock(prior.failureClass),
      ];
    case "render-refused":
      return [
        `A previous attempt refused BEFORE the agent was invoked, so the`,
        `agent NEVER ran. This is not the agent's own clean exit and not a`,
        `platform failure: something the tick needed in order to invoke —`,
        `the prompt itself, or a pre-invocation hook — did not resolve. The`,
        `record below is the whole of what refused; read it and fix that,`,
        `rather than a wall in the task.`,
        `What refused:`,
        indentBlock(prior.failures),
      ];
    case "tip-moved":
      return [
        `A previous attempt's commit was DISCARDED because the base its`,
        `branch started from was rewritten out from under it — NOT a defect`,
        `in the work. The prior reasoning is not discredited; do not treat`,
        `this as a wall in the task. Resume the work against the current`,
        `tip. No commit, no gate.`,
        `Recorded base: ${prior.expectedTip}`,
        `Observed HEAD: ${prior.observedTip}`,
      ];
    case "not-shipped":
      return [
        `A previous attempt at this work COMMITTED and passed every gate,`,
        `and this chain's own \`shipped\` predicate then did not ship it: the`,
        `commit is on trunk, the work is still queued. The commit is still`,
        `reachable; do not reproduce what it already landed.`,
        ...(prior.threw === undefined
          ? [
              `The predicate NAMED NO TAG — a deliberate decline. The`,
              `harness records that the chain said no, never why — read the`,
              `landed change below and the chain's own rules for what`,
              `"shipped" means here before redoing anything.`,
            ]
          : [
              `The predicate BROKE rather than answering — it threw, or it`,
              `named tags this span cannot ship — so the chain never reached`,
              `a verdict. This is a broken \`shipped\` hook, NOT a deliberate`,
              `decline. Nothing about the landed work is discredited by it.`,
              `What the predicate did:`,
              indentBlock(prior.threw),
            ]),
        `Landed commit: ${prior.mergedSha}`,
        `Paths it touched:`,
        indentBlock(touchedPathsBlock(prior)),
      ];
  }
}

/**
 * The `not-shipped` record's path list as block text — one path per line,
 * with the writer's own elision count stated rather than the truncated list
 * passing for the whole footprint.
 */
function touchedPathsBlock(prior: NotShippedAttempt): string {
  const lines =
    prior.touchedPaths.length > 0 ? [...prior.touchedPaths] : ["(none)"];
  if (prior.omittedPaths !== undefined && prior.omittedPaths > 0) {
    lines.push(`…and ${prior.omittedPaths} more path(s)`);
  }
  return lines.join("\n");
}
