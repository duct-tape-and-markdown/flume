/**
 * Phase — the declared shape of one step in a derivation chain.
 *
 * A Phase is data, not code. The Dispatcher (added later) consumes Phases to
 * decide what prompt to send, what to enforce post-commit, how to fan out,
 * and which sibling phases to wake.
 */

import type { Agent } from "./Agent.js";
import type {
  MergeOutcome,
  ProvisionFailure,
  ReportedGateResult,
} from "./tickVerdict.js";
import type { FlumePaths } from "./flumeApi.js";
import type { Gate } from "./Gate.js";
import type {
  EntryExtension,
  PendingEntry,
  QueueParseFailure,
} from "./PendingSchema.js";
import type { NoCommitMode, PriorAttempt } from "./Prompt.js";

/**
 * Concurrency model for a phase:
 *
 * - "singleton": one tick at a time. Plan and spec phases must be singleton
 *   because they derive shared artifacts (the plan file, the spec corpus)
 *   that don't admit concurrent edits.
 *
 * - "fanout": the dispatcher picks N disjoint-by-Files: pending entries and
 *   runs N tick invocations in parallel worktrees. Build is the canonical
 *   fanout phase. Each entry's commit is cherry-picked onto the trunk and
 *   gated individually; an afterMerge gate failure reverts only that
 *   entry's commit, and the rest of the wave stays shipped.
 */
export type Concurrency = "singleton" | "fanout";

/**
 * Facts about one fanout entry whose commit landed on trunk and passed every
 * gate, handed to {@link Phase.shipped} so the chain can decide whether it
 * counts as shipped.
 *
 * Everything here is something the dispatcher already holds at that moment —
 * no work is done to build it. In particular `worktreePath` is still on disk:
 * teardown runs after the merge loop, so a chain that wants to read something
 * its own agent wrote can, without the engine knowing such a file exists.
 */
export interface ShipContext {
  /** The entry being classified, as it appears in `pending.json`. */
  entry: PendingEntry;
  /** Sha of this entry's commit as cherry-picked onto trunk. */
  mergedSha: string;
  /**
   * The sha this entry's span branched from — its worktree's tip when the
   * tick started, the same value `GateContext.baseSha` carries and the base
   * the dispatcher cherry-picked the span from. A `shipped` predicate
   * judging the commit against the inputs the agent actually read reads
   * `git show <baseSha>:<path>`, and `git log <baseSha>..<mergedSha>` is the
   * span itself (spec/chain.md "What a hook receives").
   */
  baseSha: string;
  /** Repo-relative paths the merged commit touched (`git show --name-only`). */
  touchedPaths: readonly string[];
  /**
   * This entry's own gate results — `afterCommit` in the worktree, then
   * `afterMerge` on trunk — as the engine reports them everywhere else
   * ({@link ReportedGateResult}): every optional field the gate itself
   * authored rides along, so a `shipped` predicate keying on a discriminant
   * its own chain authored reads the field instead of pattern-matching
   * `message` (spec/chain.md "What a hook receives").
   */
  gateResults: readonly ReportedGateResult[];
  /** Absolute path to the entry's worktree, still present. */
  worktreePath: string;
  /** Repo root — the trunk checkout the commit landed on. */
  repoRoot: string;
}

/**
 * Facts about one entry the gate switch cleared, handed to
 * {@link Chain.refusesEntry} so the chain can hold that one entry back
 * without declining the phase.
 *
 * Every field is something the engine already holds at the moment it takes
 * the set — the entry as read, the record standing for it, and the tip the
 * read was taken at — so a predicate reaches for none of it itself
 * (`.claude/rules/engineering.md`, *A fact the engine holds is reported,
 * never rediscovered*).
 */
export interface EntryRefusalContext {
  /** The entry being judged, as this tick read it from the queue. */
  entry: PendingEntry;
  /**
   * The entry's own latest persisted prior-attempt record, absent on a first
   * attempt — the same record `TickContext.priorAttempts` carries under
   * `entry:<tag slug>`, read with the dispatcher's own reader and its own
   * tolerance (a corrupt or unrecognized-mode record reads as absent).
   *
   * A predicate asking "did the last attempt at this entry reach anything"
   * reads the record's own `mode` and its `headSha` anchor rather than
   * reconstructing either from the queue or from git.
   */
  priorAttempt?: PriorAttempt;
  /**
   * The trunk tip this selection was taken at — the same sha the records
   * above are anchored against, so "this record was written at the world as
   * it now stands" is a comparison and not an inference.
   */
  headSha: string;
}

/**
 * Context handed to a phase's `promptArgs` builder when constructing the
 * agent invocation for one tick.
 */
export interface TickContext {
  /**
   * Absolute path this tick works in: the worktree the dispatcher
   * provisioned for it, which is what `promptArgs` and every in-worktree
   * hook read.
   *
   * One consult sees a different root. A **singleton** `shouldRun` runs
   * before the worktree exists, so its `cwd` is the repo root (spec/loop.md,
   * *Declining a tick before the invocation*); a **fanout** `shouldRun` runs
   * inside the entry's already-provisioned worktree and sees that. A
   * predicate resolving paths off `cwd` therefore cannot assume a worktree —
   * `flumeDir` is absolute and identical across both consults.
   */
  cwd: string;
  /**
   * Absolute, resolved flume state root (`flumeDir`; default
   * `<repoRoot>/.flume`, relocatable via `FLUME_DIR`). Surfaced so a phase's
   * `promptArgs` can derive state-relative paths from it. The dispatcher also
   * auto-injects this as the reserved `{{FLUME_DIR}}` prompt arg, so most
   * prompts need no `promptArgs` boilerplate.
   */
  flumeDir: string;
  /** Pending entry assigned to this tick (fanout phases only). */
  assignedEntry?: PendingEntry;
  /** All pending entries (singleton phases that read the plan). */
  pending?: readonly PendingEntry[];
  /**
   * The entries the dispatcher would select right now: the strict-read
   * queue with `blockedBy` resolved, every declared fork checked through
   * the chain's `forkResolver`, `requiresCapability` checked against
   * `Chain.capabilities`, and this run's quarantine drop applied — the same
   * computation fanout selection uses (`isPickable`, `src/selection.ts`),
   * so a singleton `shouldRun` and the next fanout tick cannot disagree
   * (spec/chain.md "What a hook receives"). A `shouldRun`/`promptArgs` hook
   * reads this instead of re-deriving pickability with its own copy of the
   * gate switch. Optional in the type — always set on a dispatcher-built
   * context; the optionality exists for hand-built fixtures, mirroring
   * `GateContext.commitSha`/`touchedPaths` (`src/Gate.ts`).
   */
  pickable?: readonly PendingEntry[];
  /**
   * Every persisted {@link PriorAttempt} record under
   * `<flumeDir>/prior-attempts/`, keyed by the keyspace and the identity each
   * record was written under — `entry:<tag slug>` for a fanout record,
   * `phase:<phase name>` for a singleton one, the name exactly as this chain
   * spells it. A phase the chain calls `plan_sweep` finds its own record at
   * `phase:plan_sweep`, whatever stem the file sits at, and never collides
   * with a tag that slugs the same way. Read with the dispatcher's own reader and its own
   * tolerance: a corrupt or unrecognized-mode record is absent from the map
   * rather than surfaced malformed. A `shouldRun` deciding "does some other
   * phase have a standing record to reconcile" reads this instead of
   * scanning the directory itself. Optional in the type for the same
   * hand-built-fixture reason as `pickable` above.
   */
  priorAttempts?: ReadonlyMap<string, PriorAttempt>;
  /**
   * The state root's path relative to the primary repo root, in git's own
   * alphabet, or `undefined` when the state root is relocated outside it —
   * the same value `GateContext.stateRootRel` carries, from the same
   * `computeStateRootRel` (`src/paths.ts`; spec/chain.md "What a hook
   * receives"). A hook composing a path some commit must hold — a note the
   * phase's own gate keys, an artifact read at a ref — reads this
   * forward-slashed value straight rather than deriving or re-folding it,
   * which it cannot do from the rest of the context: `cwd` is the tick's
   * worktree and `flumeDir` is not nested under it. Optional in the type for
   * the same hand-built-fixture reason as `pickable` above; a
   * dispatcher-built context always carries the key, where `undefined` means
   * relocated rather than unreported.
   */
  stateRootRel?: string | undefined;
  /**
   * The queue's own parse failure, present only on a tick whose phase can
   * write the queue — the carve-out in the strict read (spec/pending.md,
   * *Queue reads are strict*; `readPendingForDecision`,
   * `src/pendingLedger.ts`). Absent means the queue resolved; a phase that
   * cannot write it never sees this field because such a tick is refused
   * before it runs.
   *
   * Present, `pending` is `[]` because nothing resolved rather than because
   * the queue is drained, and this field is the only thing that tells the two
   * apart — a `promptArgs` rendering the queue for its agent reads it and
   * renders the errors as the tick's input, since the rewrite it is about to
   * produce is the repair. Reported as a fact, never a verdict: what to do
   * about it is the chain's (`.claude/rules/engine-boundary.md`, *Routing
   * rule*).
   */
  queueParseFailure?: QueueParseFailure;
}

/**
 * Facts about one fanout entry the wave handed to its agent, reported on
 * {@link TickResult.entries} before the wave folds them into its own
 * `shippedTags`/`revertedTags`/`noCommit`/`declined` summary. `committed`
 * reflects only this entry's own worktree tick — a commit that passed every
 * `afterCommit` gate — never whether the wave's later cherry-pick/afterMerge
 * stage actually landed it on trunk; `shipped` and `reverted` cover that.
 * A `committed: true` entry with both `shipped` and `reverted` false is a
 * real, reportable state: a cherry-pick conflict, a foreign tip claim, or an
 * afterMerge-gate revert whose own reset was itself refused — the commit
 * exists but neither shipped nor was (successfully) reverted, and the engine
 * never launders that into a claim it can't back.
 */
export interface FanoutEntryOutcome {
  /** The entry's tag, as it appears in `pending.json`. */
  tag: string;
  /**
   * The chain-declared extension fields this entry carried, exactly as the
   * engine parsed them from `pending.json` — every field
   * `CORE_ENTRY_FIELDS` (`src/PendingSchema.ts`) does not name. `{}` for a
   * chain that declared no extension, never absent: the engine holds the
   * entry for every record here, so "carried no payload" is a fact it can
   * state rather than an absence a reader must interpret.
   *
   * What this adds beyond the tag: a **shipped** entry leaves the queue, so
   * it is gone from `pendingAfter`/`pickableAfter` and nothing else on the
   * result carries what it was. A `handoff` routing on the entry's own
   * declaration — the section it cited, a surface field, a risk flag —
   * would otherwise re-read `pending.json` at `TickResult.baseSha` and
   * re-parse it with the chain's own extension, which is the engine's parse
   * rebuilt by a second hand (spec/chain.md "What a hook receives").
   *
   * Values are `unknown` for the same reason they are on `PendingEntry`:
   * the chain that declared the field knows its shape and narrows locally.
   */
  extension: Record<string, unknown>;
  /** This entry's own worktree tick produced a commit that passed every `afterCommit` gate. */
  committed: boolean;
  /** `committed` reached trunk and `phase.shipped` (undeclared counts as shipped) agreed — the entry left the queue. */
  shipped: boolean;
  /** This entry's merged commit failed an `afterMerge` gate and was reset off trunk. */
  reverted: boolean;
  /** `phase.shouldRun` declined this entry before the agent was invoked. Absent when it ran. */
  declined?: boolean;
  /** No-commit mode when this entry produced no usable commit. Absent when it shipped or was declined. */
  noCommit?: NoCommitMode;
  /**
   * This entry's merge-stage fact, the same {@link MergeOutcome} the tick
   * verdict records for its span. `committed`/`shipped`/`reverted` collapse
   * distinct fates into one shape — a cherry-pick conflict, a chain that
   * declined to ship a landed commit (`not-shipped`), a per-entry
   * dropped-work reset and a foreign tip claim all read `committed: true,
   * shipped: false, reverted: false` — so a `handoff` routing a park apart
   * from a conflict reads this rather than the verdict log (spec/chain.md
   * "What a hook receives").
   *
   * Absent when the entry's span reached no merge stage and left no
   * footprint behind: a declined entry, or a clean exit that never
   * committed. Absence is therefore "nothing to merge", never "merged".
   */
  mergeOutcome?: MergeOutcome;
}

/**
 * One entry this run's quarantine dropped from a tick's pickable set
 * (spec/loop.md "Repeated identical failures — quarantine, then abort").
 *
 * The `key` is the hold's own identity — the entry's slug plus a hash of its
 * bytes in `pending.json` (`quarantineKey`, `src/selection.ts`) — reported
 * beside the tag so a chain can see *which read* of the entry the hold
 * stands under. Editing the entry on trunk changes its key and lifts the
 * hold, so a chain comparing the key it saw last tick against this one reads
 * "still held" versus "re-scoped, retried" without re-deriving either.
 */
export interface QuarantinedTag {
  tag: string;
  key: string;
}

/**
 * Result a phase reports back after a tick finishes. The handoff function
 * inspects this to decide which sibling phases to wake.
 */
export interface TickResult {
  /** Phase that produced this result. */
  phaseName: string;
  /** True if the tick produced a commit. False on a clean exit or no-op. */
  committed: boolean;
  /** SHA of the produced commit, when present. */
  commitSha?: string;
  /**
   * All gates that ran, in order, with their results — the same
   * {@link ReportedGateResult} row the tick verdict persists, so a `handoff`
   * routing on *why* a gate ruled as it did, or on *what* it blamed, reads
   * the row's own fields rather than re-parsing prose the engine already
   * decoded (spec/chain.md "What a hook receives").
   */
  gateResults: readonly ReportedGateResult[];
  /** The pending list as it stands after this tick (re-parsed from disk). */
  pendingAfter: readonly PendingEntry[];
  /**
   * `pendingAfter` filtered by the same dispatcher verdict as
   * `TickContext.pickable` (`isPickable`, `src/selection.ts`), taken at the
   * same post-tick re-read as `pendingAfter` itself. A `handoff` that wakes a
   * sibling phase on "anything pickable" reads this instead of calling
   * `isPickableNow` with a default resolver and an empty capability set — a
   * different verdict with two inputs missing (spec/chain.md "What a hook
   * receives").
   */
  pickableAfter: readonly PendingEntry[];
  /** Absolute, resolved flume state root — same value `TickContext.flumeDir` carries. */
  flumeDir: string;
  /** Absolute, resolved chain config directory (`<configDir>/chain.ts`). */
  configDir: string;
  /**
   * The sha this tick's span branched from — the same value
   * `GateContext.baseSha` carries, so a `handoff` routing on "did anything
   * land on trunk that this tick could not have seen" compares against the
   * engine's number rather than the worktree's reflog (spec/chain.md "What
   * a hook receives"). Under fanout it is the trunk tip every worktree in
   * the wave was provisioned from; a per-entry base that diverged from it
   * (a `setupWorktree` hook that committed) is on that entry's own
   * {@link ShipContext}. Absent when the tick provisioned no span at all —
   * a provisioning failure, a nothing-pickable wave, or a singleton
   * declined before its worktree tip was read.
   */
  baseSha?: string;
  /**
   * One record per entry the wave handed to its agent, reported before the
   * wave folds those same facts into `shippedTags`/`revertedTags`/
   * `noCommit`/`declined` below. Absent on a singleton tick and on a wave
   * that handed nothing to an agent (nothing pickable, or every entry's
   * provisioning failed). What this adds beyond the fold: a no-commit
   * sibling's `noCommit` mode, otherwise invisible to `handoff` whenever
   * another entry in the same wave shipped and the wave-level `noCommit`
   * reads absent, and each entry's own
   * {@link FanoutEntryOutcome.mergeOutcome}, which the summary's tag lists
   * cannot express at all.
   *
   * An entry whose provisioning failed — at `createWorktree`, or in the
   * chain's `setupWorktree` hook — never reaches an agent and so is on
   * {@link TickResult.provisionFailures} under its tag instead, never a
   * record here with every flag false (spec/chain.md "What a hook
   * receives").
   */
  entries?: readonly FanoutEntryOutcome[];
  /**
   * Every provisioning failure this tick recorded, the same records the
   * tick verdict persists: a per-entry `createWorktree` or `setupWorktree`
   * failure carries the entry's `tag`, and a repo-level wall no single entry
   * can be blamed for (a failed `git worktree prune`) carries none. Absent
   * when provisioning was clean.
   *
   * This is the only surface naming an entry the wave dropped before its
   * agent ran: such an entry is absent from `entries`, is unchanged in
   * `pendingAfter`, and shows in no tag list. A `handoff` reconciling one —
   * waking a sibling, holding the phase awake, counting a repeat — reads it
   * here rather than diffing `pendingAfter` against the batch it never saw
   * (spec/worktrees.md "`setupWorktree` and `teardownWorktree`"). The fact
   * is the engine's; what to do about it stays the chain's.
   */
  provisionFailures?: readonly ProvisionFailure[];
  /** Set of pending tags shipped by this phase (build only; usually 0 or 1). */
  shippedTags: readonly string[];
  /**
   * Tags whose commits were reverted at merge time (cherry-pick conflict or
   * afterMerge gate). Distinguishes a merge-thrash re-pick from an in-session
   * retry in downstream telemetry.
   */
  revertedTags: readonly string[];
  /**
   * No-commit classification, present iff the tick (or, for a fanout wave, the
   * whole wave) produced no usable commit. Absent on a committed tick. A
   * chain's `handoff` reads this to wake a sibling phase on a clean-exit that
   * `shippedTags`/`gateResults` alone can't distinguish from a genuine
   * nothing-pickable no-op.
   */
  noCommit?: NoCommitMode;
  /**
   * spec/loop.md "The no-commit taxonomy" / "Repeated identical failures":
   * fanout only. Every entry this run's live quarantine
   * (`FLUME_QUARANTINED_SLUGS`) dropped from the pickable set this tick.
   * Empty, never absent, on a nothing-pickable tick with no quarantine in
   * effect; absent entirely on a tick that provisioned an entry. Lets a
   * chain's `handoff` tell a quarantined `open` entry — still `open` in
   * `pendingAfter`, since `pending.json` itself is untouched — from a
   * genuinely pickable one, without re-deriving it.
   */
  quarantinedTags?: readonly QuarantinedTag[];
  /**
   * Every entry this chain's own {@link Chain.refusesEntry} held back from
   * the set reported on {@link pickableAfter} above, by tag, in queue order.
   *
   * Paired with that set rather than with the tick's opening one: a `handoff`
   * routes on what is pickable *now*, and the refusal is the only reason an
   * entry the gate switch clears can be missing from it without the
   * quarantine having taken it. Without this field a chain reading a
   * shrunken `pickableAfter` cannot tell its own refusal from a drained
   * queue — the same silent degradation `quarantinedTags` exists to prevent
   * for the other holder-back (`.claude/rules/engineering.md`, *Loud or
   * nothing*).
   *
   * Empty, never absent, on every tick the engine computed a pickable set
   * for — which is every tick that ran a phase, under either concurrency. A
   * chain declaring no refusal reads `[]` here on every tick.
   *
   * A fact, never a verdict: the engine says which entries the chain's own
   * predicate declined, and nothing about why or what to do next
   * (`.claude/rules/engine-boundary.md`, *Routing rule*).
   */
  refusedTags?: readonly string[];
  /**
   * spec/loop.md "The no-commit taxonomy": true iff this fanout tick found
   * nothing pickable (after the quarantine drop above) and therefore never
   * invoked an agent. Absent on a tick that provisioned an entry — never
   * `false`, mirroring `noCommit`'s absent-on-committed convention.
   */
  nothingPickable?: boolean;
  /**
   * The same fact `TickContext.queueParseFailure` handed this tick's agent,
   * reported back on the result so a `handoff` reads it too. Absent on every
   * tick whose queue resolved.
   *
   * What it buys a `handoff`: `pendingAfter`/`pickableAfter` come from the
   * post-tick re-read and say nothing about the decide-read this tick acted
   * on, and a fanout wave over an unparseable queue has nothing pickable by
   * construction — so without this field a queue that never resolved is
   * indistinguishable from a drained one, which is the silent degradation
   * the strict read exists to prevent (`.claude/rules/engineering.md`, *Loud
   * or nothing*).
   */
  queueParseFailure?: QueueParseFailure;
}

/**
 * The declared shape of one phase. All fields are data; the harness
 * interprets them. There is no per-phase imperative code path.
 */
export interface Phase {
  /** Stable identifier; matches the awake-flag filename `.flume/awake/<name>`. */
  name: string;

  /** One-line human description; appears in logs and `flume status`. */
  description: string;

  /**
   * The agent prompt file, resolved against the chain's config directory: a
   * relative path is read beneath that directory, an absolute one is taken
   * as given — so a prompt shipped inside a package can be addressed
   * directly rather than copied beside the chain.
   * `{{KEY}}` placeholders are substituted from promptArgs at tick time.
   * `!`shell command`` inline-exec blocks are evaluated before send.
   */
  promptPath: string;

  /** Concurrency model — see Concurrency above. */
  concurrency: Concurrency;

  /**
   * Agent that runs this phase's ticks. Per-tick resolution is
   * `phase.agent ?? chainModule.agent ?? DispatcherOptions.agent` — the
   * innermost scope of the existing chain-level override. An `Agent` value
   * (not a model string) so it composes with decorators; a model-only
   * variation is `claudeCode({ model: "…" })` inside this value — the
   * adapter owns the flag, so the chain names a model rather than
   * assembling argv. Absent, the phase runs on the chain/dispatcher default.
   */
  agent?: Agent;

  /**
   * Glob patterns the phase is permitted to modify. Post-commit, the
   * harness diffs the commit against these patterns; violations revert
   * the commit. This replaces prose "You may NOT modify X" rules in prompts.
   *
   * Paths are relative to the repo root. Patterns are matched by
   * `matchesAny` (`src/paths.ts`), the one home for the dialect they are
   * read in; it rides `FlumeApi`, so a chain predicate over the same globs
   * shares the enforcing matcher instead of hand-rolling one.
   */
  writablePaths: string[];

  /**
   * Globs always writable on an entry-scoped fanout tick, regardless of the
   * assigned entry's declared files — the channel allowance for cross-tick
   * artifacts an entry never declares (e.g. a phase that reports findings
   * into a shared file a later tick reads).
   *
   * Only consulted when `scopeWritesToEntry` is `true`. On such a tick
   * carrying an assignedEntry, the write guard narrows to the entry's
   * `files.{new,edit,retire}` paths ∪ these globs, with `writablePaths` as
   * the outer ceiling (both checks apply). Singleton ticks keep phase-wide
   * scope and ignore this regardless. Default `[]`.
   */
  entryChannelPaths?: string[];

  /**
   * Opt in to narrowing a fanout tick's write allowance to the assigned
   * entry (`declaredPaths(entry) ∪ entryChannelPaths`), with
   * `writablePaths` as the outer ceiling both checks apply against. Default
   * `false`: a scoped tick's write allowance and rendered prompt fence are
   * then byte-identical to a singleton tick's — `writablePaths` alone,
   * unconditionally enforced either way. Declaring `true` makes the
   * producer phase's `files` declaration a second, narrower permission on
   * top of that ceiling (spec/pending.md, *The entry-scoped write guard is
   * opt-in, and off by default*).
   */
  scopeWritesToEntry?: boolean;

  /** Gates that run at afterCommit / afterMerge points. */
  gates: Gate[];

  /**
   * Builds the prompt argument map for one tick. The dispatcher feeds this
   * the TickContext (with assignedEntry populated for fanout phases).
   *
   * Return values are stringified by the prompt renderer. JSON-shaped
   * arguments should be pre-serialized here.
   */
  promptArgs?: (ctx: TickContext) => Record<string, string>;

  /**
   * `promptArgs` keys whose values are **data** — content this phase did not
   * author and is only showing the agent: a cited spec section, a queue
   * entry, a diff. The render pipeline substitutes values and then scans the
   * substituted text for inline-exec spans (`spec/prompt.md`, *The render
   * pipeline*), so by default a value that merely quotes the span grammar
   * runs as a command. Naming its key here makes the engine neutralize every
   * span in that value before the scan: the command text still reaches the
   * agent, the sigil no longer fires, and an unresolvable span in the quoted
   * content can no longer refuse the tick.
   *
   * The pass-through stays the default for every undeclared key — the chain
   * says which values are data and the engine enforces it, rather than the
   * engine guessing from a value's shape. The reserved `FLUME_DIR` key is
   * engine-authored and needs no declaration. A declared key the tick's
   * `promptArgs` never returns is simply unused.
   */
  promptDataKeys?: readonly string[];

  /**
   * Decides which sibling phases to wake based on this tick's result.
   * Returning an empty array means "no wake" (system may hibernate if all
   * baton flags are absent).
   */
  handoff: (result: TickResult) => string[];

  /**
   * Optional predicate the dispatcher consults before rendering the prompt or
   * invoking the agent — a capability with an injection point: the dispatcher
   * supplies the skip, the chain supplies the reason
   * (`.claude/rules/engine-boundary.md`, *Capability vs convention*).
   * Returning `false` ends the tick as a declined
   * no-op: no agent invocation, no commit, `handoff` still runs so the chain
   * can pass the baton on. Undeclared is unchanged behavior — a phase without
   * `shouldRun` always runs, byte-identically to a phase whose `shouldRun`
   * returns `true`.
   *
   * Sees the same `TickContext` fields `promptArgs` sees; `cwd` is the one
   * value that differs, and with it what a decline buys. A **singleton**
   * consult runs ahead of the prune, `createWorktree` and `setupWorktree`,
   * so `cwd` is the repo root and declining costs a `rev-parse` and the
   * pending read. A **fanout** consult runs per entry inside a worktree the
   * wave has already built and installed, so `cwd` is that worktree and
   * declining saves the agent invocation alone (spec/loop.md, *Declining a
   * tick before the invocation*).
   *
   * Must be synchronous and cheap: it runs before every invocation, so I/O
   * belongs in the tick it would be trying to avoid.
   */
  shouldRun?: (ctx: TickContext) => boolean;

  /**
   * Optional predicate deciding whether a fanout entry whose commit landed
   * and passed every gate counts as **shipped** — i.e. leaves the queue.
   *
   * Undeclared means shipped: a commit that landed on trunk with green
   * gates removes its entry. That is the whole behavior for a chain with no
   * notion of a commit that lands without finishing the work.
   *
   * Returning `false` records the entry `not-shipped`: the commit stays on
   * trunk, the entry stays in `pending.json`. The engine holds no vocabulary
   * for *why* — a park, a partial, a deliberate hand-off are one chain's
   * words for one chain's workflow (`.claude/rules/engine-boundary.md`,
   * *Told, not inferred*). It reports the facts in {@link ShipContext}; the
   * chain decides.
   *
   * Synchronous, like `shouldRun` and `handoff`. It runs once per merged
   * entry, so a cheap `readFileSync` is fine and anything heavier is not.
   * Singleton phases never call it — they carry no entry to classify.
   */
  shipped?: (ctx: ShipContext) => boolean;

  /**
   * Optional hook invoked after the tick's worktree is created, before the
   * agent runs. The chain config uses this to materialize gitignored files
   * the gates need — typically `node_modules` via a real install (the
   * exported `setupWorktree` helper runs the install a lockfile implies)
   * and `.env` via a copy. Never symlink `node_modules` from the main
   * repo: pnpm deletes a symlinked `node_modules` on install, breaking the
   * pattern the first time a worktree installs. Both concurrencies invoke
   * it — a fanout wave once per entry, a singleton tick once for the one
   * worktree it provisions (`spec/worktrees.md`, "Singleton runs in a
   * worktree").
   *
   * Returning `{ extraEnv }` injects those vars into the agent invocation
   * for this worktree, layered on top of the harness's `process.env`. Use
   * this when the worktree needs an ephemeral resource handle the chain
   * provisioned at setup time (per-worktree DATABASE_URL, scratch dir,
   * issued credential). A hook with no vars to inject returns `void` — the
   * result object is only needed to carry `extraEnv`.
   */
  setupWorktree?: (
    ctx: WorktreeSetupContext,
  ) => Promise<void | WorktreeSetupResult>;

  /**
   * Optional hook invoked after the agent exits and gates run, before the
   * worktree is removed. Mirrors `setupWorktree` for resource cleanup —
   * drop a per-worktree DB, release a lease, etc. Best-effort: failures
   * are logged but do not block worktree removal. The same ctx fields are
   * available as at setup time.
   */
  teardownWorktree?: (ctx: WorktreeSetupContext) => Promise<void>;
}

/** Context handed to the worktree hooks once a tick's worktree exists. */
export interface WorktreeSetupContext {
  /** Path to the fresh worktree the tick will run in. */
  worktreePath: string;
  /** Path to the main repo root the worktree was created from. */
  repoRoot: string;
  /**
   * Key of the worktree this context describes: the pending entry's tag on
   * a fanout tick, the phase name on a singleton one, which carries no
   * entry. `teardownWorktree` receives the same key its `setupWorktree` did.
   * Never absent — distinct from `AgentInvocation.entryTag`, which is.
   */
  worktreeKey: string;
}

/** Optional return shape from Phase.setupWorktree. */
export interface WorktreeSetupResult {
  /**
   * Extra env vars to merge into the agent invocation env for this
   * worktree. Layered on top of the harness's `process.env`. Useful for
   * per-worktree DATABASE_URL, scratch paths, short-lived credentials —
   * anything the chain provisioned during setup that the agent needs at
   * runtime without baking into the worktree's tracked filesystem.
   * Scoped to the agent invocation only: gates spawn from the
   * dispatcher's own env and do not see these vars.
   */
  extraEnv?: Record<string, string>;
}

/**
 * A Chain is an ordered set of phases plus the rules for which phases
 * humans can wake manually.
 */
export interface Chain {
  phases: Phase[];
  /**
   * Chain-declared pending-entry extension: fields beyond the engine core
   * (tag/gate/dependsOnForks/files), each declared once with its zod schema
   * and prompt hint. The dispatcher composes the merged validator from it;
   * `renderSchemaForPrompt(extension)` composes the rendered schema from the
   * same declaration. Absent means bare core.
   */
  entryExtension?: EntryExtension;
  /**
   * Phases the dispatcher is forbidden to wake via another phase's handoff.
   * Humans still wake them by touching `.flume/awake/<name>`. Reach for it
   * when a phase consumes something a human authors between runs: a
   * sibling's handoff cannot produce that input, so waking it autonomously
   * would only burn a tick. Empty means every phase is handoff-wakeable.
   */
  humanOnly: string[];
  /**
   * `configDir`-relative directory `flume job new` seeds a fresh job dir
   * from — the `promptPath` idiom (stubs are real files beside the chain,
   * e.g. `.flume/job-seed/`). Copied verbatim, skip-existing (re-run fills
   * gaps — a stub added to the seed dir reaches existing jobs — and never
   * clobbers a worked file). Absent means a bare job: no content opinion,
   * no warning.
   */
  seedDir?: string;
  /**
   * State-root-relative directory path naming the friction channel (e.g.
   * "friction") — loop-to-owner notes, gitignored, hand-routed by the
   * operator, never in a commit diff. Resolved against the resolved
   * `flumeDir` at load, same idiom as `seedDir`. Undeclared: every
   * friction-lifecycle behavior stays off, no default channel.
   */
  friction?: string;
  /**
   * State-root-relative file path naming the pending queue (spec/pending.md,
   * *The pending queue*) — the `seedDir`/`friction` idiom applied to the
   * queue file itself. Resolved against the resolved `flumeDir` once per
   * tick, same as `friction`. Undeclared defaults to `"plan/pending.json"`,
   * the one default the engine keeps because its own mechanics (fanout
   * selection, the wave-end rewrite) read the file and a tick cannot run
   * without one.
   */
  pendingPath?: string;
  /**
   * How this chain computes the directory its worktrees are placed under
   * (spec/worktrees.md, *Placement — the worktree base*) — a function of
   * the roots the runtime resolved, evaluated
   * once per chain load, never a stored path.
   *
   * A function rather than a string because placement is machine-local —
   * the operator's, per host — and `chain.ts` is committed: a chain that
   * wants its worktrees outside the checkout derives the base from
   * `paths.repoRoot`/`paths.flumeDir` (or from whatever the host tells it)
   * at load, in the one place the engine asks for it, instead of exporting
   * `FLUME_WORKTREES_DIR` at module scope before the engine's own module
   * has loaded.
   *
   * Must return a non-empty absolute path: the engine resolves nothing
   * relative here, because a gate and a tick run with different working
   * directories and a relative base would name a different place at each of
   * them. A value that is not one refuses the chain at load rather than
   * scattering worktrees (`.claude/rules/engineering.md`, *Loud or
   * nothing*).
   *
   * `FLUME_WORKTREES_DIR` still outranks it: the env var is the operator's
   * override on a host they may not own the chain of. Undeclared leaves the
   * engine's own `<flumeDir>/worktrees` default (`worktreesBase`,
   * `src/paths.ts` — the one resolution every reader takes the base from).
   */
  worktreesBase?: (paths: FlumePaths) => string;
  /**
   * Environment facts this chain asserts — the strings a pending entry's
   * `gate: { kind: "requiresCapability", capability }` is matched against.
   * `chain.ts` is TypeScript, so this may probe the environment at load time
   * (e.g. a daemon health check succeeding asserts its name here). Undeclared
   * or omitted means no capability is asserted: a `requiresCapability` entry
   * stays non-pickable until the chain names it here.
   */
  capabilities?: string[];
  /**
   * A per-entry refusal this chain declares. Answered `true` for an entry the
   * gate switch and this run's quarantine both cleared, the engine holds that
   * entry back from every pickable set the tick reports — the wave's own
   * batch, `TickContext.pickable` and `TickResult.pickableAfter` alike — and
   * names it on `TickResult.refusedTags`.
   *
   * The injection point is the chain's, the enforcement the engine's
   * (`.claude/rules/engine-boundary.md`, *Capability vs convention*): which
   * entry to decline, and on what evidence, is the declarer's whole business,
   * and the engine reads the answer as "not this tick" and nothing more. It
   * neither supplies a predicate of its own nor a reason vocabulary for one.
   * Undeclared or omitted refuses nothing: every entry the gate switch clears
   * stays pickable, and `refusedTags` is empty.
   *
   * Consulted at selection time, before any worktree is created — the same
   * place and shape as the gate switch — so a refused entry is skipped rather
   * than picked, provisioned, and then declined. Synchronous and pure over
   * {@link EntryRefusalContext}: selection is not an async seam, and every
   * fact a tick holds about the entry is already on that context. A predicate
   * that throws propagates and fails the tick rather than being folded into a
   * verdict the chain never reached
   * (`.claude/rules/engineering.md`, *Loud or nothing*).
   */
  refusesEntry?: (ctx: EntryRefusalContext) => boolean;
  /**
   * Override for the `flume loop` supervisor's repeated-failure policy —
   * the run-scoped quarantine and the consecutive-identical-failure abort
   * threshold ship as engine defaults; this block lets a chain choose
   * otherwise. Both legs read every failure a tick reported, whichever
   * stage it came from (provision, merge or gate), never provisioning
   * alone. Undeclared or omitted fields fall through to the defaults in
   * `src/loopSupervisor.ts`'s
   * `SuperviseLoopOptions.quarantineScope`/`abortThreshold` docs, whose exact
   * byte shape is pinned by the chain-declares-neither-knob case in
   * tests/loopSupervisor.test.ts.
   */
  supervisorPolicy?: {
    /**
     * `"run"`: a failure a tick blamed on one entry — at the provision, merge
     * or gate stage alike — quarantines that entry's slug for the rest of the
     * run. `"none"`: quarantine never engages — every entry stays pickable
     * every tick regardless of an earlier failure. The
     * consecutive-identical-failure backstop (`abortThreshold`) applies either
     * way.
     */
    quarantineScope?: "run" | "none";
    /**
     * Number of consecutive ticks the same stage-tagged failure signature
     * must repeat, with no successful tick between them, before the
     * supervisor aborts the run — a provision-, merge- or gate-stage wall
     * alike, each streak counted separately.
     */
    abortThreshold?: number;
    /**
     * Milliseconds between the SIGTERM a signalled `flume tick` sends the
     * agent tree it started and the SIGKILL that follows — the window an
     * agent mid-invocation gets to finish writing before the tick stops
     * waiting and the guards over the state root are released. A tree that
     * exits on the SIGTERM never reaches it. Read by the process that
     * signals the tree it can see: a `flume tick`, bare or loop-spawned,
     * off its own tick's chain. A `flume loop` above it signals its tick
     * child and waits unbounded, holding no grace of its own — a timer
     * there would fire over a group the agent is not in. POSIX only —
     * win32 maps SIGTERM to TerminateProcess, which runs no handler, so
     * there is no grace to bound.
     */
    killGraceMs?: number;
    /**
     * Max parallel ticks per fanout batch — overrides
     * `DispatcherOptions.maxParallel` (`src/Dispatcher.ts`), whose own
     * default is 4. Unlike `quarantineScope`/`abortThreshold` this is not
     * run-scoped: the dispatcher already reloads `chain.ts` fresh every
     * tick, so `runFanout` reads this straight off the tick's own resolved
     * chain rather than a value bound once per run.
     */
    maxParallel?: number;
    /**
     * Wall-clock timeout per agent invocation in milliseconds — overrides
     * `DispatcherOptions.tickTimeoutMs` (`src/Dispatcher.ts`), whose own
     * default is unset (no cap). Same per-tick scope as `maxParallel`: the
     * dispatcher already reloads `chain.ts` fresh every tick, so both call
     * sites read this straight off the tick's own resolved chain rather than
     * a value bound once per run.
     */
    tickTimeoutMs?: number;
    /**
     * Globs (matched by `matchesAny`, `src/paths.ts`) whose paths never
     * count toward the fanout partition's collision set —
     * `partitionByFileOverlap` (`src/partition.ts`) and the wave-end
     * `observedFiles` footprint recorder (`src/waveTick.ts`) both read
     * `touchedPaths` through this filter. `declaredPaths` itself — the
     * fence, the write guard, ship detection — is untouched; this widens
     * only what counts as a partition collision, never a permission.
     * Default `[]`: byte-identical to no filter (spec/pending.md, "Fanout
     * partition — disjoint touched paths").
     */
    partitionIgnore?: string[];
  };
}
