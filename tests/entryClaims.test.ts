/**
 * The per-entry claim store (`src/entryClaims.ts`): where a claim sits, what
 * the live set answers, and what the stake does about a holder that is gone
 * (`spec/pending.md`, *Claims — an entry in flight is left alone*).
 *
 * The wave that drives this store through a real tick is
 * `tests/Dispatcher.test.ts`; what is judged here is the store's own three
 * answers — and, beside the empty one, the descent that separates a
 * repository which has staked nothing from one whose claims cannot be read —
 * over a real repository rather than a hand-built common dir: the address a
 * claim resolves to is git's, and a fixture spelling it would be this file's
 * copy of the rule under test.
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  EntryClaimStore,
  entryClaimPath,
  entryClaimSlug,
  entryClaimsDir,
} from "../src/entryClaims.ts";
import { gitCommonDir } from "../src/git.ts";
import { parsePidClaim, renderPidClaim } from "../src/pidClaim.ts";
import { deadPid } from "./helpers/deadPid.ts";
import { makeScratchRepo, type ScratchRepo } from "./helpers/scratchRepo.ts";
import { SPAWN_BUDGET_MS } from "./helpers/subprocess.ts";

// This file starts processes (`git` through the scratch repo and the common-dir
// resolution every store call makes), so it declares the lane's one budget —
// cases and hooks alike — once here rather than inheriting the runner's
// default (`SPAWN_BUDGET_MS`, `tests/helpers/subprocess.ts`).
vi.setConfig({ testTimeout: SPAWN_BUDGET_MS, hookTimeout: SPAWN_BUDGET_MS });

let repo: ScratchRepo;
let store: EntryClaimStore;

beforeEach(async () => {
  repo = await makeScratchRepo("flume-entry-claims-", "main");
  store = new EntryClaimStore(repo.dir);
});

afterEach(async () => {
  await repo.cleanup();
});

/** Plant a claim on `tag` held by `pid`, through the engine's own statement. */
async function plant(tag: string, pid: number): Promise<string> {
  const path = entryClaimPath(
    await gitCommonDir(repo.dir),
    entryClaimSlug(tag),
  );
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, renderPidClaim(pid, new Date()), "utf8");
  return path;
}

describe("EntryClaimStore — one file per entry under the git common dir", () => {
  it("stakes the entry's slug under <git-common-dir>/flume/claims, naming this process", async () => {
    const commonDir = await gitCommonDir(repo.dir);
    const stake = await store.stake("A-TAG-WITH-CAPS");
    expect(stake.kind).toBe("staked");
    if (stake.kind !== "staked") return;

    // The address is the one `spec/pending.md` names: the claims directory of
    // this repository's common dir, keyed by the entry's slug.
    expect(stake.claim.path).toBe(
      join(entryClaimsDir(commonDir), "a-tag-with-caps"),
    );
    expect(parsePidClaim(await readFile(stake.claim.path, "utf8"))?.pid).toBe(
      process.pid,
    );

    // And the live set is that one entry, by the same key.
    expect([...(await store.readLive())]).toEqual(["a-tag-with-caps"]);

    stake.claim.release();
    expect(existsSync(stake.claim.path)).toBe(false);
    expect([...(await store.readLive())]).toEqual([]);
  });

  it("reports the live holder rather than taking a claim another process holds", async () => {
    const planted = await plant("HELD", process.pid);
    const stake = await store.stake("HELD");

    expect(stake).toEqual({ kind: "held", by: expect.objectContaining({ pid: process.pid }) });
    // The holder's own file is untouched — a loser of the race rewrites
    // nothing (`.claude/rules/engineering.md`, *Loud or nothing*).
    expect(parsePidClaim(await readFile(planted, "utf8"))?.pid).toBe(
      process.pid,
    );
  });

  it("reads a claim whose pid is dead as no claim, and reclaims the file at the stake", async () => {
    const planted = await plant("STALE", deadPid());
    // Non-vacuity: the file is on disk before the reads below, so an empty
    // live set is a liveness verdict and not an empty directory.
    expect(existsSync(planted)).toBe(true);
    expect([...(await store.readLive())]).toEqual([]);

    const stake = await store.stake("STALE");
    expect(stake.kind).toBe("staked");
    if (stake.kind !== "staked") return;
    // Reclaimed in place: one file, now naming this process.
    expect(
      await readdir(entryClaimsDir(await gitCommonDir(repo.dir))),
    ).toEqual(["stale"]);
    expect(parsePidClaim(await readFile(planted, "utf8"))?.pid).toBe(
      process.pid,
    );
    stake.claim.release();
  });

  it("reads a repository that has never staked a claim as the empty set", async () => {
    const dir = entryClaimsDir(await gitCommonDir(repo.dir));
    expect(existsSync(dir)).toBe(false);
    expect([...(await store.readLive())]).toEqual([]);
  });

  /**
   * The absence verdict above, proven by descent rather than read off the
   * errno the listing raised. An obstructed ancestor is spelled `ENOENT` on
   * win32 and `ENOTDIR` on posix (`.claude/rules/platform-facts.md`, *win32
   * reports a path through a non-directory as not found*), so a listing keying
   * its silent arm on the errno tells one host's selection that nothing is in
   * flight — two ticks carry one entry, and the pending gate's claim check
   * passes over an entry a build tick holds.
   *
   * The parent is denied on purpose, which that same page admits for this one
   * reader: the descent is exercised by an obstructed *ancestor* and by
   * nothing else. A plain file denies structurally, so this runs on every host
   * rather than riding `chmod`, which denies nothing on win32
   * (`tests/helpers/denial.ts`).
   */
  it("reading a repository's entry claims under an obstructed path refuses naming the claim store", async () => {
    const commonDir = await gitCommonDir(repo.dir);
    const dir = entryClaimsDir(commonDir);
    const above = dirname(dir);

    // The reading the obstruction has to change. Nothing staked is the empty
    // set, and empty is the silent arm — so a refusal below is the plain file
    // talking and not a walk that throws over every fresh repository
    // (`.claude/rules/engineering.md`, *A green verdict is proven
    // non-vacuous*).
    expect(existsSync(above)).toBe(false);
    expect([...(await store.readLive())]).toEqual([]);

    await writeFile(above, "obstruction\n", "utf8");
    // The obstruction really is an ancestor, and the leaf really is the one a
    // single stat cannot classify: present to the descent, absent to a bare
    // probe.
    expect(existsSync(above)).toBe(true);
    expect(existsSync(dir)).toBe(false);

    let message: string | undefined;
    try {
      await store.readHolders();
    } catch (err) {
      message = (err as Error).message;
    }
    // By name: the store, and the rung an operator has to go fix — not the
    // leaf that was asked for, and never a repository with nothing in flight.
    expect(message).toBe(
      `[flume] entry-claim store is unreadable: ${above} is present but is not a directory`,
    );
  });
});
