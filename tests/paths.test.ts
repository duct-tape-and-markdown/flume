import { join, toNamespacedPath } from "node:path";

import { describe, expect, it } from "vitest";

import { entryWriteScopeUnion, namespacedJoin } from "../src/paths.ts";

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
