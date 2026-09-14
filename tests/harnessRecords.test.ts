/**
 * The harness package's record layout (`spec/harness.md`, *Records as one
 * file each*): where a record lives under a state root, what a build note is
 * called, and whether the inbox slice's window is open.
 *
 * The window cases run over a real state root on disk rather than a mocked
 * `fs`: `recordsPending` is a claim about what a directory listing says, and
 * a stubbed listing would re-author that answer by the tester's hand
 * (`.claude/rules/engineering.md`, *A seam gate reads what the real writer
 * wrote*). The note-path case closes the same loop the other way — the path
 * the package hands a build tick is written to, and the package's own
 * predicate is asked whether it sees it.
 *
 * Nothing here restates a directory name. Every case iterates
 * `recordDirs()`, so a record directory added to the package is covered by
 * these cases rather than silently skipped by them.
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { afterEach, beforeEach, expect, it } from "vitest";

import {
  RECORD_MAX_BYTES,
  notePath,
  notesDir,
  recordDirs,
  recordsPending,
} from "../harness/index.ts";

/** A fresh, empty state root per case — no directories, the untouched shape. */
let stateRoot: string;

beforeEach(async () => {
  stateRoot = await mkdtemp(join(tmpdir(), "flume-records-"));
});

afterEach(async () => {
  if (stateRoot) await rm(stateRoot, { recursive: true, force: true });
});

/**
 * The fs form of a path the package composed. The package slash-joins,
 * because its paths are git paths and fence globs; `resolve` normalizes that
 * to the host's separator so these cases read disk the same way on win32.
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
  expect(recordsPending(stateRoot)).toBe(false);
  await mkdir(dirname(onDisk(path)), { recursive: true });
  await writeFile(onDisk(path), "# a note\n");
  expect(recordsPending(stateRoot)).toBe(true);
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
    expect({ dir, live: recordsPending(stateRoot) }).toEqual({ dir, live: false });

    await writeFile(join(onDisk(dir), "2026-09-14-a-finding.md"), "# a finding\n");
    expect({ dir, live: recordsPending(stateRoot) }).toEqual({ dir, live: true });
  }
});

it("a record directory holding no file reports the record window empty", async () => {
  const dirs = recordDirs(stateRoot);
  expect(dirs.length).toBeGreaterThan(0);

  // Never created: an absent queue and an empty one are the same fact, and a
  // consumer that has never had a record should not have to mkdir to say so.
  expect(recordsPending(stateRoot)).toBe(false);

  // Created and empty — the steady state the inbox slice leaves behind.
  for (const dir of dirs) await mkdir(onDisk(dir), { recursive: true });
  expect(recordsPending(stateRoot)).toBe(false);

  // Holding something that is not a record. A `.gitkeep` is how an empty
  // queue directory survives a clone, and it must not hold the window open.
  for (const dir of dirs) {
    await writeFile(join(onDisk(dir), ".gitkeep"), "");
    await writeFile(join(onDisk(dir), "notes.txt"), "not a record\n");
  }
  expect(recordsPending(stateRoot)).toBe(false);

  // And the same directories do open the window for a record, so the three
  // verdicts above are the absence of records rather than a predicate that
  // never returns true.
  await writeFile(join(onDisk(dirs[0]!), "a-record.md"), "# a record\n");
  expect(recordsPending(stateRoot)).toBe(true);
});

it("a record's byte cap is the package's own value, not a per-consumer knob", () => {
  // One number, exported rather than declarable: the records gate refuses
  // against it and the build prompt announces it, and no declaration field
  // lets an environment raise it. Pinned so widening the package's
  // discipline is a deliberate edit rather than a number that drifted.
  expect(RECORD_MAX_BYTES).toBe(1200);
});
