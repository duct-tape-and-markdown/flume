/**
 * The integration lane's sync-point helper, covered from the default lane —
 * the lane that runs under the build's `afterMerge` gate. A helper whose only
 * cover lived in `*.integration.test.ts` would be carried by nothing the gate
 * sees, so the two properties every call site leans on (resolve on the event,
 * refuse by name at the ceiling) are pinned here.
 *
 * Virtual time throughout: the claims are about *when* the wait ends relative
 * to its own deadline, and a real-clock version of that is exactly the
 * load-sensitive assertion this helper exists to delete (spec/worktrees.md,
 * "The default test lane must stay fast"). `fileWithContent` gets a real
 * temp file, because its subject is the filesystem.
 */

import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, expect, it, vi } from "vitest";

import { mkTempDir } from "./helpers/fixtureRoot.ts";
import { fileWithContent, pidClaimIn, waitFor } from "./helpers/waitFor.ts";

afterEach(() => {
  vi.useRealTimers();
});

it("the wait helper resolves as soon as its predicate holds rather than waiting out its deadline", async () => {
  vi.useFakeTimers();
  const start = Date.now();
  let looks = 0;
  let resolvedAt = -1;

  const pending = waitFor(
    "a probe that holds on its third look",
    () => {
      looks += 1;
      return looks < 3 ? undefined : `held on look ${looks}`;
    },
    { timeoutMs: 60_000, intervalMs: 25 },
  ).then((held) => {
    resolvedAt = Date.now() - start;
    return held;
  });

  // Two interval gaps of virtual time — a rounding error next to the 60s
  // deadline the wait was handed.
  await vi.advanceTimersByTimeAsync(50);

  // Non-vacuity: the probe really ran, and ran more than once, so the
  // resolution below is the loop's and not a single lucky first look.
  expect(looks).toBe(3);
  await expect(pending).resolves.toBe("held on look 3");
  expect(resolvedAt).toBe(50);
});

it("the wait helper rejects naming what it waited for when its deadline passes", async () => {
  vi.useFakeTimers();
  let looks = 0;

  const pending = waitFor(
    "the tip claim at /tmp/never-written",
    () => {
      looks += 1;
      return undefined;
    },
    { timeoutMs: 100, intervalMs: 25 },
  );
  const caught = pending.catch((err: unknown) => err);

  await vi.advanceTimersByTimeAsync(200);

  // Non-vacuity: it polled across the window rather than refusing on sight.
  expect(looks).toBeGreaterThan(1);

  const err = await caught;
  expect(err).toBeInstanceOf(Error);
  // The refusal *is* the assertion the call site dropped, so it has to say
  // what was awaited and what ceiling it blew.
  expect((err as Error).message).toContain("the tip claim at /tmp/never-written");
  expect((err as Error).message).toContain("100ms");
});

it("fileWithContent reads an absent file and a created-but-empty one alike as not-yet, and the content once written", async () => {
  const dir = await mkTempDir("flume-waitfor-");
  try {
    const path = join(dir, "claim");
    expect(fileWithContent(path)).toBeUndefined();

    // The window `writeFile` opens between create and write: existence alone
    // would report a pid that is not there yet.
    await writeFile(path, "", "utf8");
    expect(fileWithContent(path)).toBeUndefined();

    await writeFile(path, "4242", "utf8");
    expect(fileWithContent(path)).toBe("4242");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("pidClaimIn decodes a guard file's holder through the engine's own reader, and reads a file with no usable pid as not-yet", async () => {
  const dir = await mkTempDir("flume-waitfor-claim-");
  try {
    const path = join(dir, "loop.pid");
    expect(pidClaimIn(path)).toBeUndefined();

    // Present, and stating nothing a caller could signal: still not-yet, so a
    // wait on this probe never hands a call site a `NaN` to kill.
    await writeFile(path, "not a pid\n", "utf8");
    expect(pidClaimIn(path)).toBeUndefined();

    // The shape a guard writes: pid first, claim instant second. The pid is
    // the first line's, not the whole file's.
    const at = "2026-09-16T10:11:12.000Z";
    await writeFile(path, `4242\n${at}\n`, "utf8");
    expect(pidClaimIn(path)).toEqual({ pid: 4242, atMs: Date.parse(at) });

    // And a single-line file still names its holder.
    await writeFile(path, "4242", "utf8");
    expect(pidClaimIn(path)).toEqual({ pid: 4242 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
