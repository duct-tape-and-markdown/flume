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

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  chainLoadGate,
  eslintGate,
  pendingGate,
  shellGate,
  tscGate,
  vitestGate,
  writablePathsGate,
} from "../src/builtinGates.ts";
import { computeStateRootRel } from "../src/Dispatcher.ts";
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

const exec = promisify(execFile);

function ctx(cwd: string, overrides: Partial<GateContext> = {}): GateContext {
  const repoRoot = overrides.repoRoot ?? cwd;
  const flumeDir = overrides.flumeDir ?? join(cwd, ".flume");
  return {
    cwd,
    flumeDir,
    // Default fixture shape has flumeDir nested under repoRoot (the
    // afterMerge/no-worktree shape) — computeStateRootRel handles it the
    // same as the dispatcher-built case. The dedicated "real afterCommit
    // shape" regression test below overrides both explicitly.
    stateRootRel: computeStateRootRel(repoRoot, flumeDir),
    configDir: join(cwd, ".flume"),
    repoRoot,
    phaseName: "test-phase",
    log: () => {},
    ...overrides,
  };
}

// pendingGate reads the gated commit via `git.readFileAtRef`
// (PENDING-GATE-STALE-TIP-READ), so its tests need a real repo and a real
// commit sha rather than a bare temp dir.
async function createBootstrappedRepo(prefix: string): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), prefix));
  const opts = { cwd: repo };
  await exec("git", ["init", "-q"], opts);
  await exec("git", ["config", "user.email", "test@example.com"], opts);
  await exec("git", ["config", "user.name", "Test User"], opts);
  await exec("git", ["config", "commit.gpgsign", "false"], opts);
  await exec("git", ["config", "core.autocrlf", "false"], opts);
  await writeFile(join(repo, ".seed"), "");
  await exec("git", ["add", "."], opts);
  await exec("git", ["commit", "-q", "-m", "seed"], opts);
  return repo;
}

async function commitFiles(
  repo: string,
  files: Record<string, string>,
  msg = "candidate",
): Promise<string> {
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(repo, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content);
  }
  const opts = { cwd: repo };
  await exec("git", ["add", "."], opts);
  await exec("git", ["commit", "-q", "-m", msg], opts);
  const { stdout } = await exec("git", ["rev-parse", "HEAD"], opts);
  return stdout.trim();
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
    dir = await createBootstrappedRepo("flume-pendinggate-lazy-");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writePending(entries: unknown): Promise<string> {
    return commitFiles(dir, {
      ".flume/plan/pending.json": JSON.stringify(entries),
    });
  }

  it("passes when a getter-backed writablePaths is only populated after pendingGate(...) is called", async () => {
    const sha = await writePending([validEntry]);
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
    const result = await gate.run(ctx(dir, { commitSha: sha }));
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/fence pre-check passed/);
  });

  it("fails, naming the path, when a getter-backed writablePaths narrows after pendingGate(...) is called", async () => {
    const sha = await writePending([
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
    const result = await gate.run(ctx(dir, { commitSha: sha }));
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/outside the target fence/);
    expect(result.details ?? "").toContain("docs/nope.md");
  });

  it("reflects a getter-backed entryChannelPaths populated after pendingGate(...) is called", async () => {
    const sha = await writePending([
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
    const result = await gate.run(ctx(dir, { commitSha: sha }));
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/fence pre-check passed/);
  });

  it("re-reads the fence on every run(), not just once after the first call", async () => {
    const sha = await writePending([validEntry]);
    let backing = ["src/**"];
    const targetFence = {
      get writablePaths() {
        return backing;
      },
    };
    const gate = pendingGate({ targetFence });

    const first = await gate.run(ctx(dir, { commitSha: sha }));
    expect(first.ok).toBe(true);

    backing = [];
    const second = await gate.run(ctx(dir, { commitSha: sha }));
    expect(second.ok).toBe(false);
    expect(second.details ?? "").toContain("src/foo.ts");
  });
});

describe("pendingGate — fence pre-check reads declared files, not observedFiles (engineering.md § The fix lands at the mechanism)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await createBootstrappedRepo("flume-pendinggate-declared-");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writePending(entries: unknown): Promise<string> {
    return commitFiles(dir, {
      ".flume/plan/pending.json": JSON.stringify(entries),
    });
  }

  it("passes an entry whose declared files all sit inside the fence but whose observedFiles names a path outside it", async () => {
    const sha = await writePending([
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
    const result = await gate.run(ctx(dir, { commitSha: sha }));
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/fence pre-check passed/);
  });
});

describe("pendingGate — hint option (PENDING-GATE-HINT-OPTION, engine-boundary.md § Capability vs convention)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await createBootstrappedRepo("flume-pendinggate-hint-");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writePending(entries: unknown): Promise<string> {
    return commitFiles(dir, {
      ".flume/plan/pending.json": JSON.stringify(entries),
    });
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
    const sha = await writePending([{ ...validEntry, mystery: "field" }]);
    const gate = pendingGate({
      targetFence: { writablePaths: ["src/**"] },
      hint: "park it, never re-scope",
    });
    const result = await gate.run(ctx(dir, { commitSha: sha }));
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/schema violation/);
    expect(result.message).toContain("park it, never re-scope");
  });

  it("leaves the schema-violation message unchanged when the hint is omitted", async () => {
    const sha = await writePending([{ ...validEntry, mystery: "field" }]);
    const gate = pendingGate({ targetFence: { writablePaths: ["src/**"] } });
    const result = await gate.run(ctx(dir, { commitSha: sha }));
    expect(result.ok).toBe(false);
    expect(result.message).toBe(
      `${join("plan", "pending.json")} has 1 schema violation(s)`,
    );
  });

  it("appends the hint to the fence-violation message when supplied", async () => {
    const sha = await writePending([outsideFenceEntry]);
    const gate = pendingGate({
      targetFence: { writablePaths: ["src/**"] },
      hint: "park it, never re-scope",
    });
    const result = await gate.run(ctx(dir, { commitSha: sha }));
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/outside the target fence/);
    expect(result.message).toContain("park it, never re-scope");
  });

  it("leaves the fence-violation message unchanged when the hint is omitted", async () => {
    const sha = await writePending([outsideFenceEntry]);
    const gate = pendingGate({ targetFence: { writablePaths: ["src/**"] } });
    const result = await gate.run(ctx(dir, { commitSha: sha }));
    expect(result.ok).toBe(false);
    expect(result.message).toBe(
      "1 pending entry declare files outside the target fence",
    );
  });
});

describe("pendingGate — stale-tip read (PENDING-GATE-STALE-TIP-READ)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await createBootstrappedRepo("flume-pendinggate-staletip-");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const offFenceEntry = {
    ...validEntry,
    files: {
      new: [],
      edit: [{ path: "spec/loop.md", description: "off-fence" }],
      retire: [],
    },
  };

  it("reverts the commit that introduces an off-fence declaration, not the next one", async () => {
    await commitFiles(dir, {
      ".flume/plan/pending.json": JSON.stringify([validEntry]),
    });
    const violatingSha = await commitFiles(dir, {
      ".flume/plan/pending.json": JSON.stringify([offFenceEntry]),
    });
    // The disk/working-tree copy still shows the clean, pre-violation
    // state — as it would for a fanout worktree commit whose branch hasn't
    // merged onto whatever tree `ctx.flumeDir` resolves to. Pre-fix,
    // `readFile(join(ctx.flumeDir, pendingPath))` reads exactly this stale
    // copy and wrongly passes the commit that introduced the violation —
    // the violation would only surface once some later write finally
    // synced the disk, misattributing it to whatever commit came next.
    await writeFile(
      join(dir, ".flume", "plan", "pending.json"),
      JSON.stringify([validEntry]),
      "utf8",
    );
    const gate = pendingGate({ targetFence: { writablePaths: ["src/**"] } });
    const result = await gate.run(ctx(dir, { commitSha: violatingSha }));
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/outside the target fence/);
  });

  it("passes a commit that removes a prior off-fence declaration, on its own commit", async () => {
    await commitFiles(dir, {
      ".flume/plan/pending.json": JSON.stringify([offFenceEntry]),
    });
    const fixSha = await commitFiles(dir, {
      ".flume/plan/pending.json": JSON.stringify([validEntry]),
    });
    // Mirror of the test above: the disk copy now races *ahead* of the
    // gated commit, reintroducing the violation the fix commit itself
    // removed. Pre-fix, the stale disk read sees this and wrongly reverts
    // the commit that fixed the violation (observed: 70f4632 -> c168d3b).
    await writeFile(
      join(dir, ".flume", "plan", "pending.json"),
      JSON.stringify([offFenceEntry]),
      "utf8",
    );
    const gate = pendingGate({ targetFence: { writablePaths: ["src/**"] } });
    const result = await gate.run(ctx(dir, { commitSha: fixSha }));
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/fence pre-check passed/);
  });

  it("reads a relocated flumeDir (pendingPath outside repoRoot) from disk, unchanged", async () => {
    const outside = await mkdtemp(
      join(tmpdir(), "flume-pendinggate-relocated-"),
    );
    try {
      const pendingDir = join(outside, "plan");
      await mkdir(pendingDir, { recursive: true });
      await writeFile(
        join(pendingDir, "pending.json"),
        JSON.stringify([validEntry]),
        "utf8",
      );
      // A commit must still exist to gate — the relocated queue lives
      // entirely outside git, so the gated commit's own content is
      // irrelevant to this read.
      const sha = await commitFiles(dir, { "src/foo.ts": "x" });
      const gate = pendingGate({ targetFence: { writablePaths: ["src/**"] } });
      const result = await gate.run(
        ctx(dir, { commitSha: sha, flumeDir: outside }),
      );
      expect(result.ok).toBe(true);
      expect(result.message).toMatch(/fence pre-check passed/);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

describe("pendingGate — real afterCommit shape (GATE-CONTEXT-STATE-ROOT-REL, engineering.md 'A seam gate reads what the real writer wrote')", () => {
  // Every other pendingGate test in this file builds its GateContext with
  // flumeDir *nested under* repoRoot (`ctx()`'s default) — the afterMerge/
  // no-worktree shape. That is not the shape `runAfterCommitGates` actually
  // builds: there, flumeDir is the *primary* checkout's state root and
  // repoRoot is a fanout worktree living *inside* it
  // (`<flumeDir>/worktrees/<slug>`), the reverse nesting. Pre-fix,
  // pendingGate derived its own relative offset from `ctx.repoRoot` and
  // `ctx.flumeDir` — correct only under the inverted fixture shape, and
  // misreading a real worktree's offset as a relocated state root, silently
  // falling back to the primary checkout's on-disk (pre-cherry-pick) copy.
  // This reproduces the real shape with an actual `git worktree add` so the
  // gate reads the *gated commit's* content through `stateRootRel`, not a
  // hand-authored fixture that never exercises the bug.
  let repo: string;
  let flumeDir: string;
  let worktreePath: string;

  beforeEach(async () => {
    repo = await createBootstrappedRepo("flume-pendinggate-realshape-");
    flumeDir = join(repo, ".flume");
    await commitFiles(repo, {
      ".flume/plan/pending.json": JSON.stringify([validEntry]),
    });
    worktreePath = join(flumeDir, "worktrees", "srr");
    await exec(
      "git",
      ["worktree", "add", "-b", "srr-work", worktreePath, "HEAD"],
      { cwd: repo },
    );
  });

  afterEach(async () => {
    await exec("git", ["worktree", "remove", "--force", worktreePath], {
      cwd: repo,
    }).catch(() => {});
    await rm(repo, { recursive: true, force: true });
  });

  it("reads the gated commit's tracked pending.json via stateRootRel, not the stale primary-checkout disk copy", async () => {
    const offFenceEntry = {
      ...validEntry,
      files: {
        new: [],
        edit: [{ path: "spec/loop.md", description: "off-fence" }],
        retire: [],
      },
    };
    // Committed on the worktree branch — the primary checkout's own disk
    // copy of `.flume/plan/pending.json` (under `flumeDir`) is untouched by
    // this and still holds the clean `validEntry` written above.
    const violatingSha = await commitFiles(
      worktreePath,
      { ".flume/plan/pending.json": JSON.stringify([offFenceEntry]) },
      "worktree: off-fence",
    );

    const gate = pendingGate({ targetFence: { writablePaths: ["src/**"] } });
    const result = await gate.run({
      cwd: worktreePath,
      repoRoot: worktreePath,
      flumeDir,
      stateRootRel: computeStateRootRel(repo, flumeDir),
      configDir: flumeDir,
      phaseName: "build",
      commitSha: violatingSha,
      log: () => {},
    });

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/outside the target fence/);
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

describe("Gate.command — shellGate renders cmd+args as one line (spec/chain.md 'The builtin gates')", () => {
  it("shellGate declares command as cmd followed by args, space-joined", () => {
    const gate = shellGate({
      name: "custom",
      when: "afterCommit",
      cmd: "tsc",
      args: ["--noEmit", "-p", "tsconfig.json"],
    });
    expect(gate.command).toBe("tsc --noEmit -p tsconfig.json");
  });

  it("shellGate with no args renders the bare cmd", () => {
    const gate = shellGate({
      name: "bare",
      when: "afterCommit",
      cmd: "pnpm",
      args: [],
    });
    expect(gate.command).toBe("pnpm");
  });

  it("tscGate/vitestGate/eslintGate declare their pnpm-flavored command bare", () => {
    expect(tscGate.command).toBe("pnpm tsc --noEmit");
    expect(vitestGate.command).toBe("pnpm test --run");
    expect(eslintGate.command).toBe("pnpm lint");
  });

  it("a pkgManagerGate override renders the overridden command, not the pnpm default", () => {
    const overridden = tscGate({
      cmd: "npm",
      args: ["exec", "--", "tsc", "--noEmit"],
    });
    expect(overridden.command).toBe("npm exec -- tsc --noEmit");
    expect(tscGate.command).toBe("pnpm tsc --noEmit");
  });

  it("chainLoadGate declares no command — no single command line to run", () => {
    expect(chainLoadGate.command).toBeUndefined();
  });

  it("writablePathsGate declares no command — no single command line to run", () => {
    expect(writablePathsGate(["**"]).command).toBeUndefined();
  });

  it("pendingGate declares no command — no single command line to run", () => {
    const gate = pendingGate({
      targetFence: { writablePaths: ["**"] },
    });
    expect(gate.command).toBeUndefined();
  });
});
