import {
  existsSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Baton } from "../src/Baton.ts";
import { mkTempDirSync } from "./helpers/fixtureRoot.ts";
import {
  describeBareCall,
  describeUncalled,
  fsImports,
  scanFsCalls,
} from "./helpers/namespacedFsScan.ts";
import { expectNoFindings } from "./helpers/repoProgram.ts";

const BATON_SRC_PATH = fileURLToPath(new URL("../src/Baton.ts", import.meta.url));

let repoRoot: string;
let flumeDir: string;

beforeEach(() => {
  repoRoot = mkTempDirSync("flume-baton-");
  flumeDir = join(repoRoot, ".flume");
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

describe("Baton — wake/sleep/awake roundtrip", () => {
  it("wake creates the flag, awake() lists it, sleep removes it", () => {
    const baton = new Baton(flumeDir);

    expect(baton.awake()).toEqual([]);
    expect(baton.isAwake("plan")).toBe(false);
    expect(baton.hibernating()).toBe(true);

    baton.wake("plan");
    expect(baton.isAwake("plan")).toBe(true);
    expect(baton.awake()).toEqual(["plan"]);
    expect(baton.hibernating()).toBe(false);
    expect(existsSync(join(repoRoot, ".flume", "awake", "plan"))).toBe(true);

    baton.sleep("plan");
    expect(baton.isAwake("plan")).toBe(false);
    expect(baton.awake()).toEqual([]);
    expect(baton.hibernating()).toBe(true);
    expect(existsSync(join(repoRoot, ".flume", "awake", "plan"))).toBe(false);
  });

  it("awake() returns sorted names when multiple phases are awake", () => {
    const baton = new Baton(flumeDir);
    baton.wake("plan");
    baton.wake("build");
    baton.wake("audit");

    expect(baton.awake()).toEqual(["audit", "build", "plan"]);
  });
});

describe("Baton — idempotency", () => {
  it("double wake is a no-op (still one flag, still listed once)", () => {
    const baton = new Baton(flumeDir);
    baton.wake("plan");
    baton.wake("plan");

    expect(baton.awake()).toEqual(["plan"]);
    expect(baton.isAwake("plan")).toBe(true);
  });

  it("sleep on a phase that isn't awake is a no-op (no throw)", () => {
    const baton = new Baton(flumeDir);
    expect(() => baton.sleep("never-woken")).not.toThrow();
    expect(baton.awake()).toEqual([]);
  });

  it("double sleep is a no-op", () => {
    const baton = new Baton(flumeDir);
    baton.wake("plan");
    baton.sleep("plan");
    expect(() => baton.sleep("plan")).not.toThrow();
    expect(baton.isAwake("plan")).toBe(false);
  });
});

/**
 * What a flag carries, and the sleep that reads it (spec/loop.md, *Baton —
 * presence wakes, absence hibernates*). A flag is a queue of depth one: each
 * wake writes a fresh token, and a sleep scoped to a token the caller read
 * earlier declines once a newer one stands, so a wake landing while a tick
 * runs is not cleared by that tick's own sleep.
 *
 * Presence still decides who is awake. Nothing here reads a token to answer
 * `isAwake`, `awake`, or `hibernating` — which is why the empty flag a
 * pre-token wake left still wakes its phase.
 */
describe("Baton — the flag carries a token", () => {
  it("wake writes a fresh token each time, and the flag stays one flag", () => {
    const baton = new Baton(flumeDir);
    expect(baton.token("plan")).toBeUndefined();

    baton.wake("plan");
    const first = baton.token("plan");
    expect(first).toBeTypeOf("string");
    expect(first).not.toBe("");

    baton.wake("plan");
    const second = baton.token("plan");
    expect(second).toBeTypeOf("string");
    // Fresh, not appended to and not left alone: the newest wake is what
    // stands, and the queue's depth is still one.
    expect(second).not.toBe(first);
    expect(baton.awake()).toEqual(["plan"]);
  });

  it("wake and sleep stay idempotent over a flag carrying a token", () => {
    const baton = new Baton(flumeDir);

    baton.wake("plan");
    baton.wake("plan");
    // Vacuity pin: idempotence is being judged over a flag that really
    // carries a token, not over the empty file a pre-token wake wrote.
    expect(baton.token("plan")).toBeTypeOf("string");
    expect(baton.token("plan")).not.toBe("");
    expect(baton.awake()).toEqual(["plan"]);
    expect(baton.isAwake("plan")).toBe(true);

    baton.sleep("plan");
    expect(() => baton.sleep("plan")).not.toThrow();
    expect(baton.isAwake("plan")).toBe(false);
    expect(baton.token("plan")).toBeUndefined();
    expect(() => baton.sleep("never-woken")).not.toThrow();
    expect(baton.awake()).toEqual([]);
  });

  it("a scoped sleep removes the token it read and declines a newer one", () => {
    const baton = new Baton(flumeDir);
    baton.wake("plan");
    const read = baton.token("plan");

    // A wake landing after that read — what a sibling does while a tick runs.
    baton.wake("plan");
    expect(baton.token("plan")).not.toBe(read);

    expect(baton.sleepIfUnchanged("plan", read)).toBe(false);
    expect(baton.isAwake("plan")).toBe(true);

    // Handed what is actually standing, it sleeps.
    expect(baton.sleepIfUnchanged("plan", baton.token("plan"))).toBe(true);
    expect(baton.isAwake("plan")).toBe(false);
  });

  it("a flag standing where the caller read none is a wake it keeps", () => {
    const baton = new Baton(flumeDir);

    // Nothing stood when the caller read; a wake landed since. Same verdict
    // as a newer token — the caller never saw this run queued.
    baton.wake("plan");

    expect(baton.sleepIfUnchanged("plan", undefined)).toBe(false);
    expect(baton.isAwake("plan")).toBe(true);
  });

  it("nothing standing is already asleep, whatever token the caller read", () => {
    const baton = new Baton(flumeDir);

    expect(baton.sleepIfUnchanged("plan", undefined)).toBe(true);
    expect(baton.sleepIfUnchanged("plan", "a-token-no-flag-carries")).toBe(true);
    expect(baton.isAwake("plan")).toBe(false);
    expect(baton.hibernating()).toBe(true);
  });

  it("an empty pre-token flag wakes its phase, and its token is the empty string", () => {
    // A flag a wake wrote before flags carried tokens, or a hand-touched one:
    // empty on disk. Presence is what wakes a phase, so it must not read as
    // absent — and a tick reads the empty string off it and sleeps through it
    // like any other token.
    const baton = new Baton(flumeDir);
    writeFileSync(join(baton.dir, "plan"), "");

    expect(baton.isAwake("plan")).toBe(true);
    expect(baton.awake()).toEqual(["plan"]);
    expect(baton.hibernating()).toBe(false);
    expect(baton.token("plan")).toBe("");

    expect(baton.sleepIfUnchanged("plan", "")).toBe(true);
    expect(baton.isAwake("plan")).toBe(false);
  });
});

/**
 * One flag class, one disposition on an unresolved read. `awake()` (and so
 * `hibernating()`) already throws when the awake dir is present but
 * unreadable; `isAwake` read the same disk through `existsSync`, which
 * collapses every stat failure to `false` — a phase holding a flag nothing
 * could stat reported as asleep, and the caller hibernated over it
 * (`.claude/rules/engineering.md`, "The fix lands at the mechanism").
 *
 * Two depths, and they are not the same case. An unstattable *flag* sits
 * inside a dir `readdirSync` still reads, so only the stat is hit; an
 * unstattable *awake dir* fails the listing too, and that is where the two
 * readers have to agree.
 */
describe.runIf(process.platform !== "win32")("Baton — an unstattable awake flag is loud", () => {
  /**
   * Replace the constructed awake dir with a symlink to itself: `readdirSync`
   * on the dir and `statSync` on any path under it both raise ELOOP. Not a
   * permission bit — a root-run test would bypass chmod.
   */
  const loopAwakeDir = (baton: Baton): void => {
    rmSync(baton.dir, { recursive: true });
    symlinkSync(basename(baton.dir), baton.dir);
  };

  it("an unstattable flag inside a readable dir leaves awake() listing it while isAwake throws", () => {
    const baton = new Baton(flumeDir);
    // ELOOP — present on disk, unstattable. Not a permission bit: a root-run
    // test would bypass that.
    symlinkSync("plan", join(baton.dir, "plan"));

    // readdir sees the entry, so the flag really is there.
    expect(baton.awake()).toEqual(["plan"]);
    expect(baton.hibernating()).toBe(false);
    expect(() => baton.isAwake("plan")).toThrow(/ELOOP/);
  });

  it("awake() throws when the awake dir itself is unstattable", () => {
    const baton = new Baton(flumeDir);
    loopAwakeDir(baton);

    expect(() => baton.awake()).toThrow(/ELOOP/);
    // hibernating() reads through awake(), so it cannot answer "asleep" either.
    expect(() => baton.hibernating()).toThrow(/ELOOP/);
  });

  it("awake() and isAwake both throw on one unstattable awake dir", () => {
    const baton = new Baton(flumeDir);
    loopAwakeDir(baton);

    expect(() => baton.awake()).toThrow(/ELOOP/);
    expect(() => baton.isAwake("plan")).toThrow(/ELOOP/);
  });

  it("absence stays silent — a name with no flag is still plainly asleep", () => {
    const baton = new Baton(flumeDir);
    baton.wake("plan");

    expect(baton.isAwake("build")).toBe(false);
  });
});

describe("Baton — missing directory", () => {
  it("constructor creates `<flumeDir>/awake` when neither exists", () => {
    const fresh = mkTempDirSync("flume-baton-fresh-");
    try {
      expect(existsSync(join(fresh, ".flume"))).toBe(false);

      const baton = new Baton(join(fresh, ".flume"));

      expect(existsSync(join(fresh, ".flume", "awake"))).toBe(true);
      expect(baton.awake()).toEqual([]);
      expect(baton.hibernating()).toBe(true);

      baton.wake("plan");
      expect(baton.isAwake("plan")).toBe(true);
    } finally {
      rmSync(fresh, { recursive: true, force: true });
    }
  });

  it("constructor is idempotent when `.flume/awake` already exists", () => {
    new Baton(flumeDir);
    const second = new Baton(flumeDir);
    expect(second.awake()).toEqual([]);
  });
});

describe("Baton — win32 MAX_PATH fix (.claude/rules/platform-facts.md)", () => {
  // toNamespacedPath is a no-op on POSIX, so the roundtrip tests above pass
  // identically whether Baton routes through namespacedJoin or a bare join.
  // Pin the source shape directly, per PendingSchema.test.ts's precedent for
  // this kind of platform fact — through the scan the package-wide pin
  // (tests/namespacedFsPaths.test.ts) judges src/ and harness/ with, so this
  // module cannot be admitted by a looser copy of one rule.
  //
  // The scan's subjects are Baton.ts's own fs imports, never a list restated
  // here (`.claude/rules/engineering.md`, *Derived state is computed, never
  // restated beside its source*): a sixth fs import joins the scan by being
  // written, so a bare join at its call site cannot ship green. `existsLoud`
  // (src/fsProbe.ts) stats the path it is handed and declares the join its
  // caller's, so it is a subject exactly as `node:fs` calls are.
  const src = readFileSync(BATON_SRC_PATH, "utf8");
  const imports = fsImports(src);
  const scan = scanFsCalls("src/Baton.ts", src);

  it("imports namespacedJoin from ./paths.js", () => {
    // Named alongside whatever else Baton takes from paths.js (the state-root
    // layout accessors) — the pin is that namespacedJoin comes from the shared
    // home, not that it arrives alone.
    expect(src).toMatch(/import\s*\{[^}]*\bnamespacedJoin\b[^}]*\}\s*from\s*"\.\/paths\.js"/);
  });

  it("the scanned fs-symbol set is non-empty and covers Baton.ts's node:fs and ./fsProbe.js imports", () => {
    // Vacuity pin for the scan below: an import clause the scan stopped
    // matching, or a call-site regex that stopped matching, would leave it
    // green over zero subjects.
    expect(scan.judged).toBeGreaterThan(0);
    expect(imports.get("node:fs")?.length ?? 0).toBeGreaterThan(0);
    expect(imports.get("./fsProbe.js")?.length ?? 0).toBeGreaterThan(0);
  });

  it("every fs symbol src/Baton.ts imports is called on a namespacedJoin argument", () => {
    expectNoFindings(scan.uncalled.map((fn) => describeUncalled(scan, fn)));
    expectNoFindings(scan.bare.map((call) => describeBareCall(scan, call)));
  });
});

describe("Baton — relocatable state dir", () => {
  it("puts awake/ under the given flumeDir, not under a fixed `.flume`", () => {
    // A relocated state dir (the ephemeral-dock posture): the baton must land
    // wherever flumeDir points, leaving the conventional `<root>/.flume` empty.
    const dock = join(repoRoot, "ephemeral-dock");
    const baton = new Baton(dock);

    baton.wake("plan");

    expect(existsSync(join(dock, "awake", "plan"))).toBe(true);
    expect(existsSync(join(repoRoot, ".flume"))).toBe(false);
    expect(baton.awake()).toEqual(["plan"]);
  });
});
