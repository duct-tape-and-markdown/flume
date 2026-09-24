/**
 * The harness package's plan-slice windows (`spec/harness.md`, *The
 * phases*): each slice's liveness predicate, and the prompt argument that
 * carries its material.
 *
 * **Every case drives a real git repository.** A window is a claim about
 * what `git log` says past a cursor, so a mocked `execFileSync` would pin
 * this module's idea of git's output rather than git's. Each case builds a
 * tiny repo, commits real files, and reads the window back — the writer is
 * git and the reader is the window (`.claude/rules/engineering.md`, *A seam
 * gate reads what the real writer wrote*). Each slice's state is written by
 * the package's own `writePlanState`, never hand-authored, for the same
 * reason — one file per writer, so {@link writeState} lays down every slice's
 * and a case asserting an absent cursor removes the one file it is about.
 *
 * **Every liveness case carries its control.** A predicate that answered
 * `true` for the whole fixture would satisfy a one-sided assertion, so each
 * case asserts the same window with the one fact flipped — which is what
 * makes "live exactly while" a claim about that fact rather than about the
 * fixture.
 *
 * The declaration every case uses goes through the real `parseDeclaration`:
 * a fixture the package's own schema would refuse is a window built over an
 * environment no consumer could declare.
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  defaultHandoff,
  parseDeclaration,
  planSliceWindows,
  RECORD_MAX_BYTES,
  recordsPending,
  planStatePath,
  writePlanState,
  type Declaration,
  type PlanSliceWindow,
  type PlanStateWriteOf,
} from "../harness/index.ts";
import {
  BUILD_PHASE,
  INBOX_PHASE,
  type PlanSlice,
} from "../harness/declaration.ts";
import type { TickResult } from "../src/Phase.ts";
import type {
  PendingEntry,
  QueueParseFailure,
} from "../src/PendingSchema.ts";
import {
  PRIOR_ATTEMPT_MODES,
  type PriorAttempt,
  type PriorAttemptKeyspace,
  type PriorAttemptMode,
} from "../src/Prompt.ts";
import { slugify } from "../src/paths.ts";
import { entryAttemptKey } from "../src/priorAttempts.ts";
import { mkTempDirSync } from "./helpers/fixtureRoot.ts";
import { SPAWN_BUDGET_MS, gitOutSync } from "./helpers/subprocess.ts";

// This file's cases drive real git repositories, and a git spawn is a spawn
// like any other: the lane's one budget, for its cases and its hooks alike,
// declared once for the file rather than inherited from the runner
// (`SPAWN_BUDGET_MS`, `tests/helpers/subprocess.ts`).
vi.setConfig({ testTimeout: SPAWN_BUDGET_MS, hookTimeout: SPAWN_BUDGET_MS });

/** The repo every case commits into; also the state root the windows read. */
let repo: string;

beforeEach(() => {
  repo = mkTempDirSync("flume-windows-");
  git("init", "-q", "-b", "main");
  git("config", "user.email", "windows@example.test");
  git("config", "user.name", "Windows Fixture");
  git("config", "commit.gpgsign", "false");
});

afterEach(() => {
  if (repo) rmSync(repo, { recursive: true, force: true });
});

function git(...args: string[]): string {
  return gitOutSync(repo, args);
}

/** Write `files` into the repo and commit them, returning the new sha. */
function commit(files: Record<string, string>, subject: string): string {
  for (const [path, text] of Object.entries(files)) {
    const full = join(repo, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text);
  }
  git("add", "-A");
  git("commit", "-q", "-m", subject);
  return git("rev-parse", "HEAD").trim();
}

/** A body of `n` distinct lines — enough diff to exceed a small budget. */
const body = (marker: string, n: number): string =>
  Array.from({ length: n }, (_, i) => `${marker} line ${i}`).join("\n") + "\n";

/** The state root is the repo's own `.flume`, as a real consumer's is. */
const stateRoot = (): string => join(repo, ".flume");

/** The three cursor facts a case varies, off a closed rotation at HEAD. */
interface StateOverrides {
  readonly derivedThrough?: string;
  readonly sweptThrough?: string;
  readonly rotation?: PlanStateWriteOf<"plan-sweep">["rotation"];
}

/**
 * Every cursor-bearing slice's state on disk, through the package's own
 * writer.
 *
 * Both files, always: plan state is one file per writer, and a case about one
 * window wants its sibling's file present too — otherwise an assertion about
 * this window's absent leg could be answered by a state root carrying nothing
 * at all (`spec/harness.md`, *Plan state as declared state*).
 */
function writeState(overrides: StateOverrides = {}): void {
  const head = git("rev-parse", "HEAD").trim();
  writePlanState(stateRoot(), "plan-derive", {
    derivedThrough: overrides.derivedThrough ?? head,
  });
  writePlanState(stateRoot(), "plan-sweep", {
    sweptThrough: overrides.sweptThrough ?? head,
    rotation: overrides.rotation ?? { kind: "closed" },
  });
}

/** The runner factory a declaration carries; no case here drives the judge. */
const runner = () => ({
  run: async () => [],
  runAtBase: async () => [],
  lanes: [],
});

/** A declaration the package's own strict schema accepts. */
function declaration(overrides: Record<string, unknown> = {}): Declaration {
  return parseDeclaration({
    specLocus: ["spec/**"],
    fence: { build: ["src/**"] },
    runner,
    slices: {
      enabled: [INBOX_PHASE, "plan-derive", "plan-sweep"],
      sweep: { domain: ["src/**"], posturePages: ["rules/**"] },
    },
    ...overrides,
  });
}

/** The windows for this repo, keyed by slice name. */
function windows(
  overrides: Record<string, unknown> = {},
  budget?: number,
): Record<PlanSlice, PlanSliceWindow> {
  const built = planSliceWindows({
    declaration: declaration(overrides),
    repoRoot: repo,
    ...(budget === undefined ? {} : { budget }),
  });
  return Object.fromEntries(built.map((w) => [w.name, w])) as Record<
    PlanSlice,
    PlanSliceWindow
  >;
}

/** One queue entry — the windows read only its tag. */
const entry = (tag: string): PendingEntry => ({
  tag,
  gate: { kind: "open" },
  dependsOnForks: [],
  priority: 0,
  files: { new: [], edit: [], retire: [] },
});

/**
 * One standing prior-attempt record, keyed as the engine keys one: an entry's
 * identity is `slugify(tag)`, a phase's is the phase name verbatim
 * (`src/priorAttempts.ts`, `priorAttemptRef`), and the map a tick is handed
 * files each under its keyspace and identity together. Both keyspaces, because the
 * window discriminates on the record's own `key` field and a fixture that can
 * only write one of them judges that leg over zero of its subject.
 */
function record(
  name: string,
  mode: PriorAttempt["mode"],
  keyspace: PriorAttemptKeyspace = "entry",
): PriorAttempt {
  const anchor = {
    key: keyspace,
    keyedAs: keyspace === "entry" ? slugify(name) : name,
    headSha: "0".repeat(40),
    at: "2026-09-14T00:00:00.000Z",
  };
  switch (mode) {
    case "not-shipped":
      return { mode, mergedSha: "a".repeat(40), touchedPaths: [], ...anchor };
    case "clean-exit":
      return { mode, finalMessage: "parked", ...anchor };
    case "gate-revert":
      return {
        mode,
        when: "afterCommit",
        gate: "tsc",
        message: "failed",
        diffStat: "",
        ...anchor,
      };
    case "platform-preempt":
      return { mode, failureClass: "timeout", ...anchor };
    case "render-refused":
      return { mode, failures: "span failed", ...anchor };
    case "tip-moved":
      return {
        mode,
        expectedTip: "b".repeat(40),
        observedTip: "c".repeat(40),
        ...anchor,
      };
  }
}

/**
 * One record waiting under the state root, written at a state-root-relative
 * path — `inbox/<date>-<slug>.md` for an operator's finding, or
 * `plan/notes/<TAG>.md` for a build tick's note. Both directories are the
 * record queue, and the window's record leg reads them together.
 *
 * Returns the host-native path the window renders the record at, so a case
 * asserting what the block carries compares against the file it wrote.
 */
function writeRecord(rel: string, text: string): string {
  const path = join(stateRoot(), ...rel.split("/"));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  return path;
}

/**
 * One file waiting in the declared friction channel — the engine's own
 * loop-to-owner directory, which it creates lazily and keeps out of git
 * (`spec/chain.md`, *`Chain.friction` — the declared friction channel*). The
 * cases below declare it as `friction`, so the fixture and the declaration
 * name one directory.
 *
 * Returns the host-native path the window renders the note at, so a case
 * asserting what the block carries compares against the file it wrote.
 */
function writeFriction(name: string, text: string): string {
  const path = join(stateRoot(), FRICTION_DIR, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  return path;
}

/** The friction channel the cases below declare, and write into. */
const FRICTION_DIR = "friction";

it("the derive window is live exactly while commits past the derive cursor touch the declared spec locus", () => {
  commit({ "spec/loop.md": "# Loop\n" }, "spec: the loop");
  writeState();
  const derive = windows()["plan-derive"];

  // Vacuity guard: the cursor is at HEAD, so the window is provably empty
  // before anything is asserted about what fills it.
  const atCursor = derive.live({ flumeDir: stateRoot(), pickable: false });

  commit({ "docs/notes.md": "prose\n" }, "docs: a note");
  const afterOutsideLocus = derive.live({
    flumeDir: stateRoot(),
    pickable: false,
  });

  commit({ "spec/loop.md": "# Loop\n\nAmended.\n" }, "spec: amend the loop");
  const afterInsideLocus = derive.live({
    flumeDir: stateRoot(),
    pickable: false,
  });

  expect({ atCursor, afterOutsideLocus, afterInsideLocus }).toEqual({
    atCursor: false,
    afterOutsideLocus: false,
    afterInsideLocus: true,
  });
});

/**
 * A control character is illegal in a path on win32, so this fixture cannot
 * exist there. The title is the queue entry's own `tests[]` line, matched on
 * the full name.
 */
it.runIf(process.platform !== "win32")(
  "the derive window is live when a commit touches a spec path whose name carries a control character",
  () => {
    const base = commit({ "spec/loop.md": "# Loop\n" }, "spec: the loop");
    writeState();
    const derive = windows()["plan-derive"];

    // Vacuity guard: the cursor is at HEAD, so the window is provably empty
    // before the odd-named commit is what fills it.
    const atCursor = derive.live({ flumeDir: stateRoot(), pickable: false });

    const odd = "spec/ab.md";
    commit({ [odd]: "in the locus\n" }, "spec: a control-character name");
    const afterOddName = derive.live({
      flumeDir: stateRoot(),
      pickable: false,
    });

    expect({ atCursor, afterOddName }).toEqual({
      atCursor: false,
      afterOddName: true,
    });

    // ...and the render narrows by the path git committed. The
    // octal-escaped spelling a quoted listing hands back names no file, so
    // `show -- <that>` would resolve nothing and the diff would be empty —
    // its content arriving is what proves the pathspec was the real name.
    // (The patch's own `+++` header is git's spelling, not this module's.)
    const rendered = derive.args({ cwd: repo, flumeDir: stateRoot() })
      .SPEC_WINDOW;
    expect(rendered).toContain(`=== 1 commit(s) in the spec locus since ${base}`);
    expect(rendered).toContain("+in the locus");
  },
);

it("the sweep window is live while the plan state's rotation is open", () => {
  commit({ "src/a.ts": "export const a = 1;\n" }, "build: a");
  const sweep = windows()["plan-sweep"];

  // The cursor sits at HEAD in both arms, so nothing but the rotation
  // differs — a frontier commit would make the window live either way.
  writeState({ rotation: { kind: "closed" } });
  const closed = sweep.live({ flumeDir: stateRoot(), pickable: false });

  writeState({ rotation: { kind: "open", covered: [] } });
  const open = sweep.live({ flumeDir: stateRoot(), pickable: false });

  expect({ closed, open }).toEqual({ closed: false, open: true });
});

/**
 * The sweep is its own worker, so the queue decides nothing about its window:
 * what keeps insurance behind product is the declared phase order under the
 * supervisor's budget, not a window standing aside
 * (`.claude/rules/posture-sweep.md`, *The sweep runs beside build, never
 * ahead of it*).
 */
it("the sweep window is live while the queue carries a pickable entry", () => {
  commit({ "src/a.ts": "export const a = 1;\n" }, "build: a");
  const sweep = windows()["plan-sweep"];

  // Vacuity: a closed rotation at HEAD is shut over the very queue the arms
  // below are live over, so it is the rotation they read and not the fixture.
  writeState({ rotation: { kind: "closed" } });
  const closed = sweep.live({ flumeDir: stateRoot(), pickable: true });

  // The one fact flipped across an open rotation: it answers the same either
  // way, which is what "live on its own work" claims.
  writeState({ rotation: { kind: "open", covered: [] } });
  const idle = sweep.live({ flumeDir: stateRoot(), pickable: false });
  const beside = sweep.live({ flumeDir: stateRoot(), pickable: true });

  expect({ closed, idle, beside }).toEqual({
    closed: false,
    idle: true,
    beside: true,
  });
});

it("the inbox window is live while a standing build refusal is keyed to an entry the queue still carries", () => {
  commit({ "src/a.ts": "export const a = 1;\n" }, "build: a");
  writeState();
  const inbox = windows()[INBOX_PHASE];

  const pending = [entry("HARNESS-SLICE-WINDOWS")];
  const live = (records: PriorAttempt[]): boolean =>
    inbox.live({
      flumeDir: stateRoot(),
      pickable: true,
      pending,
      priorAttempts: new Map(records.map((r) => [`${r.key}:${r.keyedAs}`, r])),
    });

  // Vacuity guard: no record queue holds the window open, so every verdict
  // below is the refusal leg's doing.
  const noRecords = inbox.live({ flumeDir: stateRoot(), pickable: true });

  expect({
    noRecords,
    parked: live([record("HARNESS-SLICE-WINDOWS", "not-shipped")]),
    cleanExit: live([record("HARNESS-SLICE-WINDOWS", "clean-exit")]),
    // Keyed to an entry the queue no longer carries: the record outlived its
    // work, so nothing holds the window open.
    retiredEntry: live([record("SOME-OTHER-ENTRY", "not-shipped")]),
    // A reverted commit is the wave's to retry from the same queue.
    gateRevert: live([record("HARNESS-SLICE-WINDOWS", "gate-revert")]),
  }).toEqual({
    noRecords: false,
    parked: true,
    cleanExit: true,
    retiredEntry: false,
    gateRevert: false,
  });
});

/**
 * The record leg, over the spec's own case: a build tick's observation note,
 * waiting while the queue still has work in it. A record is material only
 * this slice routes, so no entry build could ship answers it — the leg reads
 * its own queue and nothing about the engine's pickable set
 * (`spec/harness.md`, *The phases*).
 */
it("the inbox record leg is live while the queue carries a pickable entry", () => {
  commit({ "src/a.ts": "export const a = 1;\n" }, "build: a");
  writeState();
  const inbox = windows()[INBOX_PHASE];

  // Vacuity: nothing waits yet, so the window is shut over the same pickable
  // queue — the note written below is the only thing that opens it.
  const noRecord = inbox.live({ flumeDir: stateRoot(), pickable: true });
  const path = writeRecord(
    "plan/notes/AN-OBSERVATION.md",
    "# An observation\n\nThe gate names its own command twice.\n",
  );

  expect({
    noRecord,
    // The note really is in the queue the leg reads ...
    waiting: recordsPending(stateRoot()),
    // ... and the leg answers the same with the queue's one fact flipped.
    beside: inbox.live({ flumeDir: stateRoot(), pickable: true }),
    idle: inbox.live({ flumeDir: stateRoot(), pickable: false }),
  }).toEqual({ noRecord: false, waiting: true, beside: true, idle: true });

  // The render leg reads no such fact either — a `WindowContext` carries
  // none — so whichever tick runs is handed the record itself.
  const rendered = inbox.args({ cwd: repo, flumeDir: stateRoot() }).RECORDS;
  expect(rendered).toContain(path);
  expect(rendered).toContain("The gate names its own command twice.");
});

/**
 * The refusal leg: it is keyed to an entry the queue still carries, so a
 * pickable queue is the state it exists to interrupt. Asserted beside the
 * record leg, since both open the window over the same pickable queue and a
 * case that ran only one of them would not say which leg answered.
 *
 * Ordered: the park arm is taken before any record is on disk, so it is the
 * park holding the window open and not the queue the later arm writes into.
 */
it("the inbox slice is live for a standing park even while entries are pickable", () => {
  commit({ "src/a.ts": "export const a = 1;\n" }, "build: a");
  writeState();
  const inbox = windows()[INBOX_PHASE];

  const pending = [entry("HARNESS-STANDING-PARK")];
  const parked = record("HARNESS-STANDING-PARK", "clean-exit");
  const park = inbox.live({
    flumeDir: stateRoot(),
    pickable: true,
    pending,
    priorAttempts: new Map([[`${parked.key}:${parked.keyedAs}`, parked]]),
  });
  // Vacuity: with neither leg's material present the window is shut, so
  // `park` above is the refusal leg's verdict.
  const bare = inbox.live({ flumeDir: stateRoot(), pickable: true });

  writeRecord("inbox/2026-09-16-a-finding.md", "# A finding\n\nObserved.\n");
  const waitingRecord = inbox.live({ flumeDir: stateRoot(), pickable: true });

  expect({ bare, park, waitingRecord }).toEqual({
    bare: false,
    park: true,
    waitingRecord: true,
  });
});

/**
 * The friction channel is the fourth findings source, and the one the engine
 * already owns end to end: it creates the directory, writes the revert note
 * into it, harvests a torn-down worktree's mirror into it, and counts it for
 * `flume status` — and then routes none of it. This is the leg that routes
 * it, read exactly as the record queues are (`spec/harness.md`, *Declared
 * findings sources*).
 *
 * Its control is the same tree read by a consumer that declared no channel:
 * an undeclared `friction` is the whole channel off, so a full directory
 * beside a silent declaration renders and wakes nothing.
 */
it("the inbox slice renders a declared friction directory's files as records", () => {
  commit({ "src/a.ts": "export const a = 1;\n" }, "build: a");
  writeState();

  const inboxRecord = writeRecord(
    "inbox/2026-09-16-a-finding.md",
    "# A finding\n\nObserved.\n",
  );
  const note = writeFriction(
    "revert-note-a54de89.md",
    "# Reverted\n\nThe tsc gate reverted the span.\n",
  );
  // A dotfile is not a note (`spec/chain.md`), and the skip is the engine's
  // own `isDotName` rather than this package's idea of one.
  const placeholder = writeFriction(".gitkeep", "");

  const rendered = windows({ friction: FRICTION_DIR })[INBOX_PHASE].args({
    cwd: repo,
    flumeDir: stateRoot(),
  }).RECORDS;

  // One record per file, in the one block the drain already routes: the
  // record queues first, then the channel. Both paths are the `join`-built
  // ones this case wrote at — the window names a file where the tick
  // draining it can open it.
  expect(rendered).toContain(`--- ${inboxRecord} ---`);
  expect(rendered).toContain(`--- ${note} ---`);
  expect(rendered).toContain("The tsc gate reverted the span.");
  // Each negative reads the listing arm it is about: a path this case wrote,
  // asserted against the block that lists paths, never against whatever else
  // the render happens to quote.
  expect(rendered).not.toContain(placeholder);

  // The control: one declaration away, the same tree carries the record and
  // not the note.
  const undeclared = windows()[INBOX_PHASE].args({
    cwd: repo,
    flumeDir: stateRoot(),
  }).RECORDS;
  expect(undeclared).toContain(`--- ${inboxRecord} ---`);
  expect(undeclared).not.toContain(note);
});

it("the inbox slice is live for a waiting friction file", () => {
  commit({ "src/a.ts": "export const a = 1;\n" }, "build: a");
  writeState();
  const declared = () => windows({ friction: FRICTION_DIR })[INBOX_PHASE];

  // Vacuity: the channel exists and holds only a placeholder, so the note
  // written below is the only thing that can open this window.
  writeFriction(".gitkeep", "");
  const placeholderOnly = declared().live({
    flumeDir: stateRoot(),
    pickable: false,
  });
  const note = writeFriction("revert-note-a54de89.md", "# Reverted\n");

  expect({
    placeholderOnly,
    // A consumer that declared no channel never reads the directory, however
    // full it is.
    undeclared: windows()[INBOX_PHASE].live({
      flumeDir: stateRoot(),
      pickable: false,
    }),
    // The friction leg reads its own channel and nothing about the queue,
    // so it answers the same with that one fact flipped.
    beside: declared().live({ flumeDir: stateRoot(), pickable: true }),
    live: declared().live({ flumeDir: stateRoot(), pickable: false }),
  }).toEqual({
    placeholderOnly: false,
    undeclared: false,
    beside: true,
    live: true,
  });

  // The render leg reads no such fact either, so the note is in the block
  // whichever tick runs is handed.
  expect(
    declared().args({ cwd: repo, flumeDir: stateRoot() }).RECORDS,
  ).toContain(note);
});

/**
 * The slug is what keys a record, so a tag carrying anything outside the key's
 * alphabet is filed under text it does not itself spell. Both arms run over
 * one such tag, and the map is keyed by the engine's own `entryAttemptKey`
 * (`src/priorAttempts.ts`) rather than by a spelling of this test's hand, so
 * what the window reaches for is read against what the store's walk files
 * under (`.claude/rules/engineering.md`, *A seam gate reads what the real
 * writer wrote*).
 */
it("the inbox slice's standing refusals key a tag slugify rewrites the way the engine's own entry-attempt key does", () => {
  commit({ "src/a.ts": "export const a = 1;\n" }, "build: a");
  writeState();
  const inbox = windows()[INBOX_PHASE];

  // A tag `slugify` rewrites: uppercase, a space and a slash all leave the
  // key's alphabet, so the written identity is not the tag's own text.
  const tag = "HARNESS SLICE/WINDOWS";
  const pending = [entry(tag)];
  const slugged = record(tag, "clean-exit");
  const live = (key: string, rec: PriorAttempt): boolean =>
    inbox.live({
      flumeDir: stateRoot(),
      pickable: true,
      pending,
      priorAttempts: new Map([[key, rec]]),
    });

  expect({
    // Vacuity: the engine's key really did rewrite the tag, so the arms
    // below are about the slug and not about a tag already in the alphabet.
    keyCarriesRawTag: entryAttemptKey(pending[0]!).includes(tag),
    slugged: live(entryAttemptKey(pending[0]!), slugged),
    // Control: the same record for the same queued entry, written and filed
    // under the tag's raw text instead of its slug — neither the identity
    // the engine stamps nor the key its walk files under.
    raw: live(`entry:${tag}`, { ...slugged, keyedAs: tag }),
  }).toEqual({ keyCarriesRawTag: false, slugged: true, raw: false });
});

/**
 * A phase named `build` and a tag slugged `build` share one identity — the
 * window's only discriminator is the record's own stated `key` field, never
 * that text. Both arms below are written over that one colliding identity, so
 * the verdicts differ by the keyspace and nothing else.
 */
it("the inbox window ignores a phase-keyed prior-attempt record whose key matches a queued entry's slug", () => {
  commit({ "src/a.ts": "export const a = 1;\n" }, "build: a");
  writeState();
  const inbox = windows()[INBOX_PHASE];

  // A queued tag that slugs to a phase name the engine also keys records by.
  const pending = [entry("BUILD")];
  const entryKeyed = record("BUILD", "not-shipped");
  const phaseKeyed = record("build", "not-shipped", "phase");

  const live = (rec: PriorAttempt): boolean =>
    inbox.live({
      flumeDir: stateRoot(),
      pickable: true,
      pending,
      priorAttempts: new Map([[`${rec.key}:${rec.keyedAs}`, rec]]),
    });

  expect({
    // Vacuity guard: the phase-keyed record is judged against a populated
    // queue it genuinely collides with, so `false` below is the keyspace's
    // doing rather than a stem the queue never carried.
    collides: phaseKeyed.keyedAs === slugify(pending[0]!.tag),
    sameStem: phaseKeyed.keyedAs === entryKeyed.keyedAs,
    // Control: the same stem, the same mode, in the queue's own keyspace.
    entryKeyed: live(entryKeyed),
    phaseKeyed: live(phaseKeyed),
  }).toEqual({
    collides: true,
    sameStem: true,
    entryKeyed: true,
    phaseKeyed: false,
  });
});

/**
 * The same question — "is this refusal only a plan slice's to resolve" —
 * asked by the two readers that carry it, over **one evidence**: the
 * prior-attempt store the engine reports beside the queue it left. This
 * window reads it at a `shouldRun` consult (`TickContext`), the default
 * handoff's refusal leg reads it at the tick that follows (`TickResult`),
 * and both real readers run here. Neither side's table is restated by the
 * test.
 *
 * One evidence is the property under test. The handoff used to rebuild this
 * verdict from the tick's own `noCommit` and `entries[].mergeOutcome` — the
 * fates the engine had already stamped onto the very records the window
 * reads — so the two sides agreed only as long as a hand kept two tables in
 * step. Handed the store, the agreement is structural: a mode the engine
 * mints cannot route to the inbox from one surface and nowhere from the
 * other.
 */
it("the inbox window and the build handoff agree on every prior-attempt mode", () => {
  commit({ "src/a.ts": "export const a = 1;\n" }, "build: a");
  writeState();
  const inbox = windows()[INBOX_PHASE];

  const tag = "HARNESS-STANDING-REFUSAL";
  const pending = [entry(tag)];

  /** The queue and the store a tick reports, with one record of `mode` in it. */
  const facts = (
    mode: PriorAttemptMode,
  ): { pending: PendingEntry[]; priorAttempts: Map<string, PriorAttempt> } => {
    const rec = record(tag, mode);
    return { pending, priorAttempts: new Map([[`${rec.key}:${rec.keyedAs}`, rec]]) };
  };

  /** Whether the inbox window opens over one standing record of this mode. */
  const windowSays = (mode: PriorAttemptMode): boolean =>
    inbox.live({ flumeDir: stateRoot(), pickable: true, ...facts(mode) });

  // Every slice is dead, so a tick whose wake set carries the inbox got it
  // there through the handoff's refusal leg and not through an open window.
  const handoff = defaultHandoff(
    ([INBOX_PHASE, "plan-derive", "plan-sweep"] satisfies PlanSlice[]).map(
      (name) => ({ name, live: () => false }),
    ),
  );

  /** One build tick reporting that same store, with the same queue behind it. */
  const reported = (mode: PriorAttemptMode): TickResult => {
    const { pending: queue, priorAttempts } = facts(mode);
    return {
      phaseName: BUILD_PHASE,
      committed: true,
      gateResults: [],
      pendingAfter: queue,
      // Build is a live alternative throughout, so "inbox" is a routing
      // decision rather than the only phase left to name.
      pickableAfter: queue,
      priorAttempts,
      flumeDir: stateRoot(),
      configDir: stateRoot(),
      shippedTags: [],
      revertedTags: [],
    };
  };

  const verdicts = PRIOR_ATTEMPT_MODES.map((mode) => ({
    mode,
    window: windowSays(mode),
    handoff: handoff(reported(mode)).includes(INBOX_PHASE),
  }));

  // Vacuity: every mode the engine mints is judged, and both verdicts occur
  // on both sides — an agreement over one constant answer proves nothing.
  expect(verdicts.length).toBe(PRIOR_ATTEMPT_MODES.length);
  expect(verdicts.length).toBeGreaterThan(0);
  expect(verdicts.some((v) => v.window)).toBe(true);
  expect(verdicts.some((v) => !v.window)).toBe(true);
  expect(verdicts.some((v) => v.handoff)).toBe(true);
  expect(verdicts.some((v) => !v.handoff)).toBe(true);

  expect(verdicts.map((v) => [v.mode, v.window])).toEqual(
    verdicts.map((v) => [v.mode, v.handoff]),
  );
  expect(
    verdicts
      .filter((v) => v.window)
      .map((v) => v.mode)
      .sort(),
  ).toEqual(["clean-exit", "not-shipped", "render-refused"]);
});

it("a standing tip-moved prior-attempt record leaves the inbox window shut", () => {
  commit({ "src/a.ts": "export const a = 1;\n" }, "build: a");
  writeState();
  const inbox = windows()[INBOX_PHASE];

  const tag = "HARNESS-TIP-MOVED";
  const pending = [entry(tag)];
  const moved = record(tag, "tip-moved");

  const live = (rec: PriorAttempt): boolean =>
    inbox.live({
      flumeDir: stateRoot(),
      pickable: true,
      pending,
      priorAttempts: new Map([[`${rec.key}:${rec.keyedAs}`, rec]]),
    });

  expect({
    // Vacuity: nothing waits in the record queue, so the refusal leg is the
    // window's only possible opener here.
    noRecords: inbox.live({ flumeDir: stateRoot(), pickable: true }),
    // ... and the record reaches that leg: it is entry-keyed to a tag the
    // queue still carries, so `false` below is the fate's doing.
    keyedToLiveEntry:
      moved.key === "entry" && slugify(pending[0]!.tag) === moved.keyedAs,
    tipMoved: live(moved),
    // Control: the same fixture with the one fate changed opens the window.
    parked: live(record(tag, "not-shipped")),
  }).toEqual({
    noRecords: false,
    keyedToLiveEntry: true,
    tipMoved: false,
    parked: true,
  });
});

it("a rendered window names the sha its cursor may advance to and defers the commits past its budget", () => {
  const base = commit({ "spec/loop.md": "# Loop\n" }, "spec: the loop");
  writeState();

  const first = commit({ "spec/loop.md": body("first", 20) }, "spec: first");
  const second = commit({ "spec/loop.md": body("second", 20) }, "spec: second");

  // A budget smaller than either diff: the first commit renders whatever its
  // size, and the second is deferred to the next tick.
  const rendered = windows({}, 5)["plan-derive"].args({
    cwd: repo,
    flumeDir: stateRoot(),
  }).SPEC_WINDOW;

  expect(rendered).toContain(`=== 2 commit(s) in the spec locus since ${base}`);
  expect(rendered).toContain("first line 0");
  expect(rendered).toContain(
    `=== rendered 1 commit(s) in full; \`derivedThrough\` may advance to ${first} ===`,
  );
  expect(rendered).toContain(
    "=== 1 commit(s) beyond this tick's budget re-appear next tick: ===",
  );
  expect(rendered).toContain(`${second} spec: second`);
  // The deferred commit's diff is not rendered — only its identity.
  expect(rendered).not.toContain("second line 0");
});

/**
 * A filename may not contain `*` on win32, so this fixture cannot exist
 * there. The title is the queue entry's own `pins[]` line, matched on the
 * full name.
 */
it.runIf(process.platform !== "win32")(
  "a window diff narrows by a path whose name carries a glob metacharacter",
  () => {
    const base = commit({ "spec/loop.md": "# Loop\n" }, "spec: the loop");
    writeState();

    // One commit, two paths: only the top-level `.md` is in the declared
    // locus, and the window narrows the diff to it by name. Read as a
    // pattern that name also selects the nested file, because git's default
    // pathspec `*` crosses `/` while the engine's own `matchesAny` does not.
    commit(
      {
        "spec/a*.md": "in the locus\n",
        "spec/aliens/x.md": "outside the locus\n",
      },
      "spec: a starred name and a nested neighbour",
    );

    const rendered = windows({ specLocus: ["spec/*.md"] })["plan-derive"].args({
      cwd: repo,
      flumeDir: stateRoot(),
    }).SPEC_WINDOW;

    // Vacuity pin: the window is populated, and it is populated *by* the
    // metacharacter path — not by some other commit in the range.
    expect(rendered).toContain(`=== 1 commit(s) in the spec locus since ${base}`);
    expect(rendered).toContain("+in the locus");

    // The neighbour a pattern read would have swept in is absent.
    expect(rendered).not.toContain("spec/aliens/x.md");
    expect(rendered).not.toContain("+outside the locus");
  },
);

it("a window refuses a cursor sha that does not resolve in the tick's tree", () => {
  commit({ "spec/loop.md": "# Loop\n" }, "spec: the loop");
  const absent = "0123456789abcdef0123456789abcdef01234567";
  writeState({ derivedThrough: absent, sweptThrough: absent });
  const built = windows();
  const ctx = { cwd: repo, flumeDir: stateRoot() };

  const spec = built["plan-derive"].args(ctx).SPEC_WINDOW;
  const sweep = built["plan-sweep"].args(ctx).SWEEP_WINDOW;

  for (const [field, window] of [
    ["derivedThrough", spec],
    ["sweptThrough", sweep],
  ] as const) {
    expect(window).toContain("REFUSE");
    expect(window).toContain(absent);
    expect(window).toContain(`\`${field}\``);
    expect(window).toContain("advance no cursor this tick");
    // Nothing of the window itself leaks past the refusal: a partial render
    // beside it would read as material the tick may act on.
    expect(window).not.toContain("spec: the loop");
  }

  // An unreadable window wakes its slice rather than reporting empty — the
  // refusal above is what the woken tick is handed.
  expect(
    built["plan-derive"].live({ flumeDir: stateRoot(), pickable: false }),
  ).toBe(true);
});

it("a window render refuses by name when git fails for a reason other than an unresolvable cursor", () => {
  commit({ "spec/loop.md": "# Loop\n" }, "spec: the loop");
  // No plan state is written, so both renders take the bootstrap leg — it
  // lists the tree and consults no cursor at all. The failure below is
  // therefore git's own, not the unresolvable-cursor refusal under a second
  // name.
  const notATree = mkTempDirSync("flume-windows-nogit-");

  // What git says about that directory, read here rather than written by
  // hand: the assertion below is then that git's sentence reached the
  // refusal, not that the test and the module agree on a phrasing.
  let said = "";
  try {
    gitOutSync(notATree, ["ls-files"]);
  } catch (err) {
    said = err instanceof Error ? err.message : String(err);
  }
  const fatal =
    said.split("\n").find((line) => line.startsWith("fatal:")) ?? "";
  // Vacuity guard: a fixture git happily read would pass every assertion
  // below against a window that never failed.
  expect(fatal).not.toBe("");

  try {
    const built = windows();
    const ctx = { cwd: notATree, flumeDir: stateRoot() };

    for (const [field, window] of [
      ["derivedThrough", built["plan-derive"].args(ctx).SPEC_WINDOW],
      ["sweptThrough", built["plan-sweep"].args(ctx).SWEEP_WINDOW],
    ] as const) {
      expect(window).toContain("REFUSE");
      expect(window).toContain(`\`${field}\``);
      expect(window).toContain("advance no cursor this tick");
      // The failure's own text, carried whole.
      expect(window).toContain(fatal);
      // Nothing of the window itself: a bootstrap listing beside the
      // refusal would read as material the tick may act on.
      expect(window).not.toContain("bootstrap");
    }
  } finally {
    rmSync(notATree, { recursive: true, force: true });
  }
});

it("the sweep window carries the frontier commits and the spec lines the window retired", () => {
  const base = commit(
    { "src/a.ts": "export const a = 1;\n", "spec/loop.md": "# Loop\n\nA ratified claim.\n" },
    "build: a",
  );
  writeState();

  commit({ "src/a.ts": "export const a = 2;\n" }, "build: bump a");
  commit({ "spec/loop.md": "# Loop\n" }, "spec: retire the claim");
  commit({ "elsewhere/x.md": "untouched by the sweep\n" }, "chore: elsewhere");

  const rendered = windows()["plan-sweep"].args({
    cwd: repo,
    flumeDir: stateRoot(),
  }).SWEEP_WINDOW;

  expect(rendered).toContain(
    `=== 1 commit(s) since ${base} touching the sweep domain or a posture page ===`,
  );
  expect(rendered).toContain("build: bump a");
  expect(rendered).toContain("  src/a.ts");
  expect(rendered).not.toContain("chore: elsewhere");
  expect(rendered).toContain("(retired-claim delta)");
  expect(rendered).toContain("-A ratified claim.");
});

/**
 * The retired-claim delta's own lines, cut out of a rendered sweep window.
 *
 * The block runs from the delta's header to the blank line before the tip
 * line; a deleted blank line arrives as a bare `-`, never as `""`, so the
 * first empty line is the block's end. Cases assert against these lines
 * rather than against the whole render, which quotes commit subjects and
 * paths the delta has no say over (`.claude/rules/posture-sweep.md`, *A
 * violation counts only when verified on disk this tick*).
 */
function retiredDelta(rendered: string | undefined): string[] {
  if (rendered === undefined) throw new Error("the sweep window is unrendered");
  const lines = rendered.split("\n");
  const start = lines.findIndex((line) =>
    line.includes("(retired-claim delta)"),
  );
  expect(start).not.toBe(-1);
  const rest = lines.slice(start + 1);
  const end = rest.indexOf("");
  return end === -1 ? rest : rest.slice(0, end);
}

it("the retired-claim delta carries a deleted line that begins with two dashes", () => {
  commit(
    {
      "src/a.ts": "export const a = 1;\n",
      "spec/loop.md": "# Loop\n\nA ratified claim.\n-- a dashed claim.\n",
    },
    "build: a",
  );
  writeState();

  commit({ "src/a.ts": "export const a = 2;\n" }, "build: bump a");
  commit({ "spec/loop.md": "# Loop\n" }, "spec: retire both claims");

  const delta = retiredDelta(
    windows()["plan-sweep"].args({ cwd: repo, flumeDir: stateRoot() })
      .SWEEP_WINDOW,
  );

  // Vacuity guard: the window retired two lines, and the undashed one
  // arrives whatever git was asked to mark deletions with.
  expect(delta).toContain("-A ratified claim.");
  // The dashed one is the claim git renders as `--- a dashed claim.`: a
  // deletion, not the `--- a/spec/loop.md` header it reads as.
  expect(delta).toContain("--- a dashed claim.");
});

it("the retired-claim delta excludes the diff's own file-header lines", () => {
  commit(
    {
      "src/a.ts": "export const a = 1;\n",
      "spec/loop.md": "# Loop\n\nA ratified claim.\n",
    },
    "build: a",
  );
  writeState();

  commit({ "src/a.ts": "export const a = 2;\n" }, "build: bump a");
  commit({ "spec/loop.md": "# Loop\n" }, "spec: retire the claim");

  const delta = retiredDelta(
    windows()["plan-sweep"].args({ cwd: repo, flumeDir: stateRoot() })
      .SWEEP_WINDOW,
  );

  // Vacuity guard: a delta that carried nothing would exclude the headers
  // by having excluded everything.
  expect(delta.length).toBeGreaterThan(0);
  // Exactly what the commit removed — the sentence and the blank line above
  // it — and none of `diff --git`, `index`, `--- a/spec/loop.md`,
  // `+++ b/spec/loop.md` or the hunk header.
  expect(delta).toEqual(["-", "-A ratified claim."]);
});

it("a rendered sweep window names the tip its frontier was drawn from", () => {
  const base = commit({ "src/a.ts": "export const a = 1;\n" }, "build: a");
  writeState();

  commit({ "src/a.ts": "export const a = 2;\n" }, "build: bump a");
  // The tip is the tree's, not the frontier's last commit: the rotation this
  // window closes has been re-derived against everything past the cursor.
  const tip = commit({ "elsewhere/x.md": "outside the domain\n" }, "chore: elsewhere");

  const rendered = windows()["plan-sweep"].args({
    cwd: repo,
    flumeDir: stateRoot(),
  }).SWEEP_WINDOW;

  // Vacuity guard: the frontier this tip closes is populated.
  expect(rendered).toContain(
    `=== 1 commit(s) since ${base} touching the sweep domain or a posture page ===`,
  );
  expect(tip).not.toBe(base);
  expect(rendered).toContain(
    `=== this window was drawn from tip ${tip}; the tick that closes the ` +
      `rotation stamps \`sweptThrough\` at exactly that sha ===`,
  );
});

it("a sweep window with no commits past its cursor names the cursor as its tip", () => {
  const base = commit({ "src/a.ts": "export const a = 1;\n" }, "build: a");
  writeState();

  const rendered = windows()["plan-sweep"].args({
    cwd: repo,
    flumeDir: stateRoot(),
  }).SWEEP_WINDOW;

  // The empty case, spelled: a quiet tree still names one tip, so the tick
  // that closes on it stamps the cursor forward rather than nothing.
  expect(rendered).toContain(
    `=== 0 commit(s) since ${base} touching the sweep domain or a posture page ===`,
  );
  expect(rendered).toContain(
    `=== this window was drawn from tip ${base}; the tick that closes the ` +
      `rotation stamps \`sweptThrough\` at exactly that sha ===`,
  );
});

it("the inbox window renders every waiting record's bytes and marks the refusals it must reconcile", () => {
  commit({ "src/a.ts": "export const a = 1;\n" }, "build: a");
  writeState();

  const inboxDir = join(stateRoot(), "inbox");
  mkdirSync(inboxDir, { recursive: true });
  writeFileSync(join(inboxDir, "2026-09-14-a-finding.md"), "# A finding\n\nObserved.\n");

  const pending = [entry("LIVE-ENTRY")];
  const records = [
    record("LIVE-ENTRY", "not-shipped"),
    record("RETIRED-ENTRY", "clean-exit"),
    // A singleton phase's record: never this slice's to reconcile, however
    // the queue is shaped, so it renders with its keyspace and no mark.
    record("plan-derive", "clean-exit", "phase"),
  ];
  const args = windows()[INBOX_PHASE].args({
    cwd: repo,
    flumeDir: stateRoot(),
    pending,
    priorAttempts: new Map(records.map((r) => [`${r.key}:${r.keyedAs}`, r])),
  });

  expect(args.RECORDS).toContain("2026-09-14-a-finding.md");
  expect(args.RECORDS).toContain("Observed.");
  expect(args.BUILD_RECORDS).toContain(
    "=== 3 standing prior-attempt record(s) ===",
  );
  expect(args.BUILD_RECORDS).toContain(
    "--- live-entry (entry keyspace) ← the queue still carries this entry; reconcile it ---",
  );
  expect(args.BUILD_RECORDS).toContain("--- retired-entry (entry keyspace) ---");
  expect(args.BUILD_RECORDS).toContain("--- plan-derive (phase keyspace) ---");
  // The record's own fields, verbatim from the engine's shape.
  expect(args.BUILD_RECORDS).toContain(`"mode": "not-shipped"`);
});

it("the rendered records block names the byte count of a record over the cap", () => {
  commit({ "src/a.ts": "export const a = 1;\n" }, "build: a");
  writeState();

  const inboxDir = join(stateRoot(), "inbox");
  mkdirSync(inboxDir, { recursive: true });
  // Under the cap in characters and over it in bytes — the overrun the cap
  // is actually made of, and the reason this render measures the file's
  // bytes rather than the decoded string's length.
  const body = "\u2014".repeat(RECORD_MAX_BYTES / 2);
  const over = `# Too much\n\n${body}\n`;
  const overPath = join(inboxDir, "2026-09-14-over-the-cap.md");
  writeFileSync(overPath, over);
  const underPath = join(inboxDir, "2026-09-15-under-the-cap.md");
  writeFileSync(underPath, "# Short\n\nObserved.\n");

  // Non-vacuity, both arms: one record really is over the cap in bytes while
  // its character count is under it, and the other really is under.
  expect(over.length).toBeLessThan(RECORD_MAX_BYTES);
  const bytes = Buffer.byteLength(over);
  expect(bytes).toBeGreaterThan(RECORD_MAX_BYTES);

  const rendered = windows()[INBOX_PHASE].args({
    cwd: repo,
    flumeDir: stateRoot(),
  }).RECORDS;

  // The overrun is named where the drain reads it, with the count it must
  // report — and the under-cap record beside it carries no mark. Both paths
  // are the `join`-built ones this case wrote at: the window names a record
  // where the tick draining it can open the file, so the rendered path is
  // host-native, not git's alphabet (`spec/cli.md`, *win32 is a supported
  // host*, path discipline).
  expect(rendered).toContain(
    `--- ${overPath} (${bytes} bytes, cap ${RECORD_MAX_BYTES} — name this overrun in the commit body) ---`,
  );
  expect(rendered).toContain(`--- ${underPath} ---`);
  // The over-cap record is still rendered whole; the mark is a mark, not a
  // truncation.
  expect(rendered).toContain(body);
});

/**
 * Absence is per slice, because the files are: a consumer mid-cutover has one
 * slice's file written and another's not, and each window opens on its own
 * slice's answer rather than on whether any plan state exists at all.
 */
it("a missing slice state file renders as no state yet", () => {
  const cursor = commit({ "spec/loop.md": "# Loop\n" }, "spec: the loop");
  writeState();
  commit({ "rules/posture.md": "# Posture\n" }, "rules: a posture page");

  const built = windows();
  const ctx = { cwd: repo, flumeDir: stateRoot() };

  // Control: with both files on disk, both windows render past their cursors
  // rather than bootstrapping — so the bootstrap below is the removed file's
  // doing and not the fixture's.
  expect(built["plan-derive"].args(ctx).SPEC_WINDOW).not.toContain("bootstrap");
  expect(built["plan-sweep"].args(ctx).SWEEP_WINDOW).not.toContain("bootstrap");

  // Derive's file alone removed: derive reads no state yet and opens over its
  // whole declared corpus, while the sweep still reads the cursor in its own
  // file — the sibling's absence is not its absence.
  rmSync(planStatePath(stateRoot(), "plan-derive"));
  const half = windows();
  const bootstrapped = half["plan-derive"].args(ctx).SPEC_WINDOW;
  expect(bootstrapped).toContain("bootstrap");
  expect(bootstrapped).toContain("`derivedThrough`");
  expect(bootstrapped).toContain("spec/loop.md");
  expect(bootstrapped).not.toContain("REFUSE");

  const sweep = half["plan-sweep"].args(ctx).SWEEP_WINDOW;
  expect(sweep).not.toContain("bootstrap");
  expect(sweep).toContain(`commit(s) since ${cursor}`);

  // And the liveness leg reads the same absence: a slice with no state file
  // of its own is live, because no state yet is every window's "run".
  expect(
    half["plan-derive"].live({ flumeDir: stateRoot(), pickable: false }),
  ).toBe(true);
});

it("a state root with no plan state opens every window over the whole declared corpus", () => {
  commit(
    { "spec/loop.md": "# Loop\n", "src/a.ts": "export const a = 1;\n" },
    "chore: seed",
  );

  const rendered = windows()["plan-derive"].args({
    cwd: repo,
    flumeDir: stateRoot(),
  }).SPEC_WINDOW;

  expect(rendered).toContain("bootstrap");
  expect(rendered).toContain("`derivedThrough`");
  expect(rendered).toContain("spec/loop.md");
  // Scoped to the declared locus, never the whole tree.
  expect(rendered).not.toContain("src/a.ts");
  expect(
    windows()["plan-derive"].live({ flumeDir: stateRoot(), pickable: false }),
  ).toBe(true);
});

it("the bootstrap window names the tip it was drawn from rather than telling the tick to stamp HEAD", () => {
  commit(
    { "spec/loop.md": "# Loop\n", "src/a.ts": "export const a = 1;\n" },
    "chore: seed",
  );
  // The tip is the tree's, not the last commit inside either window's globs:
  // a bootstrap reads the whole corpus, so every commit is behind it.
  const tip = commit({ "elsewhere/x.md": "outside\n" }, "chore: elsewhere");

  const built = windows();
  const ctx = { cwd: repo, flumeDir: stateRoot() };
  // No plan state is written, so both slices take the bootstrap leg — one
  // render, two cursors.
  const cases = [
    {
      field: "derivedThrough",
      corpus: "spec/loop.md",
      rendered: built["plan-derive"].args(ctx).SPEC_WINDOW,
    },
    {
      field: "sweptThrough",
      corpus: "src/a.ts",
      rendered: built["plan-sweep"].args(ctx).SWEEP_WINDOW,
    },
  ];

  for (const { field, corpus, rendered } of cases) {
    // Vacuity guard: it is the bootstrap leg, with its corpus listed in it,
    // that ends on the tip below.
    expect(rendered).toContain("bootstrap");
    expect(rendered).toContain(corpus);
    expect(rendered).not.toContain("stamp HEAD");
    expect(rendered).toMatch(
      new RegExp(
        `=== this window was drawn from tip ${tip}; the tick that closes it ` +
          `stamps \`${field}\` at exactly that sha ===\\s*$`,
      ),
    );
  }
});

it("the windows a declaration builds are the slices it enabled, in the ladder's order", () => {
  const all = planSliceWindows({
    declaration: declaration(),
    repoRoot: repo,
  }).map((w) => w.name);

  const inboxOnly = planSliceWindows({
    declaration: declaration({ slices: { enabled: [INBOX_PHASE] } }),
    repoRoot: repo,
  }).map((w) => w.name);

  expect({ all, inboxOnly }).toEqual({
    all: [INBOX_PHASE, "plan-derive", "plan-sweep"],
    inboxOnly: [INBOX_PHASE],
  });
});

/**
 * The empty case, spelled rather than inherited (`.claude/rules/engineering.md`,
 * *A green verdict is proven non-vacuous*): a consumer with no forge still
 * gets the key, because the phase declares it as data whatever the
 * declaration holds, and a key a tick stops returning is a render the engine
 * refuses.
 *
 * It is also the proof that no lane is read for a consumer that declared
 * none — the forge CLI is never reached on this path, so no host without one
 * pays a failed spawn per inbox tick.
 */
it("the inbox window spells the empty CI lane case when the declaration names none", () => {
  commit({ "src/a.ts": "export const a = 1;\n" }, "build: a");
  writeState();
  const inbox = windows()[INBOX_PHASE];

  const args = inbox.args({ cwd: repo, flumeDir: stateRoot() });

  expect(declaration().ci).toBeUndefined();
  expect(inbox.dataKeys).toContain("CI_LANES");
  expect(Object.keys(args).sort()).toEqual([...inbox.dataKeys].sort());
  expect(args["CI_LANES"]).toBe("(no CI lanes declared)");
});

/**
 * The queue's own parse failure, the one window leg that is not a findings
 * source (`spec/harness.md`, *The gates the discipline needs*: no state of the
 * queue needs a hand edit).
 *
 * The engine runs a phase whose fence admits the ledger over an unparseable
 * queue with `pending: []` and the failure as a tick fact
 * (`readPendingForDecision`, `src/pendingLedger.ts`), and every slice this
 * package builds declares that fence. So the fact is what tells the slice that
 * repairs the queue from the two that would derive it away, and the arms below
 * are all written over one queue state that differs by that field alone.
 */

/** The engine's own decide-read fact, as `readPendingForDecision` reports one. */
const parseFailure = (): QueueParseFailure => ({
  path: ".flume/plan/pending",
  errors: [
    { file: "SOME-ENTRY.json", path: "tag", message: "Invalid input: expected string" },
  ],
});

it("a queue that fails to parse makes the inbox slice live", () => {
  commit({ "src/a.ts": "export const a = 1;\n" }, "build: a");
  writeState();
  const inbox = windows()[INBOX_PHASE];

  // Vacuity and control in one: no record waits, no refusal stands and the
  // declaration names no lane, so the window is shut over the same state root
  // — and `pickable` is false in both arms, because a tick over an unparseable
  // queue has nothing pickable by construction. What separates them is the
  // fact alone, which is the claim: an empty queue that never resolved is not
  // a drained one.
  expect(recordsPending(stateRoot())).toBe(false);
  const resolved = inbox.live({ flumeDir: stateRoot(), pickable: false });
  const failed = inbox.live({
    flumeDir: stateRoot(),
    pickable: false,
    queueParseFailure: parseFailure(),
  });

  expect({ resolved, failed }).toEqual({ resolved: false, failed: true });
});

it("the inbox render carries the queue's parse failure as the drain's input", () => {
  commit({ "src/a.ts": "export const a = 1;\n" }, "build: a");
  writeState();
  const failure = parseFailure();

  // Non-vacuity: the fact really carries an error, so the block below is
  // rendered over something.
  expect(failure.errors.length).toBeGreaterThan(0);

  const failed = windows()[INBOX_PHASE].args({
    cwd: repo,
    flumeDir: stateRoot(),
    pending: [],
    queueParseFailure: failure,
  }).QUEUE_PARSE_FAILURE;

  // The file that did not resolve, and the engine's own error shape verbatim
  // — the drain is told what to repair, not merely that something is wrong.
  expect(failed).toContain(failure.path);
  expect(failed).toContain(`${failure.errors.length} error(s)`);
  expect(failed).toContain(`"message": "${failure.errors[0]!.message}"`);
  expect(failed).toContain(`"path": "${failure.errors[0]!.path}"`);

  // The control, over the same empty `pending`: a queue that resolved says so
  // rather than rendering an empty block, which is the text a tick that failed
  // to render the fact would produce.
  const healthy = windows()[INBOX_PHASE].args({
    cwd: repo,
    flumeDir: stateRoot(),
    pending: [],
  }).QUEUE_PARSE_FAILURE;
  expect(healthy).toContain("the queue parsed");
  expect(healthy).not.toContain(failure.path);
});

/**
 * The other half of the same fact: the two slices whose output *is* a derived
 * queue shut over one that did not parse, so the tick reaches the slice whose
 * rewrite is the repair rather than landing a queue with every entry dropped.
 */
it("the derive and sweep slices shut over a queue that did not parse", () => {
  const cursor = commit({ "src/a.ts": "export const a = 1;\n" }, "build: a");
  writeState({ derivedThrough: cursor, sweptThrough: cursor });
  // Past both cursors: the spec locus for derive, the sweep domain for sweep.
  commit(
    { "spec/loop.md": "# Loop\n", "src/b.ts": "export const b = 2;\n" },
    "spec: the loop, and a build commit beside it",
  );
  const built = windows();

  const live = (queueParseFailure?: QueueParseFailure) => ({
    derive: built["plan-derive"].live({
      flumeDir: stateRoot(),
      pickable: false,
      ...(queueParseFailure ? { queueParseFailure } : {}),
    }),
    sweep: built["plan-sweep"].live({
      flumeDir: stateRoot(),
      pickable: false,
      ...(queueParseFailure ? { queueParseFailure } : {}),
    }),
  });

  // Control: both windows really are open over this tree, so the shut verdict
  // below is the fact's doing and not an empty frontier's.
  expect({ open: live(), overFailure: live(parseFailure()) }).toEqual({
    open: { derive: true, sweep: true },
    overFailure: { derive: false, sweep: false },
  });
});

/**
 * The wake set over the real windows: without this the loop hibernates on a
 * queue that never resolved, because a parse failure reports nothing pickable
 * and every other leg reads a quiet disk.
 */
it("the default handoff names the inbox slice over a queue that did not parse", () => {
  commit({ "src/a.ts": "export const a = 1;\n" }, "build: a");
  writeState();
  const handoff = defaultHandoff(
    planSliceWindows({ declaration: declaration(), repoRoot: repo }),
  );

  const base: TickResult = {
    phaseName: BUILD_PHASE,
    committed: false,
    gateResults: [],
    pendingAfter: [],
    pickableAfter: [],
    priorAttempts: new Map(),
    flumeDir: stateRoot(),
    configDir: stateRoot(),
    shippedTags: [],
    revertedTags: [],
  };

  // Vacuity: the same tick with a queue that resolved hibernates, so "inbox"
  // below is the parse failure's doing and not the set's only member.
  expect({
    resolved: handoff(base),
    failed: handoff({ ...base, queueParseFailure: parseFailure() }),
  }).toEqual({ resolved: [], failed: [INBOX_PHASE] });
});
