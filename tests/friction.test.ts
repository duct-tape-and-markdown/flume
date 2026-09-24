/**
 * The friction module's own surface: the channel's one listing, the file
 * count behind every status surface and the line printed from it, and the
 * teardown harvest that fills the dir it counts.
 *
 * The round-trip below is an agreement gate (`.claude/rules/engineering.md`,
 * *A seam gate reads what the real writer wrote*): the real
 * `harvestFriction` deposits into the primary dir and the real
 * `frictionCountLine` counts what landed there. The two resolve
 * `chain.friction` against different roots — a worktree mirror on the write
 * side, the caller's state root on the read side — so a one-sided change to
 * either resolution shows up here as a count that disagrees with the files
 * on disk, rather than as a status line that silently reads zero while notes
 * pile up.
 *
 * The dispatcher's own end-to-end friction behavior (which tick harvests
 * when, the revert note, the win32 deep-path cases) stays in
 * tests/Dispatcher.test.ts, where the tick that produces it lives.
 */

import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  countFrictionFiles,
  frictionCountLine,
  frictionNotes,
  harvestFriction,
} from "../src/friction.ts";
import {
  entryFileName,
  parsePendingQueue,
  TAG_MAX_LENGTH,
} from "../src/PendingSchema.ts";
import type { Chain } from "../src/Phase.ts";
import { denyDirectory } from "./helpers/denial.ts";
import { makeFixture, silent, type Fixture } from "./helpers/dispatcherFixture.ts";
import { mkTempDir } from "./helpers/fixtureRoot.ts";
import { SPAWN_BUDGET_MS, exec } from "./helpers/subprocess.ts";

// This file starts processes, so it declares the lane's one budget — cases
// and hooks alike — once here rather than inheriting the runner's default
// (`SPAWN_BUDGET_MS`, `tests/helpers/subprocess.ts`).
vi.setConfig({ testTimeout: SPAWN_BUDGET_MS, hookTimeout: SPAWN_BUDGET_MS });

describe("friction — harvest and count across the one declared dir", () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await makeFixture();
  });

  afterEach(async () => {
    await fx.cleanup();
  });

  it("frictionCountLine is exported from src/friction.ts and counts exactly what the real harvestFriction deposited, the tracked-at-HEAD file excluded", async () => {
    const chain: Chain = { phases: [], humanOnly: [], friction: "friction" };
    const mirrorDir = join(fx.repo, ".flume", "friction");
    await mkdir(mirrorDir, { recursive: true });

    // Delivered content already — committed at the worktree's own HEAD, so
    // the tracked-at-HEAD bound (spec/worktrees.md "Teardown harvest — the
    // delivery guarantee") must leave it where it is.
    await writeFile(join(mirrorDir, "delivered.md"), "already relayed\n");
    await exec("git", ["add", "-A"], { cwd: fx.repo });
    await exec("git", ["commit", "-q", "-m", "relay delivered.md"], {
      cwd: fx.repo,
    });
    // This tick's own note: untracked at HEAD, so this is what harvest owes
    // the operator.
    await writeFile(join(mirrorDir, "note.md"), "the loop wants owner input\n");

    // Vacuity pin (`.claude/rules/engineering.md`, "A green verdict is
    // proven non-vacuous"): harvest is judged on a populated mirror holding
    // one file of each kind, so a count of 1 below is a real exclusion
    // rather than an empty dir agreeing with an empty dir.
    expect((await readdir(mirrorDir)).sort()).toEqual([
      "delivered.md",
      "note.md",
    ]);

    // A primary state root of its own, distinct from the worktree's mirror:
    // the write side resolves chain.friction against this, the read side
    // below against the same value, and nothing else can make them agree.
    const primaryRoot = await mkTempDir("flume-friction-primary-");
    try {
      await harvestFriction(chain, fx.repo, "HARVEST-A", {
        flumeDir: primaryRoot,
        stateRootRel: ".flume",
        log: silent,
      });

      expect(await frictionCountLine(primaryRoot, chain)).toBe(
        "friction: 1 note(s) await routing",
      );

      const primaryDir = join(primaryRoot, "friction");
      const landed = await readdir(primaryDir);
      expect(landed).toHaveLength(1);
      expect(landed[0]).toMatch(
        /^HARVEST-A--\d{4}-\d{2}-\d{2}T[\d-]+Z--note\.md$/,
      );
      expect(await readFile(join(primaryDir, landed[0]!), "utf8")).toBe(
        "the loop wants owner input\n",
      );

      // The harvested file left the mirror; the delivered one stayed.
      expect(await readdir(mirrorDir)).toEqual(["delivered.md"]);
    } finally {
      await rm(primaryRoot, { recursive: true, force: true });
    }
  });

  it("harvestFriction is a strict no-op when the chain declares no friction dir, and frictionCountLine stays silent over the same chain", async () => {
    const chain: Chain = { phases: [], humanOnly: [] };
    const mirrorDir = join(fx.repo, ".flume", "friction");
    await mkdir(mirrorDir, { recursive: true });
    await writeFile(join(mirrorDir, "note.md"), "undeclared channel\n");

    const primaryRoot = await mkTempDir("flume-friction-undecl-");
    try {
      await harvestFriction(chain, fx.repo, "HARVEST-B", {
        flumeDir: primaryRoot,
        stateRootRel: ".flume",
        log: silent,
      });

      expect(await readdir(primaryRoot)).toEqual([]);
      expect(await readdir(mirrorDir)).toEqual(["note.md"]);
      expect(await frictionCountLine(primaryRoot, chain)).toBeUndefined();
    } finally {
      await rm(primaryRoot, { recursive: true, force: true });
    }
  });
});

describe("frictionCountLine — EACCES/ENOENT split (dispatcher-frictioncountline-loud-or-nothing)", () => {
  it("reads 'friction: unreadable' (not silence) when the declared dir exists but readdir fails for a non-ENOENT reason (dispatcher-frictioncountline-loud-or-nothing)", async () => {
    const stateRoot = await mkTempDir("flume-fcl-unreadable-");
    try {
      const frictionDir = join(stateRoot, "friction");
      await mkdir(frictionDir, { recursive: true });
      await writeFile(join(frictionDir, "a.md"), "x\n");
      const chain: Chain = { phases: [], humanOnly: [], friction: "friction" };
      // Non-vacuity: the dir counts before it is denied, so the reading below
      // is the denial talking and not a mistyped path.
      expect(await frictionCountLine(stateRoot, chain)).toBe(
        "friction: 1 note(s) await routing",
      );

      // Deny the friction dir structurally (`tests/helpers/denial.ts`):
      // readdir now fails ENOTDIR — the path is there but is not a dir to
      // read — not ENOENT (`.claude/rules/engineering.md`, "Loud or
      // nothing"). Same primitive `countFrictionFiles` is pinned with
      // directly below, and unlike a mode it denies on win32 too.
      denyDirectory(frictionDir);

      expect(await frictionCountLine(stateRoot, chain)).toBe(
        "friction: unreadable",
      );
    } finally {
      await rm(stateRoot, { recursive: true, force: true });
    }
  });

  it("still reads undefined when the declared dir is absent (ENOENT) — baseline unchanged (dispatcher-frictioncountline-loud-or-nothing)", async () => {
    const stateRoot = await mkTempDir("flume-fcl-absent-");
    try {
      const chain: Chain = { phases: [], humanOnly: [], friction: "friction" };
      expect(await frictionCountLine(stateRoot, chain)).toBeUndefined();
    } finally {
      await rm(stateRoot, { recursive: true, force: true });
    }
  });
});

/**
 * The destination filename harvest composes is `<tag>--<stamp>--<source
 * filename>` — two variable-length parts, so `TAG_MAX_LENGTH` (which sizes
 * the raw tag against the revert note's *fixed* scaffolding) cannot bound
 * the sum. These drive the real `harvestFriction` at the schema's own
 * ceiling (`.claude/rules/engineering.md`, *A seam gate reads what the real
 * writer wrote*): the tag comes from `parsePendingQueue` accepting it, and the
 * verdict is what landed on the real filesystem, whose NAME_MAX is the thing
 * actually being cleared.
 */
describe("friction harvest — the destination filename clears NAME_MAX at the schema's longest tag", () => {
  let fx: Fixture;

  /** Vitest's own `.flume/friction` mirror path inside the fixture repo. */
  const MIRROR_REL = [".flume", "friction"] as const;

  /** An engine-core entry, tag supplied by the caller. */
  const entryWithTag = (tag: string) => ({
    tag,
    gate: { kind: "open" },
    files: { new: [], edit: [], retire: [] },
  });

  /** That entry as the one file the real queue parse reads it out of. */
  const parseOneEntry = (entry: { tag: string }) =>
    parsePendingQueue([
      { file: entryFileName(entry.tag), raw: JSON.stringify(entry) },
    ]);

  /**
   * The longest tag the real parser admits — asserted against `parsePendingQueue`
   * itself, and against its refusal one character further, so the cases
   * below cannot quietly drift off the ceiling they claim to sit on.
   */
  const longestTag = "A".repeat(TAG_MAX_LENGTH);

  beforeEach(async () => {
    fx = await makeFixture();
    expect(parseOneEntry(entryWithTag(longestTag)).ok).toBe(true);
    expect(parseOneEntry(entryWithTag(`${longestTag}A`)).ok).toBe(false);
  });

  afterEach(async () => {
    await fx.cleanup();
  });

  /** Write one untracked note into the worktree-local mirror. */
  async function mirrorNote(name: string, content: string): Promise<string> {
    const mirrorDir = join(fx.repo, ...MIRROR_REL);
    await mkdir(mirrorDir, { recursive: true });
    await writeFile(join(mirrorDir, name), content);
    return mirrorDir;
  }

  it("harvestFriction delivers a note whose source filename is 13 chars under the longest tag parsePendingQueue accepts, within NAME_MAX", async () => {
    // 13 chars is past the wall, not at it: tag (216) + "--" + the
    // 24-character fsStamp + "--" is 244 already, so anything from 12 up
    // composes a basename the filesystem refuses with ENAMETOOLONG.
    const sourceName = "friction-1.md";
    expect(sourceName).toHaveLength(13);
    expect(TAG_MAX_LENGTH + 2 + 24 + 2 + sourceName.length).toBeGreaterThan(
      255,
    );

    const content = "the loop wants owner input\n";
    const mirrorDir = await mirrorNote(sourceName, content);
    // Vacuity pin (`.claude/rules/engineering.md`, "A green verdict is
    // proven non-vacuous"): harvest is judged over a mirror that really
    // holds the note, so a delivery below is a move and not an empty dir.
    expect(await readdir(mirrorDir)).toEqual([sourceName]);

    const primaryRoot = await mkTempDir("flume-friction-namemax-");
    try {
      const chain: Chain = { phases: [], humanOnly: [], friction: "friction" };
      await harvestFriction(chain, fx.repo, longestTag, {
        flumeDir: primaryRoot,
        stateRootRel: ".flume",
        log: silent,
      });

      const primaryDir = join(primaryRoot, "friction");
      const landed = await readdir(primaryDir);
      expect(landed).toHaveLength(1);
      // The real ceiling, read off the real filesystem entry.
      expect(landed[0]!.length).toBeLessThanOrEqual(255);
      // Provenance survives the cut — the bound trims the tail, never the
      // tag that says which entry filed the note.
      expect(landed[0]!.startsWith(`${longestTag}--`)).toBe(true);
      // Content delivered whole: only the name was ever abbreviated.
      expect(await readFile(join(primaryDir, landed[0]!), "utf8")).toBe(content);
      // Moved, not copied: the mirror is drained.
      expect(await readdir(mirrorDir)).toEqual([]);
      expect(await frictionCountLine(primaryRoot, chain)).toBe(
        "friction: 1 note(s) await routing",
      );
    } finally {
      await rm(primaryRoot, { recursive: true, force: true });
    }
  });

  it("two harvests of one source filename under the longest tag parsePendingQueue accepts land as two distinct files, neither overwriting the other", async () => {
    const sourceName = "friction-1.md";
    const first = "attempt one: the gate is unreachable\n";
    const second = "attempt two: still unreachable\n";
    const primaryRoot = await mkTempDir("flume-friction-retry-");
    try {
      const chain: Chain = { phases: [], humanOnly: [], friction: "friction" };
      const ctx = {
        flumeDir: primaryRoot,
        stateRootRel: ".flume",
        log: silent,
      };

      const mirrorDir = await mirrorNote(sourceName, first);
      expect(await readdir(mirrorDir)).toEqual([sourceName]);
      await harvestFriction(chain, fx.repo, longestTag, ctx);

      // `fsStamp` resolves to the millisecond, and the retry's note is the
      // same filename under the same tag — so the second harvest has to
      // start in a later millisecond for the two to compose different
      // names. Two calls this cheap can otherwise land inside one tick of
      // the clock, which is the collision a real retry (minutes later)
      // never has.
      await new Promise((resolve) => setTimeout(resolve, 5));

      await mirrorNote(sourceName, second);
      expect(await readdir(mirrorDir)).toEqual([sourceName]);
      await harvestFriction(chain, fx.repo, longestTag, ctx);

      const primaryDir = join(primaryRoot, "friction");
      const landed = (await readdir(primaryDir)).sort();
      expect(landed).toHaveLength(2);
      expect(new Set(landed).size).toBe(2);
      for (const name of landed) {
        expect(name.length).toBeLessThanOrEqual(255);
        expect(name.startsWith(`${longestTag}--`)).toBe(true);
      }
      // Both notes readable, neither clobbered by the other.
      const contents = await Promise.all(
        landed.map((name) => readFile(join(primaryDir, name), "utf8")),
      );
      expect(new Set(contents)).toEqual(new Set([first, second]));
    } finally {
      await rm(primaryRoot, { recursive: true, force: true });
    }
  });
});

/**
 * A dotfile is not a note (spec/chain.md, "`Chain.friction` — the declared
 * friction channel"). The two cases share one mirror shape — an untracked
 * dot-prefixed placeholder beside a real note — so the skip is proven to
 * turn on the name alone: the tracked-at-HEAD bound covers a *committed*
 * placeholder and has nothing to say about this one, and the delivery of
 * the sibling in the same call proves the dir was harvested at all rather
 * than skipped whole.
 */
describe("friction harvest — a dot-prefixed mirror name is not a note", () => {
  let fx: Fixture;
  let primaryRoot: string;
  const chain: Chain = { phases: [], humanOnly: [], friction: "friction" };

  beforeEach(async () => {
    fx = await makeFixture();
    primaryRoot = await mkTempDir("flume-friction-dot-primary-");
    const mirrorDir = join(fx.repo, ".flume", "friction");
    await mkdir(mirrorDir, { recursive: true });
    // The placeholder git made the consumer create, and this tick's real
    // note beside it.
    await writeFile(join(mirrorDir, ".gitkeep"), "");
    await writeFile(join(mirrorDir, "note.md"), "the loop wants owner input\n");

    // Vacuity pins (`.claude/rules/engineering.md`, "A green verdict is
    // proven non-vacuous"): the mirror holds both names, and the dotfile is
    // untracked at the worktree's own HEAD — so nothing but the name test
    // can hold it back.
    expect((await readdir(mirrorDir)).sort()).toEqual([".gitkeep", "note.md"]);
    const { stdout } = await exec(
      "git",
      ["ls-files", "--", ".flume/friction/.gitkeep"],
      { cwd: fx.repo },
    );
    expect(stdout).toBe("");
  });

  afterEach(async () => {
    await rm(primaryRoot, { recursive: true, force: true });
    await fx.cleanup();
  });

  it("harvestFriction leaves a dot-prefixed mirror file where it is", async () => {
    await harvestFriction(chain, fx.repo, "HARVEST-DOT", {
      flumeDir: primaryRoot,
      stateRootRel: ".flume",
      log: silent,
    });

    // Stays in the mirror, and so dies with the worktree the dispatcher
    // removes moments later.
    expect(await readdir(join(fx.repo, ".flume", "friction"))).toEqual([
      ".gitkeep",
    ]);
    // Nothing carrying the placeholder's name landed under the stamped
    // spelling, which no reading surface would skip.
    const landed = await readdir(join(primaryRoot, "friction"));
    expect(landed.filter((n) => n.endsWith(".gitkeep"))).toEqual([]);
  });

  it("harvestFriction delivers a non-dot file from a mirror dir that also holds a dot-prefixed one", async () => {
    await harvestFriction(chain, fx.repo, "HARVEST-DOT", {
      flumeDir: primaryRoot,
      stateRootRel: ".flume",
      log: silent,
    });

    const primaryDir = join(primaryRoot, "friction");
    const delivered = (await readdir(primaryDir)).filter((n) =>
      n.endsWith("--note.md"),
    );
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toMatch(
      /^HARVEST-DOT--\d{4}-\d{2}-\d{2}T[\d-]+Z--note\.md$/,
    );
    expect(await readFile(join(primaryDir, delivered[0]!), "utf8")).toBe(
      "the loop wants owner input\n",
    );
  });
});

/**
 * The channel's one listing. `frictionNotes` is what the bare `friction`
 * verb prints, what `countFrictionFiles` counts, what the teardown harvest
 * relays and what `frictionFiles` (`harness/friction.ts`) renders, so the
 * two halves of its contract are pinned here once rather than four times:
 * what counts as a note (a direct-child file, `isDotName` skipped, sorted),
 * and the ENOENT-vs-other split (absent is the empty channel, unreadable
 * throws rather than reading as empty — `.claude/rules/engineering.md`,
 * "Loud or nothing").
 */
describe("frictionNotes — the channel's one listing", () => {
  it("names the direct-child files sorted, skipping dot names and subdirs, and throws rather than reading an unlistable dir as empty", async () => {
    const base = await mkTempDir("flume-friction-notes-");
    const dir = join(base, "friction");
    try {
      // Absent dir is the empty channel, never a throw: the engine creates
      // it lazily, so "never written to" and "empty" are one fact.
      expect(frictionNotes(dir)).toEqual([]);

      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "b.md"), "y\n");
      await writeFile(join(dir, "a.md"), "x\n");
      await writeFile(join(dir, "c.txt"), "z\n");
      // A dot-prefixed name is not a note, and a subdir is not a file.
      await writeFile(join(dir, ".gitkeep"), "");
      await mkdir(join(dir, "nested"), { recursive: true });
      await writeFile(join(dir, "nested", "deep.md"), "no\n");

      // Non-vacuity: the channel lists before it is denied, and the order is
      // the sort's, not the one the writes happened in.
      expect(frictionNotes(dir)).toEqual(["a.md", "b.md", "c.txt"]);

      // Deny structurally (`tests/helpers/denial.ts`): readdir now fails
      // ENOTDIR — the path is there but is not a dir to read — not ENOENT.
      denyDirectory(dir);
      expect(() => frictionNotes(dir)).toThrow();
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
});

/**
 * `countFrictionFiles` gives a failed read the same three-way reading
 * `frictionCountLine` renders above: `0` for an absent dir, a real count for
 * a readable one, and `null` — never a zero — for a dir that is there and
 * cannot be listed (`.claude/rules/engineering.md`, "Loud or nothing"). What
 * counts as a note is `frictionNotes`'s, pinned above; the count adds only
 * the reading it gives that listing's throw.
 */
describe("countFrictionFiles — the ENOENT/other split", () => {
  it("counts an absent dir as 0 and an unlistable one as null", async () => {
    const base = await mkTempDir("flume-friction-count-");
    const dir = join(base, "friction");
    try {
      expect(countFrictionFiles(dir)).toBe(0);

      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "a.md"), "x\n");
      await writeFile(join(dir, "b.md"), "y\n");
      // A dot-prefixed name is not a note, and a subdir is not a file.
      await writeFile(join(dir, ".gitkeep"), "");
      await mkdir(join(dir, "nested"), { recursive: true });
      // Non-vacuity: the dir counts before it is denied.
      expect(countFrictionFiles(dir)).toBe(2);

      // Deny structurally (`tests/helpers/denial.ts`): readdir now fails
      // ENOTDIR — the path is there but is not a dir to read — not ENOENT.
      denyDirectory(dir);
      expect(countFrictionFiles(dir)).toBeNull();
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
});

/**
 * Same deep-nesting shape as the Dispatcher.ts win32 suites
 * (WRITEREVERTNOTE-WIN32-PATH-TOTAL-LIMIT et al.): a bare `join()` reads a
 * too-long path as absent rather than as a real error, so the count below
 * would silently read an empty channel instead of resolving.
 */
describe.runIf(process.platform === "win32")(
  "countFrictionFiles — win32 total-path limit (FRICTIONCOUNT-WIN32-PATH-TOTAL-LIMIT)",
  () => {
    it("countFrictionFiles resolves a real count when the friction dir nests past win32's ~260-char limit", async () => {
      const base = await mkTempDir("flume-friction-w32-");
      try {
        const frictionDir = join(
          base,
          ...Array.from({ length: 6 }, (_, i) => `seg-${i}-`.padEnd(50, "x")),
        );
        await mkdir(frictionDir, { recursive: true });
        await writeFile(join(frictionDir, "a.md"), "x\n");
        await writeFile(join(frictionDir, "b.md"), "y\n");

        expect(frictionDir.length).toBeGreaterThan(260);
        expect(countFrictionFiles(frictionDir)).toBe(2);
      } finally {
        await rm(base, { recursive: true, force: true });
      }
    });
  },
);
