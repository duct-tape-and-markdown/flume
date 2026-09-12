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
import { basename, dirname, isAbsolute, join, relative } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { slugify } from "../src/paths.ts";
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

    // `readAll` is keyed by the same filename stem `write` used, so a tick's
    // `TickContext.priorAttempts` carries all six.
    const all = await store.readAll();
    expect([...all.keys()].sort()).toEqual([...ALL_MODES].sort());

    expect(dirname(priorAttemptPath(flumeDir, "any-key"))).toBe(
      priorAttemptsDir(flumeDir),
    );
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
