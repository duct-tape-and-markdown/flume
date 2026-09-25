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

import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  defaultHandoff,
  defaultRefusesEntry,
  parseDeclaration,
  planSliceWindows,
  RECORD_MAX_BYTES,
  planStatePath,
  writePlanState,
  type Declaration,
  type PlanSliceWindow,
  type PlanStateWriteOf,
} from "../harness/index.ts";
import {
  BUILD_PHASE,
  INBOX_PHASE,
  PLAN_SLICES,
  type PlanSlice,
} from "../harness/declaration.ts";
import { readPlanState } from "../harness/planState.ts";
import { checkoutRecords, listRecords } from "../harness/records.ts";
import { entryDeclaredKey } from "../src/entryKey.ts";
import type { EntryRefusalContext, TickResult } from "../src/Phase.ts";
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
import { namespacedJoin, slugify } from "../src/paths.ts";
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

/**
 * The state root as the repository addresses it — the offset
 * `api.paths.stateRootRel` reports, and the alphabet a commit's touched paths
 * and `layout.ts`'s note paths share.
 */
const STATE_ROOT_REL = ".flume";

/** The state root is the repo's own `.flume`, as a real consumer's is. */
const stateRoot = (): string => join(repo, STATE_ROOT_REL);

/** The cursor facts a case varies, off a closed rotation at HEAD. */
interface StateOverrides {
  readonly derivedThrough?: string;
  readonly sweptThrough?: string;
  readonly rotation?: PlanStateWriteOf<"plan-sweep">["rotation"];
  /**
   * The sweep's retired-claim cursor. Optional on the artifact too, so a case
   * that names none writes a file carrying none — which is the state every
   * sweep file written before the field existed is in.
   */
  readonly retiredThrough?: string;
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
    ...(overrides.retiredThrough === undefined
      ? {}
      : { retiredThrough: overrides.retiredThrough }),
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
    stateRootRel: STATE_ROOT_REL,
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
      return {
        mode,
        finalMessage: "parked",
        spanBase: "1".repeat(40), spanHead: "1".repeat(40),
        ...anchor,
      };
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
 *
 * **On the shared disk alone.** The render reads a checkout, so this is all a
 * render case needs; the wake reads the tip, so a liveness case takes
 * {@link commitRecord} instead (`spec/harness.md`, *The phases*).
 */
function writeRecord(rel: string, text: string): string {
  const path = join(stateRoot(), ...rel.split("/"));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  return path;
}

/**
 * The same record, landed on the tip — the tree a provisioned worktree is cut
 * from, and so the one the wake leg counts.
 *
 * `-A`, so a case that left siblings on the shared disk lands them in the
 * same commit: what a case is saying by calling this is "the tip carries the
 * queue", never "this one file and no other".
 */
function commitRecord(rel: string, text: string): string {
  const path = writeRecord(rel, text);
  git("add", "-A");
  git("commit", "-q", "-m", `records: ${rel}`);
  return path;
}

/**
 * Whether the tip holds a state-root-relative path — git's own answer, which
 * is what the window's record leg is a claim about.
 */
const tipHolds = (rel: string): boolean =>
  git("ls-tree", "--name-only", "-r", "HEAD")
    .split("\n")
    .includes(`${STATE_ROOT_REL}/${rel}`);

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
  const rel = "plan/notes/AN-OBSERVATION.md";
  const path = commitRecord(
    rel,
    "# An observation\n\nThe gate names its own command twice.\n",
  );

  expect({
    noRecord,
    // The note really is on the tip the leg reads ...
    waiting: tipHolds(rel),
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
 * A record is read from the tip, as the drain that routes it is
 * (`spec/harness.md`, *The phases*). The tick's worktree is cut from the tip,
 * so a file the shared disk holds and the tip does not is work the woken tick
 * cannot route: it would run, be handed none of it, file nothing, and be
 * woken by the same file again.
 *
 * The pair below is one fixture read twice — an operator's finding on the
 * shared disk alone, then one landed on the tip. Both legs are asserted each
 * time, because the claim is that they agree: the render a tick in the
 * primary checkout gets is what proves the uncommitted file was really there
 * to have woken something.
 */
it("an inbox record the tip does not hold wakes no slice", () => {
  commit({ "src/a.ts": "export const a = 1;\n" }, "build: a");
  writeState();
  const rel = "inbox/2026-09-25-uncommitted.md";
  const path = writeRecord(rel, "# A finding\n\nDropped into the checkout.\n");
  const built = windows();

  // Non-vacuity: the file is really on the shared disk — a tick whose tree
  // *is* the primary checkout renders it — and the tip really does not hold
  // it, so the verdicts below are that one fact and not an empty queue.
  expect({
    onDisk: existsSync(path),
    onTip: tipHolds(rel),
    rendered: built[INBOX_PHASE]
      .args({ cwd: repo, flumeDir: stateRoot() })
      .RECORDS!.includes(path),
  }).toEqual({ onDisk: true, onTip: false, rendered: true });

  // And no window opens over it. Every slice, because the cursors sit at HEAD
  // and the rotation is closed: the record is the only unrouted thing in the
  // tree, so a slice that woke here woke on it.
  expect(
    Object.fromEntries(
      Object.entries(built).map(([name, window]) => [
        name,
        window.live({ flumeDir: stateRoot(), pickable: false }),
      ]),
    ),
  ).toEqual({
    [INBOX_PHASE]: false,
    "plan-derive": false,
    "plan-sweep": false,
  });
});

it("a record the tip holds wakes the inbox slice", () => {
  commit({ "src/a.ts": "export const a = 1;\n" }, "build: a");
  writeState();
  const rel = "inbox/2026-09-25-a-finding.md";

  // Vacuity: the tip carries no record yet, so the window is shut and the
  // commit below is the only thing that opens it.
  const beforeCommit = windows()[INBOX_PHASE].live({
    flumeDir: stateRoot(),
    pickable: false,
  });
  const path = commitRecord(rel, "# A finding\n\nObserved.\n");

  expect({
    beforeCommit,
    onTip: tipHolds(rel),
    live: windows()[INBOX_PHASE].live({
      flumeDir: stateRoot(),
      pickable: false,
    }),
    // ... and the tick it wakes is handed the record itself, which is the
    // whole point of waking it.
    rendered: windows()
      [INBOX_PHASE].args({ cwd: repo, flumeDir: stateRoot() })
      .RECORDS!.includes(path),
  }).toEqual({ beforeCommit: false, onTip: true, live: true, rendered: true });
});

/**
 * A claim covers the entry's records (`spec/pending.md`, *A claim covers the
 * entry's records*): while a build tick carries an entry, the note and the
 * park under that entry's tag are the tick's, so the drain's window does not
 * show them and the drain is never woken by them.
 *
 * Both legs are asserted, because the withholding is one listing with two
 * readers: a slice woken over a file its prompt then renders as absent is the
 * loop this window's own doc refuses.
 */
it("the inbox window withholds a record whose entry another tick holds a claim on", () => {
  commit({ "src/a.ts": "export const a = 1;\n" }, "build: a");
  writeState();
  const inbox = windows()[INBOX_PHASE];

  const note = writeRecord(
    "plan/notes/HELD-ENTRY.md",
    "# Held\n\nThe note the build tick is still writing.\n",
  );
  // Both, in one commit: the wake reads the tip, so a fixture that left
  // either on the shared disk alone would assert the withholding over a
  // window nothing opened.
  const park = commitRecord(
    "plan/notes/parked/HELD-ENTRY.md",
    "# Parked\n\nThe park the build tick is still rewriting.\n",
  );

  // Vacuity: with no claim standing, both files are the drain's material and
  // the leg is live over them — so the withheld arm below is the claim's
  // verdict, not an empty record queue.
  const unclaimed = inbox.live({ flumeDir: stateRoot(), pickable: false });
  const rendered = inbox.args({ cwd: repo, flumeDir: stateRoot() }).RECORDS!;
  expect({ unclaimed, note: rendered.includes(note), park: rendered.includes(park) })
    .toEqual({ unclaimed: true, note: true, park: true });

  const claimed = ["HELD-ENTRY"];
  const withheld = inbox.args({
    cwd: repo,
    flumeDir: stateRoot(),
    claimed,
  }).RECORDS!;

  expect({
    // Neither file reaches the drain's window ...
    note: withheld.includes(note),
    park: withheld.includes(park),
    block: withheld,
    // ... nor wakes the slice over material it would be shown none of ...
    live: inbox.live({ flumeDir: stateRoot(), pickable: false, claimed }),
    // ... and both are still on disk for the listing after the claim lifts.
    noteOnDisk: existsSync(note),
    parkOnDisk: existsSync(park),
  }).toEqual({
    note: false,
    park: false,
    block: "(no records)",
    live: false,
    noteOnDisk: true,
    parkOnDisk: true,
  });
});

/**
 * The withholding is keyed to the claimed tag, never to the directory: a
 * sibling note in the same queue, and an operator's finding in the inbox
 * beside it, are the drain's material while one entry is in flight.
 */
it("the inbox window renders a record whose entry no tick has claimed", () => {
  commit({ "src/a.ts": "export const a = 1;\n" }, "build: a");
  writeState();
  const inbox = windows()[INBOX_PHASE];

  const held = writeRecord("plan/notes/HELD-ENTRY.md", "# Held\n\nIn flight.\n");
  const free = writeRecord("plan/notes/FREE-ENTRY.md", "# Free\n\nDrainable.\n");
  const finding = commitRecord(
    "inbox/2026-09-16-a-finding.md",
    "# A finding\n\nObserved.\n",
  );

  // Non-vacuity: three records are on disk and exactly one of them is the
  // claimed entry's, so the two assertions below are over a populated queue.
  expect([held, free, finding].filter((f) => existsSync(f))).toHaveLength(3);

  const claimed = ["HELD-ENTRY"];
  const rendered = inbox.args({
    cwd: repo,
    flumeDir: stateRoot(),
    claimed,
  }).RECORDS!;

  expect({
    free: rendered.includes(free),
    finding: rendered.includes(finding),
    body: rendered.includes("Drainable."),
    live: inbox.live({ flumeDir: stateRoot(), pickable: false, claimed }),
  }).toEqual({ free: true, finding: true, body: true, live: true });
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

  commitRecord("inbox/2026-09-16-a-finding.md", "# A finding\n\nObserved.\n");
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
 * The record queues are read from the **tick's own tree**, and the friction
 * channel from the shared state root (`spec/pending.md`, *Dispatch reads come
 * from the tip, not the tree*).
 *
 * A record leaves the queue by `git rm` in the drain's own commit, so a
 * record the primary checkout holds and the drain's worktree base does not —
 * an operator's finding still uncommitted, a note that landed after the
 * worktree was cut — is one the drain cannot remove, and routing it walls the
 * same records into the window every tick. The friction channel is the
 * converse: gitignored, so no checkout carries it and the shared root is the
 * only place it exists.
 *
 * **The tree is a real `git worktree`**, cut from the commit under test
 * exactly as the dispatcher provisions one — the checkout is git's, and what
 * the window reads is whatever git put there
 * (`.claude/rules/engineering.md`, *A seam gate reads what the real writer
 * wrote*).
 */
it("the inbox window renders no record its tick's own tree does not hold", () => {
  const carriedRel = "inbox/2026-09-16-carried.md";
  commit(
    {
      "src/a.ts": "export const a = 1;\n",
      [`${STATE_ROOT_REL}/${carriedRel}`]:
        "# Carried\n\nThe finding the committed tree holds.\n",
    },
    "inbox: a finding the tree carries",
  );
  writeState();

  // The tick's own tree, cut from that commit.
  const tree = join(stateRoot(), "worktrees", "tick");
  git("worktree", "add", "--detach", "-q", tree, "HEAD");

  const sharedCarried = join(stateRoot(), ...carriedRel.split("/"));
  const treeCarried = join(tree, STATE_ROOT_REL, ...carriedRel.split("/"));

  // On the shared disk alone: a finding nobody committed, and the engine's
  // own revert note in the channel git never carries.
  const uncommitted = writeRecord(
    "inbox/2026-09-25-uncommitted.md",
    "# Uncommitted\n\nDropped into the primary checkout.\n",
  );
  const note = writeFriction("revert-note-a54de89.md", "# Reverted\n");

  const inbox = (): PlanSliceWindow =>
    windows({ friction: FRICTION_DIR })[INBOX_PHASE];
  const shared = inbox().args({ cwd: repo, flumeDir: stateRoot() }).RECORDS!;
  const rendered = inbox().args({ cwd: tree, flumeDir: stateRoot() }).RECORDS!;

  expect({
    // Non-vacuity, on both roots: the shared disk really holds both records —
    // a tick whose tree *is* the primary checkout is handed them — and the
    // worktree really holds the committed one, so neither arm below is over
    // an empty queue.
    sharedUncommitted: shared.includes(uncommitted),
    sharedCarried: shared.includes(sharedCarried),
    treeCarried: rendered.includes(treeCarried),
    treeCarriedBody: rendered.includes("The finding the committed tree holds."),
    // The record the drain's commit could not remove is not in its window ...
    treeUncommitted: rendered.includes(uncommitted),
    // ... nor is the primary checkout's copy of the one it can, which is what
    // says the listing was drawn from the tree and not filtered on the shared
    // root.
    treeSharedPath: rendered.includes(sharedCarried),
    // ... while the gitignored channel is read from the shared root as
    // before, because no checkout carries a copy of it to read.
    treeFriction: rendered.includes(note),
  }).toEqual({
    sharedUncommitted: true,
    sharedCarried: true,
    treeCarried: true,
    treeCarriedBody: true,
    treeUncommitted: false,
    treeSharedPath: false,
    treeFriction: true,
  });
});

/**
 * The wake's record leg fails open — a tip it could not list wakes the drain
 * rather than skipping it (`recordsPending`, `harness/records.ts`) — and the
 * render reads the tick's own checkout, which is a different tree. So the
 * checkout render cannot be that arm's bound: it lists happily while the tip
 * does not, and the tick the failure woke would be handed a block reading as
 * a drained queue, every tick, forever.
 *
 * The unreadable tip here is an **unborn HEAD**, which is the shape a real
 * one takes: `ls-tree HEAD` exits 128 in a repository with no commit yet, and
 * the record sitting on the shared disk is one the checkout lists without
 * trouble. Committing it is the control — the same window, the same disk, the
 * one fact flipped — so the refusal below is the tip's doing and not this
 * fixture's (`.claude/rules/engineering.md`, *Loud or nothing*).
 */
it("a tip record listing the wake could not read reaches the inbox slice as a rendered refusal", () => {
  const rel = "inbox/2026-09-25-a-finding.md";
  const path = writeRecord(rel, "# A finding\n\nLeft for the drain.\n");
  const ctx = { cwd: repo, flumeDir: stateRoot() };
  const inbox = (): PlanSliceWindow => windows()[INBOX_PHASE];

  // git's own sentence about the listing the wake makes, read rather than
  // written by hand, so the assertion is that git's text reached the refusal.
  let said = "";
  try {
    git("ls-tree", "--name-only", "-z", "HEAD", "--", `${STATE_ROOT_REL}/inbox/`);
  } catch (err) {
    said = err instanceof Error ? err.message : String(err);
  }
  const fatal =
    said.split("\n").find((line) => line.startsWith("fatal:")) ?? "";
  // Vacuity guard: a tip git listed happily would leave every assertion below
  // standing over a wake that never failed open.
  expect(fatal).not.toBe("");

  const unborn = inbox();
  const window = unborn.args(ctx).RECORDS!;

  expect({
    // The arm under test: the wake reports live over the listing it could not
    // make ...
    live: unborn.live({ flumeDir: stateRoot(), pickable: false }),
    // ... and the tick it woke is handed the refusal, in the shape an
    // unreadable cursor range already renders, carrying git's own text.
    refused: window.includes("REFUSE:"),
    saidWhatFailed: window.includes(fatal),
    stoodDown: window.includes("Route nothing and delete no record this tick"),
    // Nothing of the checkout's own queue past the refusal: the record the
    // shared disk holds is exactly what a block rendered over an unread tip
    // would show, and showing it is the tick acting on a listing that failed.
    leaked: window.includes(path),
  }).toEqual({
    live: true,
    refused: true,
    saidWhatFailed: true,
    stoodDown: true,
    leaked: false,
  });

  // The control: the one fact flipped. The tip now holds the same record, the
  // same window renders it, and no refusal is in it.
  git("add", "-A");
  git("commit", "-q", "-m", "inbox: a finding");
  expect(tipHolds(rel)).toBe(true);
  const listed = inbox().args(ctx).RECORDS!;
  expect(listed).toContain(path);
  expect(listed).toContain("Left for the drain.");
  expect(listed).not.toContain("REFUSE:");
});

/**
 * The record block reads two trees, and the tip listing above is no bound on
 * the second one: a tip that lists happily says nothing about a record
 * directory obstructed in the worktree the tick was provisioned in. Unbounded,
 * that read leaves the window as a throw — which the engine does catch, into a
 * `render-refused` record whose readers are this slice's own next tick, so the
 * tick that was woken to route the queue is lost and no drain is ever told
 * (`windowRefusal`, `harness/sliceWindow.ts`).
 *
 * Denied structurally — a plain file where the checkout's inbox queue belongs
 * — because that denies on every host where a permission bit denies on one of
 * them (`.claude/rules/platform-facts.md`, *`chmod` denies nothing on win32*).
 * The tip carries a real record throughout, so the listing the window makes
 * first is over a populated queue and the refusal is the checkout's doing.
 */
it("the inbox window refuses when the checkout's record queue cannot be listed", () => {
  const rel = "plan/notes/A-NOTE.md";
  commitRecord(rel, "# A note\n\nLeft for the drain.\n");
  expect(tipHolds(rel)).toBe(true);

  const tree = join(stateRoot(), "worktrees", "tick");
  git("worktree", "add", "--detach", "-q", tree, "HEAD");
  const ctx = { cwd: tree, flumeDir: stateRoot() };
  const inbox = (): PlanSliceWindow => windows()[INBOX_PHASE];
  const treeRoot = join(tree, STATE_ROOT_REL);
  const obstruction = join(treeRoot, "inbox");

  // The window's own reader over the window's own tree, so what the refusal
  // carries is the text the failing read produced rather than a sentence
  // written by hand here (`.claude/rules/engineering.md`, *A seam gate reads
  // what the real writer wrote*).
  const checkout = (): ReturnType<typeof listRecords> =>
    listRecords(checkoutRecords(treeRoot));

  // Vacuity: the checkout lists the committed record before the obstruction
  // stands, so there is a queue for the refusal to be withholding.
  const before = checkout();
  expect("files" in before ? [...before.files] : []).toEqual([
    join(treeRoot, "plan", "notes", "A-NOTE.md"),
  ]);

  writeFileSync(obstruction, "not a directory\n");
  const failed = checkout();
  const said = "failure" in failed ? failed.failure : "";
  // Vacuity: a checkout that listed happily would leave every assertion below
  // standing over a read that never failed.
  expect(said).not.toBe("");

  const window = inbox().args(ctx).RECORDS!;
  expect({
    refused: window.includes("REFUSE:"),
    saidWhatFailed: window.includes(said),
    stoodDown: window.includes("Route nothing and delete no record this tick"),
    // Nothing of the queue past the refusal: the note this checkout does hold
    // is exactly what a block rendered over an unread queue would show, and
    // showing it is the tick acting on a listing that failed.
    leaked: window.includes("Left for the drain."),
  }).toEqual({
    refused: true,
    saidWhatFailed: true,
    stoodDown: true,
    leaked: false,
  });

  // The control: the one fact flipped — the obstruction replaced by the
  // directory it was standing in the way of.
  rmSync(obstruction);
  mkdirSync(obstruction);
  const listed = inbox().args(ctx).RECORDS!;
  expect(listed).toContain("Left for the drain.");
  expect(listed).not.toContain("REFUSE:");
});

/**
 * The same defect one reader further in: both listings succeed, and the bytes
 * of a record they named do not come back. A tick handed the queue without it
 * would route what it could read and delete what it routed, leaving the
 * unreadable record standing with nothing said about it.
 *
 * Denied structurally again — a **directory** carrying the record extension,
 * which every listing names as a record and no host will hand back as bytes
 * (`.claude/rules/platform-facts.md`, *`chmod` denies nothing on win32*).
 */
it("the inbox window refuses when a listed record cannot be read", () => {
  commitRecord(
    "inbox/2026-09-25-a-finding.md",
    "# A finding\n\nLeft for the drain.\n",
  );
  const tree = join(stateRoot(), "worktrees", "tick");
  git("worktree", "add", "--detach", "-q", tree, "HEAD");
  const ctx = { cwd: tree, flumeDir: stateRoot() };
  const inbox = (): PlanSliceWindow => windows()[INBOX_PHASE];
  const treeRoot = join(tree, STATE_ROOT_REL);
  const unreadable = join(treeRoot, "plan", "notes", "A-NOTE.md");
  mkdirSync(unreadable, { recursive: true });

  // Vacuity: the checkout's listing really names it, so what refuses below is
  // the read and not a listing that skipped its subject.
  const listing = listRecords(checkoutRecords(treeRoot));
  expect("files" in listing ? [...listing.files] : []).toContain(unreadable);

  // The read the render makes, at the spelling it makes it at, so the refusal
  // is asserted to carry the failing reader's own words.
  let said = "";
  try {
    readFileSync(namespacedJoin(unreadable));
  } catch (err) {
    said = err instanceof Error ? err.message : String(err);
  }
  expect(said).not.toBe("");

  const window = inbox().args(ctx).RECORDS!;
  expect({
    refused: window.includes("REFUSE:"),
    saidWhatFailed: window.includes(said),
    stoodDown: window.includes("Route nothing and delete no record this tick"),
    // The record read before the failing one is not rendered either: a block
    // half-composed over a queue that would not read is the drain routing
    // what it happened to reach.
    leaked: window.includes("Left for the drain."),
  }).toEqual({
    refused: true,
    saidWhatFailed: true,
    stoodDown: true,
    leaked: false,
  });

  // The control: the one fact flipped — the same listed path, now a record
  // with bytes in it.
  rmSync(unreadable, { recursive: true });
  writeFileSync(unreadable, "# A note\n\nThe note the drain can read.\n");
  const listed = inbox().args(ctx).RECORDS!;
  expect(listed).toContain("The note the drain can read.");
  expect(listed).toContain("Left for the drain.");
  expect(listed).not.toContain("REFUSE:");
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
 * asked on the **two surfaces** that carry it, by one reader: this window.
 * It is consulted at `shouldRun` off a `TickContext`, and again off the
 * window the default handoff builds from the `TickResult` that follows, and
 * both real paths run here. No table is restated by the test, and none is
 * restated by the handoff either.
 *
 * One reader is the property under test. The handoff used to answer this for
 * itself — first from the tick's own `noCommit` and `entries[].mergeOutcome`,
 * then from a second call to the same classifier behind a build-phase guard —
 * so the two surfaces agreed only while a hand kept them in step. Handed the
 * queue and the store on its window, the agreement is structural: the only
 * way the inbox wakes on one surface and not the other is a fact the handoff
 * failed to carry, which is what the equality below is about.
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

  // The real windows, so the handoff's side of this agreement is the very
  // window the `shouldRun` side asks — the only thing left between them is
  // whether the handoff hands it the pair it reads.
  const handoff = defaultHandoff(
    planSliceWindows({
      declaration: declaration(),
      repoRoot: repo,
      stateRootRel: STATE_ROOT_REL,
    }),
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
  ).toEqual(["clean-exit", "not-shipped"]);
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

it("a standing render-refused prior-attempt record leaves the inbox window shut", () => {
  commit({ "src/a.ts": "export const a = 1;\n" }, "build: a");
  writeState();
  const inbox = windows()[INBOX_PHASE];

  const tag = "HARNESS-RENDER-REFUSED";
  const pending = [entry(tag)];
  // A prompt whose spans and hooks did not resolve: no agent ran, so nothing
  // was decided about the entry and no producer was asked for anything. The
  // section's enumeration of what a producer resolves does not name it
  // (`spec/harness.md`, *The default `handoff`*), and the drain woken over one
  // would have nothing to file — while the entry is handed to the next build
  // wave regardless, because the per-entry refusal reads the same table.
  const refused = record(tag, "render-refused");

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
    // queue still carries, so `false` below is the mode's doing.
    keyedToLiveEntry:
      refused.key === "entry" && slugify(pending[0]!.tag) === refused.keyedAs,
    renderRefused: live(refused),
    // Control: the same fixture with the one mode changed opens the window.
    parked: live(record(tag, "not-shipped")),
  }).toEqual({
    noRecords: false,
    keyedToLiveEntry: true,
    renderRefused: false,
    parked: true,
  });
});

/**
 * The same question — "is this standing record a refusal a producer resolves"
 * — asked on the **two surfaces that act on it**: the window that wakes the
 * drain (`inboxWindow.ts`), and the per-entry refusal that holds the entry
 * back from the next build wave until that drain answers
 * (`defaultRefusesEntry`, `harness/handoff.ts`).
 *
 * Both real readers run here over one record per mode, and **neither calls the
 * other** — which is what the file's sibling agreement case above cannot say,
 * since the handoff it compares the window against is handed that very window.
 * The only thing that can make these two answer alike over the engine's whole
 * roster is the one table they share (`harness/standingRefusal.ts`). They were
 * two tables that disagreed on `render-refused`: one record woke the drain with
 * nothing to file and was handed straight back to the wave that produced it.
 */
it("the inbox window and the per-entry build refusal agree on every prior-attempt mode", () => {
  commit({ "src/a.ts": "export const a = 1;\n" }, "build: a");
  writeState();
  const inbox = windows()[INBOX_PHASE];

  const queued = entry("HARNESS-BOTH-SURFACES");
  const pending = [queued];

  /**
   * One standing record of `mode`, keyed as the engine keys one and stamped
   * with the declaration the queue now carries — the key the refusal compares,
   * read off the engine's own derivation rather than spelled here.
   */
  const standing = (mode: PriorAttemptMode): PriorAttempt => ({
    ...record(queued.tag, mode),
    declaredAs: entryDeclaredKey(queued),
  });

  /** Whether the real inbox window opens over that one record. */
  const wakesTheDrain = (rec: PriorAttempt): boolean =>
    inbox.live({
      flumeDir: stateRoot(),
      pickable: true,
      pending,
      priorAttempts: new Map([[`${rec.key}:${rec.keyedAs}`, rec]]),
    });

  // The real refusal, bound over the state root the chain factory binds it
  // over, against the context the engine composes at selection
  // (`bindEntryRefusal`, `src/selection.ts`).
  const refuses = defaultRefusesEntry(STATE_ROOT_REL);
  const wallsTheEntry = (rec: PriorAttempt): boolean => {
    const ctx: EntryRefusalContext = {
      entry: queued,
      priorAttempt: rec,
      headSha: "0".repeat(40),
      declaredAs: entryDeclaredKey(queued),
    };
    return refuses(ctx);
  };

  const verdicts = PRIOR_ATTEMPT_MODES.map((mode) => {
    const rec = standing(mode);
    return { mode, drain: wakesTheDrain(rec), wall: wallsTheEntry(rec) };
  });

  // Vacuity: every mode the engine mints is judged, the fixture's records
  // really do reach both legs — entry-keyed to a tag the queue carries, and
  // standing against the declaration the refusal compares — and both verdicts
  // occur on both sides, since an agreement over one constant answer proves
  // nothing.
  const sample = standing("clean-exit");
  expect(verdicts.length).toBe(PRIOR_ATTEMPT_MODES.length);
  expect(verdicts.length).toBeGreaterThan(0);
  expect(sample.keyedAs).toBe(slugify(queued.tag));
  expect(sample.declaredAs).toBe(entryDeclaredKey(queued));
  expect(inbox.live({ flumeDir: stateRoot(), pickable: true })).toBe(false);
  expect(verdicts.some((v) => v.drain)).toBe(true);
  expect(verdicts.some((v) => !v.drain)).toBe(true);
  expect(verdicts.some((v) => v.wall)).toBe(true);
  expect(verdicts.some((v) => !v.wall)).toBe(true);

  expect(verdicts.map((v) => [v.mode, v.drain])).toEqual(
    verdicts.map((v) => [v.mode, v.wall]),
  );

  // And the set the two share is the section's own enumeration, rather than
  // whatever pair happens to agree (`spec/harness.md`, *The default
  // `handoff`*).
  expect(
    verdicts
      .filter((v) => v.wall)
      .map((v) => v.mode)
      .sort(),
  ).toEqual(["clean-exit", "not-shipped"]);
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

it("a plan window over a tree git cannot read refuses as unreadable rather than as a cursor to repair", () => {
  // The cursor is this repository's own tip, so it is correct: the only thing
  // wrong below is the tree the window is drawn in. Pre-fix the cursor probe
  // folded git's "I cannot read this tree" into its "no such commit" answer,
  // and the tick was handed a refusal telling it to rewrite that correct sha.
  const base = commit({ "spec/loop.md": "# Loop\n" }, "spec: the loop");
  writeState({ derivedThrough: base, sweptThrough: base });
  // Material for both windows past that cursor: one path in the spec locus
  // the derive window reads, one in the sweep domain.
  commit(
    { "spec/chain.md": "# Chain\n", "src/thing.ts": "export const x = 1;\n" },
    "spec: the chain",
  );

  const notATree = mkTempDirSync("flume-windows-unreadable-");

  // git's own sentence about that directory, read rather than written by
  // hand, so the assertion is that git's text reached the refusal.
  let said = "";
  try {
    gitOutSync(notATree, ["rev-parse", "--verify", "-q", `${base}^{commit}`]);
  } catch (err) {
    said = err instanceof Error ? err.message : String(err);
  }
  const fatal =
    said.split("\n").find((line) => line.startsWith("fatal:")) ?? "";
  // Vacuity guard: a directory git read happily would leave every assertion
  // below standing over a window that never failed.
  expect(fatal).not.toBe("");

  try {
    const built = windows();
    const legs = [
      ["derivedThrough", "plan-derive", "SPEC_WINDOW", "spec: the chain"],
      ["sweptThrough", "plan-sweep", "SWEEP_WINDOW", "src/thing.ts"],
    ] as const;

    for (const [field, slice, arg, material] of legs) {
      // The control: the same cursor in the tree it was stamped in renders
      // the window's material, so the refusal below is the tree's doing and
      // not a cursor this fixture got wrong.
      const readable = built[slice].args({
        cwd: repo,
        flumeDir: stateRoot(),
      })[arg];
      expect(readable).toContain(material);
      expect(readable).not.toContain("REFUSE");

      const window = built[slice].args({
        cwd: notATree,
        flumeDir: stateRoot(),
      })[arg];
      expect(window).toContain("REFUSE");
      expect(window).toContain(`\`${field}\` window could not be read`);
      // git's own text, carried whole rather than classified.
      expect(window).toContain(fatal);
      // And the bound the unreadable refusal names: the cursor is untouched,
      // so the same range re-opens next tick.
      expect(window).toContain(
        "is untouched, so the window re-opens over the same range next tick",
      );
      // The arm this case exists to separate: the cursor-repair refusal,
      // whose cause clause is the one a correct cursor must never draw. Read
      // against that clause rather than against the whole render, so an
      // unrelated sentence elsewhere in the window cannot answer it.
      // `toContain` above has already refused an absent render, so the
      // fold to a string here cannot be hiding one.
      const text = String(window);
      const cause = text.slice(0, text.indexOf(", so this window"));
      expect(cause).not.toContain("does not resolve to a commit");
    }
  } finally {
    rmSync(notATree, { recursive: true, force: true });
  }
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

it("the sweep window carries the frontier paths, the posture pages the range touched, and the spec lines the window retired", () => {
  const base = commit(
    { "src/a.ts": "export const a = 1;\n", "spec/loop.md": "# Loop\n\nA ratified claim.\n" },
    "build: a",
  );
  writeState();

  commit({ "src/a.ts": "export const a = 2;\n" }, "build: bump a");
  commit({ "rules/posture.md": "# Posture\n\nA phrase.\n" }, "rules: a posture page");
  commit({ "spec/loop.md": "# Loop\n" }, "spec: retire the claim");
  commit({ "elsewhere/x.md": "untouched by the sweep\n" }, "chore: elsewhere");

  const rendered = windows()["plan-sweep"].args({
    cwd: repo,
    flumeDir: stateRoot(),
  }).SWEEP_WINDOW;

  // Two commits touched the frontier, and between them one domain path: the
  // header counts the commits, the listing names the paths.
  expect(rendered).toContain(
    `=== 1 sweep-domain path(s) touched since ${base}, by 2 commit(s) ===`,
  );
  // Exactly the domain path: nothing of the fixture's out-of-domain file,
  // nothing of the spec file, and no commit subject — the block is the
  // union, whole.
  expect(frontierPaths(rendered)).toEqual(["src/a.ts"]);
  // The posture page is its own fact rather than one more frontier path: it
  // is the phrase delta, which arms every domain module at once.
  expect(posturePageHits(rendered)).toEqual(["rules/posture.md"]);
  expect(rendered).toContain("(retired-claim delta)");
  expect(retiredDelta(rendered)).toContain("-A ratified claim.");
});

/**
 * The frontier is a set, and a long rotation is where that matters: six
 * hundred commits over two hundred paths, rendered once per commit, is the
 * same listing paid for many times over on every tick of the rotation — for
 * subjects and shas no sweep tick reads (`.claude/rules/posture-sweep.md`,
 * *The frontier is decidable; the neighborhood is judged*).
 */
it("the sweep window names each frontier path once across the range, never once per commit that touched it", () => {
  const base = commit({ "src/a.ts": "export const a = 1;\n" }, "build: a");
  writeState();

  // One path touched by four commits past the cursor, beside a second path
  // touched once — so the listing is a union and not a deduplicated singleton.
  for (const n of [2, 3, 4, 5]) {
    commit({ "src/a.ts": `export const a = ${n};\n` }, `build: bump a to ${n}`);
  }
  commit({ "src/b.ts": "export const b = 1;\n" }, "build: b");

  const rendered = windows()["plan-sweep"].args({
    cwd: repo,
    flumeDir: stateRoot(),
  }).SWEEP_WINDOW;

  // Five commits, two paths: the count of commits is a fact the header
  // carries, never the height of the listing under it.
  expect(rendered).toContain(
    `=== 2 sweep-domain path(s) touched since ${base}, by 5 commit(s) ===`,
  );
  expect(frontierPaths(rendered)).toEqual(["src/a.ts", "src/b.ts"]);
});

/**
 * A merge commit on the checked-out branch: `files` committed on a branch off
 * `base`, merged back with `--no-ff`, and `resolved` — when given — written
 * into the merge's own tree before it commits.
 *
 * Writing into the merge itself is the only way a path can differ from
 * *every* parent, which is the one thing git's default merge listing does not
 * report and the two cases below are about. Disjoint files across the two
 * legs, so the merge that resolves nothing really resolves nothing rather
 * than being a conflict the fixture happened to settle.
 */
function mergeBranch(
  name: string,
  base: string,
  files: Record<string, string>,
  resolved: Record<string, string> = {},
): string {
  const trunk = git("rev-parse", "--abbrev-ref", "HEAD").trim();
  git("checkout", "-q", "-b", name, base);
  commit(files, `build: ${name}`);
  git("checkout", "-q", trunk);
  git("merge", "-q", "--no-ff", "--no-commit", name);
  return commit(resolved, `Merge ${name} into ${trunk}`);
}

/** One git listing's own lines, blanks dropped. */
const gitLines = (...args: string[]): string[] =>
  git(...args)
    .split("\n")
    .filter((line) => line.length > 0);

/**
 * A merge resolution is a change to the tree like any other, and the only
 * commit that carries it is the merge. git's default `--name-only` listing
 * for a merge is empty, so that change is the one edit a scan reading the
 * default would attribute to no commit at all — in no frontier, arming no
 * rotation (`.claude/rules/posture-sweep.md`, *The frontier is decidable; the
 * neighborhood is judged*).
 */
it("the frontier lists a path a merge commit changed in neither parent", () => {
  const base = commit(
    {
      "src/a.ts": "export const a = 1;\n",
      "src/resolved.ts": "export const r = 1;\n",
    },
    "build: a",
  );
  commit({ "src/trunk.ts": "export const t = 1;\n" }, "build: on the trunk");
  const merge = mergeBranch(
    "branch",
    base,
    { "src/branch.ts": "export const b = 1;\n" },
    { "src/resolved.ts": "export const r = 2;\n" },
  );
  writeState({ sweptThrough: base });

  // The arm this case is about, asserted off git rather than assumed: the
  // merge's tree differs from both its parents on `src/resolved.ts`, and no
  // commit in either parent's own history past the cursor named it.
  for (const parent of [`${merge}^1`, `${merge}^2`]) {
    expect(gitLines("diff", "--name-only", parent, merge)).toContain(
      "src/resolved.ts",
    );
    expect(
      gitLines("log", "--format=", "--name-only", `${base}..${parent}`),
    ).not.toContain("src/resolved.ts");
  }

  const rendered = windows()["plan-sweep"].args({
    cwd: repo,
    flumeDir: stateRoot(),
  }).SWEEP_WINDOW;

  // Three commits past the cursor, and all three touched the frontier: the
  // merge counts as a toucher exactly because it resolved a domain path.
  expect(rendered).toContain(
    `=== 3 sweep-domain path(s) touched since ${base}, by 3 commit(s) ===`,
  );
  expect(frontierPaths(rendered)).toEqual([
    "src/branch.ts",
    "src/resolved.ts",
    "src/trunk.ts",
  ]);
});

/**
 * The converse, and the reason the merge listing can be read at all: what a
 * merge's own tree resolved is a set that is usually empty, so reading it
 * costs an ordinary merge nothing and never credits a merge with the paths
 * its parents already carried.
 */
it("a merge commit that resolved nothing adds no path to the frontier", () => {
  const base = commit({ "src/a.ts": "export const a = 1;\n" }, "build: a");
  commit({ "src/trunk.ts": "export const t = 1;\n" }, "build: on the trunk");
  const merge = mergeBranch("branch", base, {
    "src/branch.ts": "export const b = 1;\n",
  });
  writeState({ sweptThrough: base });

  // Vacuity guard: the range really does carry a merge, so the claim below is
  // about a merge and not about a range that never had one.
  expect(gitLines("rev-list", "--merges", `${base}..HEAD`)).toEqual([merge]);

  const rendered = windows()["plan-sweep"].args({
    cwd: repo,
    flumeDir: stateRoot(),
  }).SWEEP_WINDOW;

  // Three commits past the cursor, two of them touchers: the merge brought
  // both legs' paths into the tree without changing either, so it contributes
  // no path and is not counted as having touched the frontier.
  expect(rendered).toContain(
    `=== 2 sweep-domain path(s) touched since ${base}, by 2 commit(s) ===`,
  );
  expect(frontierPaths(rendered)).toEqual(["src/branch.ts", "src/trunk.ts"]);
});

/**
 * The lines of one block of a rendered sweep window — the block whose `===`
 * header `marker` names, up to the blank line that ends it.
 *
 * Every block the window renders has that shape, so one cut serves the
 * frontier listing, the posture-page callout and the retired-claim delta
 * rather than three that must agree (`.claude/rules/engineering.md`, *A
 * module is one job*). A deleted blank line arrives as a bare `-`, never as
 * `""`, so the first empty line really is the block's end.
 *
 * Cases assert against a block rather than against the whole render, which
 * carries two other blocks and a tip line this one has no say over
 * (`.claude/rules/posture-sweep.md`, *A violation counts only when verified
 * on disk this tick*).
 */
function blockUnder(rendered: string | undefined, marker: string): string[] {
  if (rendered === undefined) throw new Error("the sweep window is unrendered");
  const lines = rendered.split("\n");
  const start = lines.findIndex((line) => line.includes(marker));
  expect(start, `the window renders no block under \`${marker}\``).not.toBe(-1);
  const rest = lines.slice(start + 1);
  const end = rest.indexOf("");
  return end === -1 ? rest : rest.slice(0, end);
}

/** The frontier's own paths, cut out of a rendered sweep window. */
const frontierPaths = (rendered: string | undefined): string[] =>
  blockUnder(rendered, "sweep-domain path(s) touched since");

/** The posture pages the range touched, cut out of a rendered sweep window. */
const posturePageHits = (rendered: string | undefined): string[] =>
  blockUnder(rendered, "posture page(s) touched in the same range");

/** The retired-claim delta's own lines, cut out of a rendered sweep window. */
const retiredDelta = (rendered: string | undefined): string[] =>
  blockUnder(rendered, "(retired-claim delta)");

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

/**
 * A deleted line is a claim the tree may still assert somewhere — but which
 * claim it is, and whether it is retired at all rather than reworded a few
 * lines down, is only decidable against the page it left. A flat list costs
 * the tick a second diff over the locus to recover a fact the window already
 * read (`.claude/rules/posture-sweep.md`, *The frontier is decidable; the
 * neighborhood is judged*).
 */
it("the retired-claim delta names the locus page each deleted line left", () => {
  commit(
    {
      "src/a.ts": "export const a = 1;\n",
      "spec/loop.md": "# Loop\n\nA tick is one commit.\n",
      "spec/chain.md": "# Chain\n\nA chain declares its fence.\n",
    },
    "build: a",
  );
  writeState();

  commit({ "src/a.ts": "export const a = 2;\n" }, "build: bump a");
  commit(
    { "spec/loop.md": "# Loop\n", "spec/chain.md": "# Chain\n" },
    "spec: retire a claim from each page",
  );

  const delta = retiredDelta(
    windows()["plan-sweep"].args({ cwd: repo, flumeDir: stateRoot() })
      .SWEEP_WINDOW,
  );

  // Two pages retired a sentence each, and every line of the block sits
  // under the page it left — in the union's own order, so one range renders
  // one listing whatever order the commits touched the pages in.
  expect(delta).toEqual([
    "=== deleted from spec/chain.md ===",
    "-",
    "-A chain declares its fence.",
    "=== deleted from spec/loop.md ===",
    "-",
    "-A tick is one commit.",
  ]);
});

it("a retired-claim delta past its budget renders the pages that fit and counts the lines no page shows", () => {
  commit(
    {
      "spec/chain.md": "# Chain\n\nfirst\nsecond\nthird\n",
      "spec/loop.md": "# Loop\n\nfourth\n",
    },
    "spec: two pages",
  );
  writeState();

  commit(
    { "spec/chain.md": "# Chain\n", "spec/loop.md": "# Loop\n" },
    "spec: retire every claim",
  );

  // Five deleted lines — four sentences and the blank line above each pair —
  // against a budget of two.
  const delta = retiredDelta(
    windows({}, 2)["plan-sweep"].args({ cwd: repo, flumeDir: stateRoot() })
      .SWEEP_WINDOW,
  );

  // The budget is spent on deleted lines, so the page lead costs nothing and
  // the remainder counts every line no page above it showed — the second
  // page among them, which never got a lead of its own.
  expect(delta).toEqual([
    "=== deleted from spec/chain.md ===",
    "-",
    "-first",
    "=== 4 further deleted line(s) beyond this tick's budget; narrow the " +
      "range by closing this rotation ===",
  ]);
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
  // The page lead this window writes from the path it handed git, then
  // exactly what the commit removed — the sentence and the blank line above
  // it — and none of `diff --git`, `index`, `--- a/spec/loop.md`,
  // `+++ b/spec/loop.md` or the hunk header.
  expect(delta).toEqual([
    "=== deleted from spec/loop.md ===",
    "-",
    "-A ratified claim.",
  ]);
});

/**
 * The window's closing block: the sha the retired-claim cursor may advance
 * to, where the delta rendered whole, and the tip line under it.
 *
 * Cut out of the render rather than asserted against the whole of it, so a
 * case saying the advance sha is *absent* reads its own block instead of an
 * artifact that also quotes a frontier listing, a posture-page callout and a
 * diff (`.claude/rules/posture-sweep.md`, *Standing lenses*).
 */
function closingBlock(rendered: string | undefined): string[] {
  if (rendered === undefined) throw new Error("the sweep window is unrendered");
  const lines = rendered.split("\n");
  const last = lines.lastIndexOf("");
  expect(last, "the window renders no closing block").not.toBe(-1);
  return lines.slice(last + 1);
}

/** The advance line a window drawn to `tip` names for the retired-claim cursor. */
const advanceLine = (tip: string): string =>
  `=== the whole retired-claim delta above rendered; the tick that ` +
  `searched it advances \`retiredThrough\` to ${tip} ===`;

/**
 * A rotation stands open across many ticks, and the lines the locus retired
 * before it opened are the same lines on every one of them. Drawn past the
 * stamp alone, each tick searches the tree for claims the tick before it
 * already searched; the retired-claim cursor is what that tick leaves behind
 * (`.claude/rules/posture-sweep.md`, *The frontier is decidable; the
 * neighborhood is judged*).
 */
it("the retired-claim delta renders the lines deleted since the retired-claim cursor", () => {
  const base = commit(
    {
      "src/a.ts": "export const a = 1;\n",
      "spec/loop.md": "# Loop\n\nAn early claim.\nA later claim.\n",
    },
    "build: a",
  );

  commit({ "src/a.ts": "export const a = 2;\n" }, "build: bump a");
  const searched = commit(
    { "spec/loop.md": "# Loop\n\nA later claim.\n" },
    "spec: retire the early claim",
  );
  commit({ "spec/loop.md": "# Loop\n" }, "spec: retire the later claim");

  // The stamp stands where the rotation opened it; a prior tick of that same
  // rotation searched the locus as far as `searched`.
  writeState({ sweptThrough: base, retiredThrough: searched });

  // Vacuity pin: the stamp's own range really does carry the early claim, so
  // the narrowing below is a delta that shrank rather than one that was
  // never wide.
  expect(git("diff", `${base}..HEAD`, "--", "spec/loop.md")).toContain(
    "-An early claim.",
  );

  const rendered = windows()["plan-sweep"].args({
    cwd: repo,
    flumeDir: stateRoot(),
  }).SWEEP_WINDOW;

  expect(rendered).toContain(
    `=== lines the spec locus no longer states since ${searched} ` +
      `(retired-claim delta) ===`,
  );
  // Exactly what the locus retired past the cursor — the claim the prior
  // tick already searched for is not re-rendered for this one.
  expect(retiredDelta(rendered)).toEqual([
    "=== deleted from spec/loop.md ===",
    "-",
    "-A later claim.",
  ]);
});

/**
 * The field is optional, and absent is a state rather than a degradation: a
 * slice that has advanced it through no commit yet has searched nothing past
 * its stamp, which is what the stamp already says.
 */
it("a sweep state carrying no retired-claim cursor draws the delta from the stamp", () => {
  const base = commit(
    {
      "src/a.ts": "export const a = 1;\n",
      "spec/loop.md": "# Loop\n\nA ratified claim.\n",
    },
    "build: a",
  );
  writeState();

  commit({ "src/a.ts": "export const a = 2;\n" }, "build: bump a");
  const tip = commit({ "spec/loop.md": "# Loop\n" }, "spec: retire the claim");

  // Vacuity pin: the state the window reads really carries no retired-claim
  // cursor, so the fallback below is the arm under test.
  expect(
    readPlanState(stateRoot(), "plan-sweep")?.retiredThrough,
  ).toBeUndefined();

  const rendered = windows()["plan-sweep"].args({
    cwd: repo,
    flumeDir: stateRoot(),
  }).SWEEP_WINDOW;

  expect(rendered).toContain(
    `=== lines the spec locus no longer states since ${base} ` +
      `(retired-claim delta) ===`,
  );
  expect(retiredDelta(rendered)).toContain("-A ratified claim.");
  // And the window hands that tick the sha its cursor takes, so the tick
  // after it is drawn past the claims this one searched rather than over
  // them again.
  expect(closingBlock(rendered)).toContain(advanceLine(tip));
});

/**
 * The advance is all-or-nothing on the delta rendering whole. The budget cuts
 * mid-page, so a prefix names no commit at which "the lines up to here are
 * searched" is true — and a cursor advanced over one would retire claims no
 * tick ever searched for (`.claude/rules/engineering.md`, *Loud or nothing*).
 */
it("a retired-claim delta cut by the tick's budget names no cursor advance sha", () => {
  commit({ "spec/chain.md": "# Chain\n\nfirst\nsecond\nthird\n" }, "spec: a page");
  writeState();
  const tip = commit(
    { "spec/chain.md": "# Chain\n" },
    "spec: retire every claim",
  );

  const ctx = { cwd: repo, flumeDir: stateRoot() };

  // The control: the same window with room for every deleted line names the
  // sha, so the absence below is the budget's doing rather than a render that
  // never names one.
  const whole = windows({}, 40)["plan-sweep"].args(ctx).SWEEP_WINDOW;
  expect(retiredDelta(whole)).toEqual([
    "=== deleted from spec/chain.md ===",
    "-",
    "-first",
    "-second",
    "-third",
  ]);
  expect(closingBlock(whole)).toContain(advanceLine(tip));

  const cut = windows({}, 2)["plan-sweep"].args(ctx).SWEEP_WINDOW;
  // Vacuity pin: the delta really was cut, and by two of its four lines.
  expect(retiredDelta(cut)).toEqual([
    "=== deleted from spec/chain.md ===",
    "-",
    "-first",
    "=== 2 further deleted line(s) beyond this tick's budget; narrow the " +
      "range by closing this rotation ===",
  ]);
  // The closing block rendered, and carries the tip line alone: no sha the
  // prefix's own reader could advance the cursor to.
  expect(closingBlock(cut)).toEqual([
    `=== this window was drawn from tip ${tip}; the tick that closes the ` +
      `rotation stamps \`sweptThrough\` at exactly that sha ===`,
  ]);
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
    `=== 1 sweep-domain path(s) touched since ${base}, by 1 commit(s) ===`,
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
    `=== 0 sweep-domain path(s) touched since ${base}, by 0 commit(s) ===`,
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
  expect(sweep).toContain(`touched since ${cursor}`);

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
    stateRootRel: STATE_ROOT_REL,
  }).map((w) => w.name);

  const inboxOnly = planSliceWindows({
    declaration: declaration({ slices: { enabled: [INBOX_PHASE] } }),
    repoRoot: repo,
    stateRootRel: STATE_ROOT_REL,
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
    planSliceWindows({
      declaration: declaration(),
      repoRoot: repo,
      stateRootRel: STATE_ROOT_REL,
    }),
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

/**
 * Every plan slice, with the state file an unreadable-artifact case corrupts
 * and the window argument that slice's own material rides.
 *
 * Each slice reads plan state on both legs — the derive its cursor, the sweep
 * its rotation, the inbox its lanes' drained-run stamps — and the two cases
 * below assert the same pair of claims over each. A table rather than three
 * pairs of cases, because the claim is about the shape of the read and not
 * about any one slice's fields.
 */
const STATE_READING_SLICES = [
  { slice: INBOX_PHASE, key: "CI_LANES" },
  { slice: "plan-derive", key: "SPEC_WINDOW" },
  { slice: "plan-sweep", key: "SWEEP_WINDOW" },
] as const satisfies readonly { slice: PlanSlice; key: string }[];

/**
 * A declaration with one CI lane, which is what puts the inbox slice's own
 * state file on its liveness path: a consumer declaring no lanes never reads
 * the drained-run stamps at all (`harness/ciLane.ts`).
 *
 * The lane is never read from a forge in either case below — both stop at the
 * unreadable stamps, and the control arms have no failing run to compare —
 * so no case here depends on a forge CLI being present or absent.
 */
const LANED = { ci: [{ name: "lint", workflow: "ci.yml", job: "test" }] };

/** Every slice's state written by the package's own writer, all three files. */
function writeEveryState(): void {
  writeState();
  writePlanState(stateRoot(), INBOX_PHASE, { drainedRuns: {} });
}

/** `slice`'s state file, replaced with bytes no JSON parse accepts. */
function corruptState(slice: PlanSlice): string {
  const path = planStatePath(stateRoot(), slice);
  writeFileSync(namespacedJoin(path), "not json{");
  return path;
}

/**
 * A liveness predicate runs inside the handoff's wake set, and that set walks
 * every slice: one throw out of one `live` leaves no phase woken at all —
 * build included — and the engine's consult declines the tick. The slice that
 * owns the unreadable file is the one tick that could rewrite it, so the
 * throw declines exactly the repair (`.claude/rules/engineering.md`, *Loud or
 * nothing*).
 */
it("a slice whose plan state file will not parse is live so the tick that can repair it runs", () => {
  commit({ "src/a.ts": "export const a = 1;\n" }, "build: a");

  // Vacuity: every slice the package declares is armed here, so a fourth
  // slice cannot join the wake set without a case over its own state file.
  expect([...STATE_READING_SLICES].map((arm) => arm.slice).sort()).toEqual(
    [...PLAN_SLICES].sort(),
  );

  const readable: Record<string, boolean> = {};
  const unreadable: Record<string, boolean> = {};
  for (const arm of STATE_READING_SLICES) {
    // The control, with the one fact flipped: the same fixture under every
    // slice's own file written by the package's writer is shut, so what the
    // second arm reads is the corruption and not the tree.
    writeEveryState();
    const shut = windows(LANED)[arm.slice];
    readable[arm.slice] = shut.live({ flumeDir: stateRoot(), pickable: false });

    corruptState(arm.slice);
    const live = windows(LANED)[arm.slice];
    unreadable[arm.slice] = live.live({
      flumeDir: stateRoot(),
      pickable: false,
    });
  }

  expect({ readable, unreadable }).toEqual({
    readable: { [INBOX_PHASE]: false, "plan-derive": false, "plan-sweep": false },
    unreadable: { [INBOX_PHASE]: true, "plan-derive": true, "plan-sweep": true },
  });
});

/**
 * The other half of the bound: waking the slice is only honest if the tick it
 * wakes is told what could not be read. Each window renders the refusal every
 * uncomputable window spells (`windowRefusal`, `harness/sliceWindow.ts`),
 * naming the file the woken tick rewrites — never a throw out of
 * `promptArgs`, which the engine turns into a record only this slice's own
 * next tick reads.
 */
it("a slice whose plan state file will not parse renders the refusal naming the file rather than throwing", () => {
  commit({ "src/a.ts": "export const a = 1;\n" }, "build: a");

  const rendered: Record<string, string> = {};
  for (const arm of STATE_READING_SLICES) {
    writeEveryState();
    const path = corruptState(arm.slice);
    const args = windows(LANED)[arm.slice].args({
      cwd: repo,
      flumeDir: stateRoot(),
    });
    const block = args[arm.key] ?? "";
    // The block leads with the refusal, and names the file to repair — the
    // two halves a woken tick acts on. Asserted per arm rather than collected,
    // so a failure names the slice whose block was wrong.
    expect(block.startsWith("REFUSE: ")).toBe(true);
    expect(block).toContain(path);
    rendered[arm.slice] = block;
  }

  // Vacuity: every armed slice produced a block, so no arm passed on an
  // absent key that an empty string would have satisfied.
  expect(Object.keys(rendered).length).toBe(STATE_READING_SLICES.length);
});
