/**
 * The runtime-owned ignore set and the merge that applies it
 * (`src/runtimeIgnores.ts`): which entries land under a state root, that the
 * merge is create-or-append rather than a rewrite, and that a `.gitignore` it
 * cannot read escapes instead of being rewritten from "".
 *
 * The set's own cases drive the real merge and then ask the real reader —
 * git — what it would track, rather than asserting the set against a list
 * respelled here (`.claude/rules/engineering.md`, *A seam gate reads what the
 * real writer wrote*).
 */

import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  ensureRuntimeIgnores,
  RUNTIME_IGNORES,
} from "../src/runtimeIgnores.ts";
import {
  mergingMarkerPath,
  STATE_ROOT_NAMES,
  tickVerdictPath,
} from "../src/paths.ts";
import { mkTempDir } from "./helpers/fixtureRoot.ts";
import { SPAWN_BUDGET_MS, exec, gitOut } from "./helpers/subprocess.ts";

// This file starts processes, so it declares the lane's one budget — cases
// and hooks alike — once here rather than inheriting the runner's default
// (`SPAWN_BUDGET_MS`, `tests/helpers/subprocess.ts`).
vi.setConfig({ testTimeout: SPAWN_BUDGET_MS, hookTimeout: SPAWN_BUDGET_MS });

/** Scratch git repo on `main` with one seed commit. */
async function makeRepo(): Promise<{
  dir: string;
  cleanup: () => Promise<void>;
}> {
  const dir = await mkTempDir("flume-ignores-repo-");
  const opts = { cwd: dir };
  await exec("git", ["init", "-q", "-b", "main"], opts);
  await exec("git", ["config", "user.email", "test@example.com"], opts);
  await exec("git", ["config", "user.name", "Test User"], opts);
  await exec("git", ["config", "commit.gpgsign", "false"], opts);
  await writeFile(join(dir, "README.md"), "seed\n");
  await exec("git", ["add", "."], opts);
  await exec("git", ["commit", "-q", "-m", "seed"], opts);
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

describe("ensureRuntimeIgnores — create-or-merge", () => {
  it("creates .gitignore with exactly the runtime entries when absent", async () => {
    const dir = await mkTempDir("flume-ignores-");
    try {
      await ensureRuntimeIgnores(dir);
      const content = await readFile(join(dir, ".gitignore"), "utf8");
      expect(content).toBe(RUNTIME_IGNORES.join("\n") + "\n");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("is idempotent: a second run leaves the file byte-identical", async () => {
    const dir = await mkTempDir("flume-ignores-");
    try {
      await ensureRuntimeIgnores(dir);
      const first = await readFile(join(dir, ".gitignore"), "utf8");
      await ensureRuntimeIgnores(dir);
      expect(await readFile(join(dir, ".gitignore"), "utf8")).toBe(first);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("preserves template lines and order, appending only the missing entries", async () => {
    const dir = await mkTempDir("flume-ignores-");
    try {
      // Template already ignores one runtime entry and carries its own
      // chain-convention lines — merge must not duplicate or reorder.
      const template = "# harness scratch\nsessions/\nnode_modules/\n";
      await writeFile(join(dir, ".gitignore"), template, "utf8");
      await ensureRuntimeIgnores(dir);
      const content = await readFile(join(dir, ".gitignore"), "utf8");
      expect(content.startsWith(template)).toBe(true);
      expect(RUNTIME_IGNORES.length).toBeGreaterThan(0);
      for (const entry of RUNTIME_IGNORES) {
        expect(content).toContain(entry);
      }
      expect(content.match(/^node_modules\/$/gm)).toHaveLength(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("folds caller-supplied extra entries (a declared friction dir) alongside RUNTIME_IGNORES into a fresh .gitignore", async () => {
    const dir = await mkTempDir("flume-ignores-");
    try {
      await ensureRuntimeIgnores(dir, ["friction/"]);
      const content = await readFile(join(dir, ".gitignore"), "utf8");
      expect(content).toBe([...RUNTIME_IGNORES, "friction/"].join("\n") + "\n");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("is idempotent with extra entries: a second run with the same extra list leaves the file byte-identical", async () => {
    const dir = await mkTempDir("flume-ignores-");
    try {
      await ensureRuntimeIgnores(dir, ["friction/"]);
      const first = await readFile(join(dir, ".gitignore"), "utf8");
      await ensureRuntimeIgnores(dir, ["friction/"]);
      expect(await readFile(join(dir, ".gitignore"), "utf8")).toBe(first);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not duplicate an extra entry already present in a template, and preserves the template verbatim", async () => {
    const dir = await mkTempDir("flume-ignores-");
    try {
      const template = "# harness scratch\nfriction/\n";
      await writeFile(join(dir, ".gitignore"), template, "utf8");
      await ensureRuntimeIgnores(dir, ["friction/"]);
      const content = await readFile(join(dir, ".gitignore"), "utf8");
      expect(content.startsWith(template)).toBe(true);
      expect(content.match(/^friction\/$/gm)).toHaveLength(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// Mechanism pin (RUNTIME-IGNORES-NAMES-THE-TICK-ARTIFACTS, per spec/jobs.md
// "Runtime ignores"): the seeded set covered the dirs and the loop lock but
// stopped short of the runtime artifacts a tick drops beside them — the stop
// flag, the verdict history log and the per-phase verdict dir — so every
// state root the merge touched left them trackable, and the first `git add
// -A` after a tick committed harness runtime state. The names are the state
// root's own (`STATE_ROOT_NAMES`, `src/paths.ts`), so this drives the real
// ignore file through the real reader — git — rather than asserting the set
// against a list respelled here.
describe("ensureRuntimeIgnores — the runtime files a tick drops", () => {
  it("RUNTIME_IGNORES names the stop flag, the latest-tick verdict and the verdict log", async () => {
    // Vacuity (.claude/rules/engineering.md, "A green verdict is proven
    // non-vacuous"): an empty set would leave `check-ignore` below judging
    // nothing.
    expect(RUNTIME_IGNORES.length).toBeGreaterThan(0);
    const tickFiles = [
      STATE_ROOT_NAMES.stopFlag,
      STATE_ROOT_NAMES.tickVerdictsLog,
    ];
    for (const name of tickFiles) {
      expect(RUNTIME_IGNORES).toContain(name);
    }
    // The verdict is a directory of per-phase files, so its entry carries the
    // trailing slash a directory needs — a bare name ignores nothing here.
    expect(RUNTIME_IGNORES).toContain(`${STATE_ROOT_NAMES.tickVerdict}/`);

    const repo = await makeRepo();
    try {
      const stateRoot = join(repo.dir, ".flume");
      await mkdir(stateRoot, { recursive: true });
      await ensureRuntimeIgnores(stateRoot);
      // The artifacts as a tick leaves them: git only reports an ignore for
      // a path it would otherwise see, so write each one first.
      for (const name of tickFiles) {
        await writeFile(join(stateRoot, name), "");
      }
      // The verdict through its own accessor rather than a path spelled here
      // — two phases, because that is what the directory exists for and a
      // single file would have matched the artifact's old shape too.
      for (const phase of ["plan", "build"]) {
        const verdict = tickVerdictPath(stateRoot, phase);
        await mkdir(dirname(verdict), { recursive: true });
        await writeFile(verdict, "{}");
      }
      // git's own verdict on what it would track under the state root: the
      // merged `.gitignore` and nothing else.
      const seen = await gitOut(repo.dir, [
        "status",
        "--porcelain",
        "-uall",
        "--",
        ".flume",
      ]);
      expect(seen).toBe("?? .flume/.gitignore");
    } finally {
      await repo.cleanup();
    }
  });
});

// Mechanism pin (RUNTIME-IGNORES-NAMES-MERGING, per spec/jobs.md "Runtime
// ignores"): the merge stage stakes `<stateRoot>/merging/<slug>.json` before
// each pick and clears it after, so a crash mid-merge leaves the marker on
// disk — exactly the moment an operator reaches for `git add`. The seed
// covered every other runtime dir but not this one, so the crash artifact the
// next `loop` start refuses on was untracked-visible and addable. The name is
// the state root's own (`STATE_ROOT_NAMES`, `src/paths.ts`) and the marker
// path is built by the real accessor, so this drives the real writer through
// the real reader — git — rather than respelling either side here.
describe("ensureRuntimeIgnores — the crash-surviving merge marker", () => {
  it("RUNTIME_IGNORES names the merging-marker dir", async () => {
    // Vacuity (.claude/rules/engineering.md, "A green verdict is proven
    // non-vacuous"): an empty set would leave `status` below judging nothing.
    expect(RUNTIME_IGNORES.length).toBeGreaterThan(0);
    expect(RUNTIME_IGNORES).toContain(`${STATE_ROOT_NAMES.merging}/`);

    const repo = await makeRepo();
    try {
      const stateRoot = join(repo.dir, ".flume");
      await mkdir(stateRoot, { recursive: true });
      await ensureRuntimeIgnores(stateRoot);
      // The marker as an interrupted merge leaves it: git only reports an
      // ignore for a path it would otherwise see, so write it first.
      const marker = mergingMarkerPath(stateRoot, "some-entry-tag");
      await mkdir(dirname(marker), { recursive: true });
      await writeFile(marker, "{}\n");

      const seen = await gitOut(repo.dir, [
        "status",
        "--porcelain",
        "-uall",
        "--",
        ".flume",
      ]);
      expect(seen).toBe("?? .flume/.gitignore");
    } finally {
      await repo.cleanup();
    }
  });
});

/**
 * JOB-EXISTSSYNC-NARROW-ENOENT — `existsSync` collapses every stat error to
 * `false`, so a gate built on it reads a present-but-unreachable path as an
 * absent one: an unreadable ignore file rewritten from "" — a correct-looking
 * answer that is a lie about what was there
 * (`.claude/rules/engineering.md`, "Loud or nothing").
 *
 * A mode is the denial here, so the case declares posix and skips on win32,
 * where `chmod` denies nothing (`.claude/rules/platform-facts.md`, *`chmod`
 * denies nothing on win32*): the merge's subject is an unreadable *file*, for
 * which no structural substitute exists — a directory where the reader wants
 * a file fails `EISDIR`, but the write that follows would then fail too and
 * the case would stop proving which side refused.
 */
describe("ensureRuntimeIgnores — the ENOENT/EACCES split (JOB-EXISTSSYNC-NARROW-ENOENT)", () => {
  it.runIf(process.platform !== "win32")(
    "ensureRuntimeIgnores rethrows a non-ENOENT read failure instead of rewriting the .gitignore it could not read",
    async () => {
      const base = await mkTempDir("flume-ignores-denied-");
      const stateRoot = join(base, "state");
      try {
        await mkdir(stateRoot, { recursive: true });
        await writeFile(join(stateRoot, ".gitignore"), "sessions/\n", "utf8");
        await chmod(join(stateRoot, ".gitignore"), 0o000);

        let caught: NodeJS.ErrnoException | undefined;
        try {
          await ensureRuntimeIgnores(stateRoot);
        } catch (err) {
          caught = err as NodeJS.ErrnoException;
        }
        expect(caught).toBeDefined();
        expect(caught?.code).not.toBe("ENOENT");
        // The seed-authored line survives: an unreadable file read as ""
        // would have been rewritten with the runtime set alone.
        await chmod(join(stateRoot, ".gitignore"), 0o644);
        expect(await readFile(join(stateRoot, ".gitignore"), "utf8")).toBe(
          "sessions/\n",
        );
      } finally {
        await chmod(join(stateRoot, ".gitignore"), 0o644).catch(() => {});
        await rm(base, { recursive: true, force: true });
      }
    },
  );
});
