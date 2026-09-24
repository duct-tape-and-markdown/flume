/**
 * The pending ledger's relocation check (`isPendingRelocated`,
 * `src/pendingLedger.ts`) — the one fact the ledger's reads and its rewrite
 * both turn on, and the one this module decides for itself rather than being
 * handed.
 *
 * What the module's other context-taking calls *return* is exercised
 * end-to-end through a real tick (`tests/Dispatcher.test.ts`), because what
 * they read is a committed tip and what they write is a harness commit. This
 * one is a pure verdict over two paths, so it is pinned where it is decided:
 * against `computeStateRootRel` (`src/paths.ts`), which answers the same
 * question about the state root the ledger sits under. The two must agree —
 * a ledger the dispatcher reports as in-tree while the rewrite treats it as
 * an out-of-tree dock would write the queue to disk and commit nothing, and
 * the next tick would dispatch off a tip that never moved.
 *
 * Beside it, the one chain-less read (`readPendingLoose`): it takes a bare
 * path because it runs where no chain resolved, so it is driven directly
 * here rather than through a tick.
 *
 * And beside both, what this module's reports **name** — the tolerant read's
 * two degrades, the strict read's refusal, and the decide-read's rethrow.
 * Each is a report about the chain's own queue, so each is pinned here over a
 * declared directory that is not the default one, where a hand-spelled name
 * shows up as a lie rather than as a coincidence.
 */

import { rmSync, symlinkSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { Logger } from "../src/log.ts";
import { computeStateRootRel } from "../src/paths.ts";
import {
  commitPendingUpdate,
  isPendingRelocated,
  readPendingForDecision,
  readPendingLoose,
  readPendingTolerant,
  type PendingLedgerContext,
} from "../src/pendingLedger.ts";
import { entryFileName, PendingParseFailure } from "../src/PendingSchema.ts";
import { denyDirectory } from "./helpers/denial.ts";
import { silent } from "./helpers/dispatcherFixture.ts";
import { mkTempDir } from "./helpers/fixtureRoot.ts";
import { makeScratchRepo } from "./helpers/scratchRepo.ts";
import { SPAWN_BUDGET_MS, exec } from "./helpers/subprocess.ts";

// The strict-refusal cases below seed a real repository, so this file starts
// processes and declares the lane's one budget — cases and hooks alike — once
// here rather than inheriting the runner's default (`SPAWN_BUDGET_MS`,
// `tests/helpers/subprocess.ts`).
vi.setConfig({ testTimeout: SPAWN_BUDGET_MS, hookTimeout: SPAWN_BUDGET_MS });

const REPO = join("/", "tmp", "flume-ledger-repo");

/** The four fields a read takes; only two of them decide this verdict. */
function ctx(pendingDir: string): PendingLedgerContext {
  return {
    repoRoot: REPO,
    pendingDir,
    entryExtension: undefined,
    log: silent,
  };
}

describe(
  "pendingLedger — isPendingRelocated agrees with computeStateRootRel " +
    '(.claude/rules/engineering.md "The fix lands at the mechanism")',
  () => {
    it("agrees with computeStateRootRel on a relocated (out-of-tree) pendingDir", () => {
      const dock = join("/", "tmp", "flume-ledger-dock");
      const pendingDir = join(dock, "plan", "pending");
      expect(computeStateRootRel(REPO, pendingDir)).toBeUndefined();
      expect(isPendingRelocated(ctx(pendingDir))).toBe(true);
    });

    it("agrees with computeStateRootRel on a normal in-tree pendingDir", () => {
      const pendingDir = join(REPO, ".flume", "plan", "pending");
      expect(computeStateRootRel(REPO, pendingDir)).toBeDefined();
      expect(isPendingRelocated(ctx(pendingDir))).toBe(false);
    });
  },
);

/**
 * `readPendingLoose` is the one probe `flume status` reads its count
 * through, and the split it gives a failed read is the whole claim: absent
 * is the empty queue, anything else escapes rather than reading as empty
 * (`.claude/rules/engineering.md`, "Loud or nothing").
 */
describe("readPendingLoose — the ENOENT/other split", () => {
  it("an absent pending directory reads as nothing pending", async () => {
    const dir = await mkTempDir("flume-loose-absent-");
    try {
      const pendingDir = join(dir, "plan", "pending");
      expect(readPendingLoose(pendingDir)).toEqual({
        ok: true,
        entries: [],
        errors: [],
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("readPendingLoose rethrows a non-ENOENT listing failure instead of reading it as absent — existsSync collapses any stat error, not just ENOENT, to false (JOB-READPENDINGLOOSE-NARROW-ENOENT)", async () => {
    const dir = await mkTempDir("flume-loose-denied-");
    try {
      const pendingDir = join(dir, "plan", "pending");
      await mkdir(pendingDir, { recursive: true });
      // Non-vacuity: the queue reads before it is denied.
      expect(readPendingLoose(pendingDir).ok).toBe(true);

      // Deny the queue directory structurally (`tests/helpers/denial.ts`):
      // the path is still there to a stat, and the listing fails ENOTDIR —
      // not ENOENT (`.claude/rules/engineering.md`, "Loud or nothing").
      // Denying the *parent* would not arm this on every host: win32 reports
      // a path through a non-directory as ENOENT, so the gate would take its
      // absent arm there (`tests/helpers/denial.ts`, *deny the exact path*).
      denyDirectory(pendingDir);

      let caught: NodeJS.ErrnoException | undefined;
      try {
        readPendingLoose(pendingDir);
      } catch (err) {
        caught = err as NodeJS.ErrnoException;
      }
      expect(caught).toBeDefined();
      expect(caught?.code).not.toBe("ENOENT");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("a *.json directly under the pending directory is an entry and a subdirectory is not walked", async () => {
    const dir = await mkTempDir("flume-loose-listing-");
    try {
      const pendingDir = join(dir, "plan", "pending");
      const sidecar = join(pendingDir, "drafts");
      await mkdir(sidecar, { recursive: true });
      const entry = (tag: string) =>
        JSON.stringify({
          tag,
          gate: { kind: "open" },
          files: { new: [], edit: [], retire: [] },
        });

      await writeFile(join(pendingDir, entryFileName("TOP-LEVEL")), entry("TOP-LEVEL"));
      // Beside the entries and never read as one: not a `*.json`, so the
      // listing skips it rather than refusing over it.
      await writeFile(join(pendingDir, ".gitkeep"), "");
      await writeFile(join(pendingDir, "NOTES.md"), "not an entry\n");
      // One level down. A valid entry by its bytes, so if the walk descended
      // the queue would read two — and the sidecar's own name ends in
      // `.json` too, so a listing that filtered by suffix without asking what
      // the row *is* would read the directory itself as an entry.
      await writeFile(join(sidecar, entryFileName("NESTED")), entry("NESTED"));
      await mkdir(join(pendingDir, "archive.json"), { recursive: true });

      const result = readPendingLoose(pendingDir);
      expect({ ok: result.ok, errors: result.errors }).toEqual({
        ok: true,
        errors: [],
      });
      expect(result.entries.map((e) => e.tag)).toEqual(["TOP-LEVEL"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

/**
 * The tolerant read is the one reader here that **narrates** — every way it
 * can fail degrades to `[]` with a warn, and that warn is the only place an
 * operator learns the queue they are looking at came back empty for a reason
 * (`src/pendingLedger.ts`, `readPendingTolerant`). A chain declares where its
 * ledger lives, so the announcement names what the chain declared rather than
 * the directory this repo happens to use
 * (`.claude/rules/engineering.md`, *A fact the engine holds is reported, never
 * rediscovered*).
 *
 * Denied structurally rather than by a mode, so no arm rests on a permission
 * bit (`tests/helpers/denial.ts`). Posix-declared, because the read arm needs
 * an entry the listing names and nothing can open: a directory at that name
 * is a subdirectory the listing skips by contract, so a self-referential
 * symlink is the only shape left. Why that host and what it costs is the
 * ledger's (`tests/helpers/host-declarations.json`).
 */
describe.runIf(process.platform !== "win32")(
  "readPendingTolerant — what a degrade announces",
  () => {
  it("a tolerant read's listing, read and parse warns each name the chain's declared pending directory", async () => {
    const repoRoot = await mkTempDir("flume-tolerant-warns-");
    try {
      // Neither the default name nor the default dock: this chain declared
      // `queue/ledger`, and that is the only spelling any of the
      // announcements below may carry.
      const pendingDir = join(repoRoot, "queue", "ledger");
      const declared = "queue/ledger";
      await mkdir(pendingDir, { recursive: true });

      const warns: string[] = [];
      const log: Logger = {
        info: () => {},
        warn: (line) => warns.push(line),
        error: () => {},
      };
      const ctx: PendingLedgerContext = {
        repoRoot,
        pendingDir,
        entryExtension: undefined,
        log,
      };

      // Non-vacuity: the declared ledger reads clean and announces nothing,
      // so each warn below is the arm above it talking
      // (`.claude/rules/engineering.md`, *A green verdict is proven
      // non-vacuous*).
      expect(await readPendingTolerant(ctx)).toEqual([]);
      expect(warns).toEqual([]);

      // Listing arm: a plain file where the directory is listed refuses with
      // a non-ENOENT disposition on every host.
      denyDirectory(pendingDir);
      expect(await readPendingTolerant(ctx)).toEqual([]);

      // Read arm: the directory lists, and an entry it names cannot be read
      // — ELOOP at the read path and never at its parent. Not a permission
      // bit, and not a directory either: the listing skips a subdirectory by
      // contract, so it would never reach the read this arm is about.
      await rm(pendingDir, { recursive: true, force: true });
      await mkdir(pendingDir, { recursive: true });
      symlinkSync(
        entryFileName("SOME-TAG"),
        join(pendingDir, entryFileName("SOME-TAG")),
      );
      expect(await readPendingTolerant(ctx)).toEqual([]);

      // Parse arm: readable, and not the entry the schema takes.
      rmSync(join(pendingDir, entryFileName("SOME-TAG")));
      await writeFile(
        join(pendingDir, entryFileName("SOME-TAG")),
        "{}",
        "utf8",
      );
      expect(await readPendingTolerant(ctx)).toEqual([]);

      expect(warns).toHaveLength(3);
      const [listWarn, readWarn, parseWarn] = warns as [string, string, string];
      expect(listWarn).toContain(`${declared} could not be read`);
      expect(readWarn).toContain(`${declared} could not be read`);
      expect(parseWarn).toContain(`${declared} failed to parse`);
      } finally {
        await rm(repoRoot, { recursive: true, force: true });
      }
    });
  },
);

/**
 * The strict read is the one that refuses, and a refusal is read by an
 * operator with nothing but its own sentence to go on — so the file it names
 * has to be the file the chain declared
 * (`.claude/rules/engineering.md`, *A fact the engine holds is reported,
 * never rediscovered*). Two ways it reaches one: bare, from
 * `commitPendingUpdate`'s rewrite read, and re-thrown with the fence verdict
 * behind it, from `readPendingForDecision`.
 *
 * Driven over a real repository on a declared `queue/ledger`, because
 * the strict read resolves the committed tip rather than the tree
 * (spec/pending.md, "Dispatch reads come from the tip, not the tree"): a
 * corruption only this read can see is one that is committed, and a ledger at
 * the default dock would let a hand-spelled name read as a coincidence.
 */
describe("readPending — what a strict refusal names", () => {
  it("a strict pending read's parse refusal names the chain's declared ledger path", async () => {
    const repo = await makeScratchRepo("flume-strict-refusal-", "main");
    try {
      const pendingDir = join(repo.dir, "queue", "ledger");
      const declared = "queue/ledger";
      await mkdir(pendingDir, { recursive: true });
      const entryPath = join(pendingDir, entryFileName("SOME-TAG"));
      await writeFile(
        entryPath,
        JSON.stringify({
          tag: "SOME-TAG",
          gate: { kind: "open" },
          files: { new: [], edit: [], retire: [] },
        }) + "\n",
        "utf8",
      );
      await exec("git", ["add", "."], { cwd: repo.dir });
      await exec("git", ["commit", "-q", "-m", "ledger"], { cwd: repo.dir });

      const ctx: PendingLedgerContext = {
        repoRoot: repo.dir,
        pendingDir,
        entryExtension: undefined,
        log: silent,
      };

      // Non-vacuity: the committed ledger parses, the rewrite read reaches
      // its own no-op answer, and that answer already spells the declared
      // path — so the refusal below is the corruption talking rather than the
      // fixture (`.claude/rules/engineering.md`, *A green verdict is proven
      // non-vacuous*).
      expect((await commitPendingUpdate(ctx, [], [], [])).path).toBe(declared);

      // Committed, not just written: the tree is what the tolerant read sees,
      // and the tip is what this one does.
      await writeFile(entryPath, "{}\n", "utf8");
      await exec("git", ["commit", "-q", "-am", "corrupt the ledger"], {
        cwd: repo.dir,
      });

      let caught: unknown;
      try {
        await commitPendingUpdate(ctx, [], [], []);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(PendingParseFailure);
      expect((caught as Error).message).toMatch(
        /^queue\/ledger failed to parse \(\d+ error\(s\)\)/,
      );
      // The file, not just the directory: a producer repairing the queue
      // opens exactly the entry that did not resolve (`spec/pending.md`,
      // *The ledger is a directory — one entry per file*).
      expect((caught as Error).message).toContain(
        `[${entryFileName("SOME-TAG")}]`,
      );
    } finally {
      await repo.cleanup();
    }
  });

  it("the decide-read's rethrow names the declared ledger path beside its fence verdict", async () => {
    const repo = await makeScratchRepo("flume-decide-refusal-", "main");
    try {
      const pendingDir = join(repo.dir, "queue", "ledger");
      const declared = "queue/ledger";
      await mkdir(pendingDir, { recursive: true });
      await writeFile(
        join(pendingDir, entryFileName("SOME-TAG")),
        "{}\n",
        "utf8",
      );
      await exec("git", ["add", "."], { cwd: repo.dir });
      await exec("git", ["commit", "-q", "-m", "an unparseable ledger"], {
        cwd: repo.dir,
      });

      const ctx: PendingLedgerContext = {
        repoRoot: repo.dir,
        pendingDir,
        entryExtension: undefined,
        log: silent,
      };

      // Non-vacuity: the queue's own writer gets the same failure handed to it
      // as a tick fact, so the ledger really is unparseable and the fence
      // verdict is the only thing that splits the two reads
      // (`.claude/rules/engineering.md`, *A green verdict is proven
      // non-vacuous*).
      const asWriter = await readPendingForDecision(ctx, {
        name: "plan",
        writablePaths: ["queue/**"],
      });
      expect(asWriter.queueParseFailure?.path).toBe(declared);
      expect([
        ...new Set(asWriter.queueParseFailure?.errors.map((e) => e.file)),
      ]).toEqual([entryFileName("SOME-TAG")]);

      let caught: unknown;
      try {
        await readPendingForDecision(ctx, {
          name: "build",
          writablePaths: ["src/**"],
        });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(PendingParseFailure);
      const message = (caught as Error).message;
      expect(message).toMatch(
        /^queue\/ledger failed to parse \(\d+ error\(s\)\)/,
      );
      // The fence verdict is over the files a repair would write, not over
      // the directory: the glob a producer declares admits the entry files
      // and never the directory's own path.
      expect(message).toContain(
        `'build' does not declare ${declared}/${entryFileName("SOME-TAG")} writable`,
      );
    } finally {
      await repo.cleanup();
    }
  });

  /**
   * The same fact, off the error rather than out of its message. A chain's
   * gate reaches this class through `FlumeApi.PendingParseFailure`
   * (`src/flumeApi.ts`), and without the field its only way to the path is a
   * regex over prose the engine wrote — the twin `QueueParseFailure` hands
   * its reader a field, and this is the same fact on the throwing side
   * (`.claude/rules/engineering.md`, *A fact the engine holds is reported,
   * never rediscovered*).
   *
   * Both constructions are read: the bare refusal `commitPendingUpdate`'s
   * rewrite read raises, and the one `readPendingForDecision` re-throws with
   * its fence verdict behind it.
   */
  it("a strict pending read's parse refusal carries the chain's declared ledger path on the error", async () => {
    const repo = await makeScratchRepo("flume-refusal-field-", "main");
    try {
      const pendingDir = join(repo.dir, "queue", "ledger");
      const declared = "queue/ledger";
      await mkdir(pendingDir, { recursive: true });
      await writeFile(
        join(pendingDir, entryFileName("SOME-TAG")),
        "{}\n",
        "utf8",
      );
      await exec("git", ["add", "."], { cwd: repo.dir });
      await exec("git", ["commit", "-q", "-m", "an unparseable ledger"], {
        cwd: repo.dir,
      });

      const ctx: PendingLedgerContext = {
        repoRoot: repo.dir,
        pendingDir,
        entryExtension: undefined,
        log: silent,
      };

      let bare: unknown;
      try {
        await commitPendingUpdate(ctx, [], [], []);
      } catch (err) {
        bare = err;
      }
      expect(bare).toBeInstanceOf(PendingParseFailure);
      // Non-vacuity: the refusal really carries the parse's own errors, so
      // the path below is read off a failure that happened rather than off a
      // constructed stand-in (`.claude/rules/engineering.md`, *A green
      // verdict is proven non-vacuous*).
      expect((bare as PendingParseFailure).errors.length).toBeGreaterThan(0);
      expect((bare as PendingParseFailure).path).toBe(declared);

      let rethrown: unknown;
      try {
        await readPendingForDecision(ctx, {
          name: "build",
          writablePaths: ["src/**"],
        });
      } catch (err) {
        rethrown = err;
      }
      expect(rethrown).toBeInstanceOf(PendingParseFailure);
      expect((rethrown as PendingParseFailure).errors.length).toBeGreaterThan(
        0,
      );
      expect((rethrown as PendingParseFailure).path).toBe(declared);
    } finally {
      await repo.cleanup();
    }
  });
});
