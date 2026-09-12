import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { RUNTIME_IGNORES } from "../src/job.ts";
import type { Phase } from "../src/Phase.ts";
import type { PendingEntry } from "../src/PendingSchema.ts";
import {
  entryWriteScope,
  entryWriteScopeUnion,
  matchesAny,
  queueFenceViolations,
  STATE_ROOT_NAMES,
  tickVerdictPath,
  tickVerdictsLogPath,
  worktreesBase,
} from "../src/paths.ts";

// The win32 MAX_PATH idiom (`toNamespacedPath(join(...))`) is pinned by
// source scan in tests/Baton.test.ts, not here: `namespacedJoin` *is* that
// expression, so any test comparing the two asserts the body against itself
// and cannot go red. See .claude/rules/platform-facts.md, "Windows MAX_PATH".

// Mechanism pin (ENTRYWRITESCOPE-SHARED-UNION, per
// .claude/rules/engineering.md "Derived state is computed, never restated
// beside its source"): `effectiveFenceLines` (src/Prompt.ts) and
// `writablePathsGate` (src/builtinGates.ts) used to each spread
// `entryPaths ∪ channelPaths` independently. This pins the shared union
// helper's own behavior — dedup and both-empty-array shapes — so a future
// one-sided edit to one call site can't silently diverge from the other's
// union without also failing here.
describe("entryWriteScopeUnion — entry.files ∪ entryChannelPaths, shared", () => {
  it("dedups entries that appear in both entryPaths and channelPaths", () => {
    expect(
      entryWriteScopeUnion(
        ["src/a.ts", "src/b.ts"],
        ["src/b.ts", "notes/**"],
      ),
    ).toEqual(["src/a.ts", "src/b.ts", "notes/**"]);
  });

  it("dedups duplicates within entryPaths alone", () => {
    expect(entryWriteScopeUnion(["src/a.ts", "src/a.ts"], [])).toEqual([
      "src/a.ts",
    ]);
  });

  it("empty entryPaths: union is exactly channelPaths", () => {
    expect(entryWriteScopeUnion([], ["notes/**", "docs/**"])).toEqual([
      "notes/**",
      "docs/**",
    ]);
  });

  it("empty channelPaths: union is exactly entryPaths", () => {
    expect(entryWriteScopeUnion(["src/a.ts"], [])).toEqual(["src/a.ts"]);
  });

  it("both empty: union is empty", () => {
    expect(entryWriteScopeUnion([], [])).toEqual([]);
  });
});

// Mechanism pin (ENTRY-WRITE-SCOPE-ONE-DERIVATION, per
// .claude/rules/engineering.md "The fix lands at the mechanism"):
// `prependHarnessBlock` (src/Prompt.ts) and `runAfterCommitGates`
// (src/Dispatcher.ts) each used to spell the `assignedEntry &&
// phase.scopeWritesToEntry` test and the `declaredPaths(entry)` /
// `phase.entryChannelPaths ?? []` pair for themselves, sharing only the
// final union — so a one-sided edit could render a fence the write guard did
// not enforce. These pin the single decision both now call: the scoped
// answer, and each way the unscoped answer is reached.
describe("entryWriteScope — the one scoped-or-not decision", () => {
  function phase(overrides: Partial<Phase> = {}): Phase {
    return {
      name: "build",
      description: "test phase",
      promptPath: "prompt.md",
      concurrency: "fanout",
      writablePaths: ["src/**", "tests/**", "notes/**"],
      gates: [],
      handoff: () => [],
      ...overrides,
    };
  }

  function entry(overrides: Partial<PendingEntry> = {}): PendingEntry {
    return {
      tag: "TEST-TAG",
      summary: "test entry",
      per: { path: "spec/pending.md", section: "5. Tests" },
      gate: { kind: "open" },
      dependsOnForks: [],
      files: { new: [], edit: [], retire: [] },
      acceptance: "green",
      ...overrides,
    };
  }

  const scoped = entry({
    files: {
      new: [{ path: "src/New.ts", description: "new" }],
      edit: [{ path: "tests/New.test.ts", description: "edit" }],
      retire: ["src/Old.ts"],
    },
  });

  it("the shared entry write scope is the assigned entry's declared files union the phase's channel paths when scopeWritesToEntry is declared", () => {
    const p = phase({
      scopeWritesToEntry: true,
      entryChannelPaths: ["notes/**", "src/New.ts"],
    });

    expect(entryWriteScope(p, scoped)).toEqual([
      "src/New.ts",
      "tests/New.test.ts",
      "src/Old.ts",
      "notes/**",
    ]);
    // All three `files` sub-lists contribute, and the channel path that
    // repeats a declared file is deduped rather than listed twice — the
    // union's own shape, reached through this decision.
    expect(entryWriteScope(p, scoped)).toEqual(
      entryWriteScopeUnion(
        ["src/New.ts", "tests/New.test.ts", "src/Old.ts"],
        ["notes/**", "src/New.ts"],
      ),
    );
    // `observedFiles` is the partition's input, never the write allowance.
    expect(
      entryWriteScope(p, { ...scoped, observedFiles: ["src/Observed.ts"] }),
    ).not.toContain("src/Observed.ts");
    // Channel paths omitted: the scope is the declaration alone, still scoped.
    expect(entryWriteScope(phase({ scopeWritesToEntry: true }), scoped)).toEqual([
      "src/New.ts",
      "tests/New.test.ts",
      "src/Old.ts",
    ]);
  });

  it("the shared entry write scope is absent when the phase omits scopeWritesToEntry, and when no entry is assigned", () => {
    // Undeclared flag with an entry in hand: unscoped, so `writablePaths`
    // alone binds — not an empty allowance that rejects everything.
    expect(entryWriteScope(phase(), scoped)).toBeUndefined();
    expect(entryWriteScope(phase({ scopeWritesToEntry: false }), scoped)).toBeUndefined();
    // Declared flag, no entry (a singleton tick, or a fanout tick that picked
    // nothing): equally unscoped.
    expect(
      entryWriteScope(phase({ scopeWritesToEntry: true }), undefined),
    ).toBeUndefined();
    expect(
      entryWriteScope(
        phase({ scopeWritesToEntry: true, entryChannelPaths: ["notes/**"] }),
        undefined,
      ),
    ).toBeUndefined();
    expect(entryWriteScope(phase(), undefined)).toBeUndefined();
  });
});

// Mechanism pin (QUEUE-FENCE-PRECHECK-ONE-DERIVATION, per
// .claude/rules/engineering.md "The fix lands at the mechanism"):
// `pendingGate` (src/builtinGates.ts) and `flume check` (src/cli.ts) each
// used to spell the `writablePaths ∪ entryChannelPaths` union and the
// `declaredPaths(e).filter(...)` scan for themselves, so a one-sided edit
// could make the gate and the verb name different offending paths for one
// queue. These pin the single derivation both now call; the two real
// consumers are driven against each other in tests/cli.test.ts.
describe("queueFenceViolations — the one consumer-phase fence pre-check", () => {
  function consumer(
    writablePaths: string[],
    entryChannelPaths?: string[],
  ): Pick<Phase, "writablePaths" | "entryChannelPaths"> {
    return entryChannelPaths === undefined
      ? { writablePaths }
      : { writablePaths, entryChannelPaths };
  }

  function entry(tag: string, overrides: Partial<PendingEntry> = {}): PendingEntry {
    return {
      tag,
      summary: "test entry",
      per: { path: "spec/pending.md", section: "The pending queue" },
      gate: { kind: "open" },
      dependsOnForks: [],
      files: { new: [], edit: [], retire: [] },
      acceptance: "green",
      ...overrides,
    };
  }

  const declaring = (tag: string, paths: string[]): PendingEntry =>
    entry(tag, {
      files: {
        new: [{ path: paths[0]!, description: "new" }],
        edit: paths.slice(1).map((path) => ({ path, description: "edit" })),
        retire: [],
      },
    });

  it("names only the declared paths no fence glob admits, keyed by tag, in declaration order", () => {
    const entries = [
      declaring("CLEAN", ["src/a.ts", "src/deep/b.ts"]),
      declaring("OUTSIDE", ["src/a.ts", "docs/guide.md", "spec/loop.md"]),
    ];

    expect(queueFenceViolations(entries, [consumer(["src/**"])])).toEqual([
      { tag: "OUTSIDE", offending: ["docs/guide.md", "spec/loop.md"] },
    ]);
  });

  it("admits a path only the channel globs cover, so the fence is the union and not writablePaths alone", () => {
    const entries = [declaring("NOTES", ["src/a.ts", "notes/NOTES.md"])];

    expect(queueFenceViolations(entries, [consumer(["src/**"])])).toEqual([
      { tag: "NOTES", offending: ["notes/NOTES.md"] },
    ]);
    expect(
      queueFenceViolations(entries, [consumer(["src/**"], ["notes/*.md"])]),
    ).toEqual([]);
  });

  it("an entry survives the union of every consumer, since any one of them could pick it", () => {
    const entries = [declaring("SPLIT", ["src/a.ts", "docs/guide.md"])];
    const build = consumer(["src/**"]);
    const scribe = consumer(["docs/**"]);

    // Each consumer alone rejects one of the two paths...
    expect(queueFenceViolations(entries, [build])).toEqual([
      { tag: "SPLIT", offending: ["docs/guide.md"] },
    ]);
    expect(queueFenceViolations(entries, [scribe])).toEqual([
      { tag: "SPLIT", offending: ["src/a.ts"] },
    ]);
    // ...and together they admit the entry whole.
    expect(queueFenceViolations(entries, [build, scribe])).toEqual([]);
  });

  it("reads declaredPaths and never observedFiles — retired paths count, a tick's reported touches do not", () => {
    const retiring = entry("RETIRE", {
      files: { new: [], edit: [], retire: ["docs/old.md"] },
      observedFiles: ["spec/loop.md"],
    });

    expect(queueFenceViolations([retiring], [consumer(["src/**"])])).toEqual([
      { tag: "RETIRE", offending: ["docs/old.md"] },
    ]);
    expect(
      queueFenceViolations([retiring], [consumer(["src/**", "docs/**"])]),
    ).toEqual([]);
  });

  it("an empty consumer list is an empty fence, so every declared path offends — the caller decides whether that case is reachable", () => {
    // Not vacuous-by-design: `flume check` refuses to call this with zero
    // consumers precisely because the answer here is "everything offends"
    // (tests/cli.test.ts, the no-fanout-phase case), and this is the
    // behavior that refusal exists to avoid.
    expect(
      queueFenceViolations([declaring("ANY", ["src/a.ts"])], []),
    ).toEqual([{ tag: "ANY", offending: ["src/a.ts"] }]);
    // An entry declaring nothing offends nothing, fence or no fence.
    expect(queueFenceViolations([entry("BARE")], [])).toEqual([]);
  });

  it("an empty queue yields no violations against a real fence", () => {
    expect(queueFenceViolations([], [consumer(["src/**"])])).toEqual([]);
  });
});

// Coverage gap (PATHS-MATCHESANY-SINGLE-STAR-UNTESTED, per spec/pending.md
// "The entry-scoped write guard is opt-in, and off by default": "`*` and `**`
// the only wildcards"). Every existing matchesAny caller (builtinGates.test.ts,
// Prompt.test.ts) exercises only `**`, so the single-segment `*` boundary —
// `[^/]*`, not `.*` — had zero coverage anywhere in the suite.
describe("matchesAny — single-`*` is segment-bound, unlike `**`", () => {
  it("a bare `*` matches a file within the same path segment", () => {
    expect(matchesAny("src/a.ts", ["src/*.ts"])).toBe(true);
  });

  it("a bare `*` does not cross a `/` into a deeper segment", () => {
    expect(matchesAny("src/sub/a.ts", ["src/*.ts"])).toBe(false);
  });

  it("`**` crosses `/` where a bare `*` would not, given the same path", () => {
    expect(matchesAny("src/sub/a.ts", ["src/**.ts"])).toBe(true);
  });

  it("a bare `*` still matches the zero-deeper-segment case `**` also matches", () => {
    expect(matchesAny("src/a.ts", ["src/**.ts"])).toBe(true);
  });
});

// Mechanism pin (WORKTREE-BASE-RESOLVED-ONCE, per spec/worktrees.md
// "Placement — the worktree base and the job namespace"): the worktree base
// used to be resolved at two independent call sites, which agreed only
// because both happened to spell the same fallback. This pins the single
// resolver's two branches, and holds the one name that leaked out of it —
// the job `.gitignore` seed's `worktrees/` line — to `STATE_ROOT_NAMES`
// rather than a hand-kept copy.
describe("worktreesBase — the one worktree-base resolution", () => {
  const saved = process.env.FLUME_WORKTREES_DIR;

  afterEach(() => {
    if (saved === undefined) delete process.env.FLUME_WORKTREES_DIR;
    else process.env.FLUME_WORKTREES_DIR = saved;
  });

  it("STATE_ROOT_NAMES names the worktrees dir", () => {
    delete process.env.FLUME_WORKTREES_DIR;
    expect(STATE_ROOT_NAMES.worktrees).toBe("worktrees");
    // The default base is that name joined onto the state root — the record
    // owns it, so the accessor cannot drift from the ignore seed below.
    expect(worktreesBase(join("state", "root"))).toBe(
      join("state", "root", STATE_ROOT_NAMES.worktrees),
    );
    expect(RUNTIME_IGNORES).toContain(`${STATE_ROOT_NAMES.worktrees}/`);
  });

  it("an override is resolved absolute, replacing the state-root default", () => {
    const override = join(process.cwd(), "elsewhere", "wt");
    process.env.FLUME_WORKTREES_DIR = override;
    expect(worktreesBase(join("state", "root"))).toBe(override);
  });

  it("a relative override resolves against cwd, not the state root", () => {
    process.env.FLUME_WORKTREES_DIR = join("..", "wt-base");
    expect(worktreesBase(join("state", "root"))).toBe(
      resolve(join("..", "wt-base")),
    );
  });

  it("an empty override is no override — the default stands", () => {
    // `resolve("")` is cwd, which would silently scatter worktrees across
    // the checkout. An unset-looking value reads as unset.
    process.env.FLUME_WORKTREES_DIR = "";
    expect(worktreesBase(join("state", "root"))).toBe(
      join("state", "root", STATE_ROOT_NAMES.worktrees),
    );
  });
});

// Mechanism pin (RUNTIME-IGNORES-NAMES-THE-TICK-ARTIFACTS, per
// .claude/rules/engineering.md "Derived state is computed, never restated
// beside its source"): the two tick-verdict filenames were module-local
// consts in `src/Dispatcher.ts`, out of reach of the one consumer that needs
// the bare name — the job `.gitignore` seed. A seed that respelled them
// would have been a rename away from ignoring nothing, so the names moved
// into `STATE_ROOT_NAMES` with the rest of the state root's layout. This
// holds them to exactly one spelling across `src/`.
describe("STATE_ROOT_NAMES owns the tick-verdict filenames", () => {
  const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

  it("the tick-verdict filenames are spelled once, in STATE_ROOT_NAMES", () => {
    const names = [
      STATE_ROOT_NAMES.tickVerdict,
      STATE_ROOT_NAMES.tickVerdictsLog,
    ];
    expect(names).toEqual(["tick-verdict.json", "tick-verdicts.jsonl"]);

    const modules = readdirSync(SRC).filter((n) => n.endsWith(".ts"));
    // Vacuity (engineering.md, "A green verdict is proven non-vacuous"): a
    // scan over no modules would report one spelling for every name.
    expect(modules.length).toBeGreaterThan(1);

    for (const name of names) {
      const spellers = modules.filter((m) =>
        readFileSync(join(SRC, m), "utf8").includes(`"${name}"`),
      );
      expect(
        spellers,
        `src/: '${name}' is spelled as a string literal outside paths.ts — ` +
          "a rename there would leave the copy pointing at the old file",
      ).toEqual(["paths.ts"]);
    }

    // The accessors read the record, so a rename moves the paths with it.
    const root = join("state", "root");
    expect(tickVerdictPath(root)).toBe(join(root, STATE_ROOT_NAMES.tickVerdict));
    expect(tickVerdictsLogPath(root)).toBe(
      join(root, STATE_ROOT_NAMES.tickVerdictsLog),
    );
  });
});
