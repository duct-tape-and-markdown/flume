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

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { slugify } from "../src/paths.ts";
import type { PendingEntry } from "../src/PendingSchema.ts";
import type { Phase } from "../src/Phase.ts";
import {
  InlineExecRenderError,
  renderPrompt,
  type PriorAttempt,
} from "../src/Prompt.ts";
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
        new InlineExecRenderError([{ cmd: "git log", stderr: "not a repo" }])
          .message,
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
    const back = await store.read(withVerdict.key);

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
    const plain = await store.read(noVerdict.key);
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
    const backDeclined = all.get(declinedRef.key);
    const backThrew = all.get(threwRef.key);
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
  });

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

  it("readAll refuses when the prior-attempts dir is present but unreadable", async () => {
    const flumeDir = join(fx.repo, ".flume");
    const store = new PriorAttemptStore(flumeDir, fx.repo, silent);
    const dir = priorAttemptsDir(flumeDir);
    await mkdir(dirname(dir), { recursive: true });
    // ENOTDIR — present at the path the store enumerates, unenumerable. Not
    // a permission bit: a root-run test would bypass that.
    await writeFile(dir, "not a directory");

    // Vacuity pins (`.claude/rules/engineering.md`, "A green verdict is
    // proven non-vacuous"): something really occupies the path `readAll`
    // reads, and the readdir that decides really does fail on it.
    expect(existsSync(dir)).toBe(true);
    expect((await lstat(dir)).isDirectory()).toBe(false);

    // Reported as an empty map this would tell every `shouldRun` "no prior
    // attempt" — the repeated-failure signal reset by an unreachable dir.
    await expect(store.readAll()).rejects.toThrow(/ENOTDIR/);
  });

  it("readAll reads an absent prior-attempts dir as no records", async () => {
    const flumeDir = join(fx.repo, ".flume");
    const store = new PriorAttemptStore(flumeDir, fx.repo, silent);

    // Vacuity pin: the ENOENT leg is the one under test, so nothing may sit
    // at the path.
    expect(existsSync(priorAttemptsDir(flumeDir))).toBe(false);

    expect((await store.readAll()).size).toBe(0);
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

    await store.snapshotReverted(fx.repo, sha, "key");

    const dir = store.snapshotDir("key");
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

      await store.snapshotReverted(fx.repo, sha, "key");

      expect(
        await readFile(
          join(store.snapshotDir("key"), "snap", "trailing.ts "),
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

      await store.snapshotReverted(fx.repo, sha, "key");

      const dir = store.snapshotDir("key");
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
      store.snapshotReverted(fx.repo, missing, "key"),
    ).resolves.toBeUndefined();
    expect(existsSync(store.snapshotDir("key"))).toBe(false);
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
