/**
 * The engine surface handed to a chain factory.
 *
 * A chain is a plugin loaded into a host, not a library consumer resolving
 * its own copy: `chain.ts` default-exports `(api: FlumeApi) => ChainModule`
 * and takes every engine *value* from `api`. Its only engine import is
 * `import type`, which is erased at runtime — so a chain cannot resolve a
 * second physical engine, and a stale types-only devDependency cannot reach
 * a tick.
 *
 * What the plugin shape removes by construction: a globally-invoked engine
 * dying with a raw `ERR_MODULE_NOT_FOUND` for the package that is running, and
 * the dual-engine process — one copy driving the Dispatcher while the chain
 * builds Phase/Gate/Agent objects from another, splitting `instanceof` and
 * module state at equal versions with nothing reporting it.
 */

import {
  claudeCode,
  withSessionCapture,
  withTerminalRenderer,
} from "./Agent.js";
import { Baton } from "./Baton.js";
import {
  shellGate,
  tscGate,
  vitestGate,
  eslintGate,
  chainLoadGate,
  writablePathsGate,
  pendingGate,
} from "./builtinGates.js";
import { CjsContextLoadError } from "./chainLoad.js";
import { PendingParseFailure } from "./PendingSchema.js";
import { readGatedQueue } from "./pendingLedger.js";
import { readTickVerdicts, readLatestVerdictsSync } from "./tickVerdict.js";
import {
  isAncestor,
  readFileAtRef,
  showNameOnly,
  statusRecords,
  TipClaimHeldError,
} from "./git.js";
import { partitionByFileOverlap } from "./partition.js";
import {
  computeStateRootRel,
  gitPath,
  matchesAny,
  slugify,
  stopFlagPath,
} from "./paths.js";
import {
  entryAttemptKey,
  phaseAttemptKey,
  priorAttemptPath,
  priorAttemptsDir,
  recordAttemptKey,
} from "./priorAttempts.js";
import {
  composePendingEntry,
  parsePendingQueue,
  parsePendingQueueLoose,
  renderSchemaForPrompt,
  touchedPaths,
  isPickableNow,
} from "./PendingSchema.js";
import { InlineExecRenderError, renderPrompt } from "./Prompt.js";
import { setupWorktree } from "./setupWorktree.js";
import { checkoutAt, readWorktreeRegistry } from "./worktrees.js";

/**
 * The three roots the runtime resolved for this run, handed to the chain
 * rather than left for it to re-derive (`spec/chain.md`, *Per-run artifacts
 * belong under `FLUME_DIR`*). All absolute, all canonicalized by
 * `resolveStateDirs` (`src/cliStateDirs.ts`) before any code path
 * constructs a chain.
 *
 * A chain that places a per-run artifact resolves it against `flumeDir`; it
 * reads no `process.env.FLUME_DIR` and carries no `?? CHAIN_DIR` fallback,
 * because there is nothing left for a fallback to cover.
 */
export interface FlumePaths {
  /** Primary repo root — the checkout the run was invoked from. */
  repoRoot: string;
  /** Where `chain.ts` and its prompt files live. `FLUME_CONFIG_DIR` alone moves it. */
  configDir: string;
  /**
   * Mutable-state root: baton (`awake/`), pending, rendered prompts, prior
   * attempts. `FLUME_DIR` moves this one and only this one.
   *
   * The fanout worktree base is **not** on that list: it only defaults to a
   * child of this root, and either `FLUME_WORKTREES_DIR` or the chain's own
   * `Chain.worktreesBase` moves it out from under the root entirely.
   * `worktreesBase` (`src/paths.ts`) is the one resolution that says where a
   * worktree lands — resolve against it, never against this root.
   */
  flumeDir: string;
}

/**
 * What `FlumeApi.paths` carries: the three resolved roots, plus the one fact
 * about them the engine has already decided — whether the state root lives
 * inside the repository, and at what offset.
 */
export interface FlumeApiPaths extends FlumePaths {
  /**
   * The state root's path relative to `repoRoot` **in git's own alphabet**
   * ({@link gitPath} — forward slashes, whatever the host's separator), or
   * `undefined` when the root is relocated outside the repository.
   *
   * The same value `GateContext.stateRootRel` and `TickContext.stateRootRel`
   * carry, from the same `computeStateRootRel` (`src/paths.ts`) — here at
   * chain load, which is where a fence glob is decided and where no
   * context exists yet to read it off. A chain rooting `writablePaths`, an
   * `entryChannelPaths` glob, or a `git show <sha>:<path>` pathspec at the
   * state root reads this rather than spelling `.flume/` — which a
   * relocated `FLUME_DIR` moves — or folding its own `relative()`,
   * which answers in the host's dialect and so matches nothing on win32.
   *
   * Absent is a **fact, not a verdict**: it says no commit can hold a
   * state-root path, and what follows is the chain's
   * (`.claude/rules/engine-boundary.md`). A chain whose committed artifacts
   * live under the root refuses at load (`spec/harness.md`,
   * *Committed-path discipline*); a chain that commits nothing there ignores
   * it. Required in the type — `buildFlumeApi` always sets it — so the
   * absence is a key carrying `undefined`, never a field a chain forgot.
   */
  stateRootRel: string | undefined;
}

/**
 * The runtime surface a chain composes with. Declared with `typeof` against
 * the real implementations so the API cannot drift from what the engine
 * actually exports — a signature change breaks the interface at compile
 * time rather than at a consumer's tick.
 *
 * Types are deliberately absent: a chain still gets `Chain`, `Phase`,
 * `Gate`, `TickContext` and friends via `import type`, which costs nothing
 * at runtime.
 */
export interface FlumeApi {
  /**
   * The runtime's own resolved roots, by reference — the identity-same
   * values the dispatcher was constructed with, never resolved a second
   * time. Required at construction: a caller that has not resolved its
   * roots cannot build an API to hand a chain.
   *
   * Beside them rides `stateRootRel`, the state root's repo-relative offset
   * as the engine computed it, so a chain composing a committed path out of
   * these roots reads the offset rather than deriving it
   * (`.claude/rules/engineering.md`, *A fact the engine holds is reported,
   * never rediscovered*).
   */
  paths: FlumeApiPaths;
  claudeCode: typeof claudeCode;
  withSessionCapture: typeof withSessionCapture;
  withTerminalRenderer: typeof withTerminalRenderer;
  Baton: typeof Baton;
  shellGate: typeof shellGate;
  tscGate: typeof tscGate;
  vitestGate: typeof vitestGate;
  eslintGate: typeof eslintGate;
  chainLoadGate: typeof chainLoadGate;
  writablePathsGate: typeof writablePathsGate;
  pendingGate: typeof pendingGate;
  setupWorktree: typeof setupWorktree;
  composePendingEntry: typeof composePendingEntry;
  parsePendingQueue: typeof parsePendingQueue;
  parsePendingQueueLoose: typeof parsePendingQueueLoose;
  renderSchemaForPrompt: typeof renderSchemaForPrompt;
  touchedPaths: typeof touchedPaths;
  isPickableNow: typeof isPickableNow;
  partitionByFileOverlap: typeof partitionByFileOverlap;
  matchesAny: typeof matchesAny;
  renderPrompt: typeof renderPrompt;
  readTickVerdicts: typeof readTickVerdicts;
  readLatestVerdictsSync: typeof readLatestVerdictsSync;
  slugify: typeof slugify;
  /**
   * The engine's own host-path-to-git-path rule — the one it keys fence
   * globs, pathspecs and touched-path comparisons by. A chain composing a
   * committed path out of a root the engine reported, or reading a path some
   * tool printed in the host's alphabet, converts it through this rather
   * than respelling the rule: a chain-local copy folds one separator where
   * the engine folds both, and the disagreement surfaces as a fence glob
   * that silently matches nothing on win32.
   */
  gitPath: typeof gitPath;
  priorAttemptPath: typeof priorAttemptPath;
  priorAttemptsDir: typeof priorAttemptsDir;
  /**
   * The engine's own keying rule for `TickContext.priorAttempts`, one keyer
   * per value a hook might be holding: the queue entry it was handed, the
   * phase it is declared on, or a record it already pulled out of the map.
   *
   * A chain looking a record up composes nothing: the map key is a keyspace
   * and an identity joined, and the identity rule differs by keyspace — a tag
   * is slugged, a phase name is keyed exactly as the chain spells it. A
   * chain-local join gets that right until the day it does not, and the
   * failure is a `shouldRun` that reads every tick as a first attempt rather
   * than anything that reds.
   */
  entryAttemptKey: typeof entryAttemptKey;
  phaseAttemptKey: typeof phaseAttemptKey;
  recordAttemptKey: typeof recordAttemptKey;
  /**
   * Where the graceful-stop flag lives under a state root (spec/loop.md
   * "Graceful stop — the stop flag") — the engine's own rule, the one
   * `flume stop` writes, `flume loop` refuses to start over, and the
   * supervisor ends a live run on.
   *
   * A chain that wants a tick to end the run — a `handoff` that saw
   * something it will not build past, a gate that will not let the next wave
   * start — plants the flag through this rather than joining a filename it
   * spelled itself: a chain-local `join(flumeDir, "stop")` is a second copy
   * of a name only this module owns, and a run that never stops is how it
   * reports its own drift.
   */
  stopFlagPath: typeof stopFlagPath;
  /**
   * The queue the commit a gate is attached to holds — where its directory
   * sits, in both the spelling a message names it by and the one a pathspec
   * is composed from, and every entry file already read out of that commit's
   * tree (`readGatedQueue`, `src/pendingLedger.ts`).
   *
   * The read `pendingGate` itself runs, handed a gate's own `GateContext`. A
   * chain gate judging the queue at its commit wants this rather than an
   * `ls-tree` plus a `show` per name over an offset it joined itself: which
   * files under the directory are entries, which ref to resolve them at, what
   * a state root relocated outside the repo reads instead, and which
   * alphabet each path comes back in are all facts the engine already
   * decided, and a second spelling of any of them is how a gate comes to
   * refuse over a queue the gate beside it passed.
   */
  readGatedQueue: typeof readGatedQueue;
  /** Read-only git helpers a chain gate may need. */
  git: {
    showNameOnly: typeof showNameOnly;
    /**
     * The engine's own tip-read — the one `pendingGate` runs on. A gate
     * reading a commit's content wants this rather than its own `git show`:
     * the reimplementation classifies every failure as "absent from the
     * commit", so a bad ref reads as a missing path instead of failing loud.
     */
    readFileAtRef: typeof readFileAtRef;
    /**
     * Whether one commit is a (non-strict) ancestor of another — the engine's
     * own `git merge-base --is-ancestor`, exit code as data.
     *
     * What a chain holding a **sha of its own** reads: a cursor an agent
     * wrote into a state file, a baseline a config names, a tip a prior tick
     * recorded. Those shas are the chain's, so whether one may step to
     * another is the chain's judgement — but the reachability question
     * underneath it is git's, and a chain answering it from a log listing or
     * a `rev-list` grep re-derives the probe the engine already runs on its
     * own tip-verify leg.
     *
     * Reported as a **fact**: yes or no. A ref neither side can resolve
     * throws rather than folding into the negative case, so a chain never
     * reads a typo'd sha as an honest "not an ancestor"
     * (`.claude/rules/engine-boundary.md`, *Told, not inferred*).
     */
    isAncestor: typeof isAncestor;
    /**
     * Every path `git status` reports dirty in a worktree right now, decoded
     * — the porcelain walk the engine already runs to name a tick's
     * uncommitted tracked edits, handed out rather than left for a gate to
     * repeat.
     *
     * A chain judging what a tick left behind filters this list; it does not
     * spawn `git status` beside the engine and re-decode the same bytes. The
     * decode is not the trivia it looks like: `-z` is what keeps a path
     * carrying a space from arriving in porcelain v1's quoted-and-escaped
     * spelling, which names a different path than the one on disk and so
     * matches no fence glob, and a rename or copy spends a second NUL field
     * on its origin that carries no status code — read as a record of its own
     * it arrives as a path with its first three bytes eaten. A chain-local
     * copy gets one of those right and ships green on the other.
     *
     * Reported as **facts**: the code git printed and the path it printed it
     * about. Which codes are residue, and which paths are the chain's to
     * refuse, stay the chain's (`.claude/rules/engine-boundary.md`).
     */
    statusRecords: typeof statusRecords;
    /**
     * Every path git currently registers as a worktree of `repoRoot`, or the
     * reason the registry could not be read — the same probe the harness
     * judges an occupied worktree path on.
     *
     * What a chain reclaiming per-worktree resources reads instead of listing
     * the worktree base itself: a scratch database, a lease, an issued
     * credential allocated in `setupWorktree` outlives a killed tick whose
     * `teardownWorktree` never ran, and the directory listing cannot say
     * which of those directories git still calls a worktree — a relocated
     * base, a sibling checkout's container directory, and residue whose
     * registration git already pruned all look alike there. An unreadable
     * registry stays distinguishable from an empty one, so a reaper never
     * frees a live arm's handle on the strength of a failed `git` call.
     *
     * The list is git's, so it names the primary checkout too; which paths
     * are the chain's to reap is the chain's to decide.
     */
    readWorktreeRegistry: typeof readWorktreeRegistry;
    /**
     * A detached checkout of a sha, planted under the run's worktree base
     * and removed by the engine when the gate that asked for it returns
     * (`spec/chain.md`, *What a gate receives*). What a **differential** gate
     * calls: one that needs the *tree* at `ctx.baseSha` — to run a suite
     * there, to typecheck it, to diff a build output — rather than one file
     * out of it, which `readFileAtRef` above already answers.
     *
     * A gate provisions nothing itself. Placement is the engine's own — the
     * `worktreesBase` resolution, with no level minted beneath it — so an
     * operator's `FLUME_WORKTREES_DIR` is honored and a run killed mid-gate
     * leaves a directory at the level the next start's sweep reads and
     * reclaims. A chain's own temp dir leaves residue in a
     * place nothing looks, and a chain's own path convention under the
     * worktree base is a name only the engine owns, restated
     * (`.claude/rules/engineering.md`, *A fact the engine holds is reported,
     * never rediscovered*).
     *
     * Reclamation is the engine's on both legs — the gate returning a
     * verdict and the gate throwing — so a gate writes no `finally` of its
     * own, and a differential gate that crashes mid-run cannot leak the tree
     * it was reading. Outside a gate invocation there is no boundary to
     * reclaim at, and this refuses rather than handing back a tree nothing
     * will remove.
     */
    checkoutAt: typeof checkoutAt;
  };
  /** The error classes chains branch on with `instanceof`, no value import. */
  CjsContextLoadError: typeof CjsContextLoadError;
  PendingParseFailure: typeof PendingParseFailure;
  InlineExecRenderError: typeof InlineExecRenderError;
  TipClaimHeldError: typeof TipClaimHeldError;
}

/**
 * Build the API object. A **function**, not a module-level constant, and
 * that is load-bearing: this module sits inside the documented intentional
 * cycle — `chainLoad` imports `buildFlumeApi` to apply the factory, and this
 * module imports `CjsContextLoadError` back out of `chainLoad`, which
 * `builtinGates` also reaches. A top-level object literal here would read a
 * sibling's exports while that module is still mid-initialization and throw
 * on the temporal dead zone. Reading them inside a call defers every
 * property access until all modules have finished — the same
 * function-body-only discipline every leg of that cycle mandates.
 */
export function buildFlumeApi(paths: FlumePaths): FlumeApi {
  return {
    // The three roots by reference, and the offset off the engine's one
    // owner of that computation (`computeStateRootRel`, `src/paths.ts`)
    // — the same call the dispatcher makes for its gate and tick contexts,
    // never a second spelling of the escape check or of the fold into git's
    // alphabet.
    paths: {
      ...paths,
      stateRootRel: computeStateRootRel(paths.repoRoot, paths.flumeDir),
    },
    claudeCode,
    withSessionCapture,
    withTerminalRenderer,
    Baton,
    shellGate,
    tscGate,
    vitestGate,
    eslintGate,
    chainLoadGate,
    writablePathsGate,
    pendingGate,
    setupWorktree,
    composePendingEntry,
    parsePendingQueue,
    parsePendingQueueLoose,
    renderSchemaForPrompt,
    touchedPaths,
    isPickableNow,
    partitionByFileOverlap,
    matchesAny,
    renderPrompt,
    readTickVerdicts,
    readLatestVerdictsSync,
    slugify,
    gitPath,
    priorAttemptPath,
    priorAttemptsDir,
    entryAttemptKey,
    phaseAttemptKey,
    recordAttemptKey,
    stopFlagPath,
    readGatedQueue,
    git: {
      showNameOnly,
      readFileAtRef,
      isAncestor,
      statusRecords,
      readWorktreeRegistry,
      checkoutAt,
    },
    CjsContextLoadError,
    PendingParseFailure,
    InlineExecRenderError,
    TipClaimHeldError,
  };
}
