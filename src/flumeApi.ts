/**
 * The engine surface handed to a chain factory (RELEASE-v0.11 §6).
 *
 * A chain is a plugin loaded into a host, not a library consumer resolving
 * its own copy: `chain.ts` default-exports `(api: FlumeApi) => ChainModule`
 * and takes every engine *value* from `api`. Its only engine import is
 * `import type`, which is erased at runtime — so a chain cannot resolve a
 * second physical engine, and a stale types-only devDependency cannot reach
 * a tick.
 *
 * What §6 removes by construction: a globally-invoked engine dying with a
 * raw `ERR_MODULE_NOT_FOUND` for the package that is running, and the
 * dual-engine process — one copy driving the Dispatcher while the chain
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
} from "./Dispatcher.js";
import { showNameOnly, TipClaimHeldError } from "./git.js";
import { partitionByFileOverlap } from "./partition.js";
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
  renderPrompt: typeof renderPrompt;
  readTickVerdicts: typeof readTickVerdicts;
  /** Read-only git helpers a chain gate may need. */
  git: {
    showNameOnly: typeof showNameOnly;
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
export function buildFlumeApi(): FlumeApi {
  return {
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
    renderPrompt,
    readTickVerdicts,
    git: { showNameOnly },
    CjsContextLoadError,
    PendingParseFailure,
    InlineExecRenderError,
    TipClaimHeldError,
  };
}
