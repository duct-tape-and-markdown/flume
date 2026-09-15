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
 * gate reads what the real writer wrote*). The plan state is written by the
 * package's own `writePlanState`, never hand-authored, for the same reason.
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

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  defaultHandoff,
  parseDeclaration,
  planSliceWindows,
  RECORD_MAX_BYTES,
  writePlanState,
  type Declaration,
  type PlanSliceWindow,
  type PlanState,
} from "../harness/index.ts";
import {
  BUILD_PHASE,
  INBOX_PHASE,
  type PlanSlice,
} from "../harness/declaration.ts";
import type { FanoutEntryOutcome, TickResult } from "../src/Phase.ts";
import type { PendingEntry } from "../src/PendingSchema.ts";
import {
  PRIOR_ATTEMPT_MODES,
  type PriorAttempt,
  type PriorAttemptKeyspace,
  type PriorAttemptMode,
} from "../src/Prompt.ts";
import { slugify } from "../src/paths.ts";
import { SPAWN_BUDGET_MS } from "./helpers/subprocess.ts";

// This file's cases drive real git repositories, and a git spawn is a spawn
// like any other: the lane's one budget, for its cases and its hooks alike,
// declared once for the file rather than inherited from the runner
// (`SPAWN_BUDGET_MS`, `tests/helpers/subprocess.ts`).
vi.setConfig({ testTimeout: SPAWN_BUDGET_MS, hookTimeout: SPAWN_BUDGET_MS });

/** The repo every case commits into; also the state root the windows read. */
let repo: string;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "flume-windows-"));
  git("init", "-q", "-b", "main");
  git("config", "user.email", "windows@example.test");
  git("config", "user.name", "Windows Fixture");
  git("config", "commit.gpgsign", "false");
});

afterEach(() => {
  if (repo) rmSync(repo, { recursive: true, force: true });
});

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" });
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

/** The three cursor facts, varied per case off a closed rotation at HEAD. */
function planState(overrides: Partial<PlanState> = {}): PlanState {
  const head = git("rev-parse", "HEAD").trim();
  return {
    derivedThrough: head,
    sweptThrough: head,
    rotation: { kind: "closed" },
    ...overrides,
  };
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

it("the derive window is live exactly while commits past the derive cursor touch the declared spec locus", () => {
  commit({ "spec/loop.md": "# Loop\n" }, "spec: the loop");
  writePlanState(stateRoot(), planState());
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
    writePlanState(stateRoot(), planState());
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
  writePlanState(stateRoot(), planState({ rotation: { kind: "closed" } }));
  const closed = sweep.live({ flumeDir: stateRoot(), pickable: false });

  writePlanState(
    stateRoot(),
    planState({ rotation: { kind: "open", covered: [] } }),
  );
  const open = sweep.live({ flumeDir: stateRoot(), pickable: false });

  expect({ closed, open }).toEqual({ closed: false, open: true });
});

it("the sweep window is not live while the queue carries a pickable entry", () => {
  commit({ "src/a.ts": "export const a = 1;\n" }, "build: a");
  writePlanState(
    stateRoot(),
    planState({ rotation: { kind: "open", covered: [] } }),
  );
  const sweep = windows()["plan-sweep"];

  // Control: the same open rotation, which is live on its own.
  const idle = sweep.live({ flumeDir: stateRoot(), pickable: false });
  const yielding = sweep.live({ flumeDir: stateRoot(), pickable: true });

  expect({ idle, yielding }).toEqual({ idle: true, yielding: false });
});

it("the inbox window is live while a standing build refusal is keyed to an entry the queue still carries", () => {
  commit({ "src/a.ts": "export const a = 1;\n" }, "build: a");
  writePlanState(stateRoot(), planState());
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
 * A phase named `build` and a tag slugged `build` share one identity — the
 * window's only discriminator is the record's own stated `key` field, never
 * that text. Both arms below are written over that one colliding identity, so
 * the verdicts differ by the keyspace and nothing else.
 */
it("the inbox window ignores a phase-keyed prior-attempt record whose key matches a queued entry's slug", () => {
  commit({ "src/a.ts": "export const a = 1;\n" }, "build: a");
  writePlanState(stateRoot(), planState());
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
 * asked of the two evidences that carry it: the `TickResult` a build tick
 * reports, read by the handoff's refusal leg, and a record still standing on
 * disk from an earlier run, read by this window. Both real readers run here;
 * neither side's table is restated by the test.
 *
 * Which `TickResult` field carries a mode is the engine's own split, so the
 * switch below follows it: the four `NoCommitMode` members arrive as the
 * tick's `noCommit`, and the two merge fates as an entry's `mergeOutcome`. A
 * prior-attempt mode the engine adds that is neither is a typecheck failure
 * in that switch rather than an unexercised arm.
 */
it("the inbox window and the build handoff agree on every prior-attempt mode", () => {
  commit({ "src/a.ts": "export const a = 1;\n" }, "build: a");
  writePlanState(stateRoot(), planState());
  const inbox = windows()[INBOX_PHASE];

  const tag = "HARNESS-STANDING-REFUSAL";
  const pending = [entry(tag)];

  /** Whether the inbox window opens over one standing record of this mode. */
  const windowSays = (mode: PriorAttemptMode): boolean => {
    const rec = record(tag, mode);
    return inbox.live({
      flumeDir: stateRoot(),
      pickable: true,
      pending,
      priorAttempts: new Map([[`${rec.key}:${rec.keyedAs}`, rec]]),
    });
  };

  // Every slice is dead, so a tick the handoff routes to the inbox got there
  // through its refusal leg and not through an open window.
  const handoff = defaultHandoff(
    ([INBOX_PHASE, "plan-derive", "plan-sweep"] satisfies PlanSlice[]).map(
      (name) => ({ name, live: () => false }),
    ),
  );

  /** One build tick reporting this mode where the engine reports it. */
  const reported = (mode: PriorAttemptMode): TickResult => {
    const base: TickResult = {
      phaseName: BUILD_PHASE,
      committed: true,
      gateResults: [],
      pendingAfter: pending,
      // Build is a live alternative throughout, so "inbox" is a routing
      // decision rather than the only phase left to name.
      pickableAfter: pending,
      flumeDir: stateRoot(),
      configDir: stateRoot(),
      shippedTags: [],
      revertedTags: [],
    };
    const entryOutcome = (
      mergeOutcome: NonNullable<FanoutEntryOutcome["mergeOutcome"]>,
    ): FanoutEntryOutcome => ({
      tag,
      extension: {},
      committed: true,
      shipped: false,
      reverted: false,
      mergeOutcome,
    });
    switch (mode) {
      case "not-shipped":
      case "tip-moved":
        return { ...base, entries: [entryOutcome(mode)] };
      default:
        return { ...base, committed: false, noCommit: mode };
    }
  };

  const verdicts = PRIOR_ATTEMPT_MODES.map((mode) => ({
    mode,
    window: windowSays(mode),
    handoff: handoff(reported(mode))[0] === INBOX_PHASE,
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
  writePlanState(stateRoot(), planState());
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
  writePlanState(stateRoot(), planState());

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
    writePlanState(stateRoot(), planState());

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
  writePlanState(
    stateRoot(),
    planState({ derivedThrough: absent, sweptThrough: absent }),
  );
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
  const notATree = mkdtempSync(join(tmpdir(), "flume-windows-nogit-"));

  // What git says about that directory, read here rather than written by
  // hand: the assertion below is then that git's sentence reached the
  // refusal, not that the test and the module agree on a phrasing.
  let said = "";
  try {
    execFileSync("git", ["ls-files"], {
      cwd: notATree,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
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
  writePlanState(stateRoot(), planState());

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

it("a rendered sweep window names the tip its frontier was drawn from", () => {
  const base = commit({ "src/a.ts": "export const a = 1;\n" }, "build: a");
  writePlanState(stateRoot(), planState());

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
  writePlanState(stateRoot(), planState());

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
  writePlanState(stateRoot(), planState());

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
  writePlanState(stateRoot(), planState());

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
  writePlanState(stateRoot(), planState());
  const inbox = windows()[INBOX_PHASE];

  const args = inbox.args({ cwd: repo, flumeDir: stateRoot() });

  expect(declaration().ci).toBeUndefined();
  expect(inbox.dataKeys).toContain("CI_LANES");
  expect(Object.keys(args).sort()).toEqual([...inbox.dataKeys].sort());
  expect(args["CI_LANES"]).toBe("(no CI lanes declared)");
});
