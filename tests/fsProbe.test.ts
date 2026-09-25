/**
 * `src/fsProbe.ts`'s own cover — the one place the engine spells "absent" —
 * driven on the raw exported calls rather than through any of the ~25 gates
 * built on them.
 *
 * The property is a *split*, so every case here names both arms: what the
 * probe answers silently (absence, and only absence) and what it refuses. A
 * cover that only asserted the refusal would pass over a probe that threw on
 * everything, and a cover that only asserted the silent arm would pass over
 * the `throwIfNoEntry: false` reading this file exists to fence — one that
 * folds an obstructed ancestor into absence and hands every gate above it a
 * confident wrong answer (`.claude/rules/engineering.md`, *Loud or nothing*).
 *
 * Denial here is structural — a plain file where a directory is traversed —
 * never a permission bit (`.claude/rules/platform-facts.md`, *chmod denies
 * nothing on win32*).
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { rm, symlink } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  existsLoud,
  existsLoudUnder,
  isDirectoryOrAbsent,
  statLoud,
} from "../src/fsProbe.ts";
import { mkTempDir } from "./helpers/fixtureRoot.ts";

const roots: string[] = [];

const scratch = async (): Promise<string> => {
  const dir = await mkTempDir("flume-fsprobe-");
  roots.push(dir);
  return dir;
};

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});

/** The errno a call raised, or `undefined` when it did not raise at all. */
const errno = (call: () => unknown): string | undefined => {
  try {
    call();
  } catch (err) {
    return (err as NodeJS.ErrnoException).code ?? "";
  }
  return undefined;
};

describe("fsProbe — the ENOENT-vs-everything-else split, on the raw call", () => {
  it("answers present for a file and a directory, and absent for a name nothing holds", async () => {
    const root = await scratch();
    const file = join(root, "pending.json");
    writeFileSync(file, "[]");

    expect(existsLoud(file)).toBe(true);
    expect(statLoud(file)?.isFile()).toBe(true);
    expect(existsLoud(root)).toBe(true);
    expect(statLoud(root)?.isDirectory()).toBe(true);

    // The one silent reading, and the reason the rest of this file matters:
    // absence is answered, never thrown.
    expect(existsLoud(join(root, "nothing-here"))).toBe(false);
    expect(statLoud(join(root, "nothing-here"))).toBeUndefined();
  });

  it("refuses a symlink loop rather than reading it as absent", async () => {
    const root = await scratch();
    const loop = join(root, "chain.ts");
    // ELOOP, not a permission bit: a root-run bypasses those, a
    // self-referential symlink fails for every uid.
    await symlink("chain.ts", loop);

    expect(errno(() => existsLoud(loop))).toBe("ELOOP");
    expect(errno(() => statLoud(loop))).toBe("ELOOP");
  });

  /*
   * The obstructed-ancestor arm. POSIX answers a lookup that passes through a
   * plain file with ENOTDIR; win32 answers it ENOENT, indistinguishable from
   * an absent leaf, so this probe reads it as absent there whatever it does
   * with the errno (`.claude/rules/platform-facts.md`, *win32 reports a path
   * through a non-directory as not found*). The host is declared and the case
   * skips rather than asserting a refusal that host cannot make; the
   * cross-host proof is a descent, which `isDirectoryOrAbsent` runs for the
   * two readers that need it (`PriorAttemptStore.readAll`,
   * `readMergingMarkers`) and which `tests/priorAttempts.test.ts` and
   * `tests/Dispatcher.test.ts` cover at their obstructed-ancestor arms.
   */
  const posixOnly = it.runIf(process.platform !== "win32");

  posixOnly(
    "existsLoud refuses a path whose ancestor is present and not a directory, rather than reading it as absent",
    async () => {
      const root = await scratch();
      const store = join(root, "store");
      const under = join(store, "awake");

      // Non-vacuity, both directions: the path really resolves while `store`
      // is a directory, and the probe's silent arm really is reachable from
      // this same root — so the verdict below is the obstruction talking and
      // not a probe that throws on everything
      // (`.claude/rules/engineering.md`, *A green verdict is proven
      // non-vacuous*).
      mkdirSync(under, { recursive: true });
      expect(existsLoud(under)).toBe(true);
      expect(existsLoud(join(root, "nothing-here"))).toBe(false);

      // Obstruct the ancestor: a plain file where `store` stood.
      await rm(store, { recursive: true, force: true });
      writeFileSync(store, "obstruction\n");
      // The ancestor really is there — this is not absence wearing a
      // different name.
      expect(readFileSync(store, "utf8")).toBe("obstruction\n");

      expect(errno(() => existsLoud(under))).toBe("ENOTDIR");
      // And the silent arm is still silent: only ENOENT is folded.
      expect(existsLoud(join(root, "nothing-here"))).toBe(false);
    },
  );

  posixOnly(
    "statLoud refuses that path too, so the probe's Stats face and its boolean face split alike",
    async () => {
      const root = await scratch();
      const store = join(root, "store");
      const under = join(store, "awake");

      mkdirSync(under, { recursive: true });
      expect(statLoud(under)?.isDirectory()).toBe(true);

      await rm(store, { recursive: true, force: true });
      writeFileSync(store, "obstruction\n");

      // Both faces, over the one path, with the one disposition: the boolean
      // face is built on the Stats face, so a split that held at only one of
      // them would mean a caller's choice of face decided whether it refused.
      expect(errno(() => statLoud(under))).toBe("ENOTDIR");
      expect(errno(() => existsLoud(under))).toBe("ENOTDIR");
      // Agreeing on the silent arm too, not merely on the loud one.
      const absent = join(root, "nothing-here");
      expect(statLoud(absent)).toBeUndefined();
      expect(existsLoud(absent)).toBe(false);
    },
  );
});

/**
 * The descent both directory readers take their absence from
 * (`PriorAttemptStore.readAll`, `readMergingMarkers`), on the raw call. Its
 * whole reason for existing is the arm the probes above declare they cannot
 * make: an obstructed *ancestor*, which a single stat reads as absent on
 * win32. So this cover runs on every host — the walk stats each ancestor
 * itself, and a plain file is a plain file on both.
 */
describe("fsProbe — the descent, where absence is proven from the path", () => {
  it("answers the leaf directory, folds an absence at any rung, and refuses a plain file at one", async () => {
    const root = await scratch();
    const store = join(root, "store");
    const leaf = join(store, "entry");
    mkdirSync(leaf, { recursive: true });

    // Cleared end to end: the walk really reaches the leaf, so the two
    // negative arms below are the fixture talking and not a walk that
    // answers `false` from the first rung
    // (`.claude/rules/engineering.md`, *A green verdict is proven
    // non-vacuous*).
    expect(isDirectoryOrAbsent("store", root, store, leaf)).toBe(true);

    // Absent at the leaf, and absent at a rung above it: both are the silent
    // arm, and neither is a refusal.
    expect(isDirectoryOrAbsent("store", root, store, join(store, "gone"))).toBe(
      false,
    );
    expect(
      isDirectoryOrAbsent(
        "store",
        root,
        join(root, "gone"),
        join(root, "gone", "entry"),
      ),
    ).toBe(false);

    // Obstruct the middle rung. The leaf is now unreachable, which on win32
    // is spelled exactly like the absences above — so the refusal has to
    // come from the rung's own type, and it names that rung rather than the
    // leaf the caller asked about.
    await rm(store, { recursive: true, force: true });
    writeFileSync(store, "obstruction\n");
    expect(readFileSync(store, "utf8")).toBe("obstruction\n");

    let message: string | undefined;
    try {
      isDirectoryOrAbsent("prior-attempt store", root, store, leaf);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message, "the obstructed rung read as absent").toBeDefined();
    expect(message).toContain(
      `prior-attempt store is unreadable: ${store} is present but is not a directory`,
    );
    // And the silent arm is still silent from the same root.
    expect(isDirectoryOrAbsent("store", join(root, "gone"))).toBe(false);
  });
});

/**
 * The same descent with a **file** at the end of it — the probe every gate
 * whose subject is one artifact takes: a loop lock, a stop flag, a tip claim.
 * The split is the one every case here names, over the arm those gates read as
 * silence: absent (the artifact was never written, and neither was a directory
 * above it) against present-but-unreachable, which a single stat cannot tell
 * apart on win32. So this cover runs on every host too.
 */
describe("fsProbe — the descent to a file, where absence is proven from the path", () => {
  it("answers the file, folds an absence at the leaf or a rung, and refuses a plain file at a rung", async () => {
    const root = await scratch();
    const dir = join(root, "flume");
    const leaf = join(dir, "tip-claims", "refs", "heads", "main");
    mkdirSync(join(dir, "tip-claims", "refs", "heads"), { recursive: true });
    writeFileSync(leaf, "4242\n");

    // Cleared end to end: the walk really reaches the file, so the absences
    // below are the fixture talking and not a descent that stopped at its
    // first rung (`.claude/rules/engineering.md`, *A green verdict is proven
    // non-vacuous*).
    expect(existsLoudUnder("tip claim", root, leaf)).toBe(true);

    // Absent at the leaf, and absent at a directory above it: both are the
    // silent arm, and neither is a refusal.
    expect(existsLoudUnder("tip claim", root, join(dir, "gone"))).toBe(false);
    expect(
      existsLoudUnder("tip claim", root, join(root, "gone", "claims", "main")),
    ).toBe(false);

    // Obstruct a rung. The file is still on disk and is now unreachable —
    // which on win32 its own stat spells exactly like the absences above, so
    // the refusal has to come from the rung's type and names that rung.
    await rm(dir, { recursive: true, force: true });
    writeFileSync(dir, "obstruction\n");

    let message: string | undefined;
    try {
      existsLoudUnder("tip claim", root, leaf);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message, "the obstructed rung read as an unclaimed tip").toBeDefined();
    expect(message).toContain(
      `tip claim is unreadable: ${dir} is present but is not a directory`,
    );

    // A file directly under the root it descends from is the shortest walk
    // there is — one rung, the root itself — and it still splits: the loop
    // lock's own shape.
    const lock = join(root, "loop.pid");
    expect(existsLoudUnder("loop lock", root, lock)).toBe(false);
    writeFileSync(lock, "4242\n");
    expect(existsLoudUnder("loop lock", root, lock)).toBe(true);
    // And the shape `flume status` refuses on: a state root that is present
    // and is not a directory, with the lock nowhere beneath it to be read.
    const sealedRoot = join(root, "state");
    writeFileSync(sealedRoot, "obstruction\n");
    expect(() =>
      existsLoudUnder("loop lock", sealedRoot, join(sealedRoot, "loop.pid")),
    ).toThrow(
      `loop lock is unreadable: ${sealedRoot} is present but is not a directory`,
    );
  });
});
