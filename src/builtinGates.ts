/**
 * builtinGates — the gates everyone reaches for. Lifted from
 * `examples/cascade-chain.ts` once their shape stabilized.
 *
 * The set is intentionally small. `shellGate` is the escape hatch for any
 * project-specific check; promote new gates here only when ≥2 chains want them.
 */

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { promisify } from "node:util";

import type { Gate, GateContext, GateResult, GatePhase } from "./Gate.js";
import type { Phase } from "./Phase.js";
// Intentional cycle: Dispatcher imports `writablePathsGate` from here.
// Both sides reference the imported symbol only inside function bodies, never
// at module top-level, so ESM live bindings resolve cleanly. `chainLoadGate`
// validates through the exact load path the runtime uses so the gate's
// verdict can never disagree with what the next tick's resolution would do.
import { loadChainModule } from "./Dispatcher.js";
import { entryWriteScopeUnion, matchesAny } from "./paths.js";
import {
  parsePending,
  declaredPaths,
  type EntryExtension,
  type PendingEntry,
} from "./PendingSchema.js";

const exec = promisify(execFile);

/**
 * execFile with a Windows shim fallback. Package-manager binaries (pnpm,
 * npm) are .cmd shims on Windows, which Node refuses to spawn without a
 * shell (CVE-2024-27980 hardening). A direct spawn is tried first so args
 * keep exact quoting semantics; only a win32 ENOENT — the shim case, where
 * gate args are chain-authored flags — retries through the shell.
 */
async function execGate(
  cmd: string,
  args: string[],
  opts: { cwd: string; maxBuffer: number; env?: NodeJS.ProcessEnv },
): Promise<{ stdout: string; stderr: string }> {
  try {
    return await exec(cmd, args, opts);
  } catch (err) {
    if (
      process.platform === "win32" &&
      (err as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return await exec(cmd, args, { ...opts, shell: true });
    }
    throw err;
  }
}

/**
 * Inputs for `shellGate`. The gate spawns `cmd` with `args` in the
 * worktree's cwd; non-zero exit = fail. `failHint` is the message surfaced
 * to the dispatcher on failure (and embedded in the next agent prompt's
 * gate-failure context).
 */
export interface ShellGateOptions {
  name: string;
  when: GatePhase;
  cmd: string;
  args: string[];
  /** Maximum bytes captured from stdout+stderr. Default 16 MiB. */
  maxBuffer?: number;
  /** Hint surfaced when the gate fails. Defaults to "<name> failed". */
  failHint?: string;
  /**
   * Merged over `process.env` for the spawned command. Lets a chain inject
   * or override a var (e.g. a test-only flag, a scrubbed secret) without
   * hand-forking `shellGate` to rebuild its exec plumbing. Omit-behavior is
   * pinned by tests/Gate.test.ts's "without env, behavior is byte-identical
   * to today" case.
   */
  env?: Record<string, string>;
}

/**
 * Generic gate that shells out and reports green/fail by exit code.
 * Captures stdout+stderr up to `maxBuffer` (default 16 MiB) and surfaces
 * them as `GateResult.details` so the dispatcher can route them to the
 * logger or back to the agent as context on the next tick.
 */
export function shellGate(opts: ShellGateOptions): Gate {
  return {
    name: opts.name,
    when: opts.when,
    async run(ctx: GateContext): Promise<GateResult> {
      try {
        const { stdout, stderr } = await execGate(opts.cmd, opts.args, {
          cwd: ctx.cwd,
          maxBuffer: opts.maxBuffer ?? 16 * 1024 * 1024,
          ...(opts.env ? { env: { ...process.env, ...opts.env } } : {}),
        });
        return {
          ok: true,
          message: `${opts.name} green`,
          details: stdout || stderr,
        };
      } catch (err) {
        const e = err as { stdout?: string; stderr?: string; message: string };
        return {
          ok: false,
          message: opts.failHint ?? `${opts.name} failed`,
          details: (e.stderr ?? "") + (e.stdout ?? "") || e.message,
        };
      }
    },
  };
}

/**
 * Package-manager override accepted by `tscGate`, `vitestGate`, and
 * `eslintGate`. The chain supplies which binary (and, since args stay
 * pnpm-shaped otherwise, which args) runs the check; the engine supplies the
 * enforcement (engine-boundary.md "Capability vs convention"). `cmd` alone is
 * only safe for a pnpm-args-compatible binary (e.g. yarn classic); npm's own
 * verb grammar has no bare `npm tsc --noEmit` — it needs `args: ["exec",
 * "--", "tsc", "--noEmit"]`. Omit both for pnpm — byte-identical to before
 * this option existed.
 */
export interface PkgManagerOverride {
  cmd?: string;
  args?: string[];
}

/**
 * A builtin language gate doubles as its own factory. Used bare (e.g.
 * `gates: [tscGate]`) it *is* the pnpm-flavored `Gate`, so every existing
 * call site that drops these straight into a `gates: []` array keeps
 * compiling unchanged. Called (`tscGate({ cmd: "npm", args: ["exec", "--",
 * "tsc", "--noEmit"] })`) it returns the identical check run through a
 * different package-manager binary and arg shape — the injection point a
 * non-pnpm chain needs without hand-rolling `shellGate` from scratch.
 */
export interface PkgManagerGate extends Gate {
  (override?: PkgManagerOverride): Gate;
}

function pkgManagerGate(
  name: string,
  args: string[],
  failHint: string,
): PkgManagerGate {
  const build = (cmd: string, gateArgs: string[]): Gate =>
    shellGate({ name, when: "afterCommit", cmd, args: gateArgs, failHint });
  const defaultGate = build("pnpm", args);
  const fn = ((override) =>
    build(override?.cmd ?? "pnpm", override?.args ?? args)) as PkgManagerGate;
  Object.defineProperty(fn, "name", {
    value: defaultGate.name,
    configurable: true,
  });
  fn.when = defaultGate.when;
  fn.run = defaultGate.run;
  return fn;
}

/**
 * `pnpm tsc --noEmit` after the agent's commit. Catches type errors before
 * the commit ships; on failure the dispatcher drops the commit and the
 * pending entry stays in queue for the next tick. Call with `{ cmd, args }`
 * to run a different package manager's `tsc --noEmit` — e.g. npm needs
 * `{ cmd: "npm", args: ["exec", "--", "tsc", "--noEmit"] }`.
 */
export const tscGate: PkgManagerGate = pkgManagerGate(
  "tsc",
  ["tsc", "--noEmit"],
  "TypeScript errors — commit reverted",
);

/**
 * `pnpm test --run` (vitest non-watch) after the agent's commit. A red
 * suite reverts the commit; pair with `tscGate` (run first) so type errors
 * are caught before vitest even attempts to load the changed module. Call
 * with `{ cmd, args }` to run a different package manager's `test --run`.
 */
export const vitestGate: PkgManagerGate = pkgManagerGate(
  "vitest",
  ["test", "--run"],
  "Tests failed — commit reverted",
);

/**
 * `pnpm lint` (ESLint) after the agent's commit. Opt-in: only meaningful
 * for chains that wire `scripts.lint` in their `package.json`. Failures
 * revert the commit just like the other afterCommit gates. Call with
 * `{ cmd, args }` to run a different package manager's `lint`.
 */
export const eslintGate: PkgManagerGate = pkgManagerGate(
  "eslint",
  ["lint"],
  "Lint errors — commit reverted",
);

/**
 * A commit's touched paths, shared across every gate that needs them.
 * `ctx.touchedPaths` is the dispatcher's one-per-commit computation
 * (`git.showNameOnly`, run once before the gate loop); a gate reads it from
 * there instead of shelling `git show --name-only` out itself. Falls back to
 * that same exec only for hand-built `GateContext` fixtures that predate the
 * field (tests, mainly) — never for a dispatcher-constructed context, which
 * always sets it.
 */
async function resolveTouchedPaths(ctx: GateContext): Promise<string[]> {
  if (ctx.touchedPaths) return ctx.touchedPaths;
  const { stdout } = await exec(
    "git",
    ["show", "--name-only", "--pretty=format:", ctx.commitSha!],
    { cwd: ctx.cwd },
  );
  return stdout.split("\n").filter((l) => l.length > 0);
}

/**
 * Builtin chain-load gate. Declared by any chain on the phase(s) that may
 * rewrite `<configDir>/chain.ts` (a self-modifying loop; default `configDir`
 * is `<repoRoot>/.flume`, relocatable via `FLUME_CONFIG_DIR`, spec/cli.md
 * "State-root and config-dir resolution"). On a commit that touched
 * `chain.ts`, it loads the post-commit file through the same load+validate
 * path the runtime uses (`loadChainModule`): the default export resolves and
 * `phases` is an array. A broken rewrite (syntax error, no default export, no
 * `phases[]`) fails the gate → flume's existing revert path drops the commit
 * → `chain.ts` returns to the last-good version → the loop continues against
 * a chain that still loads.
 *
 * `ctx.configDir` is read directly rather than assumed — it is already
 * rebased onto `ctx.cwd` by the dispatcher when the gate runs inside a fanout
 * worktree, so the touched-path check and the load both key off the same
 * relocatable dir (`.claude/rules/engine-boundary.md` "Told, not inferred").
 *
 * No-op on the overwhelming majority of ticks (the commit didn't touch
 * `chain.ts`). Promoted to a builtin — not chain-local like the pending-parse
 * gate — because `chain.ts` is universal to every flume project (pending.json
 * is specific to a plan/build chain).
 */
export const chainLoadGate: Gate = {
  name: "chain-load",
  when: "afterCommit",
  async run(ctx: GateContext): Promise<GateResult> {
    if (!ctx.commitSha) {
      return { ok: false, message: "chain-load gate requires commitSha" };
    }
    const touched = await resolveTouchedPaths(ctx);
    const configDirRel = relative(ctx.repoRoot, ctx.configDir);
    const chainRelPath = join(configDirRel, "chain.ts")
      .split(/[\\/]/)
      .join("/");
    if (!touched.includes(chainRelPath)) {
      return { ok: true, message: "chain.ts untouched — gate skipped" };
    }
    try {
      await loadChainModule(join(ctx.configDir, "chain.ts"));
      return { ok: true, message: "chain.ts loads as a valid Chain" };
    } catch (err) {
      return {
        ok: false,
        message: "chain.ts is broken — commit reverted",
        details: (err as Error).message,
      };
    }
  },
};

/**
 * Inputs for `pendingGate` (v0.8 §6).
 */
export interface PendingGateOptions {
  /**
   * Chain-declared entry extension (§2) — the same declaration passed to
   * `renderSchemaForPrompt` for the plan prompt, so this gate's validation
   * and the prompt's schema block cannot drift. Omitted validates the bare
   * engine core.
   */
  extension?: EntryExtension;
  /**
   * flumeDir-relative path to the pending list. Default `plan/pending.json`
   * — the universal plan/build convention. Override for a chain that
   * attaches this gate to a differently-shaped producer phase.
   */
  pendingPath?: string;
  /**
   * The fence every entry's declared `files` must survive: the downstream
   * phase that will build this queue, typically passed as the phase value
   * itself (`{ writablePaths, entryChannelPaths }` is all this gate reads).
   */
  targetFence: Pick<Phase, "writablePaths" | "entryChannelPaths">;
  /**
   * Which entries the fence pre-check applies to. Default `() => true` —
   * every entry is fence-checked, matching pre-fenceWhen behavior exactly.
   * A chain that exempts park-exempt `gate.kind` values (e.g. `"parked"`,
   * `"deferred"`) from the build fence supplies a predicate here; the
   * engine ships the injection point, the chain owns which `gate.kind`
   * values count as park-exempt (engine-boundary.md's mechanism-vs-
   * convention test).
   */
  fenceWhen?: (entry: PendingEntry) => boolean;
  /**
   * Chain-authored operator guidance appended verbatim to both violation
   * messages (schema and fence). The chain supplies the text, the engine
   * supplies the enforcement — the same capability/convention split as
   * `failHint` on `shellGate` (engine-boundary.md "Capability vs
   * convention"). Omit for byte-identical behavior to before this option
   * existed.
   */
  hint?: string;
}

/**
 * Builtin opt-in gate (v0.8 §6): validates the pending list against the
 * composed core+extension schema (§2) at commit time of whichever phase the
 * chain attaches it to, then pre-checks every entry's declared `files`
 * against `targetFence.writablePaths ∪ targetFence.entryChannelPaths`. An
 * entry whose declaration cannot survive that fence fails here, naming the
 * offending paths, instead of shipping through plan and burning a build
 * tick on a guaranteed revert: an entry declaring a file outside the
 * downstream phase's fence is caught at plan's own commit, never handed to
 * build as unshippable work.
 */
export function pendingGate(opts: PendingGateOptions): Gate {
  const pendingPath = opts.pendingPath ?? join("plan", "pending.json");
  const fenceWhen = opts.fenceWhen ?? (() => true);
  const withHint = (message: string): string =>
    opts.hint ? `${message} — ${opts.hint}` : message;
  return {
    name: "pending-gate",
    when: "afterCommit",
    async run(ctx: GateContext): Promise<GateResult> {
      // Read fresh on every run — not hoisted to construction — so a
      // declaration-driven fence (e.g. a Phase whose writablePaths/
      // entryChannelPaths are populated after pendingGate(...) is called,
      // such as a getter backed by a per-job declaration.json) is
      // pre-checked against its current value, not a stale snapshot from
      // module load.
      const fence = [
        ...opts.targetFence.writablePaths,
        ...(opts.targetFence.entryChannelPaths ?? []),
      ];
      let raw: string;
      try {
        raw = await readFile(join(ctx.flumeDir, pendingPath), "utf8");
      } catch {
        return {
          ok: false,
          message: `${pendingPath} missing after commit`,
        };
      }
      const parsed = parsePending(raw, opts.extension);
      if (!parsed.ok) {
        return {
          ok: false,
          message: withHint(
            `${pendingPath} has ${parsed.errors.length} schema violation(s)`,
          ),
          details: parsed.errors
            .map((e) => `  [${e.index}] ${e.path}: ${e.message}`)
            .join("\n"),
        };
      }
      const violations = parsed.entries
        .filter((entry) => fenceWhen(entry))
        .map((entry) => ({
          tag: entry.tag,
          offending: declaredPaths(entry).filter((p) => !matchesAny(p, fence)),
        }))
        .filter((v) => v.offending.length > 0);
      if (violations.length > 0) {
        return {
          ok: false,
          message: withHint(
            `${violations.length} pending entr${
              violations.length === 1 ? "y" : "ies"
            } declare files outside the target fence`,
          ),
          details: violations
            .map(
              (v) =>
                `  [${v.tag}] ${v.offending.join(", ")} (outside targetFence writablePaths ∪ entryChannelPaths)`,
            )
            .join("\n"),
        };
      }
      return {
        ok: true,
        message: `${pendingPath} valid (${parsed.entries.length} entries), fence pre-check passed`,
      };
    },
  };
}

/**
 * Entry scope for a fanout tick carrying an assignedEntry (RELEASE-v0.4 §5).
 * When present, the write allowance narrows to `entryPaths ∪ channelPaths`;
 * the phase globs remain the outer ceiling — both checks apply.
 */
interface EntryWriteScope {
  /** Literal paths the assigned entry declares (`files.{new,edit,retire}`). */
  entryPaths: string[];
  /** `Phase.entryChannelPaths` globs — always in scope on a scoped tick. */
  channelPaths: string[];
}

/**
 * Verify the commit's diff stays inside the phase's declared writablePaths —
 * and, when `entryScope` is given (fanout tick with an assignedEntry), also
 * inside the entry's declared files ∪ the phase's channel globs. Constructed
 * at runtime by the dispatcher because it needs the path globs.
 *
 * Implementation note: we don't ship this as a static export because it
 * depends on the phase config. The dispatcher attaches it automatically.
 */
export function writablePathsGate(
  globs: string[],
  entryScope?: EntryWriteScope,
): Gate {
  return {
    name: "writable-paths",
    when: "afterCommit",
    async run(ctx) {
      if (!ctx.commitSha) {
        return {
          ok: false,
          message: "writable-paths gate requires commitSha",
        };
      }
      const touched = await resolveTouchedPaths(ctx);
      // Ceiling check: phase-wide globs bind on every tick, scoped or not.
      const outsideCeiling = touched.filter((p) => !matchesAny(p, globs));
      // Entry-scope check: a scoped tick's allowance is the entry's declared
      // paths ∪ the channel globs, sourced from the same `entryWriteScopeUnion`
      // helper `effectiveFenceLines` (`src/Prompt.ts`) renders for the agent.
      // Literal paths pass through the same glob matcher (specials are
      // escaped, so a literal matches only itself).
      const outsideScope = entryScope
        ? (() => {
            const scope = entryWriteScopeUnion(
              entryScope.entryPaths,
              entryScope.channelPaths,
            );
            return touched.filter(
              (p) => matchesAny(p, globs) && !matchesAny(p, scope),
            );
          })()
        : [];
      if (outsideCeiling.length === 0 && outsideScope.length === 0) {
        return { ok: true, message: "writable paths respected" };
      }
      const lines = [
        ...outsideCeiling.map(
          (p) => `  - ${p}` + (entryScope ? " (outside phase writablePaths)" : ""),
        ),
        ...outsideScope.map(
          (p) =>
            `  - ${p} (inside phase writablePaths but outside the assigned entry's declared files ∪ entryChannelPaths)`,
        ),
      ];
      const total = outsideCeiling.length + outsideScope.length;
      return {
        ok: false,
        message: `commit touched ${total} path(s) outside ${
          entryScope ? "the entry-scoped write allowance" : "writablePaths"
        }`,
        details: lines.join("\n"),
      };
    },
  };
}
