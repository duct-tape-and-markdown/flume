/**
 * pendingGate lazy-fence coverage (RELEASE-v0.8 §6, inbox: pendingGate eager
 * capture). `Gate.test.ts` covers pendingGate's composed validation and
 * fence pre-check against a static targetFence; this file is scoped to the
 * one behavior those tests don't exercise: a targetFence whose
 * writablePaths/entryChannelPaths are populated (or change) *after*
 * `pendingGate(...)` is called — the declaration-driven-fence case
 * (v0.8 §7's second-implementation shape) that a plain object literal can't
 * surface.
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { pendingGate } from "../src/builtinGates.ts";
import type { GateContext } from "../src/Gate.ts";

function ctx(cwd: string, overrides: Partial<GateContext> = {}): GateContext {
  return {
    cwd,
    flumeDir: join(cwd, ".flume"),
    phaseName: "test-phase",
    log: () => {},
    ...overrides,
  };
}

const validEntry = {
  tag: "SOME-TAG",
  gate: { kind: "open" },
  dependsOnForks: [],
  files: {
    new: [],
    edit: [{ path: "src/foo.ts", description: "edit" }],
    retire: [],
  },
};

describe("pendingGate — lazy fence read (targetFence populated after construction)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "flume-pendinggate-lazy-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writePending(entries: unknown): Promise<void> {
    const pendingDir = join(dir, ".flume", "plan");
    await mkdir(pendingDir, { recursive: true });
    await writeFile(
      join(pendingDir, "pending.json"),
      JSON.stringify(entries),
      "utf8",
    );
  }

  it("passes when a getter-backed writablePaths is only populated after pendingGate(...) is called", async () => {
    await writePending([validEntry]);
    // Simulates a declaration-driven Phase: writablePaths is a getter whose
    // backing value isn't set until after the chain wires the gate — e.g.
    // read from a per-job declaration.json resolved later in chain setup.
    let backing: string[] = [];
    const targetFence = {
      get writablePaths() {
        return backing;
      },
    };
    const gate = pendingGate({ targetFence });
    backing = ["src/**"];
    const result = await gate.run(ctx(dir));
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/fence pre-check passed/);
  });

  it("fails, naming the path, when a getter-backed writablePaths narrows after pendingGate(...) is called", async () => {
    await writePending([
      {
        ...validEntry,
        files: {
          new: [],
          edit: [{ path: "docs/nope.md", description: "not allowed" }],
          retire: [],
        },
      },
    ]);
    let backing = ["src/**", "docs/**"];
    const targetFence = {
      get writablePaths() {
        return backing;
      },
    };
    const gate = pendingGate({ targetFence });
    // Fence narrows after construction; run() must see the current value.
    backing = ["src/**"];
    const result = await gate.run(ctx(dir));
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/outside the target fence/);
    expect(result.details ?? "").toContain("docs/nope.md");
  });

  it("reflects a getter-backed entryChannelPaths populated after pendingGate(...) is called", async () => {
    await writePending([
      {
        tag: "OTHER-TAG",
        gate: { kind: "open" },
        dependsOnForks: [],
        files: {
          new: [{ path: "tests/foo.test.ts", description: "test" }],
          edit: [],
          retire: [],
        },
      },
    ]);
    let backing: string[] = [];
    const targetFence = {
      writablePaths: ["src/**"],
      get entryChannelPaths() {
        return backing;
      },
    };
    const gate = pendingGate({ targetFence });
    backing = ["tests/**"];
    const result = await gate.run(ctx(dir));
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/fence pre-check passed/);
  });

  it("re-reads the fence on every run(), not just once after the first call", async () => {
    await writePending([validEntry]);
    let backing = ["src/**"];
    const targetFence = {
      get writablePaths() {
        return backing;
      },
    };
    const gate = pendingGate({ targetFence });

    const first = await gate.run(ctx(dir));
    expect(first.ok).toBe(true);

    backing = [];
    const second = await gate.run(ctx(dir));
    expect(second.ok).toBe(false);
    expect(second.details ?? "").toContain("src/foo.ts");
  });
});

describe("pendingGate — fence pre-check reads declared files, not observedFiles (engineering.md § The fix lands at the mechanism)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "flume-pendinggate-declared-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writePending(entries: unknown): Promise<void> {
    const pendingDir = join(dir, ".flume", "plan");
    await mkdir(pendingDir, { recursive: true });
    await writeFile(
      join(pendingDir, "pending.json"),
      JSON.stringify(entries),
      "utf8",
    );
  }

  it("passes an entry whose declared files all sit inside the fence but whose observedFiles names a path outside it", async () => {
    await writePending([
      {
        ...validEntry,
        // A prior tick's dispatcher-observed footprint, outside the fence.
        // This is not a declaration the authoring phase could have avoided —
        // touchedPaths() folding it into the fence pre-check would report a
        // fence violation the authoring phase has no way to fix.
        observedFiles: ["docs/unrelated.md"],
      },
    ]);
    const targetFence = { writablePaths: ["src/**"] };
    const gate = pendingGate({ targetFence });
    const result = await gate.run(ctx(dir));
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/fence pre-check passed/);
  });
});
