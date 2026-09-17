/**
 * Chain loading — resolving `<configDir>/chain.ts` into a validated
 * `ChainModule`: the factory shape, the declaration validations a load
 * refuses on, the CJS-context host refusal, and the default per-tick
 * resolver built over them.
 *
 * spec/chain.md "Chain residency". Three surfaces load a chain — a tick
 * (`src/Dispatcher.ts`), `chainLoadGate` (`src/builtinGates.ts`) validating a
 * just-committed self-edit, and the CLI's job verbs (`src/job.ts`) — so the
 * load is its own job rather than a second one appended to the module that
 * runs ticks (`.claude/rules/engineering.md`, *A module is one job*).
 */

import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";

import { tsImport } from "tsx/esm/api";

import type { Agent } from "./Agent.js";
// `buildFlumeApi` is a function, not a constant, precisely so this
// import participates safely in the flumeApi cycle — see its docstring.
// flumeApi takes `CjsContextLoadError` back out of this module, and both
// sides touch the imported symbol only inside function bodies, so ESM live
// bindings resolve cleanly.
import {
  buildFlumeApi,
  type FlumeApi,
  type FlumePaths,
} from "./flumeApi.js";
import { validateFrictionDeclaration } from "./friction.js";
import { existsLoud } from "./fsProbe.js";
import type { Chain } from "./Phase.js";
import {
  assertStateRootRelative,
  chainModulePath,
  namespacedJoin,
} from "./paths.js";

/**
 * What a chain factory returns: the `Chain` plus an optional `agent`
 * override and an optional `forkResolver` (the foundations governor). The
 * per-tick resolver returns this; a rewritten chain.ts changes all three for
 * the next tick.
 *
 * `agent` and `forkResolver` ride the factory's return rather than named
 * module exports because a named export cannot receive the API — leaving
 * them as exports would preserve exactly the resolution path the factory
 * shape removes.
 */
export interface ChainModule {
  chain: Chain;
  agent?: Agent;
  forkResolver?: (repoRoot: string) => (slug: string) => boolean;
}

/**
 * What `.flume/chain.ts` default-exports: a factory the
 * engine calls with its own surface. The chain imports no engine *value*, so
 * a second physical engine in one process is unreachable rather than merely
 * detected.
 */
export type ChainFactory = (api: FlumeApi) => ChainModule;

/**
 * Validate a declared `Chain.pendingPath` (spec/pending.md "The pending
 * queue"): must be relative and must resolve inside the state root, same
 * idiom as `Chain.friction`. Undeclared is a strict no-op — the dispatcher
 * falls back to `plan/pending.json`.
 */
function validatePendingPathDeclaration(chain: Chain): void {
  if (chain.pendingPath === undefined) return;
  assertStateRootRelative(
    "pendingPath",
    chain.pendingPath,
    'file path (e.g. "plan/pending.json")',
  );
}

/**
 * Evaluate a chain's declared worktree base (spec/worktrees.md, *Placement —
 * the worktree base*): `Chain.worktreesBase` is how to
 * compute a base, not a base, so the engine runs it **once per chain load**
 * against the roots it resolved and carries the string from there. Every
 * reader — creation, the per-wave stale-slug removal, the startup sweep, a
 * gate's differential checkout — takes it through `worktreesBase`
 * (`src/paths.ts`), which is also where an operator's `FLUME_WORKTREES_DIR`
 * outranks it. Undeclared is a strict no-op.
 *
 * A value that is not a non-empty absolute path refuses the chain here
 * rather than scattering worktrees somewhere no sweep reads
 * (`.claude/rules/engineering.md`, *Loud or nothing*): nothing resolves a
 * relative base, because a tick runs at the repo root and a gate runs inside
 * a worktree, so the same relative value would name two different places.
 */
export function resolveWorktreesBaseDeclaration(
  chain: Chain,
  paths: FlumePaths,
): string | undefined {
  if (chain.worktreesBase === undefined) return undefined;
  const value = chain.worktreesBase(paths);
  if (typeof value !== "string" || value === "") {
    throw new Error(
      `chain's worktreesBase(paths) returned ${JSON.stringify(value)}; ` +
        `Chain.worktreesBase must return a non-empty absolute directory path ` +
        `(e.g. join(paths.repoRoot, "..", "flume-worktrees"))`,
    );
  }
  if (!isAbsolute(value)) {
    throw new Error(
      `chain's worktreesBase(paths) returned the relative path '${value}'; ` +
        `Chain.worktreesBase must return an absolute directory path — a tick ` +
        `and a gate run from different working directories, so a relative base ` +
        `names a different place at each`,
    );
  }
  return value;
}

/**
 * Refuse the one decidable dead-declaration shape (spec/chain.md, *A dead
 * declaration is refused at load*): a chain field whose only consumer is statically
 * unreachable from the rest of the same declaration. Checkable from the
 * declaration alone, no tick required, so the loader — not a tick — refuses
 * it.
 *
 * `phase.entryChannelPaths` is only consulted on a scoped tick
 * (`phase.scopeWritesToEntry === true`); declared without the flag it
 * governs nothing. Emptiness doesn't matter — `[]` on a scoped phase is
 * live (it just adds no extra globs); the field's *presence* without the
 * flag is what's dead.
 */
function validateNoDeadDeclarations(chain: Chain): void {
  for (const phase of chain.phases) {
    if (phase.entryChannelPaths !== undefined && !phase.scopeWritesToEntry) {
      throw new Error(
        `phase '${phase.name}' declares entryChannelPaths without scopeWritesToEntry: true; ` +
          `entryChannelPaths is only consulted on a scoped tick, so it governs nothing here. ` +
          `Set scopeWritesToEntry: true on '${phase.name}', or remove entryChannelPaths.`,
      );
    }
  }
}

/**
 * tsx's ESM loader failing to recognize the chain as a module because the
 * host repo's `package.json` (or one beside `.flume/chain.ts`) lacks
 * `"type": "module"` — two known empirical shapes:
 * tsx 4.21 falls through to a CJS parse of the compiled output and Node's
 * CJS loader rejects the `import`/`export` syntax outright; tsx 4.23
 * instead fails resolution one step earlier, `ERR_MODULE_NOT_FOUND` against
 * a path carrying its internal `tsImport` `?namespace=` query, percent-
 * encoded because the failed resolution treated the query as part of a
 * literal file path. Declining to support CJS-context hosts; this
 * class exists only so `loadChainModule`'s caller can refuse with a fix
 * instead of relaying either raw shape as a stack trace.
 */
export class CjsContextLoadError extends Error {
  constructor(chainPath: string, cause: Error) {
    super(
      `${chainPath} failed to load: tsx's ESM loader can't parse it as a ` +
        `module. Fix: add "type": "module" to this repo's package.json ` +
        `(or one beside .flume/chain.ts). Flume does not support a ` +
        `CJS-context host otherwise. (raw loader error, for debugging: ` +
        `${cause.message})`,
    );
    this.name = "CjsContextLoadError";
  }
}

const CJS_CONTEXT_IMPORT_OUTSIDE_MODULE =
  /Cannot use import statement outside a module/;
const CJS_CONTEXT_NAMESPACE_QUERY = /%3Fnamespace%3D/i;

/**
 * Empirical match only — never a false positive at the cost of missing
 * a shape: a genuinely missing dependency (a bare `ERR_MODULE_NOT_FOUND`
 * with no `tsImport` namespace query in the path) must keep surfacing as
 * itself, unshadowed by this refusal.
 */
function isCjsContextLoadFailure(err: unknown): err is Error {
  if (!(err instanceof Error)) return false;
  if (CJS_CONTEXT_IMPORT_OUTSIDE_MODULE.test(err.message)) return true;
  const code = (err as NodeJS.ErrnoException).code;
  return (
    code === "ERR_MODULE_NOT_FOUND" &&
    CJS_CONTEXT_NAMESPACE_QUERY.test(err.message)
  );
}

/**
 * Load + normalize + validate a chain module from an absolute `chain.ts`
 * path. Throws on a missing file, a compile/syntax error, or a module that is
 * not the factory shape: a default export that is not a function, or a
 * factory whose return carries no `chain` with a `phases[]` array.
 *
 * This is the single load+validate path the runtime trusts. `diskChainLoader`
 * wraps it (one load per call, no memo); `chainLoadGate` (builtinGates) calls
 * it to validate a just-committed `chain.ts` so a broken self-edit fails its
 * gate and is reverted before the next tick's process resolves it.
 *
 * tsImport (tsx/esm/api) compiles the .ts source in-process so the published
 * dist/src/cli.js can resolve consumer chain.ts files without a node loader flag
 * (plain `await import()` would fail: node refuses .ts under node_modules,
 * and consumer .flume/chain.ts is a .ts file regardless of where flume lives).
 *
 * In-process this returns a *pinned* evaluation — see
 * .claude/rules/platform-facts.md, "Node's ESM registry is keyed by resolved
 * URL and cannot be evicted". That is *why* per-tick re-resolution is a
 * process boundary rather than in-process re-eval: `flume loop` spawns one
 * `flume tick` per iteration, each a fresh process that loads chain.ts
 * exactly once. A rewritten chain.ts governs the next tick because the next
 * tick is a new process — not because anything re-imports it in-process.
 */
export async function loadChainModule(
  paths: FlumePaths,
): Promise<ChainModule> {
  // The chain lives at `<configDir>/chain.ts` and nowhere else (spec/chain.md
  // "Chain residency"), so the file to load is computed from the roots the
  // factory will receive rather than passed beside them — a second parameter
  // could only disagree with `paths.configDir`. `chainModulePath`
  // (src/paths.ts) is that computation, shared with the two sibling surfaces
  // that name the same file: `jobNew`'s precondition and `chainLoadGate`'s
  // touched-path key.
  const path = chainModulePath(paths.configDir);
  // win32 MAX_PATH: the single fix point for this check — every caller
  // (job.ts's jobNew/jobRun, builtinGates.ts's chainLoadGate, this file's
  // own default loader) reaches an existing chain.ts through here.
  // namespacedJoin (src/paths.ts) is the shared idiom.
  // Absent is the only silent reading: `existsLoud` (src/fsProbe.ts) throws
  // on any other stat failure rather than reporting absence, so a chain.ts
  // that is present but unreachable — a symlink loop, a permission-denied
  // configDir — names that failure instead of telling the operator to create
  // a file they are looking at. Same split the sibling probe one line ahead
  // of this call in `jobNew` (src/job.ts) already gives the very same path.
  if (!existsLoud(namespacedJoin(path))) {
    throw new Error(
      `chain config not found at ${path}; create .flume/chain.ts that ` +
        `default-exports a chain factory: (api) => ({ chain }).`,
    );
  }
  let ns: Record<string, unknown>;
  try {
    ns = (await tsImport(
      pathToFileURL(path).href,
      import.meta.url,
    )) as Record<string, unknown>;
  } catch (err) {
    if (isCjsContextLoadFailure(err)) {
      throw new CjsContextLoadError(path, err);
    }
    throw err;
  }

  // tsx compiles a default-ONLY .ts module to CJS interop, so the namespace
  // is { default: { __esModule: true, default: <realDefault> } }. A module
  // with named exports stays true ESM: ns.default is the value directly.
  // Normalize both shapes — the documented minimal chain (default export
  // only) hits the interop path.
  const d = ns.default as Record<string, unknown> | undefined;
  const interop =
    !!d &&
    (d as { __esModule?: boolean }).__esModule === true &&
    "default" in d;
  const factory = (interop ? d!.default : d) as ChainFactory | undefined;

  // A non-function default export is refused, never accepted as the older
  // `Chain` object the factory replaced. A silent fallback would readmit the
  // very thing the factory shape removes — a chain resolving engine values
  // through its own import, and with them a second physical engine.
  if (typeof factory !== "function") {
    throw new Error(
      `${path} must default-export a chain factory: (api) => ({ chain }). ` +
        `Default-exporting a Chain object is the pre-0.10 shape — wrap it in a ` +
        `factory and take engine values from the parameter instead of importing ` +
        `them (see docs/MIGRATING-0.10.md § 2).`,
    );
  }

  // The one factory-application seam. The roots go in by reference, so
  // `api.paths` is the dispatcher's own resolved answer rather than a copy
  // the chain would otherwise rebuild from `process.env`.
  const module = factory(buildFlumeApi(paths)) as ChainModule | undefined;

  // A returned thenable means an async factory: the factory shape is
  // synchronous, and awaiting here would silently accept a shape the
  // contract does not carry. Name it rather than failing later on `chain.phases`.
  if (module && typeof (module as { then?: unknown }).then === "function") {
    throw new Error(
      `${path}'s chain factory returned a Promise; the factory must be synchronous. ` +
        `Do async work inside a phase hook (setupWorktree, gates), not at chain build time.`,
    );
  }

  const chain = module?.chain;
  if (!chain || !Array.isArray((chain as { phases?: unknown }).phases)) {
    throw new Error(
      `${path}'s chain factory must return { chain } where chain has a phases[] array`,
    );
  }
  validateFrictionDeclaration(chain);
  validatePendingPathDeclaration(chain);
  validateNoDeadDeclarations(chain);
  const result: ChainModule = { chain };
  if (module.agent) result.agent = module.agent;
  if (module.forkResolver) result.forkResolver = module.forkResolver;
  return result;
}

/**
 * Build the default per-tick chain resolver: load `<configDir>/chain.ts` via
 * `loadChainModule`, once per call. No memoization: each `flume tick` is a
 * fresh process, so there is exactly one resolution per process and
 * nothing to memoize across — cost is one small `tsImport` per tick,
 * dominated by orders of magnitude by the agent invocation.
 *
 * Injecting `DispatcherOptions.chainLoader` replaces this wholesale — the
 * in-process unit-test seam (tests call `tick()` directly, no subprocess).
 */
export function diskChainLoader(
  paths: FlumePaths,
): () => Promise<ChainModule> {
  return () => loadChainModule(paths);
}
