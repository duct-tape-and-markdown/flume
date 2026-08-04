import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  shellGate,
  tscGate,
  vitestGate,
  eslintGate,
  chainLoadGate,
  writablePathsGate,
  pendingGate,
} from "../src/builtinGates.ts";
import type { GateContext } from "../src/Gate.ts";

const exec = promisify(execFile);

function ctx(cwd: string, overrides: Partial<GateContext> = {}): GateContext {
  return {
    cwd,
    flumeDir: join(cwd, ".flume"),
    repoRoot: cwd,
    phaseName: "test-phase",
    log: () => {},
    ...overrides,
  };
}

describe("shellGate — ok path", () => {
  it("returns ok=true on exit 0 and surfaces stdout in details", async () => {
    const gate = shellGate({
      name: "shout",
      when: "afterCommit",
      cmd: "node",
      args: ["-e", "process.stdout.write('hello-stdout')"],
    });
    const result = await gate.run(ctx(process.cwd()));
    expect(result.ok).toBe(true);
    expect(result.message).toBe("shout green");
    expect(result.details).toContain("hello-stdout");
  });

  it("falls back to stderr in details when stdout is empty", async () => {
    const gate = shellGate({
      name: "warn",
      when: "afterCommit",
      cmd: "node",
      args: ["-e", "process.stderr.write('warn-stderr')"],
    });
    const result = await gate.run(ctx(process.cwd()));
    expect(result.ok).toBe(true);
    expect(result.details).toContain("warn-stderr");
  });
});

describe("shellGate — env option", () => {
  it("without env, behavior is byte-identical to today (no forced var leaks in)", async () => {
    const gate = shellGate({
      name: "no-env",
      when: "afterCommit",
      cmd: "node",
      args: ["-e", "process.stdout.write(process.env.SHELLGATE_ENV_OPTION_TEST ?? 'unset')"],
    });
    const result = await gate.run(ctx(process.cwd()));
    expect(result.ok).toBe(true);
    expect(result.details).toContain("unset");
  });

  it("with env, the spawned command observes the merged var", async () => {
    const gate = shellGate({
      name: "with-env",
      when: "afterCommit",
      cmd: "node",
      args: ["-e", "process.stdout.write(process.env.SHELLGATE_ENV_OPTION_TEST ?? 'unset')"],
      env: { SHELLGATE_ENV_OPTION_TEST: "bar" },
    });
    const result = await gate.run(ctx(process.cwd()));
    expect(result.ok).toBe(true);
    expect(result.details).toContain("bar");
  });

  it("merges env over process.env rather than replacing it", async () => {
    const gate = shellGate({
      name: "merged-env",
      when: "afterCommit",
      cmd: "node",
      args: [
        "-e",
        "process.stdout.write(typeof process.env.PATH === 'string' && process.env.FOO === 'bar' ? 'both-present' : 'missing')",
      ],
      env: { FOO: "bar" },
    });
    const result = await gate.run(ctx(process.cwd()));
    expect(result.ok).toBe(true);
    expect(result.details).toContain("both-present");
  });
});

describe("shellGate — fail path", () => {
  it("returns ok=false with failHint on non-zero exit", async () => {
    const gate = shellGate({
      name: "boom",
      when: "afterCommit",
      cmd: "node",
      args: ["-e", "process.stderr.write('explosion'); process.exit(1)"],
      failHint: "boom blew up",
    });
    const result = await gate.run(ctx(process.cwd()));
    expect(result.ok).toBe(false);
    expect(result.message).toBe("boom blew up");
    expect(result.details).toContain("explosion");
  });

  it("defaults the fail message to '<name> failed'", async () => {
    const gate = shellGate({
      name: "bare",
      when: "afterCommit",
      cmd: "node",
      args: ["-e", "process.exit(3)"],
    });
    const result = await gate.run(ctx(process.cwd()));
    expect(result.ok).toBe(false);
    expect(result.message).toBe("bare failed");
  });

  it("returns ok=false when the binary is missing", async () => {
    const gate = shellGate({
      name: "absent",
      when: "afterCommit",
      cmd: "definitely-not-a-real-binary-xyz",
      args: [],
    });
    const result = await gate.run(ctx(process.cwd()));
    expect(result.ok).toBe(false);
    expect(result.message).toBe("absent failed");
  });
});

// Node refuses to spawn .cmd shims without a shell (CVE-2024-27980
// hardening), so an extension-less command that resolves only to a .cmd
// shim ENOENTs on the direct spawn and must go green through execGate's
// shell retry. Only observable on hosts where .cmd is an executable form.
describe.runIf(process.platform === "win32")(
  "shellGate — win32 .cmd shim fallback",
  () => {
    let shimDir: string;
    let originalPath: string | undefined;

    beforeEach(async () => {
      shimDir = await mkdtemp(join(tmpdir(), "flume-shim-"));
      await writeFile(
        join(shimDir, "flume-shim-fixture.cmd"),
        "@echo off\r\necho shim-ok %1\r\n",
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

    it("turns green via the shell retry when only a .cmd shim exists", async () => {
      const gate = shellGate({
        name: "shim",
        when: "afterCommit",
        cmd: "flume-shim-fixture",
        args: ["arg1"],
      });
      const result = await gate.run(ctx(process.cwd()));
      expect(result.ok).toBe(true);
      expect(result.message).toBe("shim green");
      expect(result.details).toContain("shim-ok arg1");
    });

    it("still reports ok=false when the shim exits non-zero through the retry", async () => {
      await writeFile(
        join(shimDir, "flume-shim-red.cmd"),
        "@echo off\r\necho shim-stderr 1>&2\r\nexit /b 7\r\n",
      );
      const gate = shellGate({
        name: "shim-red",
        when: "afterCommit",
        cmd: "flume-shim-red",
        args: [],
      });
      const result = await gate.run(ctx(process.cwd()));
      expect(result.ok).toBe(false);
      expect(result.message).toBe("shim-red failed");
      expect(result.details).toContain("shim-stderr");
    });
  },
);

async function createBootstrappedRepo(prefix = "flume-gate-"): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), prefix));
  const opts = { cwd: repo };
  await exec("git", ["init", "-q"], opts);
  await exec("git", ["config", "user.email", "test@example.com"], opts);
  await exec("git", ["config", "user.name", "Test User"], opts);
  await exec("git", ["config", "commit.gpgsign", "false"], opts);
  // Byte-exact checkout on Windows: revert-path assertions compare file
  // content, and a host-level autocrlf=true would rewrite LF on reset.
  await exec("git", ["config", "core.autocrlf", "false"], opts);
  // Seed an initial commit so HEAD exists and `git show` works cleanly.
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

describe("writablePathsGate — git-backed checks", () => {
  let repo: string;

  beforeEach(async () => {
    repo = await createBootstrappedRepo();
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it("accepts a commit whose paths all sit inside the globs", async () => {
    const sha = await commitFiles(repo, {
      "src/foo.ts": "x",
      "src/nested/bar.ts": "y",
    });
    const gate = writablePathsGate(["src/**"]);
    const result = await gate.run(ctx(repo, { commitSha: sha }));
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/writable paths respected/);
  });

  it("rejects a commit whose paths fall outside the globs", async () => {
    const sha = await commitFiles(repo, {
      "src/foo.ts": "x",
      "spec/bad.md": "stay out",
    });
    const gate = writablePathsGate(["src/**"]);
    const result = await gate.run(ctx(repo, { commitSha: sha }));
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/1 path/);
    expect(result.details ?? "").toContain("spec/bad.md");
    expect(result.details ?? "").not.toContain("src/foo.ts");
  });

  it("supports literal file globs alongside ** patterns", async () => {
    const sha = await commitFiles(repo, {
      "package.json": "{}",
      "src/foo.ts": "x",
    });
    const gate = writablePathsGate(["src/**", "package.json"]);
    const result = await gate.run(ctx(repo, { commitSha: sha }));
    expect(result.ok).toBe(true);
  });

  it("treats `*` as a single-segment match (not `**`)", async () => {
    const sha = await commitFiles(repo, {
      "src/foo.ts": "x",
      "src/nested/deep.ts": "y",
    });
    const gate = writablePathsGate(["src/*"]);
    const result = await gate.run(ctx(repo, { commitSha: sha }));
    expect(result.ok).toBe(false);
    expect(result.details ?? "").toContain("src/nested/deep.ts");
    expect(result.details ?? "").not.toContain("src/foo.ts");
  });

  it("fails fast when commitSha is missing from the context", async () => {
    const gate = writablePathsGate(["src/**"]);
    const result = await gate.run(ctx(repo));
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/requires commitSha/);
  });
});

describe("afterCommit vs afterMerge wiring", () => {
  it("shellGate carries the declared lifecycle phase", () => {
    const earlyGate = shellGate({
      name: "early",
      when: "afterCommit",
      cmd: "node",
      args: ["-e", ""],
    });
    const lateGate = shellGate({
      name: "late",
      when: "afterMerge",
      cmd: "node",
      args: ["-e", ""],
    });
    expect(earlyGate.when).toBe("afterCommit");
    expect(lateGate.when).toBe("afterMerge");
  });

  it("the built-in afterCommit gates all declare when=afterCommit", () => {
    expect(tscGate.when).toBe("afterCommit");
    expect(vitestGate.when).toBe("afterCommit");
    expect(eslintGate.when).toBe("afterCommit");
    expect(writablePathsGate(["**"]).when).toBe("afterCommit");
  });

  it("the same shellGate body works in either lifecycle slot", async () => {
    const make = (when: "afterCommit" | "afterMerge") =>
      shellGate({
        name: `noop-${when}`,
        when,
        cmd: "node",
        args: ["-e", "process.stdout.write('ok')"],
      });
    const afterCommitResult = await make("afterCommit").run(ctx(process.cwd()));
    const afterMergeResult = await make("afterMerge").run(ctx(process.cwd()));
    expect(afterCommitResult.ok).toBe(true);
    expect(afterMergeResult.ok).toBe(true);
  });

  it("chainLoadGate declares afterCommit", () => {
    expect(chainLoadGate.when).toBe("afterCommit");
    expect(chainLoadGate.name).toBe("chain-load");
  });
});

// ---------- chainLoadGate (RELEASE-v0.2 §3) ----------

const VALID_CHAIN =
  `export default () => ({ chain: { phases: [{ name: "a", description: "", ` +
  `promptPath: "p.md", concurrency: "singleton", writablePaths: ["**"], ` +
  `gates: [], handoff: () => [] }], humanOnly: [] } });\n`;

describe("chainLoadGate — post-tick chain.ts validation", () => {
  let repo: string;

  beforeEach(async () => {
    repo = await createBootstrappedRepo("flume-chainload-");
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it("passes a commit whose post-tick .flume/chain.ts loads as a valid Chain", async () => {
    const sha = await commitFiles(
      repo,
      { ".flume/chain.ts": VALID_CHAIN },
      "build: rewrite chain",
    );
    const result = await chainLoadGate.run(ctx(repo, { commitSha: sha }));
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/valid Chain/);
  });

  it("is a no-op when the commit did not touch .flume/chain.ts", async () => {
    const sha = await commitFiles(
      repo,
      { "src/unrelated.ts": "export const x = 1;\n" },
      "build: unrelated",
    );
    const result = await chainLoadGate.run(ctx(repo, { commitSha: sha }));
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/untouched/);
  });

  it("fails a syntactically-broken chain.ts", async () => {
    // Last-good chain.ts on trunk; the broken rewrite must revert to this.
    await commitFiles(repo, { ".flume/chain.ts": VALID_CHAIN }, "build: good chain");
    const brokenSha = await commitFiles(
      repo,
      { ".flume/chain.ts": "export default { phases: [" },
      "build: rewrite chain (broken)",
    );

    const result = await chainLoadGate.run(
      ctx(repo, { commitSha: brokenSha }),
    );
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/broken/);
    expect(result.details ?? "").not.toBe("");
  });

  it("fails a chain.ts that has no default export", async () => {
    const sha = await commitFiles(
      repo,
      { ".flume/chain.ts": "export const notTheDefault = 1;\n" },
      "build: no default export",
    );
    const result = await chainLoadGate.run(ctx(repo, { commitSha: sha }));
    expect(result.ok).toBe(false);
    expect(result.details ?? "").toMatch(/default-export a chain factory/);
  });

  it("fails fast when commitSha is missing from the context", async () => {
    const result = await chainLoadGate.run(ctx(repo));
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/requires commitSha/);
  });
});

// ---------- ctx.touchedPaths dedup (GATECONTEXT-TOUCHED-PATHS-DEDUP,
// engineering.md "The fix lands at the mechanism") ----------

describe("chainLoadGate / writablePathsGate — consume ctx.touchedPaths, no independent git show", () => {
  let notARepo: string;

  beforeEach(async () => {
    // Not a git repository: if either gate tried to shell out its own
    // `git show --name-only` here, that exec would reject and the gate's
    // run() promise would reject too — a clean resolve below is only
    // possible because the gate trusted ctx.touchedPaths instead.
    notARepo = await mkdtemp(join(tmpdir(), "flume-gate-notrepo-"));
  });

  afterEach(async () => {
    await rm(notARepo, { recursive: true, force: true });
  });

  it("writablePathsGate passes based on injected touchedPaths alone", async () => {
    const gate = writablePathsGate(["src/**"]);
    const result = await gate.run(
      ctx(notARepo, { commitSha: "deadbeef", touchedPaths: ["src/foo.ts"] }),
    );
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/writable paths respected/);
  });

  it("writablePathsGate fails based on injected touchedPaths alone, naming the offending path", async () => {
    const gate = writablePathsGate(["src/**"]);
    const result = await gate.run(
      ctx(notARepo, { commitSha: "deadbeef", touchedPaths: ["spec/bad.md"] }),
    );
    expect(result.ok).toBe(false);
    expect(result.details ?? "").toContain("spec/bad.md");
  });

  it("chainLoadGate skips (untouched) based on injected touchedPaths alone", async () => {
    const result = await chainLoadGate.run(
      ctx(notARepo, { commitSha: "deadbeef", touchedPaths: ["src/unrelated.ts"] }),
    );
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/untouched/);
  });

  it("chainLoadGate loads chain.ts straight off ctx.cwd when injected touchedPaths names it, without deriving touched paths from git", async () => {
    await mkdir(join(notARepo, ".flume"), { recursive: true });
    await writeFile(join(notARepo, ".flume", "chain.ts"), VALID_CHAIN, "utf8");
    const result = await chainLoadGate.run(
      ctx(notARepo, {
        commitSha: "deadbeef",
        touchedPaths: [".flume/chain.ts"],
      }),
    );
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/valid Chain/);
  });

  it("both gates still fall back to git show when ctx.touchedPaths is omitted — a hand-built ctx keeps working", async () => {
    const repo = await createBootstrappedRepo("flume-touchedpaths-fallback-");
    try {
      const sha = await commitFiles(repo, { "src/foo.ts": "x" });
      const wp = await writablePathsGate(["src/**"]).run(
        ctx(repo, { commitSha: sha }),
      );
      expect(wp.ok).toBe(true);
      const cl = await chainLoadGate.run(ctx(repo, { commitSha: sha }));
      expect(cl.ok).toBe(true);
      expect(cl.message).toMatch(/untouched/);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });
});

// ---------- pendingGate (RELEASE-v0.8 §6) ----------

describe("pendingGate — composed validation + fence pre-check", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "flume-pendinggate-"));
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

  it("passes a valid queue whose declared files sit inside the target fence", async () => {
    await writePending([validEntry]);
    const gate = pendingGate({ targetFence: { writablePaths: ["src/**"] } });
    const result = await gate.run(ctx(dir));
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/fence pre-check passed/);
  });

  it("fails composed validation on an unknown field with no declared extension", async () => {
    await writePending([{ ...validEntry, mystery: "field" }]);
    const gate = pendingGate({ targetFence: { writablePaths: ["src/**"] } });
    const result = await gate.run(ctx(dir));
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/schema violation/);
  });

  it("validates against a chain-declared extension", async () => {
    const extension = {
      summary: { schema: z.string().min(1), hint: '"one-line"' },
    };
    await writePending([{ ...validEntry, summary: "does a thing" }]);
    const gate = pendingGate({
      targetFence: { writablePaths: ["src/**"] },
      extension,
    });
    const result = await gate.run(ctx(dir));
    expect(result.ok).toBe(true);
  });

  it("fails the fence pre-check naming the offending path", async () => {
    await writePending([
      {
        ...validEntry,
        files: {
          new: [],
          edit: [{ path: "spec/loop.md", description: "nope" }],
          retire: [],
        },
      },
    ]);
    const gate = pendingGate({ targetFence: { writablePaths: ["src/**"] } });
    const result = await gate.run(ctx(dir));
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/outside the target fence/);
    expect(result.details ?? "").toContain("spec/loop.md");
    expect(result.details ?? "").toContain("SOME-TAG");
  });

  it("includes entryChannelPaths in the fence alongside writablePaths", async () => {
    await writePending([
      validEntry,
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
    const gate = pendingGate({
      targetFence: {
        writablePaths: ["src/**"],
        entryChannelPaths: ["tests/**"],
      },
    });
    const result = await gate.run(ctx(dir));
    expect(result.ok).toBe(true);
  });

  it("passes an empty queue — a fully-drained pending.json has nothing to fence", async () => {
    await writePending([]);
    const gate = pendingGate({ targetFence: { writablePaths: ["src/**"] } });
    const result = await gate.run(ctx(dir));
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/\(0 entries\)/);
  });

  it("reports pending.json missing after commit", async () => {
    const gate = pendingGate({ targetFence: { writablePaths: ["src/**"] } });
    const result = await gate.run(ctx(dir));
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/missing after commit/);
  });

  it("reads pending.json from a custom pendingPath", async () => {
    await mkdir(join(dir, ".flume", "custom"), { recursive: true });
    await writeFile(
      join(dir, ".flume", "custom", "queue.json"),
      JSON.stringify([validEntry]),
      "utf8",
    );
    const gate = pendingGate({
      targetFence: { writablePaths: ["src/**"] },
      pendingPath: join("custom", "queue.json"),
    });
    const result = await gate.run(ctx(dir));
    expect(result.ok).toBe(true);
  });

  it("omitting fenceWhen fences every entry, matching current behavior", async () => {
    await writePending([
      {
        ...validEntry,
        gate: { kind: "parked", reason: "blocked on human decision" },
        files: {
          new: [],
          edit: [{ path: "spec/loop.md", description: "nope" }],
          retire: [],
        },
      },
    ]);
    const gate = pendingGate({ targetFence: { writablePaths: ["src/**"] } });
    const result = await gate.run(ctx(dir));
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/outside the target fence/);
  });

  it("fenceWhen exempts an entry it returns false for", async () => {
    await writePending([
      {
        ...validEntry,
        gate: { kind: "parked", reason: "blocked on human decision" },
        files: {
          new: [],
          edit: [{ path: "spec/loop.md", description: "nope" }],
          retire: [],
        },
      },
    ]);
    const gate = pendingGate({
      targetFence: { writablePaths: ["src/**"] },
      fenceWhen: (entry) => entry.gate.kind !== "parked",
    });
    const result = await gate.run(ctx(dir));
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/fence pre-check passed/);
  });

  it("fenceWhen still checks entries it returns true for", async () => {
    await writePending([
      {
        ...validEntry,
        gate: { kind: "parked", reason: "blocked on human decision" },
        files: {
          new: [],
          edit: [{ path: "spec/loop.md", description: "nope" }],
          retire: [],
        },
      },
      {
        tag: "OTHER-TAG",
        gate: { kind: "open" },
        dependsOnForks: [],
        files: {
          new: [],
          edit: [{ path: "docs/nope.md", description: "also nope" }],
          retire: [],
        },
      },
    ]);
    const gate = pendingGate({
      targetFence: { writablePaths: ["src/**"] },
      fenceWhen: (entry) => entry.gate.kind !== "parked",
    });
    const result = await gate.run(ctx(dir));
    expect(result.ok).toBe(false);
    expect(result.details ?? "").toContain("OTHER-TAG");
    expect(result.details ?? "").not.toContain("SOME-TAG");
  });
});
