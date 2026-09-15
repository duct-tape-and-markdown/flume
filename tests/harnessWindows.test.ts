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

import { afterEach, beforeEach, expect, it } from "vitest";

import {
  parseDeclaration,
  planSliceWindows,
  writePlanState,
  type Declaration,
  type PlanSliceWindow,
  type PlanState,
} from "../harness/index.ts";
import { INBOX_PHASE, type PlanSlice } from "../harness/declaration.ts";
import type { PendingEntry } from "../src/PendingSchema.ts";
import type { PriorAttempt } from "../src/Prompt.ts";
import { slugify } from "../src/paths.ts";

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

/** A runner satisfying the declared interface; no case drives the judge. */
const runner = {
  run: async () => [],
  runAtBase: async () => [],
  lanes: [],
};

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

/** One standing prior-attempt record, keyed as the engine keys an entry's. */
function record(tag: string, mode: PriorAttempt["mode"]): PriorAttempt {
  const anchor = {
    key: "entry" as const,
    keyedAs: slugify(tag),
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
      priorAttempts: new Map(records.map((r) => [r.keyedAs, r])),
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
  ];
  const args = windows()[INBOX_PHASE].args({
    cwd: repo,
    flumeDir: stateRoot(),
    pending,
    priorAttempts: new Map(records.map((r) => [r.keyedAs, r])),
  });

  expect(args.RECORDS).toContain("2026-09-14-a-finding.md");
  expect(args.RECORDS).toContain("Observed.");
  expect(args.BUILD_RECORDS).toContain(
    "=== 2 standing prior-attempt record(s) ===",
  );
  expect(args.BUILD_RECORDS).toContain(
    "--- live-entry (entry keyspace) ← the queue still carries this entry; reconcile it ---",
  );
  expect(args.BUILD_RECORDS).toContain("--- retired-entry (entry keyspace) ---");
  // The record's own fields, verbatim from the engine's shape.
  expect(args.BUILD_RECORDS).toContain(`"mode": "not-shipped"`);
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
