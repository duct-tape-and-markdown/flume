/**
 * The prior-attempt module's own surface: the six record builders and the
 * store that anchors and persists what they mint.
 *
 * Driven as an agreement gate (`.claude/rules/engineering.md`, *A seam gate
 * reads what the real writer wrote*): every draft here is built by the real
 * builder, written by the real `PriorAttemptStore.write`, and decoded by the
 * real `PriorAttemptStore.read` — the reader that a tick's
 * `TickContext.priorAttempts` is assembled from. A builder minting a mode the
 * reader does not accept, or a `write` dropping the anchor `read` requires,
 * fails here rather than degrading a live tick's record to "no prior".
 *
 * The dispatcher's own end-to-end prior-attempt behavior (which tick writes
 * which mode, when a record is cleared, the win32 deep-path cases) stays in
 * tests/Dispatcher.test.ts, where the tick that produces it lives.
 */

import { existsSync } from "node:fs";
import { lstat, mkdir, symlink, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { slugify } from "../src/paths.ts";
import type { PendingEntry } from "../src/PendingSchema.ts";
import type { Phase } from "../src/Phase.ts";
import { InlineExecRenderError } from "../src/Prompt.ts";
import {
  buildCleanExit,
  buildGateRevert,
  buildNotShipped,
  buildPlatformPreempt,
  buildRenderRefused,
  buildTipMoved,
  priorAttemptPath,
  priorAttemptRef,
  priorAttemptsDir,
  PriorAttemptStore,
  type PriorAttemptDraft,
} from "../src/priorAttempts.ts";
import {
  makeFixture,
  silent,
  type Fixture,
} from "./helpers/dispatcherFixture.ts";
import { gitOut } from "./helpers/subprocess.ts";

/** Every `PriorAttempt` mode the renderer is exhaustive over. */
const ALL_MODES = [
  "gate-revert",
  "clean-exit",
  "platform-preempt",
  "render-refused",
  "tip-moved",
  "not-shipped",
] as const;

describe("priorAttempts — the record builders (spec/loop.md 'Prior-outcome feedback to the retrying tick')", () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await makeFixture();
  });
  afterEach(async () => {
    await fx.cleanup();
  });

  it("the prior-attempt record builders are exported from src/priorAttempts.ts — one per mode, each round-tripping through the store that writes and reads them", async () => {
    const flumeDir = join(fx.repo, ".flume");
    const store = new PriorAttemptStore(flumeDir, fx.repo, silent);
    const head = (await gitOut(fx.repo, ["rev-parse", "HEAD"])).trim();
    expect(head).toMatch(/^[0-9a-f]{40}$/);

    const drafts: PriorAttemptDraft[] = [
      await buildGateRevert(
        "afterCommit",
        { gate: "tsc", message: "type error", details: "src/seed.ts(1,1)" },
        fx.repo,
        head,
        ["src/seed.ts"],
      ),
      buildCleanExit("refused: the fence excludes spec/"),
      buildPlatformPreempt("process-failure"),
      buildRenderRefused(
        new InlineExecRenderError([{ cmd: "git log", stderr: "not a repo" }]),
      ),
      buildTipMoved(head, `${"0".repeat(39)}1`),
      buildNotShipped(head, ["src/seed.ts"]),
    ];

    // Non-vacuity, both directions: the builders cover every mode the reader
    // accepts, and no two of them mint the same one. A builder that stopped
    // being exported would take its mode out of this set rather than
    // silently shrinking a loop the assertions below still pass over.
    expect(drafts.map((d) => d.mode).sort()).toEqual([...ALL_MODES].sort());

    for (const draft of drafts) {
      // One key per mode, so the six records coexist rather than overwriting
      // each other — `priorAttemptRef` derives key and keyspace together.
      const ref = priorAttemptRef({ name: draft.mode } as Phase);
      expect(ref).toEqual({ key: draft.mode, keyspace: "phase" });

      await store.write(ref, draft);
      expect(existsSync(priorAttemptPath(flumeDir, ref.key)), draft.mode).toBe(
        true,
      );

      const back = await store.read(ref.key);
      expect(back, `${draft.mode} read back as absent`).toBeDefined();
      // The anchor `read` refuses a record without (spec/loop.md "Every
      // record is anchored" / "No false signal") — stamped by `write`, so no
      // builder carries it.
      expect(back!.headSha).toBe(head);
      expect(back!.key).toBe("phase");
      expect(Date.parse(back!.at)).not.toBeNaN();
      // Everything the builder itself said survives the round trip verbatim.
      expect(back).toMatchObject(draft as Record<string, unknown>);
    }

    // `readAll` is keyed by the identity `write` stamped — here one mode name
    // per record — so a tick's `TickContext.priorAttempts` carries all six.
    const all = await store.readAll();
    expect([...all.keys()].sort()).toEqual([...ALL_MODES].sort());

    expect(dirname(priorAttemptPath(flumeDir, "any-key"))).toBe(
      priorAttemptsDir(flumeDir),
    );
  });
});

/**
 * `existsSync` collapsed every stat failure to `false`, so a record that is
 * on disk but unstattable read as "no prior attempt" — the one answer
 * spec/loop.md "Repeated identical failures" counts on to *not* be invented.
 * A false absent there resets the quarantine count on every tick and the
 * loop retries the same failing entry forever. The probe now splits ENOENT
 * from the rest (`existsLoud`, src/fsProbe.ts); the reader's other
 * degradations — garbled JSON, an unknown mode, a missing anchor — still
 * return "no prior", because those records were read.
 */
describe("priorAttempts — an unreachable record is not an absent one", () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await makeFixture();
  });
  afterEach(async () => {
    await fx.cleanup();
  });

  it("PriorAttempts.read throws on a record present but unstattable, never reporting no prior attempt", async () => {
    const flumeDir = join(fx.repo, ".flume");
    const store = new PriorAttemptStore(flumeDir, fx.repo, silent);
    const key = "build";
    const p = priorAttemptPath(flumeDir, key);
    await mkdir(dirname(p), { recursive: true });
    // ELOOP — present, unstattable. Not a permission bit: a root-run test
    // would bypass that.
    await symlink(basename(p), p);

    // Vacuity pins (`.claude/rules/engineering.md`, "A green verdict is
    // proven non-vacuous"): a record really is at the path the store reads,
    // and the stat that decides really does fail on it.
    expect((await lstat(p)).isSymbolicLink()).toBe(true);
    expect(existsSync(p)).toBe(false);

    await expect(store.read(key)).rejects.toThrow(/ELOOP/);
  });

  it("PriorAttemptStore.read still reports no prior attempt for a record it read and could not decode", async () => {
    const flumeDir = join(fx.repo, ".flume");
    const store = new PriorAttemptStore(flumeDir, fx.repo, silent);
    const key = "build";
    const p = priorAttemptPath(flumeDir, key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, "{not json");

    expect(existsSync(p)).toBe(true);
    await expect(store.read(key)).resolves.toBeUndefined();
  });
});

describe("priorAttempts — one stem, two artifacts (`.claude/rules/engineering.md`, 'The fix lands at the mechanism')", () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await makeFixture();
  });
  afterEach(async () => {
    await fx.cleanup();
  });

  it("PriorAttemptStore.snapshotDir keys its directory by the same slug priorAttemptPath keys the record JSON by", async () => {
    const flumeDir = join(fx.repo, ".flume");
    const store = new PriorAttemptStore(flumeDir, fx.repo, silent);
    const head = (await gitOut(fx.repo, ["rev-parse", "HEAD"])).trim();

    // Raw keys a `slugify` actually changes — a phase name the chain spells
    // with an underscore, a tag with the shout-case the queue uses. A key
    // already in slug form would make this vacuous.
    const rawKeys = ["plan_sweep", "SNAPSHOT-KEY", "Plan Derive"];
    expect(rawKeys.every((k) => slugify(k) !== k)).toBe(true);

    for (const key of rawKeys) {
      // The real writers, not a re-derivation: `write` places the record and
      // `snapshotReverted` places the snapshot, each through the store's own
      // keying.
      await store.write({ key, keyspace: "phase" }, buildTipMoved(head, head));
      await store.snapshotReverted(fx.repo, head, key);

      const record = priorAttemptPath(flumeDir, key);
      const snapshot = store.snapshotDir(key);
      expect(existsSync(record), key).toBe(true);
      expect(existsSync(snapshot), key).toBe(true);

      // Same directory, same stem, different suffix — siblings by one
      // identity rather than two spellings of the same attempt.
      expect(dirname(snapshot)).toBe(dirname(record));
      expect(basename(snapshot)).toBe(
        `${basename(record, ".json")}.reverted`,
      );
      expect(basename(snapshot)).toBe(`${slugify(key)}.reverted`);
    }
  });

  it("PriorAttemptStore.snapshotDir keeps a traversing key inside priorAttemptsDir", () => {
    const flumeDir = join(fx.repo, ".flume");
    const store = new PriorAttemptStore(flumeDir, fx.repo, silent);

    // `clear` and `snapshotReverted` both `rm -rf` this dir; a key that
    // resolves out of `prior-attempts/` aims that removal at the tree.
    for (const key of ["../../escape", "..", "a/../../b", "/abs"]) {
      const dir = store.snapshotDir(key);
      const rel = relative(priorAttemptsDir(flumeDir), dir);
      expect(rel, key).not.toBe("");
      expect(rel.startsWith("..") || isAbsolute(rel), key).toBe(false);
      expect(dirname(dir), key).toBe(priorAttemptsDir(flumeDir));
    }
  });

  it("priorAttemptPath keeps a traversing key inside priorAttemptsDir", () => {
    const flumeDir = join(fx.repo, ".flume");

    for (const key of ["../../escape", "..", "a/../../b", "/abs"]) {
      const p = priorAttemptPath(flumeDir, key);
      const rel = relative(priorAttemptsDir(flumeDir), p);
      expect(rel, key).not.toBe("");
      expect(rel.startsWith("..") || isAbsolute(rel), key).toBe(false);
      expect(dirname(p), key).toBe(priorAttemptsDir(flumeDir));
    }
  });
});

/**
 * The record's own written identity, and the map key that reads off it.
 *
 * A record's filename stem is slugged — it has to be, or a raw tag would walk
 * out of `prior-attempts/`. The map a chain reads is not a filesystem, and
 * keying it by that stem handed a singleton phase a key it does not hold: a
 * chain whose phase is named `plan_sweep` looks itself up by `plan_sweep` and
 * found nothing, because the file sat at `plan-sweep.json`. `write` now stamps
 * the ref's key onto the record and `readAll` keys by that, so the two
 * keyspaces spec/chain.md ("What a hook receives") names — tag slug for
 * fanout, phase name for singletons — are both the identity the caller
 * already holds.
 *
 * Driven end to end through the real writer and the real reader
 * (`.claude/rules/engineering.md`, *A seam gate reads what the real writer
 * wrote*); only the refusal case below is hand-authored, which is the
 * sanctioned exception — no writer mints a record missing the field.
 */
describe("priorAttempts — a record is keyed by the identity it was written under", () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await makeFixture();
  });
  afterEach(async () => {
    await fx.cleanup();
  });

  it("readAll keys a singleton's record by the raw phase name, not its slugged stem", async () => {
    const flumeDir = join(fx.repo, ".flume");
    const store = new PriorAttemptStore(flumeDir, fx.repo, silent);

    // Phase names a chain plausibly spells and `slugify` actually rewrites —
    // a name already in slug form would make the whole test vacuous.
    const phaseNames = ["plan_sweep", "Plan Derive"];
    expect(phaseNames.every((n) => slugify(n) !== n)).toBe(true);

    for (const name of phaseNames) {
      const ref = priorAttemptRef({ name } as Phase);
      expect(ref).toEqual({ key: name, keyspace: "phase" });
      await store.write(ref, buildCleanExit(`parked: ${name}`));
    }

    const all = await store.readAll();
    expect(all.size).toBe(phaseNames.length);

    for (const name of phaseNames) {
      // The key a `shouldRun` holds is `phase.name` itself.
      expect(all.get(name)?.mode, name).toBe("clean-exit");
      expect(all.get(name)?.key, name).toBe("phase");
      // …and the slugged stem is not a second key for the same record.
      expect(all.has(slugify(name)), name).toBe(false);
      // The on-disk artifact is unmoved: still the slugged stem, so nothing
      // a raw key could do to a path is reintroduced here.
      expect(
        existsSync(join(priorAttemptsDir(flumeDir), `${slugify(name)}.json`)),
        name,
      ).toBe(true);
    }
  });

  it("readAll keys a fanout entry's record by its tag slug", async () => {
    const flumeDir = join(fx.repo, ".flume");
    const store = new PriorAttemptStore(flumeDir, fx.repo, silent);

    const tag = "SHOUTY-TAG";
    expect(slugify(tag)).not.toBe(tag);
    const entry: PendingEntry = {
      tag,
      gate: { kind: "open" },
      dependsOnForks: [],
      files: { new: [], edit: [], retire: [] },
    };

    const ref = priorAttemptRef({ name: "build" } as Phase, entry);
    expect(ref).toEqual({ key: slugify(tag), keyspace: "entry" });
    await store.write(ref, buildCleanExit("parked: needs a wider fence"));

    const all = await store.readAll();
    expect(all.size).toBe(1);
    // The entry keyspace is unchanged by the singleton fix: the ref already
    // slugged the tag, so the written identity and the stem are one text —
    // which is what `clearStale` compares the queue's tags against.
    expect(all.get(slugify(tag))?.key).toBe("entry");
    expect(all.has(tag)).toBe(false);
    expect(await store.clearStale([entry])).toEqual([]);
    expect(await store.clearStale([])).toEqual([slugify(tag)]);
  });

  it("a prior-attempt record carrying no written identity reads as no prior attempt", async () => {
    const flumeDir = join(fx.repo, ".flume");
    const store = new PriorAttemptStore(flumeDir, fx.repo, silent);
    const p = priorAttemptPath(flumeDir, "plan");
    await mkdir(dirname(p), { recursive: true });

    // Everything the reader asked for before the identity existed — a record
    // left by an older line, or by anything that is not this store. Without
    // it `readAll` has nothing to key by and would file the record under
    // `undefined`, which is a key no chain can ask for and a value every
    // `ReadonlyMap<string, …>` consumer believes cannot be there.
    await writeFile(
      p,
      JSON.stringify({
        mode: "clean-exit",
        finalMessage: "parked: the entry needs a wider fence",
        key: "phase",
        headSha: "0".repeat(40),
        at: "2024-01-01T00:00:00.000Z",
      }),
    );
    expect(existsSync(p)).toBe(true);

    await expect(store.read("plan")).resolves.toBeUndefined();
    expect((await store.readAll()).size).toBe(0);
  });
});
