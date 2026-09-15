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
import {
  CjsContextLoadError,
  PendingParseFailure,
  readTickVerdicts,
  readLatestVerdictsSync,
} from "./Dispatcher.js";
import {
  readFileAtRef,
  showNameOnly,
  statusRecords,
  TipClaimHeldError,
} from "./git.js";
import { partitionByFileOverlap } from "./partition.js";
import { gitPath, matchesAny, slugify, stopFlagPath } from "./paths.js";
import { priorAttemptPath, priorAttemptsDir } from "./priorAttempts.js";
import {
  composePendingList,
  parsePending,
  parsePendingLoose,
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
 * `resolveStateDirs` (`src/cliJobResolution.ts`) before any code path
 * constructs a chain.
 *
 * A chain that places a per-run artifact resolves it against `flumeDir`; it
 * reads no `process.env.FLUME_DIR` and carries no `?? CHAIN_DIR` fallback,
 * because there is nothing left for a fallback to cover.
 */
export interface FlumePaths {
  /** Primary repo root — the checkout the run was invoked from. */
  repoRoot: string;
  /** Where `chain.ts` and its prompt files live. Never retargeted by a job. */
  configDir: string;
  /**
   * Mutable-state root: baton (`awake/`), pending, rendered prompts, prior
   * attempts. `--job`/`FLUME_JOB` moves this one and only this one.
   *
   * The fanout worktree base is **not** on that list: it only defaults to a
   * child of this root, and `FLUME_WORKTREES_DIR` moves it out from under
   * the root entirely. `worktreesBase` (`src/paths.ts`) is the one
   * resolution that says where a worktree lands — resolve against it, never
   * against this root.
   */
  flumeDir: string;
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
   */
  paths: FlumePaths;
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
  composePendingList: typeof composePendingList;
  parsePending: typeof parsePending;
  parsePendingLoose: typeof parsePendingLoose;
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
     * refuse, stay the chain's (`engine-boundary.md`).
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
     * base, a sibling job's container directory, and residue whose
     * registration git already pruned all look alike there. An unreadable
     * registry stays distinguishable from an empty one, so a reaper never
     * frees a live arm's handle on the strength of a failed `git` call.
     *
     * The list is git's, so it names the primary checkout too; which paths
     * are the chain's to reap is the chain's to decide.
     */
    readWorktreeRegistry: typeof readWorktreeRegistry;
    /**
     * A detached checkout of a sha, planted under the state root's worktree
     * base and removed by the engine when the gate that asked for it returns
     * (`spec/chain.md`, *What a gate receives*). What a **differential** gate
     * calls: one that needs the *tree* at `ctx.baseSha` — to run a suite
     * there, to typecheck it, to diff a build output — rather than one file
     * out of it, which `readFileAtRef` above already answers.
     *
     * A gate provisions nothing itself. Placement is the engine's own
     * `worktreesBase` resolution, so an operator's `FLUME_WORKTREES_DIR` is
     * honored and a run killed mid-gate leaves a directory the next start's
     * sweep reclaims — where a chain's own temp dir leaves residue in a
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
 * that is load-bearing: `src/index.ts` initializes `builtinGates` before
 * `Dispatcher`, and `builtinGates` imports `Dispatcher` (the documented
 * intentional cycle). A top-level object literal here would read
 * `builtinGates`' exports while that module is still mid-initialization and
 * throw on the temporal dead zone. Reading them inside a call defers every
 * property access until all modules have finished — the same
 * function-body-only discipline the existing cycle already mandates.
 */
export function buildFlumeApi(paths: FlumePaths): FlumeApi {
  return {
    paths,
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
    composePendingList,
    parsePending,
    parsePendingLoose,
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
    stopFlagPath,
    git: {
      showNameOnly,
      readFileAtRef,
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
