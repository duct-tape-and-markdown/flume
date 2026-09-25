/**
 * The harness package's record queue (`spec/harness.md`, *Records as one
 * file each*): what is waiting under a state root, and whether the inbox
 * slice's window is open over it. Where a record *sits* is the plan-artifact
 * layout's (`tests/harnessLayout.test.ts`); the cases here read those
 * directories off it and ask disk.
 *
 * The window cases run over a real state root on disk rather than a mocked
 * `fs`: `recordsPending` is a claim about what a directory listing says, and
 * a stubbed listing would re-author that answer by the tester's hand
 * (`.claude/rules/engineering.md`, *A seam gate reads what the real writer
 * wrote*). The note-path case closes the same loop the other way — the path
 * the package hands a build tick is written to, and the package's own
 * predicate is asked whether it sees it.
 *
 * **Two trees, one listing.** Every case but the last reads a checkout
 * (`checkoutRecords`); the last drives the same listing over a real
 * repository's tip (`tipRecords`) beside that checkout, so the rules the two
 * readers share are read off one derivation rather than asserted twice.
 *
 * Nothing here restates a directory name. Every case iterates
 * `recordDirs()`, so a record directory added to the package is covered by
 * these cases rather than silently skipped by them.
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  RECORD_MAX_BYTES,
  checkoutRecords,
  continuingNotePath,
  notePath,
  notesDir,
  recordDirs,
  recordFiles,
  recordsPending,
  tipRecords,
} from "../harness/index.ts";

import { mkTempDir } from "./helpers/fixtureRoot.ts";
import { SPAWN_BUDGET_MS, gitOutSync } from "./helpers/subprocess.ts";

// The two-source case drives a real repository, and a git spawn is a spawn
// like any other: the lane's one budget, for its cases and its hooks alike,
// declared once for the file rather than inherited from the runner
// (`SPAWN_BUDGET_MS`, `tests/helpers/subprocess.ts`).
vi.setConfig({ testTimeout: SPAWN_BUDGET_MS, hookTimeout: SPAWN_BUDGET_MS });

/** A fresh, empty state root per case — no directories, the untouched shape. */
let stateRoot: string;

beforeEach(async () => {
  stateRoot = await mkTempDir("flume-records-");
});

afterEach(async () => {
  if (stateRoot) await rm(stateRoot, { recursive: true, force: true });
});

/**
 * The fs form of a path the package composed in git's alphabet. `recordDirs`,
 * `notesDir` and `notePath` (`harness/layout.ts`) slash-join, because what
 * they name is a diff-tree line, a pathspec or a fence glob; `resolve`
 * normalizes that to the host's separator so these cases read disk the same
 * way on win32.
 *
 * `recordFiles` over a checkout needs no such conversion — that tree reads
 * disk, so it already answers host-native — and the case below is the pin on
 * that difference. Over the tip it answers in git's alphabet, which the
 * two-source case is the pin on.
 */
const onDisk = (path: string): string => resolve(path);

it("the note path for an entry tag is that tag's file under the state root's notes dir", async () => {
  const path = notePath(stateRoot, "HARNESS-RECORDS");

  // Under the notes dir, named for the tag, and that notes dir is one the
  // liveness predicate actually scans — a note written somewhere no record
  // directory covers would never wake the slice that drains it.
  expect(path).toBe(`${notesDir(stateRoot)}/HARNESS-RECORDS.md`);
  expect(recordDirs(stateRoot)).toContain(notesDir(stateRoot));

  // The tag is the whole of what varies: two entries never share a note.
  expect(notePath(stateRoot, "OTHER-TAG")).not.toBe(path);
  expect(dirname(onDisk(notePath(stateRoot, "OTHER-TAG")))).toBe(
    dirname(onDisk(path)),
  );

  // And the loop closes: a build tick writing at this path is a record the
  // package's own predicate reports pending. Empty first, so the assertion
  // below is about the write rather than about the root.
  expect(recordsPending(checkoutRecords(stateRoot))).toBe(false);
  await mkdir(dirname(onDisk(path)), { recursive: true });
  await writeFile(onDisk(path), "# a note\n");
  expect(recordsPending(checkoutRecords(stateRoot))).toBe(true);
});

it("a record directory holding a file reports the record window live", async () => {
  const dirs = recordDirs(stateRoot);
  // Vacuity pin: a package with no record directories would pass every
  // per-directory assertion below by running none of them.
  expect(dirs.length).toBeGreaterThan(0);

  for (const dir of dirs) {
    // One directory at a time, each from the bare root, so every arm proves
    // that *this* directory opens the window rather than riding a sibling.
    await rm(stateRoot, { recursive: true, force: true });
    await mkdir(onDisk(dir), { recursive: true });
    expect({ dir, live: recordsPending(checkoutRecords(stateRoot)) }).toEqual({ dir, live: false });

    await writeFile(join(onDisk(dir), "2026-09-14-a-finding.md"), "# a finding\n");
    expect({ dir, live: recordsPending(checkoutRecords(stateRoot)) }).toEqual({ dir, live: true });
  }
});

it("a record directory holding no file reports the record window empty", async () => {
  const dirs = recordDirs(stateRoot);
  expect(dirs.length).toBeGreaterThan(0);

  // Never created: an absent queue and an empty one are the same fact, and a
  // consumer that has never had a record should not have to mkdir to say so.
  expect(recordsPending(checkoutRecords(stateRoot))).toBe(false);

  // Created and empty — the steady state the inbox slice leaves behind.
  for (const dir of dirs) await mkdir(onDisk(dir), { recursive: true });
  expect(recordsPending(checkoutRecords(stateRoot))).toBe(false);

  // Holding something that is not a record. A `.gitkeep` is how an empty
  // queue directory survives a clone, and it must not hold the window open.
  for (const dir of dirs) {
    await writeFile(join(onDisk(dir), ".gitkeep"), "");
    await writeFile(join(onDisk(dir), "notes.txt"), "not a record\n");
  }
  expect(recordsPending(checkoutRecords(stateRoot))).toBe(false);

  // And the same directories do open the window for a record, so the three
  // verdicts above are the absence of records rather than a predicate that
  // never returns true.
  await writeFile(join(onDisk(dirs[0]!), "a-record.md"), "# a record\n");
  expect(recordsPending(checkoutRecords(stateRoot))).toBe(true);
});

it("recordFiles names each record at the path node:path composes under the state root", async () => {
  const dirs = recordDirs(stateRoot);
  // Vacuity pin: with no record directories every arm below judges nothing.
  expect(dirs.length).toBeGreaterThan(0);

  // One record per directory, each written at the host's own spelling of that
  // directory — which is the spelling every consumer of this listing holds:
  // the window `readFileSync`s these, renders them for a tick to open, and
  // the tick joins its own paths against them.
  const written = dirs.map((dir) => join(onDisk(dir), "2026-09-15-a-record.md"));
  for (const file of written) {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, "# a record\n");
  }

  // Host-native and in queue order. A slash-joined absolute root agrees with
  // this on posix and names every record at `C:\repo\.flume/inbox/x.md` on
  // win32 — a spelling fs accepts and no `join` reproduces, so the rendered
  // path would match nothing the tick that must open it composes.
  expect(recordFiles(checkoutRecords(stateRoot))).toEqual(written);
});

/**
 * The queue's absence arm, proven rather than read off an errno
 * (`harness/dirListing.ts`). An obstructed ancestor is spelled `ENOENT` on
 * win32 and `ENOTDIR` on posix (`.claude/rules/platform-facts.md`, *win32
 * reports a path through a non-directory as not found*), so a listing keying
 * its silent arm on the errno reports an unreachable queue as empty on
 * exactly one host — and the inbox window then renders no record while the
 * drain that would have named them is never woken.
 *
 * The parent is denied on purpose, which that same page admits for this one
 * reader: the descent is exercised by an obstructed *ancestor* and by
 * nothing else. A plain file denies structurally, so this runs on every host
 * rather than riding `chmod`, which denies nothing on win32.
 */
it("recordFiles refuses when a plain file sits above a record directory", async () => {
  const dirs = recordDirs(stateRoot);
  // Vacuity pin: with no record directories the loop below judges nothing.
  expect(dirs.length).toBeGreaterThan(0);

  // The reading the obstruction has to change. A bare root is the absent
  // queue, and absent is the silent arm — so a refusal below is the plain
  // file talking and not a listing that throws at every root.
  expect(recordFiles(checkoutRecords(stateRoot))).toEqual([]);

  for (const dir of dirs) {
    const above = dirname(onDisk(dir));
    // One directory at a time, each from a bare root, so every arm proves
    // that *this* directory's walk refuses rather than riding a sibling's.
    await rm(stateRoot, { recursive: true, force: true });
    await mkdir(dirname(above), { recursive: true });
    await writeFile(above, "obstruction\n");

    let message: string | undefined;
    try {
      recordFiles(checkoutRecords(stateRoot));
    } catch (error) {
      message = (error as Error).message;
    }
    // By name: the rung an operator has to go fix, not the leaf that was
    // asked for — and not an empty queue.
    expect({ dir, message }).toEqual({
      dir,
      message: `[flume] record queue is unreadable: ${above} is present but is not a directory`,
    });
  }
});

/**
 * The one note home the drain does not walk (`spec/harness.md`, *A tick puts
 * work down*). Location is kind, and this kind is addressed to build's own
 * next tick on the entry: a listing that carried it would wake the inbox
 * slice on a file no plan tick can reconcile, and route the note away from
 * the tick it was written for.
 */
it("the record drain lists no note under the continuing directory", async () => {
  const dirs = recordDirs(stateRoot);
  expect(dirs.length).toBeGreaterThan(0);

  // A record in every queue the drain does list, so the listing the absence
  // is asserted against is populated and the absence below is the continuing
  // home's alone (`.claude/rules/engineering.md`, *A green verdict is proven
  // non-vacuous*).
  for (const dir of dirs) {
    const file = join(onDisk(dir), "2026-09-24-a-record.md");
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, "# a record\n");
  }
  expect(recordFiles(checkoutRecords(stateRoot))).toHaveLength(dirs.length);

  // The continuation sits one segment across from the park, under a notes
  // directory the drain *does* walk — so it is skipped by the layout saying
  // it is no record, never by it being somewhere the walk cannot reach.
  const continuing = continuingNotePath(stateRoot, "PUT-DOWN");
  expect(continuing.startsWith(`${notesDir(stateRoot)}/`)).toBe(true);
  await mkdir(dirname(onDisk(continuing)), { recursive: true });
  await writeFile(onDisk(continuing), "# what landed\n\nThe first segment.\n");

  expect(recordFiles(checkoutRecords(stateRoot))).not.toContain(onDisk(continuing));
  expect(recordFiles(checkoutRecords(stateRoot))).toHaveLength(dirs.length);

  // And a continuation standing alone leaves the drain's window shut: the
  // inbox slice is not woken by a note addressed to build.
  await rm(stateRoot, { recursive: true, force: true });
  await mkdir(dirname(onDisk(continuing)), { recursive: true });
  await writeFile(onDisk(continuing), "# what landed\n\nThe first segment.\n");
  expect(recordsPending(checkoutRecords(stateRoot))).toBe(false);
});

it("a record's byte cap is the package's own value, not a per-consumer knob", () => {
  // One number, exported rather than declarable: the records gate refuses
  // against it and the build prompt announces it, and no declaration field
  // lets an environment raise it. Pinned so widening the package's
  // discipline is a deliberate edit rather than a number that drifted.
  expect(RECORD_MAX_BYTES).toBe(2000);
});

/**
 * One listing, two trees (`spec/harness.md`, *The phases*). The wake runs at
 * the handoff with no worktree of its own and reads the tip a worktree would
 * be cut from; the render runs inside that worktree and reads its checkout.
 * Both go through `recordFiles`, so the extension filter, the queue order and
 * the claim withholding are one derivation, and the two trees can differ only
 * in what they hold.
 *
 * Driven over a real repository rather than a stubbed listing: what the tip
 * holds is git's answer, and a hand-authored one would re-author the writer
 * this case exists to read (`.claude/rules/engineering.md`, *A seam gate
 * reads what the real writer wrote*).
 */
it("the record listing reads a checkout and the tip through one derivation", async () => {
  const repo = await mkTempDir("flume-records-tip-");
  const git = (...args: string[]): string => gitOutSync(repo, args);
  git("init", "-q", "-b", "main");
  git("config", "user.email", "records@example.test");
  git("config", "user.name", "Records Fixture");
  git("config", "commit.gpgsign", "false");

  const rel = ".flume";
  const root = join(repo, rel);
  const dirs = recordDirs(root);
  // Vacuity pin: with no record directories every arm below judges nothing.
  expect(dirs.length).toBeGreaterThan(0);

  // Each queue's name as the repository addresses it — the tail `recordDirs`
  // joined onto the root it was handed, which is already git's alphabet.
  const queue = (dir: string): string => dir.slice(root.length + 1);
  /** The two spellings of one record: the host's, and git's. */
  const at = (dir: string, name: string) => ({
    disk: join(resolve(dir), name),
    git: `${rel}/${queue(dir)}/${name}`,
  });

  // One record per queue, plus a `.gitkeep` the extension filter drops and a
  // claimed entry's note the withholding drops — the three rules both trees
  // apply, each with something on disk to apply it to.
  const carried = dirs.map((dir) => at(dir, "2026-09-24-carried.md"));
  const held = at(notesDir(root), "HELD-ENTRY.md");
  for (const file of [...carried, held]) {
    await mkdir(dirname(file.disk), { recursive: true });
    await writeFile(file.disk, "# a record\n");
  }
  for (const dir of dirs) await writeFile(join(resolve(dir), ".gitkeep"), "");
  git("add", "-A");
  git("commit", "-q", "-m", "records: the tip's own queue");

  // On the shared disk alone: nothing the tip holds, so it is the one file
  // the two trees may disagree about.
  const uncommitted = at(dirs[0]!, "2026-09-25-uncommitted.md");
  await writeFile(uncommitted.disk, "# dropped in\n");

  const checkout = checkoutRecords(root);
  const tip = tipRecords(repo, rel);
  // Queue order, spelled out: the inbox first and its two records by name,
  // then the notes dir with the claimed entry's note behind the dated one,
  // then the parked dir one segment below it.
  const order = [
    carried[0]!,
    uncommitted,
    carried[1]!,
    held,
    carried[2]!,
  ];

  expect({
    // Both queues, in queue order, under each tree's own spelling ...
    checkout: recordFiles(checkout),
    tip: recordFiles(tip),
    // ... the claim withheld by both, keyed to the tag and nothing else ...
    checkoutClaimed: recordFiles(checkout, ["HELD-ENTRY"]),
    tipClaimed: recordFiles(tip, ["HELD-ENTRY"]),
    // ... and both windows open, so the difference below is the one file and
    // not a predicate that never answers.
    checkoutLive: recordsPending(checkout),
    tipLive: recordsPending(tip),
  }).toEqual({
    checkout: order.map((file) => file.disk),
    tip: order.filter((file) => file !== uncommitted).map((file) => file.git),
    checkoutClaimed: order
      .filter((file) => file !== held)
      .map((file) => file.disk),
    tipClaimed: order
      .filter((file) => file !== held && file !== uncommitted)
      .map((file) => file.git),
    checkoutLive: true,
    tipLive: true,
  });

  // And the file the tip does not hold is the whole of the difference: with
  // it gone the two trees name the same records, segment for segment.
  await rm(uncommitted.disk);
  expect(recordFiles(checkout)).toEqual(
    order.filter((file) => file !== uncommitted).map((file) => file.disk),
  );

  await rm(repo, { recursive: true, force: true });
});
