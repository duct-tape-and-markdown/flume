import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve, toNamespacedPath } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { RUNTIME_IGNORES } from "../src/job.ts";
import {
  entryWriteScopeUnion,
  matchesAny,
  namespacedJoin,
  STATE_ROOT_NAMES,
  tickVerdictPath,
  tickVerdictsLogPath,
  worktreesBase,
} from "../src/paths.ts";

// Mechanism pin (WIN32-NAMESPACEDPATH-JOIN-UNSHARED, per
// .claude/rules/engineering.md "The fix lands at the mechanism"):
// writeRevertNote, harvestFriction, frictionCountLine, and
// countFrictionFiles each used to inline `toNamespacedPath(join(...))`
// separately. This pins the shared helper against exactly that idiom so a
// future one-sided edit to one call site's join list can't silently diverge
// from the others' wrapping. `toNamespacedPath` is a no-op on POSIX and
// prepends the `\\?\` extended-length prefix on win32 — the assertions hold
// under whichever the suite runs on.
describe("namespacedJoin — win32 MAX_PATH idiom, shared", () => {
  it("matches toNamespacedPath(join(...)) for a multi-segment build", () => {
    const segments = ["state", "friction", "notes"];
    expect(namespacedJoin(...segments)).toBe(
      toNamespacedPath(join(...segments)),
    );
  });

  it("matches toNamespacedPath(join(...)) for a single already-joined path", () => {
    const path = join("state", "friction");
    expect(namespacedJoin(path)).toBe(toNamespacedPath(join(path)));
  });

  it("matches toNamespacedPath(join(...)) for a filename appended to a dir", () => {
    const dir = join("flume", "friction");
    const name = "2026-08-01T00-00-00-000Z--tag--reverted.md";
    expect(namespacedJoin(dir, name)).toBe(
      toNamespacedPath(join(dir, name)),
    );
  });

  it("matches toNamespacedPath(join(...)) for a deep join past MAX_PATH-length segments", () => {
    const segments = Array.from({ length: 6 }, (_, i) =>
      `seg-${i}-`.padEnd(50, "x"),
    );
    expect(namespacedJoin(...segments)).toBe(
      toNamespacedPath(join(...segments)),
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
