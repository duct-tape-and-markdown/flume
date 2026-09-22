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
 * Nothing here restates a directory name. Every case iterates
 * `recordDirs()`, so a record directory added to the package is covered by
 * these cases rather than silently skipped by them.
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { afterEach, beforeEach, expect, it } from "vitest";

import {
  RECORD_MAX_BYTES,
  notePath,
  notesDir,
  recordDirs,
  recordFiles,
  recordsPending,
} from "../harness/index.ts";

import { mkTempDir } from "./helpers/fixtureRoot.ts";

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
 * `recordFiles` needs no such conversion — it reads disk, so it already
 * answers host-native — and the case below is the pin on that difference.
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
  expect(recordFiles(stateRoot)).toEqual(written);
});

it("a record's byte cap is the package's own value, not a per-consumer knob", () => {
  // One number, exported rather than declarable: the records gate refuses
  // against it and the build prompt announces it, and no declaration field
  // lets an environment raise it. Pinned so widening the package's
  // discipline is a deliberate edit rather than a number that drifted.
  expect(RECORD_MAX_BYTES).toBe(2000);
});
