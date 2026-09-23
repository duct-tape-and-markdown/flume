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
 * three degrades, the strict read's refusal, and the decide-read's rethrow.
 * Each is a report about the chain's own file, so each is pinned here over a
 * declared path that is not the default one, where a hand-spelled basename
 * shows up as a lie rather than as a coincidence.
 */

import { rmSync, symlinkSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

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
import { PendingParseFailure } from "../src/PendingSchema.ts";
import { denyFile } from "./helpers/denial.ts";
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
function ctx(pendingPath: string): PendingLedgerContext {
  return {
    repoRoot: REPO,
    pendingPath,
    entryExtension: undefined,
    log: silent,
  };
}

describe(
  "pendingLedger — isPendingRelocated agrees with computeStateRootRel " +
    '(.claude/rules/engineering.md "The fix lands at the mechanism")',
  () => {
    it("agrees with computeStateRootRel on a relocated (out-of-tree) pendingPath", () => {
      const dock = join("/", "tmp", "flume-ledger-dock");
      const pendingPath = join(dock, "plan", "pending.json");
      expect(computeStateRootRel(REPO, pendingPath)).toBeUndefined();
      expect(isPendingRelocated(ctx(pendingPath))).toBe(true);
    });

    it("agrees with computeStateRootRel on a normal in-tree pendingPath", () => {
      const pendingPath = join(REPO, ".flume", "plan", "pending.json");
      expect(computeStateRootRel(REPO, pendingPath)).toBeDefined();
      expect(isPendingRelocated(ctx(pendingPath))).toBe(false);
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
  it("readPendingLoose reads an absent (ENOENT) pending.json as the empty, valid list", async () => {
    const dir = await mkTempDir("flume-loose-absent-");
    try {
      const pendingPath = join(dir, "plan", "pending.json");
      expect(readPendingLoose(pendingPath)).toEqual({
        ok: true,
        entries: [],
        errors: [],
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("readPendingLoose rethrows a non-ENOENT stat/read failure instead of reading it as absent — existsSync collapses any stat error, not just ENOENT, to false (JOB-READPENDINGLOOSE-NARROW-ENOENT)", async () => {
    const dir = await mkTempDir("flume-loose-denied-");
    try {
      const planDir = join(dir, "plan");
      await mkdir(planDir, { recursive: true });
      const pendingPath = join(planDir, "pending.json");
      await writeFile(pendingPath, "[]");
      // Non-vacuity: the queue reads before it is denied.
      expect(readPendingLoose(pendingPath).ok).toBe(true);

      // Deny the queue file structurally (`tests/helpers/denial.ts`): the
      // path is still there to a stat, and the read fails EISDIR — not
      // ENOENT (`.claude/rules/engineering.md`, "Loud or nothing"). Denying
      // the *parent* would not arm this on every host: win32 reports a path
      // through a non-directory as ENOENT, so the gate would take its absent
      // arm there (`tests/helpers/denial.ts`, *deny the exact path*).
      denyFile(pendingPath);

      let caught: NodeJS.ErrnoException | undefined;
      try {
        readPendingLoose(pendingPath);
      } catch (err) {
        caught = err as NodeJS.ErrnoException;
      }
      expect(caught).toBeDefined();
      expect(caught?.code).not.toBe("ENOENT");
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
 * the basename this repo happens to use
 * (`.claude/rules/engineering.md`, *A fact the engine holds is reported, never
 * rediscovered*).
 *
 * Posix-declared, because the stat arm needs a path that is present and
 * unstattable. Why that host and what it costs is the ledger's
 * (`tests/helpers/host-declarations.json`), which is where a skip's reason
 * lives rather than in a comment per site.
 */
describe.runIf(process.platform !== "win32")(
  "readPendingTolerant — what a degrade announces",
  () => {
    it("a tolerant read's stat, read and parse warns each name the chain's declared pending path", async () => {
      const repoRoot = await mkTempDir("flume-tolerant-warns-");
      try {
        // Neither the default basename nor the default dock: this chain
        // declared `queue/ledger.json`, and that is the only spelling any of
        // the three announcements below may carry.
        const dock = join(repoRoot, "queue");
        await mkdir(dock, { recursive: true });
        const pendingPath = join(dock, "ledger.json");
        const declared = "queue/ledger.json";

        const warns: string[] = [];
        const log: Logger = {
          info: () => {},
          warn: (line) => warns.push(line),
          error: () => {},
        };
        const ctx: PendingLedgerContext = {
          repoRoot,
          pendingPath,
          entryExtension: undefined,
          log,
        };

        // Non-vacuity: the declared ledger reads clean and announces nothing,
        // so each warn below is the arm above it talking
        // (`.claude/rules/engineering.md`, *A green verdict is proven
        // non-vacuous*).
        await writeFile(pendingPath, "[]\n", "utf8");
        expect(await readPendingTolerant(ctx)).toEqual([]);
        expect(warns).toEqual([]);

        // Stat arm: a self-referential symlink is present to a listing and
        // raises ELOOP to `statSync`, which `existsLoud` (`src/fsProbe.ts`)
        // rethrows rather than reading as absent. Not a permission bit — a
        // root-run test would bypass one (`tests/helpers/denial.ts`).
        rmSync(pendingPath);
        symlinkSync(basename(pendingPath), pendingPath);
        expect(await readPendingTolerant(ctx)).toEqual([]);

        // Read arm: stattable and unreadable — a directory where the file is
        // read, denied at the read path and never at its parent
        // (`tests/helpers/denial.ts`).
        rmSync(pendingPath);
        denyFile(pendingPath);
        expect(await readPendingTolerant(ctx)).toEqual([]);

        // Parse arm: readable, and not the list the schema takes.
        rmSync(pendingPath, { recursive: true });
        await writeFile(pendingPath, "{}", "utf8");
        expect(await readPendingTolerant(ctx)).toEqual([]);

        expect(warns).toHaveLength(3);
        const [statWarn, readWarn, parseWarn] = warns as [
          string,
          string,
          string,
        ];
        expect(statWarn).toContain(`${declared} could not be stat'd`);
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
 * Driven over a real repository on a declared `queue/ledger.json`, because
 * the strict read resolves the committed tip rather than the tree
 * (spec/pending.md, "Dispatch reads come from the tip, not the tree"): a
 * corruption only this read can see is one that is committed, and a ledger at
 * the default dock would let a hand-spelled basename read as a coincidence.
 */
describe("readPending — what a strict refusal names", () => {
  it("a strict pending read's parse refusal names the chain's declared ledger path", async () => {
    const repo = await makeScratchRepo("flume-strict-refusal-", "main");
    try {
      const dock = join(repo.dir, "queue");
      await mkdir(dock, { recursive: true });
      const pendingPath = join(dock, "ledger.json");
      const declared = "queue/ledger.json";
      await writeFile(pendingPath, "[]\n", "utf8");
      await exec("git", ["add", "."], { cwd: repo.dir });
      await exec("git", ["commit", "-q", "-m", "ledger"], { cwd: repo.dir });

      const ctx: PendingLedgerContext = {
        repoRoot: repo.dir,
        pendingPath,
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
      await writeFile(pendingPath, "{}\n", "utf8");
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
        /^queue\/ledger\.json failed to parse \(\d+ error\(s\)\)/,
      );
    } finally {
      await repo.cleanup();
    }
  });

  it("the decide-read's rethrow names the declared ledger path beside its fence verdict", async () => {
    const repo = await makeScratchRepo("flume-decide-refusal-", "main");
    try {
      const dock = join(repo.dir, "queue");
      await mkdir(dock, { recursive: true });
      const pendingPath = join(dock, "ledger.json");
      const declared = "queue/ledger.json";
      await writeFile(pendingPath, "{}\n", "utf8");
      await exec("git", ["add", "."], { cwd: repo.dir });
      await exec("git", ["commit", "-q", "-m", "an unparseable ledger"], {
        cwd: repo.dir,
      });

      const ctx: PendingLedgerContext = {
        repoRoot: repo.dir,
        pendingPath,
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
        /^queue\/ledger\.json failed to parse \(\d+ error\(s\)\)/,
      );
      expect(message).toContain(
        `'build' does not declare ${declared} writable`,
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
      const dock = join(repo.dir, "queue");
      await mkdir(dock, { recursive: true });
      const pendingPath = join(dock, "ledger.json");
      const declared = "queue/ledger.json";
      await writeFile(pendingPath, "{}\n", "utf8");
      await exec("git", ["add", "."], { cwd: repo.dir });
      await exec("git", ["commit", "-q", "-m", "an unparseable ledger"], {
        cwd: repo.dir,
      });

      const ctx: PendingLedgerContext = {
        repoRoot: repo.dir,
        pendingPath,
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
