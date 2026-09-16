import { readdirSync, readFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, win32 } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { chainLoadGate } from "../src/builtinGates.ts";
import { loadChainModule } from "../src/chainLoad.ts";
import type { GateContext } from "../src/Gate.ts";
import { JobUsageError, jobNew, RUNTIME_IGNORES } from "../src/job.ts";
import type { Phase } from "../src/Phase.ts";
import type { PendingEntry } from "../src/PendingSchema.ts";
import {
  CHAIN_MODULE_NAME,
  chainModulePath,
  computeStateRootRel,
  entryWriteScope,
  entryWriteScopeUnion,
  gitPath,
  matchesAny,
  plainPath,
  queueFenceViolations,
  resolvePendingPath,
  slugify,
  STATE_ROOT_NAMES,
  stopFlagPath,
  tickVerdictPath,
  tickVerdictsLogPath,
  worktreesBase,
} from "../src/paths.ts";
import {
  gitPath as indexGitPath,
  matchesAny as indexMatchesAny,
  slugify as indexSlugify,
  stopFlagPath as indexStopFlagPath,
} from "../src/index.ts";

import { mkTempDir } from "./helpers/fixtureRoot.ts";

// The win32 MAX_PATH idiom (`toNamespacedPath(join(...))`) is pinned by
// source scan in tests/Baton.test.ts, not here: `namespacedJoin` *is* that
// expression, so any test comparing the two asserts the body against itself
// and cannot go red. See .claude/rules/platform-facts.md, "Windows MAX_PATH".

// `plainPath` is the idiom's other direction and does go red here, because
// the alphabet it undoes is not its own: `win32.toNamespacedPath` is node's
// real composer, answering in win32's alphabet on every host, so the
// round-trip is read against the writer rather than against a second
// spelling of the inverse (.claude/rules/engineering.md, "A seam gate reads
// what the real writer wrote").
describe("plainPath — win32's namespaced alphabet, undone", () => {
  it("undoes win32's own toNamespacedPath over a drive path and a UNC share alike", () => {
    const drive = String.raw`C:\pnpm-store\flume\dist\cli.js`;
    const unc = String.raw`\\build-host\tools\flume\dist\cli.js`;
    // The vacuity pin the round-trip rides: a composer that stopped prefixing
    // would leave `plainPath` a no-op and both assertions below green.
    expect(win32.toNamespacedPath(drive)).not.toBe(drive);
    expect(win32.toNamespacedPath(unc)).not.toBe(unc);

    expect(plainPath(win32.toNamespacedPath(drive))).toBe(drive);
    expect(plainPath(win32.toNamespacedPath(unc))).toBe(unc);
  });

  it("leaves a path that is in no namespaced alphabet alone, so the fold needs no platform test", () => {
    // Why the fold is unconditional: a posix path is rooted at `/` and a
    // posix `realpathSync` answers absolute, so neither can carry the prefix
    // this strips — and a name that merely contains backslashes is not one.
    expect(plainPath("/home/dev/flume/src/cli.ts")).toBe("/home/dev/flume/src/cli.ts");
    expect(plainPath(String.raw`/home/dev/odd\\?\name`)).toBe(
      String.raw`/home/dev/odd\\?\name`,
    );
  });
});

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
// (src/tickAttempt.ts) each used to spell the `assignedEntry &&
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

// MATCHESANY-QUESTION-MARK-UNESCAPED, per spec/pending.md "The entry-scoped
// write guard is opt-in, and off by default": "regex specials escaped, `*`
// and `**` the only wildcards, so a declared literal path matches only
// itself". `?` was missing from `globToRegex`'s escape class, so it kept its
// regex meaning — its preceding character went optional — and one fence both
// refused its own declared path and admitted an undeclared neighbor. The
// class is hand-kept, so the pin below drives every ASCII punctuation
// character except the wildcard through the real matcher rather than
// re-listing the class the fix edited: a member silently dropped from it
// fails here whichever member it is.
describe("matchesAny — a declared literal path matches only itself", () => {
  it("a declared literal path containing `?` matches itself", () => {
    expect(matchesAny("docs/faq?.md", ["docs/faq?.md"])).toBe(true);
    expect(matchesAny("src/a?b.ts", ["src/a?b.ts"])).toBe(true);
  });

  it("a declared literal path containing `?` does not admit the path its preceding character dropped", () => {
    expect(matchesAny("docs/fa.md", ["docs/faq?.md"])).toBe(false);
    expect(matchesAny("src/ab.ts", ["src/a?b.ts"])).toBe(false);
  });

  // The reach: the same matcher decides the queue pre-check, the write
  // guard, and ship detection. An entry declaring a `?` path used to be
  // reported as offending against a fence that names that very path.
  it("the queue fence admits an entry whose declared path carries a `?`", () => {
    const withQuestion: PendingEntry = {
      tag: "QUESTION",
      summary: "test entry",
      per: { path: "spec/pending.md", section: "The pending queue" },
      gate: { kind: "open" },
      dependsOnForks: [],
      files: {
        new: [],
        edit: [{ path: "docs/faq?.md", description: "edit" }],
        retire: [],
      },
      acceptance: "green",
    };

    expect(
      queueFenceViolations([withQuestion], [{ writablePaths: ["docs/faq?.md"] }]),
    ).toEqual([]);
    expect(
      queueFenceViolations([withQuestion], [{ writablePaths: ["docs/fa.md"] }]),
    ).toEqual([{ tag: "QUESTION", offending: ["docs/faq?.md"] }]);
  });

  it("every regex metacharacter globToRegex escapes leaves a declared literal path matching only itself", () => {
    // Every ASCII punctuation character except `*`, the one wildcard. A
    // superset of the escape class by construction, so the class cannot lose
    // a member without this going red.
    const specials = [...`!"#$%&'()+,-./:;<=>?@[\\]^_\`{|}~`];
    // Vacuity (.claude/rules/engineering.md, "A green verdict is proven
    // non-vacuous"): an empty character set would assert nothing and still
    // pass.
    expect(specials).toHaveLength(31);
    expect(specials).not.toContain("*");

    for (const c of specials) {
      const declared = `src/a${c}b.ts`;
      expect(matchesAny(declared, [declared]), `'${c}' in a declared path no longer matches itself`).toBe(true);
      // The near misses each metacharacter would admit if it kept its regex
      // meaning: `?` drops the preceding character, `+`/`*` repeat it, `.`
      // and a character class stand in for any other.
      for (const other of ["src/ab.ts", "src/b.ts", "src/aab.ts", "src/aXb.ts", "src/aXXb.ts"]) {
        expect(matchesAny(other, [declared]), `'${c}' in a declared path admits '${other}'`).toBe(false);
      }
    }
  });

  // GLOBTOREGEX-NO-SENTINEL-ROUNDTRIP, per .claude/rules/engineering.md "The
  // fix lands at the mechanism". The per-character pin above cannot see a
  // multi-character hole: `globToRegex` used to stage `**` through a
  // `::DOUBLESTAR::` literal and re-scan for it, so a declared path carrying
  // that text compiled to `.*` — a wildcard the glob never spelled, admitting
  // every path through the write guard, the queue fence and ship detection
  // alike. The compiler is now one pass and reads nothing it emits; these
  // cases pin the retired sentinel text as the literal it always should have
  // been, and stand as the regression case for any successor marker.
  it("a declared path containing the glob compiler's `**` placeholder text matches only itself", () => {
    expect(matchesAny("::DOUBLESTAR::", ["::DOUBLESTAR::"])).toBe(true);
    expect(matchesAny("src/secret.ts", ["::DOUBLESTAR::"])).toBe(false);
    expect(matchesAny("docs/::DOUBLESTAR::.md", ["docs/::DOUBLESTAR::.md"])).toBe(
      true,
    );
    expect(matchesAny("docs/anything-else.md", ["docs/::DOUBLESTAR::.md"])).toBe(
      false,
    );
  });

  // The reach: one matcher decides the queue pre-check, the write guard and
  // ship detection, so a fence line carrying the placeholder text used to
  // admit every path at all three.
  it("a fence line carrying the compiler's placeholder text admits only the path it spells", () => {
    function entryDeclaring(tag: string, path: string): PendingEntry {
      return {
        tag,
        summary: "test entry",
        per: { path: "spec/pending.md", section: "The pending queue" },
        gate: { kind: "open" },
        dependsOnForks: [],
        files: { new: [], edit: [{ path, description: "edit" }], retire: [] },
        acceptance: "green",
      };
    }

    const fence = [{ writablePaths: ["docs/::DOUBLESTAR::.md"] }];
    expect(
      queueFenceViolations(
        [entryDeclaring("SENTINEL", "docs/::DOUBLESTAR::.md")],
        fence,
      ),
    ).toEqual([]);
    expect(
      queueFenceViolations(
        [entryDeclaring("UNDECLARED", "docs/unrelated.md")],
        fence,
      ),
    ).toEqual([{ tag: "UNDECLARED", offending: ["docs/unrelated.md"] }]);
  });

  // The wildcards the compiler does still spell, unchanged by the one-pass
  // rewrite — the pass is only correct if `**` and `*` keep their meanings
  // beside literal text that resembles a marker.
  it("a glob mixing real wildcards with placeholder-shaped literal text keeps both readings", () => {
    expect(matchesAny("docs/::DOUBLESTAR::/deep/a.md", ["docs/::DOUBLESTAR::/**.md"])).toBe(true);
    expect(matchesAny("docs/elsewhere/deep/a.md", ["docs/::DOUBLESTAR::/**.md"])).toBe(false);
    expect(matchesAny("docs/::DOUBLESTAR::/a.md", ["docs/::DOUBLESTAR::/*.md"])).toBe(true);
    expect(matchesAny("docs/::DOUBLESTAR::/deep/a.md", ["docs/::DOUBLESTAR::/*.md"])).toBe(false);
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

  // The third input: `Chain.worktreesBase` already evaluated
  // (spec/worktrees.md, "Placement — the worktree base and the job
  // namespace").
  // All three inputs meet at this one function, so the order they outrank
  // each other in is stated once, here, rather than at each reader.
  it("a chain-declared base replaces the state-root default", () => {
    delete process.env.FLUME_WORKTREES_DIR;
    const declared = resolve(join("elsewhere", "chain-base"));
    expect(worktreesBase(join("state", "root"), declared)).toBe(declared);
  });

  it("an operator's override outranks a chain-declared base", () => {
    const override = join(process.cwd(), "operator", "wt");
    process.env.FLUME_WORKTREES_DIR = override;
    // The env var is the host's, the chain file is the repo's: a chain
    // committed by someone else never takes placement away from the
    // operator running it.
    expect(worktreesBase(join("state", "root"), resolve("chain-base"))).toBe(
      override,
    );
  });

  it("an empty declared base is no declaration — the default stands", () => {
    delete process.env.FLUME_WORKTREES_DIR;
    expect(worktreesBase(join("state", "root"), "")).toBe(
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
    // Vacuity (.claude/rules/engineering.md, "A green verdict is proven
    // non-vacuous"): a scan over no modules would report one spelling for every
    // name.
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

// Mechanism pin (CHAIN-MODULE-PATH-ONE-DERIVATION, per
// .claude/rules/engineering.md "The fix lands at the mechanism"): the loader
// that imports the chain, the `job new` precondition that refuses without it,
// and the gate that decides whether a commit touched it each spelled
// `chain.ts` themselves. The gate's copy was the silent one — a divergence
// leaves `chainLoadGate` reporting `skipped` over the very commit that broke
// the chain.
//
// Both pins below are agreement gates (.claude/rules/engineering.md, "A seam
// gate reads what the real writer wrote"): the real gate / the real verb names
// the path, and the real loader is then driven over the file that name points
// at. No chain filename is authored by this test's hand on either side.
describe("the chain module's path has one derivation", () => {
  const PIN_CHAIN =
    `export default () => ({ chain: { phases: [{ name: "a", description: "", ` +
    `promptPath: "p.md", concurrency: "singleton", writablePaths: ["**"], ` +
    `gates: [], handoff: () => [] }], humanOnly: [] } });\n`;

  let repo: string;
  let configDir: string;

  beforeEach(async () => {
    repo = await mkTempDir("flume-chain-module-path-");
    configDir = join(repo, ".flume");
    await mkdir(configDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  const gateCtx = (over: Partial<GateContext>): GateContext => ({
    cwd: repo,
    flumeDir: configDir,
    stateRootRel: ".flume",
    pendingPath: join(configDir, "plan", "pending.json"),
    configDir,
    repoRoot: repo,
    phaseName: "paths-pin",
    commitSha: "0".repeat(40),
    baseSha: "b".repeat(40),
    touchedPaths: [],
    log: () => {},
    ...over,
  });

  it("chainLoadGate's touched-path key names the file loadChainModule resolves from the same configDir", async () => {
    // The gate is the writer: its `skipped` reason is `<key> untouched by
    // this commit`, the only account it gives of the key it judged against.
    const skipped = await chainLoadGate.run(
      gateCtx({ commitSha: "0".repeat(40), touchedPaths: ["src/unrelated.ts"] }),
    );
    expect(skipped.ok).toBe(true);
    const key = String(skipped.skipped ?? "").split(" ")[0] ?? "";
    // Vacuity (.claude/rules/engineering.md, "A green verdict is proven
    // non-vacuous"): a key the gate never stated would make every assertion
    // below vacuous.
    expect(key).not.toBe("");
    expect(resolve(repo, key)).toBe(chainModulePath(configDir));

    // The real consumer over the file the real writer named: put a chain
    // where the gate's key points and the loader finds it there.
    await writeFile(resolve(repo, key), PIN_CHAIN, "utf8");
    const { chain } = await loadChainModule({
      repoRoot: repo,
      configDir,
      flumeDir: configDir,
    });
    expect(chain.phases.map((p) => p.name)).toEqual(["a"]);

    // And the key is the gate's trigger, not decoration: named in the
    // touched list, the gate loads instead of skipping.
    const ran = await chainLoadGate.run(
      gateCtx({ commitSha: "0".repeat(40), touchedPaths: [key] }),
    );
    expect(ran.ok).toBe(true);
    expect(ran.skipped).toBeUndefined();
  });

  it("jobNew's chain precondition probes the file loadChainModule resolves from the same configDir", async () => {
    // `jobNew` is the writer: over a chainless configDir its refusal names
    // the path it probed, the only account it gives of that path.
    const refusal = await jobNew({
      repoRoot: repo,
      name: "probe",
      configDir,
      flumeDir: configDir,
      log: () => {},
    }).then(
      () => undefined,
      (err: unknown) => err,
    );
    expect(refusal).toBeInstanceOf(JobUsageError);
    const probed = /no chain at (.+?);/.exec((refusal as Error).message)?.[1];
    // Vacuity: a refusal that named no path would leave the load below
    // proving only that some chain somewhere loads.
    expect(probed).toBeTruthy();
    expect(probed).toBe(chainModulePath(configDir));

    // The real consumer over the file the real precondition named.
    await writeFile(probed!, PIN_CHAIN, "utf8");
    const { chain } = await loadChainModule({
      repoRoot: repo,
      configDir,
      flumeDir: configDir,
    });
    expect(chain.phases.map((p) => p.name)).toEqual(["a"]);
  });

  it("the chain module's filename is spelled once, in paths.ts", () => {
    expect(CHAIN_MODULE_NAME).toBe("chain.ts");

    const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
    const modules = readdirSync(SRC).filter((n) => n.endsWith(".ts"));
    // Vacuity: a scan over no modules reports one speller for every name.
    expect(modules.length).toBeGreaterThan(1);

    const spellers = modules.filter((m) =>
      readFileSync(join(SRC, m), "utf8").includes(`"${CHAIN_MODULE_NAME}"`),
    );
    expect(
      spellers,
      `src/: '${CHAIN_MODULE_NAME}' is spelled as a string literal outside ` +
        "paths.ts — a fourth spelling is how the loader, the precondition " +
        "and the gate come to name different files",
    ).toEqual(["paths.ts"]);
  });
});

// Mechanism pin (HARNESS-STATE-ROOT-IS-A-GIT-PATH, per
// .claude/rules/engineering.md "A fact the engine holds is reported, never
// rediscovered"): git names every path with `/`, and a value that has been
// through `join`/`relative` on win32 does not. This is the one rule that
// converts one, exported so that a consumer composing a committed path is
// reading the engine's fold rather than spelling a second. The state-root
// offset is the value that most wanted it, and the engine now applies it
// there before reporting (`computeStateRootRel`, `src/paths.ts`), so no
// consumer folds that one at all.
describe("gitPath — the one host-path-to-git-path rule", () => {
  it("the engine's path surface renders a backslash-separated relative path as a git path", () => {
    // What `relative()` answers for a nested state root on win32 — the
    // host's own dialect, which is what the reporter folds before a gate
    // ever sees it.
    expect(gitPath(String.raw`jobs\alpha\.flume`)).toBe("jobs/alpha/.flume");

    // A path already in git's alphabet is itself, so a posix host pays
    // nothing for the conversion.
    expect(gitPath("jobs/alpha/.flume")).toBe("jobs/alpha/.flume");
    expect(gitPath("pending.json")).toBe("pending.json");

    // Mixed, which is exactly what a slash-joined tail on a `relative()` head
    // produces — converted whole, never half.
    expect(gitPath(String.raw`jobs\alpha\.flume/plan/notes/TAG.md`)).toBe(
      "jobs/alpha/.flume/plan/notes/TAG.md",
    );

    // And it is the rule the engine keys its own committed paths by: a
    // nested state root's host-dialect offset, joined to the queue's default
    // relative path, is the git path a commit names.
    expect(gitPath(resolvePendingPath(String.raw`jobs\alpha\.flume`))).toBe(
      "jobs/alpha/.flume/plan/pending.json",
    );
  });

  it("the separator fold is spelled once, in paths.ts", () => {
    // The two forms the tree spelled it in before this rule had a home.
    const FOLDS = [String.raw`split("\\")`, String.raw`split(/[\\/]/)`];
    const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

    const modules = ["src", "harness", "examples"].flatMap((dir) =>
      readdirSync(join(ROOT, dir))
        .filter((name) => name.endsWith(".ts"))
        .map((name) => `${dir}/${name}`),
    );
    // Vacuity (.claude/rules/engineering.md, "A green verdict is proven
    // non-vacuous"): a scan over no modules would report one speller for every
    // form.
    expect(modules.length).toBeGreaterThan(20);
    // And the form under test is one the tree still contains — in its home.
    expect(readFileSync(join(ROOT, "src", "paths.ts"), "utf8")).toContain(
      FOLDS[1],
    );

    const spellers = modules.filter((module) => {
      const text = readFileSync(join(ROOT, module), "utf8");
      return FOLDS.some((fold) => text.includes(fold));
    });
    expect(
      spellers,
      "the host-path-to-git-path fold is spelled outside src/paths.ts — a " +
        "second copy is how one surface comes to key a committed path by a " +
        "separator another one does not",
    ).toEqual(["src/paths.ts"]);
  });
});

// STATE-ROOT-REL-IS-REPORTED-IN-GITS-ALPHABET, per spec/chain.md "What a gate
// receives": the offset every `GateContext.stateRootRel`,
// `TickContext.stateRootRel` and `FlumeApiPaths.stateRootRel` carries is
// `relative()` folded through `gitPath` above, so a consumer comparing it
// against a commit's touched path re-folds nothing. Pinned beside the fold it
// is built on rather than against a dispatcher fixture: the verdict is path
// arithmetic over two roots and touches no disk.
describe("computeStateRootRel — the offset's alphabet", () => {
  const REPO = resolve("flume-offset-repo");

  it("computeStateRootRel reports a nested state root in git's alphabet, so no consumer re-folds the offset", () => {
    const repoRoot = join(REPO, "wherever");
    const nested = join(repoRoot, "jobs", "alpha", ".flume");
    // Non-vacuity: the offset under test is a multi-segment path, so the
    // separator between its segments is a real character the claim is about
    // — not a single segment where every alphabet agrees.
    expect(relative(repoRoot, nested).split(/[\\/]/)).toHaveLength(3);

    expect(computeStateRootRel(repoRoot, nested)).toBe("jobs/alpha/.flume");
  });

  it("a state-root segment carrying the host's other separator is reported folded too, so a mixed-dialect offset never reaches a gate half-converted", () => {
    // `relative` answers in the host's dialect and nothing guarantees the
    // segments it joins are free of the other one — on win32 a declared
    // `jobs/alpha` tail rides a backslash-separated head, and this is that
    // shape reachable from a posix run. The reporter folds both separators
    // (`gitPath`, `src/paths.ts`), so the value a gate compares against a
    // commit's touched path is git's alphabet whole, never half.
    const repoRoot = join(REPO, "wherever");
    const odd = join(repoRoot, String.raw`jobs\alpha`, ".flume");
    expect(relative(repoRoot, odd)).toContain("\\");

    expect(computeStateRootRel(repoRoot, odd)).toBe("jobs/alpha/.flume");
  });

  it("a relocated state root is still reported absent, not as a folded climb-out", () => {
    const outside = join(REPO, "..", "elsewhere", ".flume");
    expect(computeStateRootRel(REPO, outside)).toBeUndefined();
  });
});

// INDEX-EXPORTS-THE-GLOB-MATCHER, per spec/pending.md "What the package
// exports": `src/index.ts` and `FlumeApi` are the canonical lists and they
// carry the same values. `FlumeApi.matchesAny` is held to this function by
// tests/chain.test.ts; the entry point carried the other three path rules
// and not this one, so a chain composing a fence glob without the api
// parameter in hand had to respell the dialect it is matched in.
describe("src/index.ts — matchesAny barrel export (INDEX-EXPORTS-THE-GLOB-MATCHER)", () => {
  it("the package entry point exports the glob matcher matchesAny", () => {
    expect(indexMatchesAny).toBe(matchesAny);
    // Identity is the claim, so one probe says which dialect it is: `**`
    // crosses `/` where a bare `*` does not — the boundary a chain reaching
    // for an off-the-shelf glob library instead would get wrong.
    expect(indexMatchesAny("src/sub/a.ts", ["src/**.ts"])).toBe(true);
    expect(indexMatchesAny("src/sub/a.ts", ["src/*.ts"])).toBe(false);
  });

  it("the entry point's path rules are the same functions src/paths.ts exports, not second copies", () => {
    // The `beside` half of the claim: one set of path rules reaches a chain
    // through the entry point, so none of the four can drift from the
    // matcher the engine itself keys its fences by.
    expect(indexGitPath).toBe(gitPath);
    expect(indexSlugify).toBe(slugify);
    expect(indexStopFlagPath).toBe(stopFlagPath);
  });
});
