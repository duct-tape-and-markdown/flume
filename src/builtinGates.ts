/**
 * builtinGates — the gates everyone reaches for. Lifted from
 * `examples/cascade-chain.ts` once their shape stabilized.
 *
 * The set is intentionally small. `shellGate` is the escape hatch for any
 * project-specific check; promote new gates here only when ≥2 chains want them.
 */

import { join, relative } from "node:path";

import type { Gate, GateContext, GateResult, GatePhase } from "./Gate.js";
import type { Phase } from "./Phase.js";
import { EntryClaimStore, entryClaimSlug } from "./entryClaims.js";
// `chainLoadGate` validates through the exact load path the runtime uses, so
// the gate's verdict can never disagree with what the next tick's resolution
// would do.
import { loadChainModule } from "./chainLoad.js";
import {
  chainModulePath,
  gitPath,
  matchesAny,
  queueFenceViolations,
} from "./paths.js";
import { readQueueAtRef, readQueueOnDisk } from "./pendingLedger.js";
import { execFileWithShimRetry } from "./spawnShim.js";
import {
  entryTagFromFileName,
  parsePendingQueue,
  type EntryExtension,
  type PendingEntry,
  type QueueFile,
} from "./PendingSchema.js";

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
   * pinned by tests/Gate.test.ts's "omitting env leaves the spawned
   * environment untouched (no forced var leaks in)" case.
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
    command: [opts.cmd, ...opts.args].join(" "),
    async run(ctx: GateContext): Promise<GateResult> {
      try {
        // A gate's cmd is whatever binary the chain named, so the spawn
        // takes the shared shim retry (`src/spawnShim.ts`) — gate args are
        // chain-authored flags, which is the quoting tradeoff that buys.
        const { stdout, stderr } = await execFileWithShimRetry(
          opts.cmd,
          opts.args,
          {
            cwd: ctx.cwd,
            maxBuffer: opts.maxBuffer ?? 16 * 1024 * 1024,
            ...(opts.env ? { env: { ...process.env, ...opts.env } } : {}),
          },
        );
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
 * enforcement (.claude/rules/engine-boundary.md "Capability vs convention").
 * `cmd` alone is only safe for a pnpm-args-compatible binary (e.g. yarn
 * classic); npm's own verb grammar has no bare `npm tsc --noEmit` — it needs
 * `args: ["exec", "--", "tsc", "--noEmit"]`. Omit both for pnpm —
 * byte-identical to before this option existed.
 *
 * `when` is the same injection point for gate placement, which is
 * chain-authoring doctrine and not the engine's to fix (spec/chain.md "Gate
 * placement is the chain's decision"): a chain that wants the same check over
 * the merged tree says `when: "afterMerge"` instead of copying the builtin's
 * own `cmd`/`args` into a hand-rolled `shellGate`
 * (.claude/rules/engine-boundary.md "Surface, not prescription" — verbatim
 * copying is the detector). Omitted stays `afterCommit`.
 */
export interface PkgManagerOverride {
  cmd?: string;
  args?: string[];
  when?: GatePhase;
}

/**
 * A builtin language gate doubles as its own factory. Used bare (e.g.
 * `gates: [tscGate]`) it *is* the pnpm-flavored `Gate`, so every existing
 * call site that drops these straight into a `gates: []` array keeps
 * compiling unchanged. Called (`tscGate({ cmd: "npm", args: ["exec", "--",
 * "tsc", "--noEmit"] })`) it returns the identical check run through a
 * different package-manager binary, arg shape, or gate point — the injection
 * point a non-pnpm chain (or one gating the merged tree) needs without
 * hand-rolling `shellGate` from scratch.
 */
export interface PkgManagerGate extends Gate {
  (override?: PkgManagerOverride): Gate;
}

function pkgManagerGate(
  name: string,
  args: string[],
  failHint: string,
): PkgManagerGate {
  const build = (cmd: string, gateArgs: string[], when: GatePhase): Gate =>
    shellGate({ name, when, cmd, args: gateArgs, failHint });
  const defaultGate = build("pnpm", args, "afterCommit");
  const fn = ((override) =>
    build(
      override?.cmd ?? "pnpm",
      override?.args ?? args,
      override?.when ?? "afterCommit",
    )) as PkgManagerGate;
  Object.defineProperty(fn, "name", {
    value: defaultGate.name,
    configurable: true,
  });
  fn.when = defaultGate.when;
  fn.run = defaultGate.run;
  fn.command = defaultGate.command!;
  return fn;
}

/**
 * `pnpm tsc --noEmit` after the agent's commit. Catches type errors before
 * the commit ships; on failure the dispatcher drops the commit and the
 * pending entry stays in queue for the next tick. Call with `{ cmd, args }`
 * to run a different package manager's `tsc --noEmit` — e.g. npm needs
 * `{ cmd: "npm", args: ["exec", "--", "tsc", "--noEmit"] }` — or with
 * `{ when }` to place the same check at the other gate point.
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
 * with `{ cmd, args }` to run a different package manager's `test --run`, or
 * with `{ when }` to place it at the other gate point.
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
 * `{ cmd, args }` to run a different package manager's `lint`, or with
 * `{ when }` to place it at the other gate point.
 */
export const eslintGate: PkgManagerGate = pkgManagerGate(
  "eslint",
  ["lint"],
  "Lint errors — commit reverted",
);

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
 * gate — because `chain.ts` is universal to every flume project (the queue
 * is specific to a plan/build chain).
 */
export const chainLoadGate: Gate = {
  name: "chain-load",
  when: "afterCommit",
  async run(ctx: GateContext): Promise<GateResult> {
    const touched = ctx.touchedPaths;
    // The touched-path key is the file `loadChainModule` will resolve from
    // this same `configDir`, made repo-relative and posix-slashed to match
    // the commit's own path list. Both derivations are shared
    // (`chainModulePath` and `gitPath`, src/paths.ts): a key spelled here
    // could diverge from what the loader reads, and this gate's divergence is
    // the silent one — it would report `skipped` over the very commit that
    // broke the chain.
    const chainRelPath = gitPath(
      relative(ctx.repoRoot, chainModulePath(ctx.configDir)),
    );
    if (!touched.includes(chainRelPath)) {
      // Vacuous by design, and spelled as such: nothing loaded, so the green
      // is declared on `skipped` rather than left for a reader to pattern-
      // match out of `message` (spec/chain.md "What a gate returns").
      return {
        ok: true,
        message: "chain-load skipped",
        skipped: `${chainRelPath} untouched by this commit`,
      };
    }
    try {
      // Declared divergence: under `afterCommit` these three roots do not
      // describe one tree — `repoRoot` is the tick's ephemeral worktree
      // while `flumeDir` is the primary checkout's state root, which the
      // worktree lives *inside* (spec/chain.md, "What a gate receives").
      // That is the right pair here: the gate validates the committed
      // chain in the worktree, and a `FlumeApi` built for a validation load
      // must still name the state root a real tick would run against.
      await loadChainModule({
        repoRoot: ctx.repoRoot,
        configDir: ctx.configDir,
        flumeDir: ctx.flumeDir,
      });
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
 * Inputs for `pendingGate`.
 */
export interface PendingGateOptions {
  /**
   * Chain-declared entry extension — the same declaration passed to
   * `renderSchemaForPrompt` for the plan prompt, so this gate's validation and
   * the prompt's schema block cannot drift. Omitted validates the bare engine
   * core.
   */
  extension?: EntryExtension;
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
   * values count as park-exempt (.claude/rules/engine-boundary.md's
   * mechanism-vs-convention test).
   */
  fenceWhen?: (entry: PendingEntry) => boolean;
  /**
   * Chain-authored operator guidance appended verbatim to both violation
   * messages (schema and fence). The chain supplies the text, the engine
   * supplies the enforcement — the same capability/convention split as
   * `failHint` on `shellGate` (.claude/rules/engine-boundary.md "Capability
   * vs convention"). Omit for byte-identical behavior to before this option
   * existed.
   */
  hint?: string;
  /**
   * Where in the lifecycle the gate runs. Defaults to `afterCommit`, the
   * placement `spec/pending.md` describes and the one the fence pre-check
   * wants: an entry declaring a path outside the consumer's fence is caught
   * in the producer's own worktree, where the revert costs a tick and
   * nothing on trunk.
   *
   * `afterMerge` is the placement the **claim check** wants, and is why the
   * knob exists rather than the chain hand-rolling a second gate: a
   * concurrent build tick can stake a claim between the producer's commit
   * and its cherry-pick, so a read taken in the worktree answers about a
   * tree the collision is not in. Placement is the chain's decision, the
   * same injection point {@link PkgManagerOverride} carries for the
   * shell-backed builtins (spec/chain.md, *Gate placement is the chain's
   * decision*); a chain that wants both placements attaches two.
   */
  when?: GatePhase;
}

/**
 * Builtin opt-in gate: validates the pending list against the composed
 * core+extension schema at commit time of whichever phase the chain attaches
 * it to, then pre-checks every entry's declared `files` against
 * `targetFence.writablePaths ∪ targetFence.entryChannelPaths`. An entry whose
 * declaration cannot survive that fence fails here, naming the offending
 * paths, instead of shipping through plan and burning a build tick on a
 * guaranteed revert: an entry declaring a file outside the downstream phase's
 * fence is caught at plan's own commit, never handed to build as unshippable
 * work.
 *
 * Third, the **claim check**: an entry a concurrent tick holds a claim on
 * (`spec/pending.md`, *Claims — an entry in flight is left alone*) is left
 * byte-identical by the gated commit, or the commit is refused naming the
 * entry and its holder. `opts.when` is what a chain places that check where
 * it bites — see the option.
 */
export function pendingGate(opts: PendingGateOptions): Gate {
  const fenceWhen = opts.fenceWhen ?? (() => true);
  const withHint = (message: string): string =>
    opts.hint ? `${message} — ${opts.hint}` : message;
  return {
    name: "pending-gate",
    when: opts.when ?? "afterCommit",
    async run(ctx: GateContext): Promise<GateResult> {
      // spec/pending.md "The pending queue": `ctx.pendingDir` is the one
      // resolved value (`Chain.pendingDir ?? "plan/pending"`, absolute,
      // under `ctx.flumeDir`) — the gate and the dispatcher can no longer
      // check two different queues. `displayPath` is only for messages:
      // flumeDir-relative, matching the pre-`ctx.pendingDir` text.
      const displayPath = relative(ctx.flumeDir, ctx.pendingDir);
      // spec/pending.md "Dispatch reads come from the tip, not the tree":
      // the gate judges the commit it is attached to, not whatever the
      // working tree happens to hold — a disk read here would see trunk's
      // queue even while gating a commit that hasn't merged to trunk yet
      // (`.claude/rules/engineering.md` "Loud or nothing").
      // `readQueueAtRef` (`src/pendingLedger.ts`) resolves the queue
      // directory as of `ctx.commitSha` instead — keyed by `ctx.stateRootRel`,
      // the state root's offset from the *primary* repo root (spec/chain.md
      // "What a gate receives"), not by rebasing `ctx.flumeDir` onto
      // `ctx.repoRoot`: under `afterCommit` `ctx.repoRoot` is a worktree that
      // mirrors the primary checkout's tracked layout at that same offset,
      // while `ctx.flumeDir` is the primary checkout's own state root and is
      // never nested under the worktree — `relative(ctx.repoRoot,
      // ctx.flumeDir)` climbs out through the worktree root regardless of
      // whether the state root is actually relocated, misreading every real
      // afterCommit tick as relocated and falling back to the primary
      // checkout's on-disk (pre-commit) copy. Absent `stateRootRel` (a
      // genuinely relocated state root) has no shared tracked history to read
      // the gated commit's copy from, so it stays the disk read.
      //
      // The offset and the queue's own leg are joined and folded once, here,
      // rather than at each of the two readers below: `relative` answers in
      // the host's dialect and every consumer of this value hands it to git
      // — a tree listing at a ref, a touched-path comparison — where a
      // backslash matches nothing (`.claude/rules/posture-sweep.md`, *A
      // repo-relative path composed with `node:path`*).
      const queueDirRel =
        ctx.stateRootRel === undefined
          ? undefined
          : gitPath(join(ctx.stateRootRel, displayPath));
      let files: QueueFile[] | null;
      if (queueDirRel === undefined) {
        try {
          files = readQueueOnDisk(ctx.pendingDir);
        } catch {
          files = null;
        }
      } else {
        files = await readQueueAtRef(ctx.repoRoot, ctx.commitSha, queueDirRel);
      }
      if (files === null) {
        return { ok: false, message: `${displayPath} missing after commit` };
      }
      const parsed = parsePendingQueue(files, opts.extension);
      if (!parsed.ok) {
        return {
          ok: false,
          message: withHint(
            `${displayPath} has ${parsed.errors.length} schema violation(s)`,
          ),
          details: parsed.errors
            .map((e) => `  [${e.file}] ${e.path}: ${e.message}`)
            .join("\n"),
        };
      }
      // `fenceWhen` is this gate's alone — which entries are submitted, not
      // how they are judged. The judgment is the shared derivation
      // (`queueFenceViolations`, `src/paths.ts`), which `flume check` reads
      // too, so the gate and the verb can never name different offending
      // paths for one queue. `opts.targetFence` is dereferenced here rather
      // than at construction, so a declaration-driven fence (a Phase whose
      // writablePaths/entryChannelPaths are populated after
      // `pendingGate(...)` is called, e.g. a getter backed by a
      // declaration read off disk) is pre-checked against its current value,
      // not a stale snapshot from module load.
      const violations = queueFenceViolations(
        parsed.entries.filter((entry) => fenceWhen(entry)),
        [opts.targetFence],
      );
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
      // spec/pending.md, *Claims — an entry in flight is left alone*: while a
      // build tick holds an entry, that entry's file is left byte-identical
      // or this commit is refused naming both. A re-scope that lands anyway
      // pulls the rug from under a wave already building the entry as it was.
      //
      // The subject is the gated span's diff, so "byte-identical" is git's
      // verdict and not a comparison composed here: a path absent from
      // `touchedPaths` is one the span did not change, and an edit and a
      // removal arrive the same way. A relocated state root puts the queue
      // where no commit can name it (`queueDirRel` absent), so no touched
      // path is an entry file and the check has nothing to judge.
      const touchedEntries = touchedEntryFiles(ctx, queueDirRel);
      if (touchedEntries.length > 0) {
        // Read only behind a touched entry file: the claims walk costs a
        // `rev-parse` and a listing, and a phase whose fence never admits the
        // queue — build's — pays neither.
        const holders = await new EntryClaimStore(ctx.repoRoot).readHolders();
        const held = touchedEntries.flatMap(({ path, tag }) => {
          const by = holders.get(entryClaimSlug(tag));
          return by === undefined
            ? []
            : [`  [${tag}] ${path} is claimed by pid ${by.pid}`];
        });
        if (held.length > 0) {
          return {
            ok: false,
            message: withHint(
              `this commit changes ${held.length} entr${
                held.length === 1 ? "y" : "ies"
              } another tick holds a claim on`,
            ),
            details: held.join("\n"),
          };
        }
      }
      return {
        ok: true,
        message: `${displayPath} valid (${parsed.entries.length} entries), fence pre-check passed`,
      };
    },
  };
}

/**
 * The entry files the gated span changed, each paired with the tag its name
 * claims — the claim check's subject.
 *
 * The listing rule is the queue's own (`spec/pending.md`, *The ledger is a
 * directory — one entry per file*): every `<tag>.json` **directly** under the
 * queue directory is an entry and nothing else is, so a sidecar in a
 * subdirectory is not read as work here any more than it is by the read that
 * dispatches. The tag comes back through `entryFileName`'s own inverse
 * ({@link entryTagFromFileName}) rather than a `.json` strip spelled here,
 * which is the second copy of the naming rule the parse already enforces
 * both directions on.
 *
 * Off the touched paths rather than the parsed queue, because a **removal**
 * is the collision that matters most and a removed entry is in no listing
 * left to parse.
 */
function touchedEntryFiles(
  ctx: GateContext,
  queueDirRel: string | undefined,
): { readonly path: string; readonly tag: string }[] {
  if (queueDirRel === undefined) return [];
  const prefix = `${queueDirRel}/`;
  return ctx.touchedPaths.flatMap((path) => {
    if (!path.startsWith(prefix)) return [];
    const file = path.slice(prefix.length);
    if (file.includes("/")) return [];
    const tag = entryTagFromFileName(file);
    return tag === null ? [] : [{ path, tag }];
  });
}

/**
 * Verify the commit's diff stays inside the phase's declared writablePaths —
 * and, when `entryScope` is given, also inside that narrower allowance. The
 * phase globs remain the outer ceiling; both checks apply. Constructed at
 * runtime by the dispatcher because it needs the path globs.
 *
 * `entryScope` is whatever `entryWriteScope` (`src/paths.ts`) returned for
 * this tick — the same value `effectiveFenceLines` (`src/Prompt.ts`)
 * rendered to the agent, already resolved to `entry.files ∪
 * entryChannelPaths`. The gate never re-decides whether a tick is scoped and
 * never rebuilds the union: `undefined` here *is* an unscoped tick.
 *
 * A refusal names its violating paths on `GateResult.failingFiles` as well as
 * in `details` prose. Those paths are by construction a subset of the span's
 * own footprint, so the dispatcher's disjointness check never marks a
 * writable-paths revert a suspect flake.
 *
 * Implementation note: we don't ship this as a static export because it
 * depends on the phase config. The dispatcher attaches it automatically.
 */
export function writablePathsGate(
  globs: string[],
  entryScope?: string[],
): Gate {
  return {
    name: "writable-paths",
    when: "afterCommit",
    async run(ctx) {
      const touched = ctx.touchedPaths;
      // Ceiling check: phase-wide globs bind on every tick, scoped or not.
      const outsideCeiling = touched.filter((p) => !matchesAny(p, globs));
      // Entry-scope check, against the scope as handed in — the same array
      // `effectiveFenceLines` (`src/Prompt.ts`) rendered for the agent.
      // Literal paths pass through the same glob matcher (specials are
      // escaped, so a literal matches only itself).
      const outsideScope = entryScope
        ? touched.filter(
            (p) => matchesAny(p, globs) && !matchesAny(p, entryScope),
          )
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
      // The two sets the refusal was computed from, reported as paths rather
      // than spent on prose alone (`.claude/rules/engineering.md` "A fact the
      // engine holds is reported, never rediscovered"): a chain reading the
      // verdict row or a prior-attempt record gets the violating paths as a
      // list, never by re-parsing `details`. Same order and same membership
      // as `lines` above — the prose is the rendering of this list, not a
      // second derivation of it.
      const violating = [...outsideCeiling, ...outsideScope];
      return {
        ok: false,
        message: `commit touched ${violating.length} path(s) outside ${
          entryScope ? "the entry-scoped write allowance" : "writablePaths"
        }`,
        details: lines.join("\n"),
        failingFiles: violating,
      };
    },
  };
}
