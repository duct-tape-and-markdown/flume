/**
 * Gate — a composable harness check. Runs at a declared point in the tick
 * lifecycle and reports ok/fail with a message the dispatcher can surface
 * back to the agent on retry.
 *
 * Gates are how prose-validation moves out of prompts. A phase declares its
 * gates; the harness runs them; the prompt never reminds the agent to.
 */

import type { PendingEntry } from "./PendingSchema.js";

/**
 * When in the tick lifecycle a gate runs. `afterCommit` is the common case
 * (validate the agent's commit on its worktree branch); `afterMerge` runs
 * on the trunk once the tick's span has been cherry-picked onto it. Both
 * placements are open to both concurrencies — see each member below for
 * what a failure costs.
 */
export type GatePhase =
  /**
   * Runs after the agent's commit lands on the worktree branch, before the
   * harness accepts it. Failure drops the commit (worktree branch is reset)
   * and (for fanout phases) the entry is left in pending for the next plan.
   */
  | "afterCommit"
  /**
   * Runs over the **candidate** a worktree commit was cherry-picked onto — a
   * fanout entry's span, or a singleton phase's own (spec/worktrees.md,
   * "Singleton runs in a worktree"): a tree at the current trunk tip that
   * trunk fast-forwards to once every gate here is green. Failure discards
   * that candidate and trunk never names the commit; for a fanout wave, the
   * siblings trunk already fast-forwarded to stay shipped
   * (spec/worktrees.md, "Per-entry `afterMerge` revert isolation").
   */
  | "afterMerge";

/**
 * Where a gate is running, and what it writes through — the half of a gate's
 * input surface that holds however many spans the merge it judges carried.
 * {@link GateContext} and {@link BatchGateContext} each extend it, so the
 * dispatcher composes one placement and the two shapes differ only in what
 * they say about the span (spec/chain.md, "What a gate receives").
 */
export interface GateSite {
  /** Absolute path of the worktree (or the merge's candidate for afterMerge gates). */
  cwd: string;
  /**
   * Absolute, resolved flume state root (`flumeDir`) — where the baton,
   * pending, worktrees, and prior-attempts live (default `<repoRoot>/.flume`,
   * relocatable via `FLUME_DIR`). A gate reads state-relative paths from here
   * (`join(ctx.flumeDir, "prior-attempts")`) instead of hardcoding `.flume/`
   * or reaching into `process.env`. The queue is not one of them — it has its
   * own resolved field, `pendingDir` below, and a gate that rebuilds the path
   * from this root instead reads the wrong file the moment a chain relocates
   * the queue.
   *
   * This is the **primary checkout's** state root at both gate points, never
   * rebased onto a worktree: runtime state (`awake/`, `prior-attempts/`,
   * `tick-verdicts.jsonl`) exists only there. Under `afterCommit` it is
   * therefore *not* nested under `repoRoot` — the worktree lives inside it —
   * so a gate never derives a repo-relative path from `flumeDir` and
   * `repoRoot` directly; use `stateRootRel` for that (spec/chain.md "What a
   * gate receives").
   */
  flumeDir: string;
  /**
   * `flumeDir`'s path relative to the primary repo root **in git's own
   * alphabet** — forward-slashed whatever the host's separator — set when the
   * state root lives inside the repo and absent when it is relocated outside
   * it (an absolute `FLUME_DIR`, or one that climbs out via `..`). The one
   * value a gate needs to read a **tracked** state-root file as a given commit
   * held it — `git ls-tree <commitSha> -- <stateRootRel>/plan/pending/` —
   * without hardcoding `.flume`, re-deriving the offset, or re-folding it: a
   * gate composes a pathspec, a fence glob or a touched-path comparison from
   * this value and each of those is git's alphabet already. Computed
   * once by the dispatcher and shared with its own friction-harvest use of
   * the same offset (`.claude/rules/engineering.md` "The fix lands at the
   * mechanism"). The key is required and its `undefined` is stated, never
   * omitted: absence of a value carries the relocation meaning gates branch
   * on, so a context that leaves the field off is a forgotten offset wearing
   * a relocated state root's clothes.
   */
  stateRootRel: string | undefined;
  /**
   * Absolute path of the chain/prompts dir (`<configDir>/chain.ts`, default
   * `<repoRoot>/.flume`, relocatable via `FLUME_CONFIG_DIR`, spec/cli.md
   * "State-root and config-dir resolution"). Rebased onto the gate's own
   * `cwd` when that differs from the primary checkout (an `afterCommit` gate
   * runs inside the tick's worktree and an `afterMerge` gate inside the
   * merge's candidate, each mirroring the repo's tracked layout at the same
   * relative offset) — but only while the config dir
   * resolves *inside* the repo. One relocated outside it has no mirror in a
   * checkout that carries only tracked files, so it passes through
   * verbatim; the escape test that picks the branch is
   * `computeStateRootRel`'s, the same owner `stateRootRel` above reads.
   * Either way a gate reads `ctx.configDir` directly instead of hardcoding
   * `.flume` or reaching into `process.env`
   * (`.claude/rules/engine-boundary.md` "Told, not inferred").
   */
  configDir: string;
  /**
   * Absolute, resolved path to the pending queue's **directory**
   * (`Chain.pendingDir`, default `<flumeDir>/plan/pending`), resolved once per
   * tick by the dispatcher — same idiom as `flumeDir`/`configDir`. Every
   * `<tag>.json` directly under it is an entry. A gate reads this instead of
   * hardcoding `plan/pending` (spec/pending.md, "`pendingGate` — validation
   * and fence pre-check as an opt-in builtin").
   */
  pendingDir: string;
  /**
   * Absolute path of the working-tree root the gate is running in — for an
   * `afterCommit` gate, the worktree root (a fanout entry's, or a singleton
   * phase's own; spec/worktrees.md "Singleton runs in a worktree"); for an
   * `afterMerge` gate, the merge's candidate, which is the tree trunk is
   * about to become (spec/worktrees.md "Per-entry `afterMerge` revert
   * isolation").
   */
  repoRoot: string;
  /** Phase the gate is running for. */
  phaseName: string;
  /** Logger for harness-side output. Gates should not write to stdout directly. */
  log: (line: string) => void;
}

/**
 * One session's assignment, as the gates judging that session read it: the
 * entry a span was provisioned for and that entry's steps, in one value.
 *
 * The pair is one fact and travels as one. A span is one *session's*, and a
 * session's footprint is the entry's `files` and its steps' together
 * (`declaredPaths`, `src/PendingSchema.ts`) — the union the engine already
 * folded to scope the write guard and to render the `<harness>` block. Two
 * optional fields would let a leg state one half and drop the other, and a
 * consumer handed that cannot tell an entry no producer decomposed from a
 * context that never answered — two states whose verdicts are opposite
 * (`.claude/rules/engineering.md`, *A fact the engine holds is reported, never
 * rediscovered*). One optional value makes both unconstructable, which is the
 * rung above pinning the pairing in a suite.
 */
export interface GateAssignment {
  /**
   * The pending entry the span was provisioned for, as the wave selected it.
   * A chain gate reads its extension fields (`tests[]`, an acceptance) through
   * the chain's own schema to hold the commit to the entry's own contract; the
   * engine reads none of them. Reported from the value the dispatcher already
   * holds for the scoped fence, never re-read from the queue.
   */
  entry: PendingEntry;
  /**
   * {@link entry}'s steps — every descendant of it in the queue the selection
   * that pulled it read (`spec/pending.md`, *The queue is a forest*), in that
   * listing's own order: the same value `ShipContext.steps` (`src/Phase.ts`)
   * carries for the span and `TickContext.assignedSteps` (`src/Phase.ts`)
   * rendered to its agent. `[]` for an entry a producer has not decomposed,
   * which is the whole of what "no steps" means here — a gate cannot walk for
   * them, since it is handed one entry and no queue.
   */
  steps: readonly PendingEntry[];
}

/**
 * One span of a batched merge, as the gates over that batch read it
 * (spec/worktrees.md, "Batched merges"). The per-span facts a single-span
 * context carries on {@link GateContext} itself: a batch withholds them
 * there and states them here, once per span, in the order the batch picked
 * them.
 *
 * `commitSha` is the span's own merged tip, reported rather than left for a
 * gate to chain out of its neighbour's `landedOnSha`
 * (`.claude/rules/engineering.md`, *A fact the engine holds is reported,
 * never rediscovered*) — and it is what {@link BatchGateContext.commitSha}
 * is computed from, never a second copy of.
 */
export interface GateBatchSpan {
  /**
   * The session this span was provisioned for ({@link GateAssignment}) —
   * {@link GateContext.assignment}, per span. Absent on a span that carries
   * none, exactly as it is there; the entry and its steps cannot part company
   * on the way here, so a batch cannot hand a path-judging gate a footprint
   * narrower than the one the engine fenced.
   */
  assignment?: GateAssignment;
  /** The span's own tip once it was picked onto trunk. */
  commitSha: string;
  /** The sha this span started from — {@link GateContext.baseSha}, per span. */
  baseSha: string;
  /**
   * The trunk tip this span landed onto — {@link GateContext.landedOnSha},
   * per span. The batch's picks are sequential, so each span's value is the
   * tip its own pick went onto rather than the tip the batch started from.
   */
  landedOnSha: string;
  /** The span's own changed paths, the range its own two shas bound. */
  touchedPaths: readonly string[];
}

/**
 * Inputs passed to a gate judging **one** span. The dispatcher constructs
 * this once per gate invocation; gates should treat it as read-only and
 * confine side effects to disk operations inside `cwd`.
 *
 * `batch` is the discriminant against {@link BatchGateContext} and is always
 * absent here: a gate handed this one reads the span's facts off the context
 * directly.
 */
export interface GateContext extends GateSite {
  /** Never set here — see {@link BatchGateContext.batch}. */
  batch?: undefined;
  /**
   * SHA of the commit under inspection — the tip of the gated span. Set on
   * every dispatcher-built context at both stages, so it is required: no
   * builtin carries a second derivation to fall back to, and a hand-built
   * fixture states what a tick hands a gate rather than leaving the field
   * off (spec/chain.md "What a gate receives").
   */
  commitSha: string;
  /**
   * The gated span's changed paths (relative to repo root, forward-slash) —
   * the cumulative `baseSha..commitSha` diff, computed once per commit by
   * the dispatcher and handed to every gate this tick runs; the `readonly`
   * is that sharing, since one array reaches them all. A gate that needs
   * touched-path detection reads this instead of shelling `git show
   * --name-only` out on its own (.claude/rules/engineering.md "The fix lands
   * at the mechanism"); no gate carries a second derivation to fall back to,
   * so a hand-built context states the same list a real tick would hand it
   * (.claude/rules/engineering.md "A seam gate reads what the real writer
   * wrote").
   */
  touchedPaths: readonly string[];
  /**
   * The sha the gated span started from — the worktree's tip when the tick
   * branched, the same value the dispatcher cherry-picks the span from. Set
   * at both stages: under `afterCommit` it is the base of the span being
   * gated in the worktree; under `afterMerge` it is that same base, not the
   * pre-cherry-pick trunk tip, so a gate reading trunk can tell an input the
   * tick *ignored* from one it *never saw* — `git log <baseSha>..HEAD --
   * <inputs>` names what landed after the tick branched, and
   * `git show <baseSha>:<path>` is the input as the tick read it
   * (spec/chain.md "What a gate receives"). Without it a chain rebuilds the
   * base from a worktree path convention the engine never promised. Required
   * for the same reason as `commitSha` above: every dispatcher-built context
   * sets it.
   */
  baseSha: string;
  /**
   * Under `afterMerge`, the trunk tip the gated span landed onto: the lower
   * end of the range {@link touchedPaths} is diffed over, and the trunk as
   * this entry found it before its own commits were carried across. Absent
   * under `afterCommit`, where no trunk is involved and {@link baseSha} is
   * the whole story.
   *
   * It is how a per-entry cumulative gate on trunk — one that measures a set
   * before and after this entry and refuses growth — reads the right
   * *before*. {@link baseSha} is what the tick *saw* when its own slot was
   * filled — shared with every sibling of a wave's initial fill, and later
   * than theirs for an entry a freed slot pulled — so a gate measured against
   * it inherits whatever landed before it; `HEAD^` is right only while a span
   * lands as one commit (spec/chain.md "What a gate receives"). Set on every
   * dispatcher-built `afterMerge` context, so an `afterMerge` gate reads it
   * without a fallback; the dispatcher already holds the sha it
   * cherry-picked onto.
   */
  landedOnSha?: string;
  /**
   * The session this span was provisioned for ({@link GateAssignment}) — set
   * at both stages under fanout, absent on a singleton tick, which is
   * assigned nothing (spec/chain.md "What a gate receives"). A chain gate
   * holding a commit to its session's declaration reads the entry and its
   * steps off this one value; absence is the singleton, never a half-answer
   * it would have to rule on.
   */
  assignment?: GateAssignment;
}

/**
 * Inputs passed to a gate judging a **batch** — one merge that carried
 * several spans (spec/worktrees.md, "Batched merges"). Only a gate declaring
 * `batches: true` is ever handed one ({@link BatchingGate}), because a gate
 * written for one span would read a batch's facts as one entry's.
 *
 * The single-span facts are withheld rather than filled with the last pick's:
 * {@link GateContext.assignment}, {@link GateContext.baseSha} and
 * {@link GateContext.landedOnSha} are absent, and each span states its own on
 * {@link batch}.
 */
export interface BatchGateContext extends GateSite {
  /**
   * One record per span the merge carried, in the order they were picked —
   * never empty, since a merge that carried no span runs no gate.
   */
  batch: readonly GateBatchSpan[];
  /**
   * The batch's last pick — the tip the gates are judging, which is the one
   * fact a single-span context and a batch context agree on.
   */
  commitSha: string;
  /**
   * The union of every span's {@link GateBatchSpan.touchedPaths}, in the
   * order the batch first saw each path: what a path-keyed gate must read,
   * because any span's edit is in the tree the gates run over.
   */
  touchedPaths: readonly string[];
  /** Withheld under a batch — each span states its own on {@link batch}. */
  assignment?: undefined;
  /** Withheld under a batch — each span states its own on {@link batch}. */
  baseSha?: undefined;
  /** Withheld under a batch — each span states its own on {@link batch}. */
  landedOnSha?: undefined;
}

/**
 * What a gate reports back. `message` is the one-line verdict shown to the
 * dispatcher (and forwarded to the agent on failure context); `details`
 * carries any captured stdout/stderr for richer surfacing.
 */
export interface GateResult {
  ok: boolean;
  /** Short summary surfaced to the dispatcher and (on failure) the agent. */
  message: string;
  /** Optional captured output (e.g. tsc stderr) for context injection. */
  details?: string;
  /**
   * A chain-authored discriminant for *why* this gate ruled as it did. The
   * dispatcher persists it verbatim onto the tick verdict's gate result and
   * onto a `gate-revert` prior-attempt record beside `message`, and
   * interprets it no further — as with {@link skipped} (spec/chain.md "What
   * a gate returns"). A chain whose next tick keys on the reason reads this
   * field rather than re-reading its own prose out of `message`.
   */
  verdict?: string;
  /**
   * The gate did not run its judge, and why: no code path among the touched
   * paths, a runner the chain scopes out by design. `ok` stays required and
   * stays the verdict the engine acts on; this is the fact that the verdict
   * was not *earned* by running anything. The dispatcher copies it onto the
   * tick verdict's gate result verbatim and interprets it no further
   * (spec/chain.md "What a gate returns"). A gate returning `ok: true`
   * without it claims it ran — vacuous-by-design is spelled, never inherited
   * (`.claude/rules/engineering.md` "A green verdict is proven non-vacuous").
   */
  skipped?: string;
  /**
   * Repo-relative paths the gate attributes the failure to, when its runner
   * can name them (a test reporter's JSON, a type-checker's diagnostics).
   * Copied onto the tick verdict's gate result and onto a `gate-revert`
   * prior-attempt record verbatim; the engine derives nothing from it
   * (spec/chain.md "What a gate returns"). A span's edits can red a file
   * they never touched — a pin in a test module that reads the whole tree —
   * so disjointness from the footprint proves nothing, and attribution is
   * the gate's to declare on {@link blamesSpan}. `writablePathsGate`
   * populates this with the same paths its `details` lists; a shell-backed
   * gate populates it from whatever its declared reader attributed
   * (`ShellGateOptions`, `src/builtinGates.ts`), and leaves it empty where
   * no reader was declared, an exit status naming no file.
   */
  failingFiles?: string[];
  /**
   * The gate says this failure is **not** the gated span's: the suite was
   * red at the base, or a resource the span never touched refused. The
   * engine withholds the entry-scoped half of the stage failure — no
   * quarantine key, no blame on the prior-attempt record — exactly as a
   * singleton's own revert already carries none, while the
   * consecutive-failure backstop still counts the failed tick
   * (spec/chain.md "What a gate returns"). The revert itself still happens:
   * a span that cannot be judged does not land.
   *
   * Absent is today's behavior — the span is blamed. Typed `false` alone
   * because `true` says only what absence already says, and a field with
   * one meaningful value cannot be set to the wrong one. A declared fact,
   * never a reading of {@link verdict} or {@link message}
   * (`.claude/rules/engine-boundary.md`, *Told, not inferred*).
   *
   * **No builtin the package configures sets it.** `shellGate` judges by the
   * exit code of one command in one working tree — so it, and `tscGate`,
   * `vitestGate` and `eslintGate`, which are that gate under three commands
   * and declare no reader — has no base run to compare against and cannot
   * tell a red the span introduced from one it inherited. `chainLoadGate`,
   * `pendingGate` and `writablePathsGate` read the gated commit alone and
   * declare nothing either; `namedLinesGate` (`harness/judgeGate.ts`) is the
   * one gate shipped beside the engine that observes a base at all, and so
   * the one that withholds blame. A `shellGate` carrying a declared reader
   * reports whatever that reader stated here, the command having made the
   * comparison the gate itself cannot
   * (`ShellGateOptions`, `src/builtinGates.ts`).
   *
   * What that costs is declared, not accidental
   * (`.claude/rules/engineering.md`, *Loud or nothing*): a trunk already red
   * at `baseSha` reverts every span gated over it, keys a quarantine on each
   * entry, and blames a failure that predates all of them. The miss is
   * uniform rather than selective, which is what bounds it — every entry in
   * the wave fails the same gate with the same message, so the
   * consecutive-identical-failure backstop aborts the run non-zero
   * (`spec/loop.md`, *Consecutive-identical-failure backstop*) rather than
   * the queue draining one mis-blamed entry at a time. Giving a shell gate a
   * base arm means re-running its command against `baseSha` per failed
   * entry, or the engine ruling base-red wave-wide ahead of the gates; both
   * were declined as the complexity signal
   * (`.claude/rules/collaboration.md`, *Complexity is a signal, not a
   * challenge*). A chain that needs the distinction declares a gate that
   * makes the base comparison itself.
   */
  blamesSpan?: false;
}

/**
 * What every gate declares, batching or not — the half of {@link Gate} that
 * does not depend on how many spans one merge may hand it.
 */
export interface GateIdentity {
  /** Stable identifier; appears in logs and gate-failure prompt context. */
  name: string;
  /** When in the lifecycle this gate runs. */
  when: GatePhase;
  /**
   * The single command line this gate runs, when it has one — `shellGate`
   * sets it from its `cmd`/`args`, so a chain wanting the agent to
   * self-check before committing doesn't restate the command in its prompt
   * from a parallel constant (`spec/chain.md`, "The builtin gates"). A
   * hand-rolled gate with no single command line (`chainLoadGate`,
   * `pendingGate`, `writablePathsGate`) declares none.
   */
  command?: string;
}

/**
 * A gate written for **one** span — the default, and what every gate is
 * until it says otherwise. Its `run` is typed over {@link GateContext}
 * alone, so the span's assignment, base and landing are there to read without
 * a guard, and the merge is held to one span at a time on its behalf
 * (spec/worktrees.md, "Batched merges").
 */
export interface SingleSpanGate extends GateIdentity {
  /**
   * Absent, or `false` spelled out: either way this gate reads one span.
   * Typed `false` rather than `boolean` so the discriminant against
   * {@link BatchingGate} cannot be widened by a variable.
   */
  batches?: false;
  /** The check itself. Must be pure-ish; idempotent; no commits or pushes. */
  run: (ctx: GateContext) => Promise<GateResult>;
}

/**
 * A gate that has declared it reads a batch. Its `run` takes either shape,
 * because a batch is what a merge *may* carry and never what it must: with
 * `supervisorPolicy.mergeBatch` at its default of one, or a wave with a
 * single span to ship, a batching gate is handed the same
 * {@link GateContext} every other gate gets.
 *
 * The declaration is what buys batching for the whole phase — a phase
 * batches only when every one of its `afterMerge` gates declares it
 * (`mergeBatchWidth`, `src/gateBatch.ts`) — so a gate written for one entry
 * fails safe to serial merging instead of reading the last pick's facts as
 * the batch's.
 */
export interface BatchingGate extends GateIdentity {
  /** This gate reads {@link BatchGateContext.batch} when it is handed one. */
  batches: true;
  /** The check itself. Must be pure-ish; idempotent; no commits or pushes. */
  run: (ctx: GateContext | BatchGateContext) => Promise<GateResult>;
}

/**
 * The declared shape of one validation step. Gates are data the dispatcher
 * runs at the declared `when` point in the lifecycle; the prompt never
 * needs to remind the agent to run them.
 */
export type Gate = SingleSpanGate | BatchingGate;
