import { join, toNamespacedPath } from "node:path";

import { describe, expect, it } from "vitest";

import { namespacedJoin } from "../src/paths.ts";

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
