import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  shellGate,
  tscGate,
  vitestGate,
  eslintGate,
  chainLoadGate,
  writablePathsGate,
} from "../src/builtinGates.ts";
import type { GateContext } from "../src/Gate.ts";

const exec = promisify(execFile);

function ctx(cwd: string, overrides: Partial<GateContext> = {}): GateContext {
  return {
    cwd,
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

describe("writablePathsGate — git-backed checks", () => {
  let repo: string;

  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), "flume-gate-"));
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
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  async function commitFiles(files: Record<string, string>): Promise<string> {
    for (const [rel, content] of Object.entries(files)) {
      const abs = join(repo, rel);
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, content);
    }
    const opts = { cwd: repo };
    await exec("git", ["add", "."], opts);
    await exec("git", ["commit", "-q", "-m", "candidate"], opts);
    const { stdout } = await exec("git", ["rev-parse", "HEAD"], opts);
    return stdout.trim();
  }

  it("accepts a commit whose paths all sit inside the globs", async () => {
    const sha = await commitFiles({
      "src/foo.ts": "x",
      "src/nested/bar.ts": "y",
    });
    const gate = writablePathsGate(["src/**"]);
    const result = await gate.run(ctx(repo, { commitSha: sha }));
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/writable paths respected/);
  });

  it("rejects a commit whose paths fall outside the globs", async () => {
    const sha = await commitFiles({
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
    const sha = await commitFiles({
      "package.json": "{}",
      "src/foo.ts": "x",
    });
    const gate = writablePathsGate(["src/**", "package.json"]);
    const result = await gate.run(ctx(repo, { commitSha: sha }));
    expect(result.ok).toBe(true);
  });

  it("treats `*` as a single-segment match (not `**`)", async () => {
    const sha = await commitFiles({
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
  `export default { phases: [{ name: "a", description: "", ` +
  `promptPath: "p.md", concurrency: "singleton", writablePaths: ["**"], ` +
  `gates: [], handoff: () => [] }], humanOnly: [] };\n`;

describe("chainLoadGate — post-tick chain.ts validation", () => {
  let repo: string;

  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), "flume-chainload-"));
    const opts = { cwd: repo };
    await exec("git", ["init", "-q"], opts);
    await exec("git", ["config", "user.email", "test@example.com"], opts);
    await exec("git", ["config", "user.name", "Test User"], opts);
    await exec("git", ["config", "commit.gpgsign", "false"], opts);
    // Byte-exact checkout on Windows: revert-path assertions compare file
    // content, and a host-level autocrlf=true would rewrite LF on reset.
    await exec("git", ["config", "core.autocrlf", "false"], opts);
    await writeFile(join(repo, ".seed"), "");
    await exec("git", ["add", "."], opts);
    await exec("git", ["commit", "-q", "-m", "seed"], opts);
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  async function commit(
    files: Record<string, string>,
    msg: string,
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

  it("passes a commit whose post-tick .flume/chain.ts loads as a valid Chain", async () => {
    const sha = await commit(
      { ".flume/chain.ts": VALID_CHAIN },
      "build: rewrite chain",
    );
    const result = await chainLoadGate.run(ctx(repo, { commitSha: sha }));
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/valid Chain/);
  });

  it("is a no-op when the commit did not touch .flume/chain.ts", async () => {
    const sha = await commit(
      { "src/unrelated.ts": "export const x = 1;\n" },
      "build: unrelated",
    );
    const result = await chainLoadGate.run(ctx(repo, { commitSha: sha }));
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/untouched/);
  });

  it("fails a syntactically-broken chain.ts → reverting the commit restores the last-good chain", async () => {
    // Last-good chain.ts on trunk; the broken rewrite must revert to this.
    await commit({ ".flume/chain.ts": VALID_CHAIN }, "build: good chain");
    const brokenSha = await commit(
      { ".flume/chain.ts": "export default { phases: [" },
      "build: rewrite chain (broken)",
    );

    const result = await chainLoadGate.run(
      ctx(repo, { commitSha: brokenSha }),
    );
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/broken/);
    expect(result.details ?? "").not.toBe("");

    // Gate failure ⇒ the dispatcher drops the commit (hard reset). chain.ts
    // is back to the last-good version; the next resolution would succeed.
    await exec("git", ["reset", "--hard", "HEAD~1"], { cwd: repo });
    expect(
      await readFile(join(repo, ".flume", "chain.ts"), "utf8"),
    ).toBe(VALID_CHAIN);
  });

  it("fails a chain.ts that has no default export", async () => {
    const sha = await commit(
      { ".flume/chain.ts": "export const notTheDefault = 1;\n" },
      "build: no default export",
    );
    const result = await chainLoadGate.run(ctx(repo, { commitSha: sha }));
    expect(result.ok).toBe(false);
    expect(result.details ?? "").toMatch(/default-export a Chain/);
  });

  it("fails fast when commitSha is missing from the context", async () => {
    const result = await chainLoadGate.run(ctx(repo));
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/requires commitSha/);
  });
});
