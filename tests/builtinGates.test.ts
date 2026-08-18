/**
 * pendingGate lazy-fence coverage (RELEASE-v0.8 §6, inbox: pendingGate eager
 * capture). `Gate.test.ts` covers pendingGate's composed validation and
 * fence pre-check against a static targetFence; this file is scoped to the
 * one behavior those tests don't exercise: a targetFence whose
 * writablePaths/entryChannelPaths are populated (or change) *after*
 * `pendingGate(...)` is called — the declaration-driven-fence case
 * (v0.8 §7's second-implementation shape) that a plain object literal can't
 * surface.
 *
 * Also covers the tscGate/vitestGate/eslintGate pnpm cmd override
 * (BUILTINGATES-PNPM-HARDCODED-NO-OVERRIDE, engine-boundary.md "Capability
 * vs convention"): the injection point a non-pnpm chain needs, and that
 * omitting it stays byte-identical to before the override existed. And the
 * args override that rides alongside it (BUILTINGATES-CMD-OVERRIDE-PNPM-
 * SHAPED-ARGS): cmd alone only swaps the binary while args stay pnpm-shaped,
 * which silently misreports an npm chain's gate (npm has no bare `npm tsc`
 * verb) as "TypeScript errors" when npm never ran tsc at all.
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  eslintGate,
  pendingGate,
  tscGate,
  vitestGate,
} from "../src/builtinGates.ts";
import type { GateContext } from "../src/Gate.ts";
// Barrel-export pin (engineering.md "An export earns its consumer",
// CHAIN-EXPORT-GATE-OPTION-TYPES): a consumer can call shellGate/tscGate/
// vitestGate/eslintGate but, pre-fix, could not name the shape it passes
// them — ShellGateOptions wasn't exported at all, and PkgManagerOverride /
// PkgManagerGate weren't re-exported from src/index.ts alongside
// PendingGateOptions. This import fails tsc if any of the three drops from
// src/index.ts.
import type {
  ShellGateOptions,
  PkgManagerOverride,
  PkgManagerGate,
} from "../src/index.ts";

function ctx(cwd: string, overrides: Partial<GateContext> = {}): GateContext {
  return {
    cwd,
    flumeDir: join(cwd, ".flume"),
    configDir: join(cwd, ".flume"),
    repoRoot: cwd,
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

describe("pendingGate — hint option (PENDING-GATE-HINT-OPTION, engine-boundary.md § Capability vs convention)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "flume-pendinggate-hint-"));
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

  const outsideFenceEntry = {
    ...validEntry,
    files: {
      new: [],
      edit: [{ path: "docs/nope.md", description: "not allowed" }],
      retire: [],
    },
  };

  it("appends the hint to the schema-violation message when supplied", async () => {
    await writePending([{ ...validEntry, mystery: "field" }]);
    const gate = pendingGate({
      targetFence: { writablePaths: ["src/**"] },
      hint: "park it, never re-scope",
    });
    const result = await gate.run(ctx(dir));
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/schema violation/);
    expect(result.message).toContain("park it, never re-scope");
  });

  it("leaves the schema-violation message unchanged when the hint is omitted", async () => {
    await writePending([{ ...validEntry, mystery: "field" }]);
    const gate = pendingGate({ targetFence: { writablePaths: ["src/**"] } });
    const result = await gate.run(ctx(dir));
    expect(result.ok).toBe(false);
    expect(result.message).toBe(
      `${join("plan", "pending.json")} has 1 schema violation(s)`,
    );
  });

  it("appends the hint to the fence-violation message when supplied", async () => {
    await writePending([outsideFenceEntry]);
    const gate = pendingGate({
      targetFence: { writablePaths: ["src/**"] },
      hint: "park it, never re-scope",
    });
    const result = await gate.run(ctx(dir));
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/outside the target fence/);
    expect(result.message).toContain("park it, never re-scope");
  });

  it("leaves the fence-violation message unchanged when the hint is omitted", async () => {
    await writePending([outsideFenceEntry]);
    const gate = pendingGate({ targetFence: { writablePaths: ["src/**"] } });
    const result = await gate.run(ctx(dir));
    expect(result.ok).toBe(false);
    expect(result.message).toBe(
      "1 pending entry declare files outside the target fence",
    );
  });
});

describe("tscGate / vitestGate / eslintGate — pnpm cmd override (BUILTINGATES-PNPM-HARDCODED-NO-OVERRIDE)", () => {
  it.each([
    ["tscGate", tscGate, "tsc"],
    ["vitestGate", vitestGate, "vitest"],
    ["eslintGate", eslintGate, "eslint"],
  ] as const)(
    "%s stays a bare Gate (name=%s, when=afterCommit) whether used directly or called with no override",
    (_label, gate, name) => {
      expect(gate.name).toBe(name);
      expect(gate.when).toBe("afterCommit");
      const called = gate();
      expect(called.name).toBe(name);
      expect(called.when).toBe("afterCommit");
      expect(gate({}).name).toBe(name);
    },
  );

  it.each([
    ["tscGate", tscGate, "TypeScript errors — commit reverted"],
    ["vitestGate", vitestGate, "Tests failed — commit reverted"],
    ["eslintGate", eslintGate, "Lint errors — commit reverted"],
  ] as const)(
    "%s({ cmd }) actually swaps the invoked binary away from pnpm",
    async (_label, gate, failHint) => {
      // Overriding to "node" and keeping the gate's own fixed args (e.g.
      // ["tsc", "--noEmit"]) makes node try to load the first arg as its
      // entry script — Node's own MODULE_NOT_FOUND, not a pnpm/shell
      // "not recognized" failure, is proof the override binary actually ran.
      const result = await gate({ cmd: "node" }).run(ctx(process.cwd()));
      expect(result.ok).toBe(false);
      expect(result.message).toBe(failHint);
      expect(result.details ?? "").toContain("MODULE_NOT_FOUND");
    },
  );
});

describe("tscGate / vitestGate / eslintGate — args override (BUILTINGATES-CMD-OVERRIDE-PNPM-SHAPED-ARGS)", () => {
  it.each([
    ["tscGate", tscGate],
    ["vitestGate", vitestGate],
    ["eslintGate", eslintGate],
  ] as const)(
    "%s({ cmd, args }) runs the overridden args instead of the pnpm-shaped default",
    async (_label, gate) => {
      // On the pre-fix tree PkgManagerOverride carries no `args` field, so
      // this override's `args` is silently dropped and the gate still runs
      // `<node> tsc --noEmit` (etc, the gate's own fixed pnpm-shaped args) —
      // node tries to load "tsc"/"test"/"lint" as an entry script and fails
      // with MODULE_NOT_FOUND, exactly like the cmd-only override proven
      // above. Only once `args` is actually threaded into `build()` does
      // this trivial `-e` script run instead and the gate goes green.
      const result = await gate({
        cmd: process.execPath,
        args: ["-e", "process.exit(0)"],
      }).run(ctx(process.cwd()));
      expect(result.ok).toBe(true);
    },
  );

  it("tscGate({ cmd: 'npm' }) (cmd-only) fails with npm's own \"Unknown command\" — npm has no bare-bin tsc verb", async () => {
    const result = await tscGate({ cmd: "npm" }).run(ctx(process.cwd()));
    expect(result.ok).toBe(false);
    expect(result.details ?? "").toContain("Unknown command");
  });

  it(
    "tscGate({ cmd: 'npm', args: [...] }) composes a working npm invocation and actually runs tsc",
    async () => {
      const result = await tscGate({
        cmd: "npm",
        args: ["exec", "--", "tsc", "--noEmit"],
      }).run(ctx(process.cwd()));
      expect(result.ok).toBe(true);
    },
    30_000,
  );
});

// win32-only: proves the *default* (omitted cmd) invocation is literally
// "pnpm" — a fake pnpm.cmd shimmed ahead on PATH is what a bare/no-override
// call resolves to, and an explicit override bypasses it entirely. Mirrors
// the win32 .cmd shim fixture in Gate.test.ts (same CVE-2024-27980 shim
// resolution this repo already tests against).
describe.runIf(process.platform === "win32")(
  "tscGate — pnpm shim proves the default cmd (win32)",
  () => {
    let shimDir: string;
    let originalPath: string | undefined;

    beforeEach(async () => {
      shimDir = await mkdtemp(join(tmpdir(), "flume-pnpm-shim-"));
      await writeFile(
        join(shimDir, "pnpm.cmd"),
        "@echo off\r\necho pnpm-shim %*\r\n",
      );
      originalPath = process.env.PATH;
      process.env.PATH = `${shimDir};${process.env.PATH ?? ""}`;
    });

    afterEach(async () => {
      if (originalPath === undefined) {
        delete process.env.PATH;
      } else {
        process.env.PATH = originalPath;
      }
      await rm(shimDir, { recursive: true, force: true });
    });

    it("bare tscGate (no override) resolves to the pnpm shim", async () => {
      const result = await tscGate.run(ctx(process.cwd()));
      expect(result.ok).toBe(true);
      expect(result.details).toContain("pnpm-shim tsc --noEmit");
    });

    it("tscGate() called with no override is byte-identical to the bare gate", async () => {
      const result = await tscGate().run(ctx(process.cwd()));
      expect(result.ok).toBe(true);
      expect(result.details).toContain("pnpm-shim tsc --noEmit");
    });

    it("tscGate({ cmd }) bypasses the pnpm shim entirely", async () => {
      await writeFile(
        join(shimDir, "other-pm.cmd"),
        "@echo off\r\necho other-pm-shim %*\r\n",
      );
      const result = await tscGate({ cmd: "other-pm" }).run(
        ctx(process.cwd()),
      );
      expect(result.ok).toBe(true);
      expect(result.details).toContain("other-pm-shim tsc --noEmit");
    });
  },
);

describe("src/index.ts — ShellGateOptions/PkgManagerOverride/PkgManagerGate barrel export (CHAIN-EXPORT-GATE-OPTION-TYPES)", () => {
  it("re-exports ShellGateOptions, PkgManagerOverride, and PkgManagerGate as named types a chain author can consume", () => {
    // The imported types (line 41, from src/index.ts rather than
    // src/builtinGates.ts) are what a chain author would actually reach for
    // to name the shape it passes to shellGate/tscGate/vitestGate/eslintGate
    // — if any drops from the barrel this fails tsc, not just an LSP
    // references check.
    const shellOpts: ShellGateOptions = {
      name: "custom",
      when: "afterCommit",
      cmd: process.execPath,
      args: ["-e", "process.exit(0)"],
    };
    const override: PkgManagerOverride = { cmd: "npm", args: ["run", "tsc"] };
    const gate: PkgManagerGate = tscGate;

    expect(shellOpts.name).toBe("custom");
    expect(override.cmd).toBe("npm");
    expect(gate.name).toBe("tsc");
  });
});
