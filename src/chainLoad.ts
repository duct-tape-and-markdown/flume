/**
 * Chain loading — resolving `<configDir>/chain.ts` into a validated
 * `ChainModule`: the factory shape, the declaration validations a load
 * refuses on, the CJS-context host refusal, and the default per-tick
 * resolver built over them.
 *
 * spec/chain.md "Chain residency". Running a tick is not the only reason to
 * resolve a chain: a gate validating a just-committed self-edit and a
 * read-only verb reporting on a repo's chain each need the same
 * resolve-and-refuse, and neither runs a phase. So the load is its own job
 * here rather than a second one appended to the module that runs ticks
 * (`.claude/rules/engineering.md`, *A module is one job*). Which modules hold
 * those loads is the program's answer, never a roll call kept here by hand
 * (`.claude/rules/engineering.md`, *Derived state is computed, never restated
 * beside its source*).
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
 * Validate a declared `Chain.pendingDir` (spec/pending.md "The pending
 * queue"): must be relative and must resolve inside the state root, same
 * idiom as `Chain.friction`. Undeclared is a strict no-op — the dispatcher
 * falls back to `plan/pending`.
 */
function validatePendingDirDeclaration(chain: Chain): void {
  if (chain.pendingDir === undefined) return;
  assertStateRootRelative(
    "pendingDir",
    chain.pendingDir,
    'directory path (e.g. "plan/pending")',
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
 * Validate the one supervisor knob whose out-of-range value is a run that
 * cannot happen: `supervisorPolicy.maxTicks` is how many `flume tick`
 * children the supervisor holds at once (`src/Phase.ts`), and a supervisor
 * that may hold none can never start one — the run would report the flags
 * still standing as an orphaned baton and stop having done nothing. Refused
 * here, at the load, rather than at the boundary where the symptom appears
 * (`.claude/rules/engineering.md`, *Loud or nothing*).
 *
 * A positive integer, because the value counts processes: `1.5` children is
 * not a budget anyone declared on purpose. Undeclared is a strict no-op —
 * `superviseLoop` falls back to `DEFAULT_MAX_TICKS`
 * (`src/loopSupervisor.ts`), the serial loop.
 *
 * The other knobs in the block are deliberately not checked beside it: each
 * of them degrades to something an operator can read off a run, and the
 * engine validates only what its mechanics consume
 * (`.claude/rules/engine-boundary.md`, *Capability vs convention*).
 */
function validateSupervisorPolicyDeclaration(chain: Chain): void {
  const maxTicks = chain.supervisorPolicy?.maxTicks;
  if (maxTicks === undefined) return;
  if (!Number.isInteger(maxTicks) || maxTicks < 1) {
    throw new Error(
      `chain declares supervisorPolicy.maxTicks: ${JSON.stringify(maxTicks)}; ` +
        `it must be a positive integer — it is how many flume tick children ` +
        `the loop supervisor holds at once, and a supervisor that may hold ` +
        `none can never run one. Omit it for the default of one (the serial ` +
        `loop).`,
    );
  }
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
 * tsx refusing the chain because the host repo's `package.json` (or one
 * beside `.flume/chain.ts`) lacks `"type": "module"`
 * (`.claude/rules/platform-facts.md`, *tsx decides a module's interop shape
 * from the nearest `package.json` `type`*). The shapes
 * `isCjsContextLoadFailure` matches — four, each empirical, none inferred:
 *
 * - tsx 4.21 falls through to a CJS parse of the compiled output and Node's
 *   CJS loader rejects the `import`/`export` syntax outright.
 * - tsx 4.23 instead fails resolution one step earlier,
 *   `ERR_MODULE_NOT_FOUND` against a path carrying its internal `tsImport`
 *   `?namespace=` query. That query reaches the message in either spelling —
 *   literal where the resolver reports the specifier as written,
 *   percent-encoded where it round-tripped the specifier through a URL first
 *   — and a win32 host reported the literal one, so both are matched.
 * - A top-level await in the chain itself never reaches the loader at all: a
 *   CJS context compiles under esbuild's `cjs` output format, which carries
 *   no top-level await, so the transform refuses first, with a TransformError
 *   naming the file that holds the await and the format that cannot hold it.
 *   Keyed on the format rather than on the await: every refusal esbuild
 *   raises under `cjs` is the same host misconfiguration with the same fix.
 * - A top-level await in a module the chain imports is refused a stage
 *   later, by the CJS loader that requires it: `ERR_REQUIRE_ASYNC_MODULE`.
 *
 * Declining to support CJS-context hosts; this class exists only so
 * `loadChainModule`'s caller can refuse with a fix instead of relaying any of
 * those raw shapes as a stack trace.
 */
export class CjsContextLoadError extends Error {
  constructor(chainPath: string, cause: Error) {
    super(
      `${chainPath} failed to load: tsx can't load it as a module — the ` +
        `parse, the resolution, or the transform refused it. Fix: add ` +
        `"type": "module" to this repo's package.json ` +
        `(or one beside .flume/chain.ts). Flume does not support a ` +
        `CJS-context host otherwise. (raw loader error, for debugging: ` +
        `${cause.message})`,
    );
    this.name = "CjsContextLoadError";
  }
}

const CJS_CONTEXT_IMPORT_OUTSIDE_MODULE =
  /Cannot use import statement outside a module/;
const CJS_CONTEXT_NAMESPACE_QUERY = /(?:\?|%3F)namespace(?:=|%3D)/i;
const CJS_CONTEXT_OUTPUT_FORMAT = /the "cjs" output format/;

/**
 * Empirical match only — never a false positive at the cost of missing
 * a shape: a genuinely missing dependency (a bare `ERR_MODULE_NOT_FOUND`
 * with no `tsImport` namespace query in the path) and a transform that
 * failed on anything else (a syntax error in the chain) must keep surfacing
 * as themselves, unshadowed by this refusal.
 *
 * Two arms read English, the sanctioned divergence
 * `.claude/rules/engine-boundary.md`, *Told, not inferred* names: Node's CJS
 * parse rejection and esbuild's TransformError each arrive with no `code`
 * and no structured field naming the cause — measured on tsx 4.21, where the
 * transform failure carries `name` and nothing else — so the message is the
 * only thing there is to read. The other two arms key on a code, and the
 * namespace arm reads the message only after its code has already narrowed
 * the field.
 */
function isCjsContextLoadFailure(err: unknown): err is Error {
  if (!(err instanceof Error)) return false;
  if (CJS_CONTEXT_IMPORT_OUTSIDE_MODULE.test(err.message)) return true;
  if (CJS_CONTEXT_OUTPUT_FORMAT.test(err.message)) return true;
  const code = (err as NodeJS.ErrnoException).code;
  if (code === "ERR_REQUIRE_ASYNC_MODULE") return true;
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
 * This is the single load+validate path the runtime trusts: a gate's
 * validation load and a tick's own resolution refuse on exactly the same
 * shapes, so a `chain.ts` that clears the gate is one the next process can
 * run. A second load+validate spelled beside this one is a self-edit reverted
 * on a rule this path does not hold, or shipped past one it does.
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
  // (src/paths.ts) is that computation, shared with the sibling surface that
  // names the same file: `chainLoadGate`'s touched-path key.
  const path = chainModulePath(paths.configDir);
  // win32 MAX_PATH: the single fix point for this check, because every path
  // into an existing chain.ts runs this probe first. namespacedJoin
  // (src/paths.ts) is the shared idiom.
  // Absent is the only silent reading: `existsLoud` (src/fsProbe.ts) throws
  // on any other stat failure rather than reporting absence, so a chain.ts
  // that is present but unreachable — a symlink loop, a permission-denied
  // configDir — names that failure instead of telling the operator to create
  // a file they are looking at.
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

  // `tsImport` hands the module back in either shape — `__esModule` set with
  // the factory under a second `default`, or the factory as `ns.default`
  // directly — and which one is not read off the module in hand
  // (`.claude/rules/platform-facts.md`, *tsx decides a module's interop shape
  // from the nearest `package.json` `type`*). Both are normalized here because keying on
  // one would refuse a chain the other spelling loads fine.
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
  validatePendingDirDeclaration(chain);
  validateSupervisorPolicyDeclaration(chain);
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
