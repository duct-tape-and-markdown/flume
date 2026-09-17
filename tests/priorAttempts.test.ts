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
import { lstat, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { slugify } from "../src/paths.ts";
import type { PendingEntry } from "../src/PendingSchema.ts";
import type { Phase } from "../src/Phase.ts";
import {
  InlineExecRenderError,
  renderPrompt,
  type PriorAttempt,
} from "../src/Prompt.ts";
// The roster comes from the package root rather than src/Prompt.ts: a chain
// reads it there, which is the whole reason it is a runtime value. The two
// keyers come from there under their own names for the same reason, and are
// spelled apart from the module's copies below so a case naming the package's
// surface cannot be satisfied by the module import.
import {
  entryAttemptKey as surfaceEntryAttemptKey,
  recordAttemptKey as surfaceRecordAttemptKey,
  PRIOR_ATTEMPT_MODES,
} from "../src/index.ts";
import {
  buildCleanExit,
  buildGateRevert,
  buildNotShipped,
  buildPlatformPreempt,
  buildRenderRefused,
  buildTipMoved,
  entryAttemptKey,
  priorAttemptPath,
  priorAttemptRef,
  priorAttemptsDir,
  PriorAttemptStore,
  recordAttemptKey,
  type PriorAttemptDraft,
  type PriorAttemptRef,
} from "../src/priorAttempts.ts";
import {
  makeFixture,
  silent,
  type Fixture,
} from "./helpers/dispatcherFixture.ts";
import { gitOut, SPAWN_BUDGET_MS } from "./helpers/subprocess.ts";

// This file starts processes, so it declares the lane's one budget — cases
// and hooks alike — once here rather than inheriting the runner's default
// (`SPAWN_BUDGET_MS`, `tests/helpers/subprocess.ts`).
vi.setConfig({ testTimeout: SPAWN_BUDGET_MS, hookTimeout: SPAWN_BUDGET_MS });

/**
 * One draft per mode, minted by the real builders in the shape
 * {@link PriorAttemptStore.write} receives them — the input both tests below
 * judge the roster and the reader against.
 */
async function everyDraft(
  repo: string,
  head: string,
): Promise<PriorAttemptDraft[]> {
  return [
    await buildGateRevert(
      "afterCommit",
      { gate: "tsc", message: "type error", details: "src/seed.ts(1,1)" },
      repo,
      head,
      ["src/seed.ts"],
    ),
    buildCleanExit("refused: the fence excludes spec/"),
    buildPlatformPreempt("process-failure"),
    buildRenderRefused(
      new InlineExecRenderError([{ cmd: "git log", stderr: "not a repo" }])
        .message,
    ),
    buildTipMoved(head, `${"0".repeat(39)}1`),
    buildNotShipped(head, ["src/seed.ts"]),
  ];
}

describe("priorAttempts — the record builders (spec/loop.md 'Prior-outcome feedback to the retrying tick')", () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await makeFixture();
  });
  afterEach(async () => {
    await fx.cleanup();
  });

  it("the engine's prior-attempt mode roster names every mode a record builder mints", async () => {
    const head = (await gitOut(fx.repo, ["rev-parse", "HEAD"])).trim();
    expect(head).toMatch(/^[0-9a-f]{40}$/);
    const drafts = await everyDraft(fx.repo, head);

    // Vacuity, both sides: an empty roster or a builder list that quietly
    // shrank would otherwise agree with anything.
    expect(PRIOR_ATTEMPT_MODES.length).toBeGreaterThan(0);
    expect(drafts.length).toBe(PRIOR_ATTEMPT_MODES.length);

    // Set equality, so neither side can grow alone: a builder minting a mode
    // the roster does not name fails here, and a roster mode no builder
    // mints — a record shape nothing on the write side produces — fails here
    // too. The union's own tie to the roster is tsc's (src/Prompt.ts).
    expect(drafts.map((d) => d.mode).sort()).toEqual(
      [...PRIOR_ATTEMPT_MODES].sort(),
    );
  });

  it("PriorAttemptStore.read accepts a record for every mode the engine's prior-attempt mode roster names", async () => {
    const flumeDir = join(fx.repo, ".flume");
    const store = new PriorAttemptStore(flumeDir, fx.repo, silent);
    const head = (await gitOut(fx.repo, ["rev-parse", "HEAD"])).trim();
    expect(head).toMatch(/^[0-9a-f]{40}$/);

    const byMode = new Map<string, PriorAttemptDraft>(
      (await everyDraft(fx.repo, head)).map((d) => [d.mode, d]),
    );

    for (const mode of PRIOR_ATTEMPT_MODES) {
      // Roster-driven: the loop runs over what the engine names, so a mode
      // the builders stopped minting reads as a missing draft here rather
      // than as a loop that silently got shorter.
      const draft = byMode.get(mode);
      expect(draft, `${mode} has no builder`).toBeDefined();

      // One key per mode, so the records coexist rather than overwriting
      // each other — `priorAttemptRef` derives key and keyspace together.
      const ref = priorAttemptRef({ name: mode } as Phase);
      expect(ref).toEqual({ key: mode, keyspace: "phase" });

      await store.write(ref, draft!);
      expect(existsSync(priorAttemptPath(flumeDir, ref)), mode).toBe(true);

      const back = await store.read(ref);
      expect(back, `${mode} read back as absent`).toBeDefined();
      expect(back!.mode).toBe(mode);
      // The anchor `read` refuses a record without (spec/loop.md "Every
      // record is anchored" / "No false signal") — stamped by `write`, so no
      // builder carries it.
      expect(back!.headSha).toBe(head);
      expect(back!.key).toBe("phase");
      expect(Date.parse(back!.at)).not.toBeNaN();
      // Everything the builder itself said survives the round trip verbatim.
      expect(back).toMatchObject(draft as Record<string, unknown>);
    }

    // `readAll` is keyed by the keyspace and the identity `write` stamped —
    // here one mode name per record, all of them phase-keyed — so a tick's
    // `TickContext.priorAttempts` carries one per roster mode.
    const all = await store.readAll();
    expect([...all.keys()].sort()).toEqual(
      PRIOR_ATTEMPT_MODES.map((m) => `phase:${m}`).sort(),
    );

    expect(dirname(priorAttemptPath(flumeDir, { key: "any-key", keyspace: "phase" }))).toBe(
      join(priorAttemptsDir(flumeDir), "phase"),
    );
  });

  // spec/chain.md "What a gate returns": the gate's chain-authored `verdict`
  // is persisted onto the gate-revert record beside `message`. Same agreement
  // discipline as the round-trip above — real builder, real `write`, real
  // `read` — because a retry's `shouldRun` reaches this field through exactly
  // that path.
  it("a gate-revert prior-attempt record carries the failing gate's verdict beside its message", async () => {
    const flumeDir = join(fx.repo, ".flume");
    const store = new PriorAttemptStore(flumeDir, fx.repo, silent);
    const head = (await gitOut(fx.repo, ["rev-parse", "HEAD"])).trim();

    const authored = await buildGateRevert(
      "afterCommit",
      {
        gate: "cite-resolves",
        message: "2 of 3 cites unresolved: §Fences, §Baton",
        verdict: "cite-unresolved",
        details: "spec/chain.md: no section named 'Fences'",
      },
      fx.repo,
      head,
      ["src/seed.ts"],
    );
    const withVerdict = priorAttemptRef({ name: "authored" } as Phase);
    await store.write(withVerdict, authored);
    const back = await store.read(withVerdict);

    // Vacuity pin: the record really came back, as the mode under judgement.
    expect(back?.mode).toBe("gate-revert");
    expect(back).toMatchObject({
      gate: "cite-resolves",
      message: "2 of 3 cites unresolved: §Fences, §Baton",
      verdict: "cite-unresolved",
    });
    // Verbatim, not paraphrased out of the prose beside it, and not bounded
    // like the captured `details` is.
    expect((back as { verdict?: string }).verdict).toBe("cite-unresolved");

    // A gate that authored none leaves the key off entirely — absence is the
    // fact "this gate named no reason", never an empty string standing in.
    const silentGate = await buildGateRevert(
      "afterCommit",
      { gate: "tsc", message: "type error" },
      fx.repo,
      head,
      ["src/seed.ts"],
    );
    expect(silentGate).not.toHaveProperty("verdict");
    const noVerdict = priorAttemptRef({ name: "unauthored" } as Phase);
    await store.write(noVerdict, silentGate);
    const plain = await store.read(noVerdict);
    expect(plain?.mode).toBe("gate-revert");
    expect(plain).not.toHaveProperty("verdict");
  });

  /**
   * spec/loop.md "Prior-outcome feedback to the retrying tick": `not-shipped`
   * has two causes — the predicate returned `false`, or it threw — and the
   * record says which. Driven the whole way for the same reason the round
   * trip above is: the retry reaches this fact through the real `write` →
   * `readAll` → `renderPrompt` path, and a hand dropping it anywhere along it
   * serves a broken `shipped` hook to the next tick dressed as a deliberate
   * park.
   */
  it("a not-shipped record distinguishes a thrown shipped hook from a returned false", async () => {
    const flumeDir = join(fx.repo, ".flume");
    const store = new PriorAttemptStore(flumeDir, fx.repo, silent);
    const head = (await gitOut(fx.repo, ["rev-parse", "HEAD"])).trim();
    const THREW = "TypeError: ctx.gateResults.every is not a function";

    const declined = buildNotShipped(head, ["src/seed.ts"]);
    const threw = buildNotShipped(head, ["src/seed.ts"], THREW);

    // At the builder: absence is the fact "the chain decided", never a
    // placeholder standing in for a throw that did not happen.
    expect(declined).not.toHaveProperty("threw");
    expect(threw).toMatchObject({ threw: THREW });

    // Through the store under two keys, read back by the reader a tick's
    // `TickContext.priorAttempts` is assembled from.
    const declinedRef = priorAttemptRef({ name: "declined" } as Phase);
    const threwRef = priorAttemptRef({ name: "threw" } as Phase);
    await store.write(declinedRef, declined);
    await store.write(threwRef, threw);

    const all = await store.readAll();
    const backDeclined = all.get(`phase:${declinedRef.key}`);
    const backThrew = all.get(`phase:${threwRef.key}`);
    // Vacuity: both records really came back, as the mode under judgement.
    expect(backDeclined?.mode).toBe("not-shipped");
    expect(backThrew?.mode).toBe("not-shipped");
    expect(backDeclined).not.toHaveProperty("threw");
    expect(backThrew).toMatchObject({ threw: THREW });

    // And into the prompt: the block names which of the two happened, and
    // quotes a throw only where there was one.
    const declinedBlock = await renderPriorBlock(fx.repo, backDeclined!);
    const threwBlock = await renderPriorBlock(fx.repo, backThrew!);
    expect(declinedBlock).toContain("RETURNED FALSE");
    expect(declinedBlock).not.toContain("THREW");
    expect(declinedBlock).not.toContain(THREW);
    expect(threwBlock).toContain("THREW");
    expect(threwBlock).toContain(THREW);
    expect(threwBlock).not.toContain("RETURNED FALSE");
  }, SPAWN_BUDGET_MS);

  it("a thrown shipped hook's message is bounded on the record like every other captured text", async () => {
    const head = (await gitOut(fx.repo, ["rev-parse", "HEAD"])).trim();
    // A throw carries whatever the chain's own frames put in it — a stack, a
    // dumped payload — and the record renders straight into a prompt.
    const huge = "x".repeat(64 * 1024);
    const rec = buildNotShipped(head, ["src/seed.ts"], huge);

    expect(rec.threw).toBeDefined();
    expect(rec.threw!.length).toBeLessThan(huge.length);
    // Elided visibly, never passed off as the whole message (spec/loop.md
    // "Bounded by construction").
    expect(rec.threw).toMatch(/truncated \d+ chars/);
  });
});

/**
 * One prior-attempt record through the real `renderPrompt`, so what a block
 * claims is read off the renderer the dispatcher runs rather than a fixture
 * restating it (`.claude/rules/engineering.md`, *A seam gate reads what the
 * real writer wrote*). The prompt file sits under the fixture's flume dir —
 * harness runtime state, not a tracked path the repo's own tree would show
 * as dirty.
 */
async function renderPriorBlock(
  repo: string,
  prior: PriorAttempt,
): Promise<string> {
  const flumeDir = join(repo, ".flume");
  await mkdir(flumeDir, { recursive: true });
  const promptFile = join(flumeDir, "prompt.md");
  await writeFile(promptFile, "task body\n", "utf8");
  return renderPrompt({
    phase: {
      name: "build",
      description: "renders a prior-attempt block",
      promptPath: "prompt.md",
      concurrency: "singleton",
      writablePaths: ["**"],
      gates: [],
      handoff: () => [],
    },
    flumeDir,
    promptFile,
    cwd: repo,
    args: {},
    priorAttempt: prior,
  });
}

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
    const ref: PriorAttemptRef = { key: "build", keyspace: "phase" };
    const p = priorAttemptPath(flumeDir, ref);
    await mkdir(dirname(p), { recursive: true });
    // ELOOP — present, unstattable. Not a permission bit: a root-run test
    // would bypass that.
    await symlink(basename(p), p);

    // Vacuity pins (`.claude/rules/engineering.md`, "A green verdict is
    // proven non-vacuous"): a record really is at the path the store reads,
    // and the stat that decides really does fail on it.
    expect((await lstat(p)).isSymbolicLink()).toBe(true);
    expect(existsSync(p)).toBe(false);

    await expect(store.read(ref)).rejects.toThrow(/ELOOP/);
  });

  it("PriorAttemptStore.read still reports no prior attempt for a record it read and could not decode", async () => {
    const flumeDir = join(fx.repo, ".flume");
    const store = new PriorAttemptStore(flumeDir, fx.repo, silent);
    const ref: PriorAttemptRef = { key: "build", keyspace: "phase" };
    const p = priorAttemptPath(flumeDir, ref);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, "{not json");

    expect(existsSync(p)).toBe(true);
    await expect(store.read(ref)).resolves.toBeUndefined();
  });

  /**
   * The refusal, not the platform's spelling of it: the errno a plain file at
   * the root raises for the paths beneath it is host-dependent
   * (`.claude/rules/platform-facts.md`, *win32 reports a path through a
   * non-directory as not found*). Asserting the errno pins one host's
   * accident; asserting the store's own message pins the behavior these
   * cases are about.
   */
  const refusalOf = async (p: Promise<unknown>): Promise<string> => {
    const err = await p.then(
      () => undefined,
      (e: unknown) => e as Error,
    );
    expect(err, "readAll resolved where it must refuse").toBeInstanceOf(Error);
    return err!.message;
  };

  it("readAll refuses when a plain file sits at the prior-attempts root", async () => {
    const flumeDir = join(fx.repo, ".flume");
    const store = new PriorAttemptStore(flumeDir, fx.repo, silent);
    const dir = priorAttemptsDir(flumeDir);
    await mkdir(dirname(dir), { recursive: true });
    // Present at the path the store enumerates, unenumerable. Structural,
    // not a permission bit: a root-run test would bypass that, and a bit
    // denies nothing on the other host anyway
    // (`.claude/rules/platform-facts.md`, *chmod denies nothing on win32*).
    await writeFile(dir, "not a directory");

    // Vacuity pins (`.claude/rules/engineering.md`, "A green verdict is
    // proven non-vacuous"): something really occupies the path `readAll`
    // reads, and it really is not a directory.
    expect(existsSync(dir)).toBe(true);
    expect((await lstat(dir)).isDirectory()).toBe(false);

    // Reported as an empty map this would tell every `shouldRun` "no prior
    // attempt" — the repeated-failure signal reset by an unreachable store.
    const message = await refusalOf(store.readAll());
    expect(message).toContain("is not a directory");
    expect(message).toContain(dir);
  });

  it("readAll refuses when a plain file sits above the prior-attempts root", async () => {
    const flumeDir = join(fx.repo, ".flume");
    const store = new PriorAttemptStore(flumeDir, fx.repo, silent);
    // The obstruction is an *ancestor* of every path the store reads, which
    // is where the two hosts disagree hardest
    // (`.claude/rules/platform-facts.md`, *win32 reports a path through a
    // non-directory as not found*): only the descent tells absent from
    // obstructed, and it must refuse on both.
    await writeFile(flumeDir, "not a directory");

    expect(existsSync(flumeDir)).toBe(true);
    expect((await lstat(flumeDir)).isDirectory()).toBe(false);
    expect(existsSync(priorAttemptsDir(flumeDir))).toBe(false);

    const message = await refusalOf(store.readAll());
    expect(message).toContain("is not a directory");
    expect(message).toContain(flumeDir);
  });

  it("readAll refuses when a plain file sits at a keyspace directory", async () => {
    const flumeDir = join(fx.repo, ".flume");
    const store = new PriorAttemptStore(flumeDir, fx.repo, silent);
    // The last rung of the descent: the two directories above it are real,
    // so only the keyspace dir's own type decides. A record written to the
    // sibling keyspace proves the walk reaches this one at all.
    const ref: PriorAttemptRef = { key: "build", keyspace: "phase" };
    await store.write(ref, buildCleanExit("no commit"));
    const obstructed = join(priorAttemptsDir(flumeDir), "entry");
    await writeFile(obstructed, "not a directory");

    expect((await lstat(obstructed)).isDirectory()).toBe(false);
    expect(existsSync(priorAttemptPath(flumeDir, ref))).toBe(true);

    const message = await refusalOf(store.readAll());
    expect(message).toContain("is not a directory");
    expect(message).toContain(obstructed);
  });

  it("readAll reads an absent prior-attempts dir as no records", async () => {
    const flumeDir = join(fx.repo, ".flume");
    const store = new PriorAttemptStore(flumeDir, fx.repo, silent);
    await mkdir(flumeDir, { recursive: true });

    // Vacuity pins: the absent leg is the one under test, so nothing may sit
    // at the path — and the root above it is a real directory, which is what
    // makes that absence a proof rather than an errno.
    expect(existsSync(flumeDir)).toBe(true);
    expect(existsSync(priorAttemptsDir(flumeDir))).toBe(false);

    expect((await store.readAll()).size).toBe(0);
  });

  it("readAll reads an absent keyspace directory as no records of that keyspace", async () => {
    const flumeDir = join(fx.repo, ".flume");
    const store = new PriorAttemptStore(flumeDir, fx.repo, silent);
    const ref: PriorAttemptRef = { key: "build", keyspace: "phase" };
    await store.write(ref, buildCleanExit("no commit"));

    // Vacuity pins: one keyspace dir exists and holds a record, the other
    // was never created — the mixed case the descent must walk through
    // rather than refuse on.
    expect(existsSync(join(priorAttemptsDir(flumeDir), "phase"))).toBe(true);
    expect(existsSync(join(priorAttemptsDir(flumeDir), "entry"))).toBe(false);

    expect([...(await store.readAll()).keys()]).toEqual(["phase:build"]);
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
      const ref: PriorAttemptRef = { key, keyspace: "phase" };
      // The real writers, not a re-derivation: `write` places the record and
      // `snapshotReverted` places the snapshot, each through the store's own
      // keying.
      await store.write(ref, buildTipMoved(head, head));
      await store.snapshotReverted(fx.repo, head, ref);

      const record = priorAttemptPath(flumeDir, ref);
      const snapshot = store.snapshotDir(ref);
      expect(existsSync(record), key).toBe(true);
      expect(existsSync(snapshot), key).toBe(true);

      // Same directory, same stem, different suffix — siblings by one
      // identity rather than two spellings of the same attempt.
      expect(dirname(snapshot)).toBe(dirname(record));
      expect(basename(snapshot)).toBe(`${basename(record, ".json")}.reverted`);
      expect(basename(snapshot)).toBe(`${slugify(key)}.reverted`);
    }
  });

  it("PriorAttemptStore.snapshotDir keeps a traversing key inside priorAttemptsDir", () => {
    const flumeDir = join(fx.repo, ".flume");
    const store = new PriorAttemptStore(flumeDir, fx.repo, silent);

    // `clear` and `snapshotReverted` both `rm -rf` this dir; a key that
    // resolves out of `prior-attempts/` aims that removal at the tree.
    for (const key of ["../../escape", "..", "a/../../b", "/abs"]) {
      const dir = store.snapshotDir({ key, keyspace: "phase" });
      const rel = relative(priorAttemptsDir(flumeDir), dir);
      expect(rel, key).not.toBe("");
      expect(rel.startsWith("..") || isAbsolute(rel), key).toBe(false);
      // Inside its keyspace's directory, which is inside the records root:
      // the scoping segment is this module's own closed set, never the key.
      expect(dirname(dir), key).toBe(join(priorAttemptsDir(flumeDir), "phase"));
    }
  });

  it("priorAttemptPath keeps a traversing key inside priorAttemptsDir", () => {
    const flumeDir = join(fx.repo, ".flume");

    for (const key of ["../../escape", "..", "a/../../b", "/abs"]) {
      const p = priorAttemptPath(flumeDir, { key, keyspace: "entry" });
      const rel = relative(priorAttemptsDir(flumeDir), p);
      expect(rel, key).not.toBe("");
      expect(rel.startsWith("..") || isAbsolute(rel), key).toBe(false);
      expect(dirname(p), key).toBe(join(priorAttemptsDir(flumeDir), "entry"));
    }
  });
});

/**
 * The revert snapshot over the two path spellings git's *default*
 * `--name-only` form rewrites: a non-ASCII path (octal-escaped inside double
 * quotes) and one that ends in a space (double-quoted). Either rewrite makes
 * the listed name a path that no longer resolves as `<sha>:<path>`, so the
 * content read throws and `snapshotReverted`'s best-effort catch swallows the
 * rest of the commit with it.
 *
 * Driven as an agreement gate (`.claude/rules/engineering.md`, *A seam gate
 * reads what the real writer wrote*): a real commit made by git is listed by
 * the engine's own name-only reader and read back by the engine's own
 * tip-read, with the snapshot on disk as the verdict. No fixture re-spells a
 * path by the tester's hand.
 *
 * Deliberately top-level rather than inside a `describe`: these titles are
 * the queue entry's own `tests[]`/`pins[]` lines, matched on the full name.
 */
/**
 * The ref the snapshot cases below write under. Any one ref serves: what they
 * judge is the content of the snapshot dir, not which keyspace it hangs off.
 */
const SNAP_REF: PriorAttemptRef = { key: "key", keyspace: "phase" };

async function commitPathsNamed(
  repo: string,
  names: readonly string[],
): Promise<string> {
  await mkdir(join(repo, "snap"), { recursive: true });
  for (const name of names) {
    await writeFile(join(repo, "snap", name), `content of ${name}\n`);
  }
  await gitOut(repo, ["add", "--all"]);
  await gitOut(repo, ["commit", "-q", "-m", "awkward paths"]);
  return gitOut(repo, ["rev-parse", "HEAD"]);
}

it("snapshotReverted writes a non-ASCII path's content into the revert snapshot", async () => {
  const fx = await makeFixture();
  try {
    const store = new PriorAttemptStore(
      join(fx.repo, ".flume"),
      fx.repo,
      silent,
    );
    const sha = await commitPathsNamed(fx.repo, ["café.ts", "plain.ts"]);

    // Vacuity pin: the default form really does rewrite this path, so the
    // snapshot below is judged over a listing that a raw `git show
    // --name-only` would have mis-spelled rather than over an ASCII no-op.
    const quoted = await gitOut(fx.repo, [
      "show",
      "--name-only",
      "--format=",
      sha,
    ]);
    expect(quoted).toContain('"snap/caf\\303\\251.ts"');

    await store.snapshotReverted(fx.repo, sha, SNAP_REF);

    const dir = store.snapshotDir(SNAP_REF);
    expect(await readFile(join(dir, "snap", "café.ts"), "utf8")).toBe(
      "content of café.ts\n",
    );
    // The sibling git lists *after* the awkward one: a listing that throws on
    // `café.ts` truncates the whole snapshot from there on.
    expect(await readFile(join(dir, "snap", "plain.ts"), "utf8")).toBe(
      "content of plain.ts\n",
    );
  } finally {
    await fx.cleanup();
  }
});

// A filename may not end in a space on win32 — the Win32 path layer strips
// trailing spaces before the create call reaches the filesystem, so neither
// this fixture nor a `git checkout` of it can exist there.
it.runIf(process.platform !== "win32")(
  "snapshotReverted preserves a path's trailing space instead of trimming it",
  async () => {
    const fx = await makeFixture();
    try {
      const store = new PriorAttemptStore(
        join(fx.repo, ".flume"),
        fx.repo,
        silent,
      );
      const sha = await commitPathsNamed(fx.repo, ["trailing.ts "]);

      // Vacuity pin: the space really is part of the committed name, and the
      // trimmed spelling names nothing at this commit — which is what makes a
      // trim a substitution rather than a cleanup. (Unlike the non-ASCII case
      // above, git leaves this path unquoted in either form; the trim alone
      // loses it.)
      expect(
        await gitOut(fx.repo, ["cat-file", "-e", `${sha}:snap/trailing.ts `]),
      ).toBe("");
      await expect(
        gitOut(fx.repo, ["cat-file", "-e", `${sha}:snap/trailing.ts`]),
      ).rejects.toThrow();

      await store.snapshotReverted(fx.repo, sha, SNAP_REF);

      expect(
        await readFile(
          join(store.snapshotDir(SNAP_REF), "snap", "trailing.ts "),
          "utf8",
        ),
      ).toBe("content of trailing.ts \n");
    } finally {
      await fx.cleanup();
    }
  },
);

// A filename may not contain `:` on win32 — the Win32 path layer refuses the
// create call, so neither this fixture nor a `git checkout` of it can exist
// there.
//
// Repo-root rather than under `snap/` like the siblings above: pathspec magic
// is read off a *leading* colon, so only a path whose own first character is
// `:` reaches the parse that loses it.
it.runIf(process.platform !== "win32")(
  "snapshotReverted writes a colon-leading path's content into the revert snapshot",
  async () => {
    const fx = await makeFixture();
    try {
      const store = new PriorAttemptStore(
        join(fx.repo, ".flume"),
        fx.repo,
        silent,
      );
      await writeFile(join(fx.repo, ":colon.ts"), "content of :colon.ts\n");
      await writeFile(join(fx.repo, "plain.ts"), "content of plain.ts\n");
      await gitOut(fx.repo, ["add", "--all"]);
      await gitOut(fx.repo, ["commit", "-q", "-m", "colon-leading path"]);
      const sha = await gitOut(fx.repo, ["rev-parse", "HEAD"]);

      // Vacuity pin: git names the path unquoted and resolves it as
      // `<sha>:<path>`, so the listing hands `snapshotReverted` a name that
      // is genuinely readable — the content read's `null` came from the
      // pathspec parse alone, and the null-skip then drops a file the commit
      // really carried.
      expect(
        (
          await gitOut(fx.repo, ["show", "--name-only", "--format=", sha])
        ).split("\n"),
      ).toContain(":colon.ts");
      expect(
        await gitOut(fx.repo, ["cat-file", "-e", `${sha}::colon.ts`]),
      ).toBe("");

      await store.snapshotReverted(fx.repo, sha, SNAP_REF);

      const dir = store.snapshotDir(SNAP_REF);
      expect(await readFile(join(dir, ":colon.ts"), "utf8")).toBe(
        "content of :colon.ts\n",
      );
      // The sibling git lists beside the awkward one: a drop that skipped
      // only `:colon.ts` still leaves this one, so the assertion above is
      // what carries the verdict.
      expect(await readFile(join(dir, "plain.ts"), "utf8")).toBe(
        "content of plain.ts\n",
      );
    } finally {
      await fx.cleanup();
    }
  },
);

it("a snapshotReverted failure leaves the revert path unblocked", async () => {
  const fx = await makeFixture();
  try {
    const store = new PriorAttemptStore(
      join(fx.repo, ".flume"),
      fx.repo,
      silent,
    );

    // Vacuity pin: the sha really is unresolvable here, so every git read
    // inside `snapshotReverted` below fails rather than quietly succeeding.
    const missing = "0".repeat(40);
    await expect(
      gitOut(fx.repo, ["cat-file", "-e", missing]),
    ).rejects.toThrow();

    // Recovery is best-effort by spec: the caller's next move is the hard
    // reset, and a snapshot that cannot be taken must not stand in its way.
    await expect(
      store.snapshotReverted(fx.repo, missing, SNAP_REF),
    ).resolves.toBeUndefined();
    expect(existsSync(store.snapshotDir(SNAP_REF))).toBe(false);
  } finally {
    await fx.cleanup();
  }
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
      // The identity a `shouldRun` holds is `phase.name` itself, under its
      // keyspace.
      expect(all.get(`phase:${name}`)?.mode, name).toBe("clean-exit");
      expect(all.get(`phase:${name}`)?.key, name).toBe("phase");
      // …and the slugged stem is not a second key for the same record.
      expect(all.has(`phase:${slugify(name)}`), name).toBe(false);
      // The on-disk artifact is still the slugged stem, under the keyspace's
      // own directory, so nothing a raw key could do to a path is
      // reintroduced here.
      expect(
        existsSync(
          join(priorAttemptsDir(flumeDir), "phase", `${slugify(name)}.json`),
        ),
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
    expect(all.get(`entry:${slugify(tag)}`)?.key).toBe("entry");
    expect(all.has(`entry:${tag}`)).toBe(false);
    expect(await store.clearStale([entry])).toEqual([]);
    expect(await store.clearStale([])).toEqual([`entry:${slugify(tag)}`]);
  });

  it("a prior-attempt record whose stated keyspace disagrees with the directory it sits in reads as no prior attempt", async () => {
    const flumeDir = join(fx.repo, ".flume");
    const store = new PriorAttemptStore(flumeDir, fx.repo, silent);
    const ref: PriorAttemptRef = { key: "plan", keyspace: "phase" };
    const p = priorAttemptPath(flumeDir, ref);
    await mkdir(dirname(p), { recursive: true });

    // Hand-authored, the sanctioned exception for a refusal case: no writer
    // mints a record that contradicts its own location. Honouring the stated
    // half would file it in the map under `entry:plan`, whose path is a file
    // that does not exist — so `clear` would later remove nothing and the
    // record would outlive every sweep.
    await writeFile(
      p,
      JSON.stringify({
        mode: "clean-exit",
        finalMessage: "parked: the entry needs a wider fence",
        key: "entry",
        keyedAs: "plan",
        headSha: "0".repeat(40),
        at: "2024-01-01T00:00:00.000Z",
      }),
    );
    expect(existsSync(p)).toBe(true);

    await expect(store.read(ref)).resolves.toBeUndefined();
    expect((await store.readAll()).size).toBe(0);
  });

  it("a prior-attempt record carrying no written identity reads as no prior attempt", async () => {
    const flumeDir = join(fx.repo, ".flume");
    const store = new PriorAttemptStore(flumeDir, fx.repo, silent);
    const ref: PriorAttemptRef = { key: "plan", keyspace: "phase" };
    const p = priorAttemptPath(flumeDir, ref);
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

    await expect(store.read(ref)).resolves.toBeUndefined();
    expect((await store.readAll()).size).toBe(0);
  });
});

/**
 * The keyspace scoping, driven end to end: a phase name and an entry tag that
 * `slugify` maps onto one stem are two records, on disk and in the map a tick
 * reads, and the queue's stale sweep reaches only the one the queue has a say
 * over.
 *
 * Driven through the real writer and the real reader
 * (`.claude/rules/engineering.md`, *A seam gate reads what the real writer
 * wrote*): the refs come from `priorAttemptRef`, the records from the real
 * builders, and the verdict is what `read`/`readAll`/`clearStale` hand back.
 *
 * Deliberately top-level rather than inside a `describe`: these titles are the
 * queue entry's own `tests[]` lines, matched on the full name.
 */

/** A phase name and a tag that slugify onto one stem — the collision itself. */
const COLLIDING_PHASE = "plan_sweep";
const COLLIDING_TAG = "PLAN-SWEEP";

/** The queue entry the colliding tag names. */
const collidingEntry: PendingEntry = {
  tag: COLLIDING_TAG,
  gate: { kind: "open" },
  dependsOnForks: [],
  files: { new: [], edit: [], retire: [] },
};

it("a singleton phase and a fanout entry whose identities slugify alike write distinct prior-attempt records through the store", async () => {
  const fx = await makeFixture();
  try {
    const flumeDir = join(fx.repo, ".flume");
    const store = new PriorAttemptStore(flumeDir, fx.repo, silent);
    const head = (await gitOut(fx.repo, ["rev-parse", "HEAD"])).trim();

    const phaseRef = priorAttemptRef({ name: COLLIDING_PHASE } as Phase);
    const entryRef = priorAttemptRef(
      { name: "build" } as Phase,
      collidingEntry,
    );

    // Vacuity pin: the two identities really do slugify onto one stem, so
    // everything below is judged over the collision rather than over two
    // names that were never going to meet.
    expect(slugify(phaseRef.key)).toBe(slugify(entryRef.key));
    expect(phaseRef.keyspace).not.toBe(entryRef.keyspace);

    // Two modes, so a single shared file shows up as the wrong record rather
    // than as an indistinguishable one.
    await store.write(phaseRef, buildCleanExit("parked: the phase"));
    await store.write(entryRef, buildTipMoved(head, head));

    expect(priorAttemptPath(flumeDir, phaseRef)).not.toBe(
      priorAttemptPath(flumeDir, entryRef),
    );
    expect(existsSync(priorAttemptPath(flumeDir, phaseRef))).toBe(true);
    expect(existsSync(priorAttemptPath(flumeDir, entryRef))).toBe(true);

    // Each ref reads back its own attempt, not the other's.
    const backPhase = await store.read(phaseRef);
    const backEntry = await store.read(entryRef);
    expect(backPhase).toMatchObject({
      mode: "clean-exit",
      key: "phase",
      keyedAs: COLLIDING_PHASE,
      finalMessage: "parked: the phase",
    });
    expect(backEntry).toMatchObject({
      mode: "tip-moved",
      key: "entry",
      keyedAs: slugify(COLLIDING_TAG),
    });

    // The reverted-file snapshot hangs off the same stem as the record, so a
    // shared stem would have shared that directory too.
    expect(store.snapshotDir(phaseRef)).not.toBe(store.snapshotDir(entryRef));
  } finally {
    await fx.cleanup();
  }
});

it("readAll keys a fanout record under entry:<slug> and a singleton record under phase:<name>", async () => {
  const fx = await makeFixture();
  try {
    const flumeDir = join(fx.repo, ".flume");
    const store = new PriorAttemptStore(flumeDir, fx.repo, silent);

    const phaseRef = priorAttemptRef({ name: COLLIDING_PHASE } as Phase);
    const entryRef = priorAttemptRef(
      { name: "build" } as Phase,
      collidingEntry,
    );
    // Vacuity pin: one stem, two records — a map keyed by the identity alone
    // could only carry one of them.
    expect(slugify(phaseRef.key)).toBe(slugify(entryRef.key));

    await store.write(phaseRef, buildCleanExit("parked: the phase"));
    await store.write(entryRef, buildCleanExit("parked: the entry"));

    const all = await store.readAll();
    expect([...all.keys()].sort()).toEqual([
      `entry:${slugify(COLLIDING_TAG)}`,
      `phase:${COLLIDING_PHASE}`,
    ]);
    // The keyspace is the disambiguator, and the identity half is what the
    // caller already holds: the tag slug for an entry, the phase name as the
    // chain spells it for a singleton.
    expect(all.get(`entry:${slugify(COLLIDING_TAG)}`)).toMatchObject({
      key: "entry",
      finalMessage: "parked: the entry",
    });
    expect(all.get(`phase:${COLLIDING_PHASE}`)).toMatchObject({
      key: "phase",
      finalMessage: "parked: the phase",
    });
  } finally {
    await fx.cleanup();
  }
});

it("clearStale keeps a phase record whose name slugifies onto a tag the queue no longer carries", async () => {
  const fx = await makeFixture();
  try {
    const flumeDir = join(fx.repo, ".flume");
    const store = new PriorAttemptStore(flumeDir, fx.repo, silent);

    const phaseRef = priorAttemptRef({ name: COLLIDING_PHASE } as Phase);
    const entryRef = priorAttemptRef(
      { name: "build" } as Phase,
      collidingEntry,
    );
    await store.write(phaseRef, buildCleanExit("parked: the phase"));
    await store.write(entryRef, buildCleanExit("parked: the entry"));

    // Vacuity pin: the sweep runs over a populated map whose two records the
    // queue's own text cannot tell apart.
    expect((await store.readAll()).size).toBe(2);
    expect(slugify(phaseRef.key)).toBe(entryRef.key);

    // The queue carries neither tag: the entry's record is retired and
    // reported, the phase's — which no queue has a say over — is untouched.
    expect(await store.clearStale([])).toEqual([
      `entry:${slugify(COLLIDING_TAG)}`,
    ]);

    expect(await store.read(entryRef)).toBeUndefined();
    expect(existsSync(priorAttemptPath(flumeDir, entryRef))).toBe(false);
    expect(await store.read(phaseRef)).toMatchObject({
      mode: "clean-exit",
      key: "phase",
      keyedAs: COLLIDING_PHASE,
      finalMessage: "parked: the phase",
    });
    expect([...(await store.readAll()).keys()]).toEqual([
      `phase:${COLLIDING_PHASE}`,
    ]);
  } finally {
    await fx.cleanup();
  }
});

/**
 * The record's own key, reported rather than rediscovered
 * (`.claude/rules/engineering.md`, *A fact the engine holds is reported,
 * never rediscovered*). `entryAttemptKey` answers for a caller holding an
 * entry; a caller holding a record off `TickContext.priorAttempts` — the
 * harness's own records block among them — had no engine spelling at all and
 * had to join the record's two halves itself.
 *
 * Driven through the real writer and the real reader (*A seam gate reads what
 * the real writer wrote*): the keyer is judged against the key
 * `PriorAttemptStore.readAll` actually filed each record under, over both
 * keyspaces, so a keyer that agrees with a hand-written join but not with the
 * store cannot read green here.
 */
it("a prior-attempt record answers the key the store's own walk filed it under", async () => {
  const fx = await makeFixture();
  try {
    const flumeDir = join(fx.repo, ".flume");
    const store = new PriorAttemptStore(flumeDir, fx.repo, silent);

    // Both keyspaces, and a phase name `slugify` rewrites: a map holding only
    // records whose identity is already its stem would agree with a keyer
    // that read the filename.
    const phaseRef = priorAttemptRef({ name: COLLIDING_PHASE } as Phase);
    const entryRef = priorAttemptRef(
      { name: "build" } as Phase,
      collidingEntry,
    );
    expect(slugify(phaseRef.key)).toBe(slugify(entryRef.key));
    await store.write(phaseRef, buildCleanExit("parked: the phase"));
    await store.write(entryRef, buildCleanExit("parked: the entry"));

    const all = await store.readAll();
    // Vacuity pin: the walk really filed two records, one per keyspace, so
    // the agreement below is judged over a populated map.
    expect(all.size).toBe(2);
    expect([...all.values()].map((rec) => rec.key).sort()).toEqual([
      "entry",
      "phase",
    ]);

    for (const [key, record] of all) {
      expect(recordAttemptKey(record), key).toBe(key);
    }
  } finally {
    await fx.cleanup();
  }
});

/**
 * The two keyers agree where their keyspaces overlap: a record written for a
 * queue entry answers what the entry itself answers. Without this the engine
 * would hold two spellings of one key and a consumer could reach a record by
 * one and fail to match it by the other.
 */
it("a fanout entry's record answers the key entryAttemptKey answers for its entry", async () => {
  const fx = await makeFixture();
  try {
    const flumeDir = join(fx.repo, ".flume");
    const store = new PriorAttemptStore(flumeDir, fx.repo, silent);

    // A tag `slugify` rewrites, so the two keyers agreeing is an agreement
    // about the slug and not about a tag that was already in slug form.
    expect(slugify(COLLIDING_TAG)).not.toBe(COLLIDING_TAG);
    const entryRef = priorAttemptRef(
      { name: "build" } as Phase,
      collidingEntry,
    );
    await store.write(entryRef, buildCleanExit("parked: the entry"));

    const record = await store.read(entryRef);
    // Vacuity pin: there is a record to key, so the comparison below is over
    // a real one rather than over `undefined` on both sides.
    expect(record?.mode).toBe("clean-exit");

    expect(recordAttemptKey(record!)).toBe(entryAttemptKey(collidingEntry));
  } finally {
    await fx.cleanup();
  }
});


/**
 * The same two keyers, judged where a consumer actually reaches them. The
 * cases above import them from `src/priorAttempts.ts`, which no package
 * `exports` entry resolves — green there says the join exists, never that a
 * chain holding `TickContext.priorAttempts` can take it
 * (`.claude/rules/engineering.md`, *A fact the engine holds is reported, never
 * rediscovered*). Both run through the real writer and the real reader (*A
 * seam gate reads what the real writer wrote*): the key under judgement is the
 * one `PriorAttemptStore.readAll` filed the record under, so a surface export
 * that agreed with a hand-written join and not with the store reds here.
 */
it("the package's public surface spells the prior-attempt map key for an entry", async () => {
  const fx = await makeFixture();
  try {
    const flumeDir = join(fx.repo, ".flume");
    const store = new PriorAttemptStore(flumeDir, fx.repo, silent);

    // A tag `slugify` rewrites, so what the surface answers is the engine's
    // slug and not the tag echoed back.
    expect(slugify(COLLIDING_TAG)).not.toBe(COLLIDING_TAG);
    const entryRef = priorAttemptRef(
      { name: "build" } as Phase,
      collidingEntry,
    );
    await store.write(entryRef, buildCleanExit("parked: the entry"));

    const all = await store.readAll();
    // Vacuity pin: the walk filed a record, so the key below is the one a
    // consumer would have been looking the record up by.
    expect(all.size).toBe(1);

    const filedUnder = [...all.keys()][0]!;
    expect(surfaceEntryAttemptKey(collidingEntry)).toBe(filedUnder);
    expect(all.get(surfaceEntryAttemptKey(collidingEntry))).toMatchObject({
      finalMessage: "parked: the entry",
    });
  } finally {
    await fx.cleanup();
  }
});

/**
 * The record half of the same claim, over both keyspaces — a consumer
 * iterating the map holds records, not refs, and that is the side with no
 * keyspace to assume.
 */
it("the package's public surface spells the prior-attempt map key for a record", async () => {
  const fx = await makeFixture();
  try {
    const flumeDir = join(fx.repo, ".flume");
    const store = new PriorAttemptStore(flumeDir, fx.repo, silent);

    const phaseRef = priorAttemptRef({ name: COLLIDING_PHASE } as Phase);
    const entryRef = priorAttemptRef(
      { name: "build" } as Phase,
      collidingEntry,
    );
    // One stem, two records: a surface keyer reading the identity alone would
    // answer one key for both.
    expect(slugify(phaseRef.key)).toBe(slugify(entryRef.key));
    await store.write(phaseRef, buildCleanExit("parked: the phase"));
    await store.write(entryRef, buildCleanExit("parked: the entry"));

    const all = await store.readAll();
    // Vacuity pin: both keyspaces are populated before the agreement is
    // judged over them.
    expect([...all.values()].map((rec) => rec.key).sort()).toEqual([
      "entry",
      "phase",
    ]);

    for (const [key, record] of all) {
      expect(surfaceRecordAttemptKey(record), key).toBe(key);
    }
  } finally {
    await fx.cleanup();
  }
});
