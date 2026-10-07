/**
 * The harness package's gate set (`spec/harness.md`, *The gates the
 * discipline needs*): what each of them refuses, that they all sit ahead of
 * whatever a consumer declared, and that the page a consumer adopts from
 * names every one of them.
 *
 * Every case runs over a **real git repository** and gates a **real commit**:
 * the span each gate reads is `git diff` over the two shas git just handed
 * back, the record bytes are read at the commit through the engine's own
 * at-ref reader, and the clean-tree verdict is `git status` on the tree the
 * commit left behind. A hand-built span would re-author, by the tester's
 * hand, exactly the seam these gates exist to hold — what git calls touched,
 * and what "absent at the commit" means (`.claude/rules/engineering.md`, *A
 * seam gate reads what the real writer wrote*).
 *
 * The declaration is parsed through the package's own schema rather than cast
 * into shape, so no case can wire a gate to a fence a consumer could not have
 * written. Record paths are composed from `layout.ts` — nothing here spells
 * `plan/notes` — so a layout rename moves these cases with it.
 */

import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  RECORD_MAX_BYTES,
  continuingNotePath,
  harnessGates,
  noteGlobs,
  notePath,
  notePaths,
  parkedNotePath,
  parseDeclaration,
  planStatePath,
  recordDirs,
  writePlanState,
  type Declaration,
  type PlanStateWriteOf,
  type GateEngine,
} from "../harness/index.ts";
import { pendingGate } from "../src/builtinGates.ts";
import type { Gate, GateContext, GateResult } from "../src/Gate.ts";
import {
  checkoutAddress,
  isAncestor,
  readFileAtRef,
  statusRecords,
} from "../src/git.ts";
import { entryClaimPath, entryClaimSlug } from "../src/entryClaims.ts";
import { renderPidClaim } from "../src/pidClaim.ts";
import { readGatedQueue, readQueueAtRef } from "../src/pendingLedger.ts";
import { entryFileName, parsePendingQueue } from "../src/PendingSchema.ts";
import { computeStateRootRel, matchesAny } from "../src/paths.ts";
import type { PendingEntry } from "../src/PendingSchema.ts";
import {
  BUILD_PHASE,
  INBOX_PHASE,
  PLAN_SLICES,
  type PlanSlice,
} from "../harness/declaration.ts";
import { GOAL_RANK_FIELD } from "../harness/entryExtension.ts";
import { JUDGED_SLICES } from "../harness/planState.ts";
import { putDownPredicate } from "../harness/putDown.ts";
import type { RunnerFactory } from "../harness/runner.ts";
import { sectionOf } from "./helpers/docSections.ts";
import { mkTempDir } from "./helpers/fixtureRoot.ts";
import { stubRunner } from "./helpers/stubRunner.ts";
import { SPAWN_BUDGET_MS, gitOutSync } from "./helpers/subprocess.ts";

// This file's cases drive real git repositories, and a git spawn is a spawn
// like any other: the lane's one budget, for its cases and its hooks alike,
// declared once for the file rather than inherited from the runner
// (`SPAWN_BUDGET_MS`, `tests/helpers/subprocess.ts`).
vi.setConfig({ testTimeout: SPAWN_BUDGET_MS, hookTimeout: SPAWN_BUDGET_MS });

/**
 * The engine, as a chain hands it in: the real builtin, the real at-ref and
 * gated-queue reads and the real status decode, never a stand-in. A stubbed
 * reader would decide for itself what "absent from the commit" means, which
 * is half of what the records gate is — and, for the queue, which offset the
 * gated commit's listing comes out of; a stubbed decode would re-author, by
 * the tester's hand, the porcelain vocabulary the clean-tree gate exists to
 * read (`.claude/rules/engineering.md`, *A seam gate reads what the real
 * writer wrote*).
 */
const engine: GateEngine = {
  pendingGate,
  readGatedQueue,
  parsePendingQueue,
  git: { readFileAtRef, isAncestor, statusRecords },
};

/** The state root every case addresses, repo-relative. */
const STATE_ROOT = ".flume";

/**
 * A nested state root, as a job namespace produces one — the segments under
 * the repo that the case writes its records at.
 *
 * The offset the gate reads is not spelled beside them: `ctxFor` runs the
 * engine's own `computeStateRootRel` over the same two roots a dispatcher
 * would, so the gate is driven by what the real reporter reports rather than
 * by the tester's hand (`.claude/rules/engineering.md`, *A seam gate reads
 * what the real writer wrote*). That reporter folds to git's alphabet, which
 * is what every record path this gate matches is in.
 */
const NESTED = { segments: ["jobs", "alpha", ".flume"] };

/**
 * The runner as it is declared: a factory over the engine's API. No case in
 * this file runs a test, so the shared stand-in is what it returns.
 */
const runnerFactory: RunnerFactory = () => stubRunner;

/** Build's fence, and so the queue's target fence. `docs/**` is outside it. */
const BUILD_FENCE = ["src/**", "tests/**", ...noteGlobs(STATE_ROOT)];

/**
 * A declaration a consumer could have written, through the package's own
 * schema — the gates are wired from this and from nothing beside it.
 */
const DECLARED = {
  specLocus: ["spec/**"],
  fence: { build: BUILD_FENCE, "plan-derive": [`${STATE_ROOT}/plan/**`] },
  runner: runnerFactory,
  slices: { enabled: ["plan-derive"] },
};

const declaration: Declaration = parseDeclaration(DECLARED);

/** One CI lane, as a consumer with a second host declares one. */
const CI_LANE = { name: "windows", workflow: "ci.yml", job: "windows" };

/**
 * The same declaration carrying that lane — composed from the literal above
 * rather than beside it, so a case that varies the lanes varies nothing else.
 */
const withCiLane: Declaration = parseDeclaration({ ...DECLARED, ci: [CI_LANE] });

/** The phase the set is built for — build's name and fence, as declared. */
const phase = { name: BUILD_PHASE, writablePaths: [...BUILD_FENCE] };

const git = (repo: string, args: string[]): string =>
  gitOutSync(repo, args).trim();

/** The span the dispatcher would hand a gate, as git itself reports it. */
interface Span {
  readonly baseSha: string;
  readonly commitSha: string;
  readonly touchedPaths: string[];
}

let repo: string;

const write = async (rel: string, text: string): Promise<void> => {
  const abs = join(repo, rel);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, text);
};

/** Stage everything and commit, reporting the span the commit spans. */
function commitAll(message: string): Span {
  const baseSha = git(repo, ["rev-parse", "HEAD"]);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", message]);
  const commitSha = git(repo, ["rev-parse", "HEAD"]);
  return {
    baseSha,
    commitSha,
    touchedPaths: git(repo, ["diff", "--name-only", `${baseSha}..${commitSha}`])
      .split("\n")
      .filter(Boolean),
  };
}

/**
 * One queued entry: the engine core plus every package extension field.
 *
 * Typed as the engine's own {@link PendingEntry} rather than a bag cast into
 * one, so a core-field change is a tsc error here and at every case built
 * from it. The package's extension fields ride the type's open half, which is
 * where a chain's declared fields live.
 */
const queueEntry = (
  tag: string,
  over: {
    per?: { path: string; section: string };
    edit?: string;
    kind?: PendingEntry["kind"];
    parent?: string;
    rank?: number;
  } = {},
): PendingEntry => ({
  tag,
  gate: { kind: "open" },
  dependsOnForks: [],
  kind: over.kind ?? "work",
  ...(over.parent === undefined ? {} : { parent: over.parent }),
  ...(over.rank === undefined ? {} : { [GOAL_RANK_FIELD]: over.rank }),
  files: {
    new: [],
    edit: [{ path: over.edit ?? "src/widget.ts", description: "the work" }],
    retire: [],
  },
  summary: "one line of what",
  per: over.per ?? {
    path: "spec/harness.md",
    section: "The gates the discipline needs",
  },
  acceptance: "what turns green",
  tests: [],
  pins: [],
});

/**
 * The queue as a commit holds it: one `<tag>.json` per entry directly under
 * the directory, plus the `.gitkeep` adoption seeds (`harness/init.ts`) —
 * git holds no empty directory, so a drained queue needs a file of its own to
 * stay *present* and empty rather than missing.
 *
 * Every prior entry file is removed first: the listing is the queue
 * (`spec/pending.md`, *The ledger is a directory — one entry per file*), so a
 * fixture that sets the queue sets the directory.
 */
const writeQueue = async (entries: readonly unknown[]): Promise<void> => {
  const dir = join(repo, STATE_ROOT, "plan", "pending");
  await mkdir(dir, { recursive: true });
  for (const name of await readdir(dir)) {
    if (name.endsWith(".json")) await rm(join(dir, name), { force: true });
  }
  await write(`${STATE_ROOT}/plan/pending/.gitkeep`, "");
  for (const entry of entries) {
    const tag = (entry as { tag?: unknown }).tag;
    await write(
      `${STATE_ROOT}/plan/pending/${entryFileName(typeof tag === "string" ? tag : "SOME-TAG")}`,
      `${JSON.stringify(entry, null, 2)}\n`,
    );
  }
};

/**
 * The context a dispatcher builds for a gate on this repo — `.flume` at the
 * repo root by default, or the nested root a case names. The offset is the
 * engine's own, computed from the same two roots a dispatcher computes it
 * from, never a spelling of the tester's.
 */
function ctxFor(
  span: Span,
  over: {
    phaseName: string;
    entry?: PendingEntry;
    stateRoot?: { segments: string[] };
  },
): GateContext {
  const flumeDir = over.stateRoot
    ? join(repo, ...over.stateRoot.segments)
    : join(repo, STATE_ROOT);
  return {
    cwd: repo,
    repoRoot: repo,
    flumeDir,
    stateRootRel: computeStateRootRel(repo, flumeDir),
    pendingDir: join(flumeDir, "plan", "pending"),
    configDir: flumeDir,
    phaseName: over.phaseName,
    commitSha: span.commitSha,
    baseSha: span.baseSha,
    touchedPaths: span.touchedPaths,
    ...(over.entry ? { entry: over.entry } : {}),
    log: () => {},
  };
}

/** An entry as the wave selected it — only its tag is read by these gates. */
const assigned = (tag: string): PendingEntry => queueEntry(tag);

/**
 * The package's own put-down predicate over this repo's state root — the real
 * one the chain factory hands its gates, never a stand-in. What counts as a
 * park, a continuation or a finished entry is exactly the seam the records
 * gate is wired to here (`.claude/rules/engineering.md`, *A seam gate reads
 * what the real writer wrote*).
 */
const putDown = putDownPredicate(STATE_ROOT);

/**
 * The package's set for this phase, plus whatever the case declares — under
 * the shared declaration unless a case hands its own, which is how a gate
 * composed from a declared value is driven over two declarations.
 */
const gates = (
  declared: readonly Gate[] = [],
  decl: Declaration = declaration,
): Gate[] => harnessGates({ phase, declaration: decl, engine, putDown, declared });

/**
 * The package's set for one plan slice — the phase a filed entry's band is a
 * fact about. Built from the real factory for the named slice, so the gate a
 * case runs is the gate that slice's own ticks run.
 */
const sliceGates = (name: PlanSlice): Gate[] =>
  harnessGates({
    phase: { name, writablePaths: [...BUILD_FENCE] },
    declaration,
    engine,
    putDown,
  });

/** The gate this set names `name` — by name, never by index. */
function named(
  name: string,
  declared: readonly Gate[] = [],
  decl: Declaration = declaration,
): Gate {
  const gate = gates(declared, decl).find((g) => g.name === name);
  if (!gate) throw new Error(`the package's set has no gate named "${name}"`);
  return gate;
}

const records = (
  span: Span,
  over: Parameters<typeof ctxFor>[1],
): Promise<GateResult> => named("records").run(ctxFor(span, over));

beforeEach(async () => {
  repo = await mkTempDir("flume-harness-gates-");
  git(repo, ["init", "-q"]);
  git(repo, ["config", "user.email", "t@example.com"]);
  git(repo, ["config", "user.name", "t"]);
  git(repo, ["config", "commit.gpgsign", "false"]);

  await write(
    "spec/harness.md",
    [
      "# The harness package",
      "",
      "## The gates the discipline needs",
      "",
      "The `per` gate, the records gate, the clean-tree gate, the pending gate.",
      "",
      "## Records as one file each",
      "",
      "One file per record.",
      "",
    ].join("\n"),
  );
  await write("src/widget.ts", `export const widget = "base";\n`);
  await writeQueue([]);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "base"]);
});

afterEach(async () => {
  if (repo) await rm(repo, { recursive: true, force: true });
});

it("the per gate refuses a commit whose cited file is not in it, naming the tag", async () => {
  const gate = named("per cites resolve");

  // The resolving queue first: without it the refusal below could be a gate
  // that never returns anything else.
  await writeQueue([queueEntry("RESOLVES")]);
  const resolving = await gate.run(
    ctxFor(commitAll("plan: a cite that resolves"), { phaseName: "plan-derive" }),
  );
  expect(resolving).toMatchObject({ ok: true });
  expect(resolving.message).toContain("1 per cite(s) resolve");
  // Judged, not skipped: the queue carried a cite to rule on.
  expect(resolving.skipped).toBeUndefined();

  await writeQueue([
    queueEntry("GONE-CITE", {
      per: { path: "spec/absent.md", section: "The gates the discipline needs" },
    }),
  ]);
  const refused = await gate.run(
    ctxFor(commitAll("plan: a cite the commit does not carry"), {
      phaseName: "plan-derive",
    }),
  );

  expect(refused.ok).toBe(false);
  expect(refused.details).toContain("GONE-CITE");
  expect(refused.details).toContain("spec/absent.md is not in the commit");
});

it("the per gate reports a drained queue as skipped, not as a judged green", async () => {
  const gate = named("per cites resolve");

  // A queue with one entry first: the same gate, on the same repo, rules and
  // says so — so the skip below is the empty queue's verdict and not a gate
  // that never judges anything.
  await writeQueue([queueEntry("RESOLVES")]);
  const judged = await gate.run(
    ctxFor(commitAll("plan: a queue carrying one cite"), { phaseName: "plan-derive" }),
  );
  expect(judged).toMatchObject({ ok: true });
  expect(judged.skipped).toBeUndefined();
  expect(judged.message).toContain("1 per cite(s) resolve");

  await writeQueue([]);
  const span = commitAll("plan: drain the last entry");
  // The queue the gate is about to read, at the commit it reads it from:
  // present and parsing, carrying nothing. Absent would be the gate's
  // refusal arm, which is a different verdict entirely.
  const files = await readQueueAtRef(
    repo,
    span.commitSha,
    `${STATE_ROOT}/plan/pending`,
  );
  expect(files).toEqual([]);

  const skipped = await gate.run(ctxFor(span, { phaseName: "plan-derive" }));

  // Vacuous by design, and spelled: green, with the fact that nothing was
  // judged carried on the verdict rather than read back out of the message.
  expect(skipped.ok).toBe(true);
  expect(skipped.skipped).toBe("the queue is empty");
  expect(skipped.message).toContain("cites nothing");
  expect(skipped.message).not.toContain("per cite(s) resolve");
});

/**
 * **Nothing a producer files carries a rank** (`spec/harness.md`, *The
 * phases*): the queue has one ordering and no number an entry's filer chose
 * is part of it, so no rank is the package's to refuse at the commit that
 * filed it.
 *
 * Driven over a real plan commit through the real factory's whole
 * `afterCommit` set for a real slice — the verdicts that slice's own ticks are
 * handed, not the absence of one gate read off a roster
 * (`.claude/rules/engineering.md`, *A seam gate reads what the real writer
 * wrote*).
 */
it("a plan slice's commit filing an entry from each of the three old bands' provenances passes its gates", async () => {
  // The three provenances the retired bands kept apart — the sweep's, a build
  // note's, and a downstream report's. The derive slice admitted exactly one
  // of them, so two of these three rows were a refusal before; and the rank
  // that separated them is no longer a field an entry may carry at all
  // (`spec/pending.md`, *The entry core*).
  const FILED = [
    "FILED-FROM-THE-SWEEPS-OLD-BAND",
    "FILED-FROM-A-BUILD-NOTES-OLD-BAND",
    "FILED-FROM-A-DOWNSTREAM-REPORTS-OLD-BAND",
  ];
  await writeQueue(FILED.map((tag) => queueEntry(tag)));
  const span = commitAll("plan: derive three entries from three sources");
  // Non-vacuity: git named every entry file, so the verdicts below are read
  // over a span that really filed each of them.
  expect(span.touchedPaths).toEqual(
    FILED.map((tag) => `${STATE_ROOT}/plan/pending/${entryFileName(tag)}`).sort(),
  );

  const set = sliceGates("plan-derive").filter((g) => g.when === "afterCommit");
  // Vacuity pin: there are gates at that point to run at all.
  expect(set.length).toBeGreaterThan(0);
  // A throw counts against the claim exactly as a refusal does: what the
  // title asserts is that the commit *passes*, and a gate that cannot run
  // over it has not passed it.
  const refused = (
    await Promise.all(
      set.map(async (gate) => {
        try {
          const verdict = await gate.run(ctxFor(span, { phaseName: "plan-derive" }));
          return verdict.ok ? [] : [`${gate.name}: ${verdict.message}`];
        } catch (error) {
          return [`${gate.name} threw: ${(error as Error).message}`];
        }
      }),
    )
  ).flat();
  // The compared value is the refusing gates, named; the whole of each refusal
  // rides the message, which chai does not truncate
  // (`.claude/rules/platform-facts.md`, *chai truncates an inspected value in
  // an assertion message at 40 characters*).
  expect(
    refused.map((line) => line.split(":")[0]),
    refused.join("\n"),
  ).toEqual([]);
});

/**
 * And no member of the set reads a rank at all. Read off the real factory for
 * every declared slice rather than off build's set, which never carried the
 * row: the band was a fact about the slice that filed the entry, so the
 * producer's own set is where its absence has to hold.
 */
it("the gates a plan slice declares carry no filing-band row", () => {
  // Vacuity pin: there are slices to read.
  expect(PLAN_SLICES.length).toBeGreaterThan(0);

  for (const slice of PLAN_SLICES) {
    const names = sliceGates(slice).map((g) => g.name);
    // And that slice's set is populated: an empty set names no band either.
    expect({ slice, populated: names.length > 0 }).toEqual({
      slice,
      populated: true,
    });
    expect({ slice, band: names.filter((name) => name.includes("band")) })
      .toEqual({ slice, band: [] });
  }
});

/**
 * The goal rank's two rules (`spec/harness.md`, *The gates the discipline
 * needs*), each driven over a real plan commit through the real factory's
 * gate for the real slice: only a root `group` carries a rank, and only the
 * records drain adds or changes one.
 *
 * A **goal**, here and at the gate, is a `group` with no `parent`. Every
 * fixture composes one through `queueEntry`, so the forest fields these cases
 * turn on are the core's own rather than a bag shaped like an entry.
 */
const goalRankGateOf = (slice: PlanSlice): Gate => {
  const gate = sliceGates(slice).find((g) => g.name === "goal rank");
  if (!gate) throw new Error(`${slice}'s set has no gate named "goal rank"`);
  return gate;
};

/** A goal, as the inbox slice files one: a root `group` carrying its rank. */
const goal = (tag: string, rank: number): PendingEntry =>
  queueEntry(tag, { kind: "group", rank });

/**
 * One queue committed and left as the span's base, so the rank the next
 * commit moves is one the base really held. The commit itself is not gated —
 * what the cases below judge is the span off it.
 */
const baseQueue = async (entries: readonly PendingEntry[]): Promise<void> => {
  await writeQueue(entries);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "plan: the queue this span starts from"]);
};

it("a rank on an entry that is not a group is refused", async () => {
  const gate = goalRankGateOf(INBOX_PHASE);

  // The well-placed queue first: a goal with its rank beside a `work` entry
  // with none, so the refusal below is this gate ruling rather than a gate
  // that never returns anything else.
  await writeQueue([goal("A-GOAL", 1), queueEntry("THE-WORK")]);
  const placed = await gate.run(
    ctxFor(commitAll("plan: a goal and a work entry"), {
      phaseName: INBOX_PHASE,
    }),
  );
  expect(placed, placed.details ?? placed.message).toMatchObject({ ok: true });
  expect(placed.message).toContain("2 entries placed, 1 carrying a goal rank");

  // The same rank on the `work` entry. Judged under the drain's own gate, so
  // the provenance leg cannot be what refuses: this is placement alone.
  await writeQueue([goal("A-GOAL", 1), queueEntry("THE-WORK", { rank: 2 })]);
  const refused = await gate.run(
    ctxFor(commitAll("plan: rank a work entry"), { phaseName: INBOX_PHASE }),
  );

  expect(refused.ok).toBe(false);
  expect(refused.details).toContain("THE-WORK");
  expect(refused.details).toContain("`work`");
  // And the goal beside it is not swept up in the refusal.
  expect(refused.details).not.toContain("A-GOAL");
});

it("a rank on a group that has a parent is refused", async () => {
  const gate = goalRankGateOf(INBOX_PHASE);

  // A group under a parent carrying no rank is the passing shape: only the
  // root of the forest is a goal, so a nested group is ranked by nothing.
  await writeQueue([
    goal("A-GOAL", 1),
    queueEntry("AN-EPIC", { kind: "group", parent: "A-GOAL" }),
  ]);
  const placed = await gate.run(
    ctxFor(commitAll("plan: a goal and a group beneath it"), {
      phaseName: INBOX_PHASE,
    }),
  );
  expect(placed, placed.details ?? placed.message).toMatchObject({ ok: true });
  expect(placed.message).toContain("2 entries placed, 1 carrying a goal rank");

  await writeQueue([
    goal("A-GOAL", 1),
    queueEntry("AN-EPIC", { kind: "group", parent: "A-GOAL", rank: 2 }),
  ]);
  const refused = await gate.run(
    ctxFor(commitAll("plan: rank a group under a parent"), {
      phaseName: INBOX_PHASE,
    }),
  );

  expect(refused.ok).toBe(false);
  expect(refused.details).toContain("AN-EPIC");
  // Named by the parent that disqualifies it, so the refusal says which half
  // of "root group" the entry failed.
  expect(refused.details).toContain("under `A-GOAL`");
});

it("a commit that adds a root group with no rank is refused", async () => {
  const gate = goalRankGateOf(INBOX_PHASE);

  await writeQueue([queueEntry("THE-WORK"), goal("A-GOAL", 1)]);
  const placed = await gate.run(
    ctxFor(commitAll("plan: a goal carrying its rank"), {
      phaseName: INBOX_PHASE,
    }),
  );
  expect(placed, placed.details ?? placed.message).toMatchObject({ ok: true });

  // The same goal with the rank taken off it: a group at the root of the
  // forest and no place in the operator's order.
  await writeQueue([
    queueEntry("THE-WORK"),
    queueEntry("A-GOAL", { kind: "group" }),
  ]);
  const refused = await gate.run(
    ctxFor(commitAll("plan: a goal with no rank"), { phaseName: INBOX_PHASE }),
  );

  expect(refused.ok).toBe(false);
  expect(refused.details).toContain("A-GOAL");
  expect(refused.details).toContain("carries none");
});

it("a rank a derive commit adds is refused naming the tag", async () => {
  const gate = goalRankGateOf("plan-derive");

  // The base holds work and no goal, so the span below really adds the rank
  // rather than carrying one that was already there.
  await baseQueue([queueEntry("THE-WORK")]);
  await writeQueue([queueEntry("THE-WORK"), goal("A-GOAL", 1)]);
  const span = commitAll("plan: derive files a goal and ranks it");
  // Non-vacuity on the span: git named the entry file the rank arrived in.
  expect(span.touchedPaths).toContain(
    `${STATE_ROOT}/plan/pending/${entryFileName("A-GOAL")}`,
  );

  const refused = await gate.run(ctxFor(span, { phaseName: "plan-derive" }));

  expect(refused.ok).toBe(false);
  expect(refused.message).toContain("plan-derive");
  expect(refused.message).toContain(INBOX_PHASE);
  expect(refused.details).toContain("A-GOAL");
  expect(refused.details).toContain("ranked `1` by this commit");
});

it("a rank a sweep commit changes is refused naming the tag", async () => {
  const gate = goalRankGateOf("plan-sweep");

  await baseQueue([goal("A-GOAL", 1), queueEntry("THE-WORK")]);
  await writeQueue([goal("A-GOAL", 4), queueEntry("THE-WORK")]);
  const span = commitAll("plan: sweep re-ranks the standing goal");
  expect(span.touchedPaths).toEqual([
    `${STATE_ROOT}/plan/pending/${entryFileName("A-GOAL")}`,
  ]);

  const refused = await gate.run(ctxFor(span, { phaseName: "plan-sweep" }));

  expect(refused.ok).toBe(false);
  expect(refused.message).toContain("plan-sweep");
  expect(refused.details).toContain("A-GOAL: `1` -> `4`");
});

it("a rank an inbox commit adds to a root group passes the gate", async () => {
  const gate = goalRankGateOf(INBOX_PHASE);

  await baseQueue([queueEntry("THE-WORK")]);
  await writeQueue([queueEntry("THE-WORK"), goal("A-GOAL", 3)]);
  const span = commitAll("plan: the drain files the operator's goal");

  const verdict = await gate.run(ctxFor(span, { phaseName: INBOX_PHASE }));

  expect(verdict, verdict.details ?? verdict.message).toMatchObject({
    ok: true,
  });
  // Non-vacuity: the green names the move it passed, so this is the drain's
  // rank admitted rather than a span that moved nothing.
  expect(verdict.message).toContain("A-GOAL: ranked `3` by this commit");
  expect(verdict.skipped).toBeUndefined();
});

it("a rank an inbox commit changes on a standing goal passes the gate", async () => {
  const gate = goalRankGateOf(INBOX_PHASE);

  await baseQueue([goal("A-GOAL", 3), goal("ANOTHER-GOAL", 5)]);
  await writeQueue([goal("A-GOAL", 7), goal("ANOTHER-GOAL", 5)]);
  const span = commitAll("plan: the operator re-ranks a standing goal");

  const verdict = await gate.run(ctxFor(span, { phaseName: INBOX_PHASE }));

  expect(verdict, verdict.details ?? verdict.message).toMatchObject({
    ok: true,
  });
  expect(verdict.message).toContain("A-GOAL: `3` -> `7`");
  // And the goal the commit left alone is not reported as moved.
  expect(verdict.message).not.toContain("ANOTHER-GOAL");
  expect(verdict.skipped).toBeUndefined();
});

/**
 * Build files no entry, so there is no rank on its commit to place and none
 * it could have moved — the same reasoning the merged-tree pending gate's
 * wiring rests on (`harness/gates.ts`).
 */
it("build's gate set carries no goal-rank row", () => {
  const producer = sliceGates(INBOX_PHASE).map((g) => g.name);
  // Vacuity pin: the row exists to be absent from build's set.
  expect(producer).toContain("goal rank");

  expect(gates().map((g) => g.name)).not.toContain("goal rank");
});

it("the records gate refuses a record written outside the tick's own tag", async () => {
  const entry = assigned("MINE");

  // Its own note is the one file a build tick may write.
  await write(notePath(STATE_ROOT, "MINE"), "# what I saw\n\nIn `src/`.\n");
  const own = await records(commitAll("build: park into my own note"), {
    phaseName: "build",
    entry,
  });
  expect(own).toMatchObject({ ok: true });
  expect(own.message).toContain("1 written");

  await write(notePath(STATE_ROOT, "OTHER"), "# not mine\n\nAnother tag.\n");
  const refused = await records(commitAll("build: write another tag's note"), {
    phaseName: "build",
    entry,
  });

  expect(refused.ok).toBe(false);
  expect(refused.details).toContain(notePath(STATE_ROOT, "OTHER"));
  expect(refused.details).toContain(notePath(STATE_ROOT, "MINE"));
});

it("the records gate matches a touched record under a nested state root, reading the engine's offset straight", async () => {
  // The offset the gate will read, from the real reporter: git's alphabet,
  // which is the one `touchedPaths` is in — so the gate composes its record
  // globs from it without a conversion of its own.
  expect(computeStateRootRel(repo, join(repo, ...NESTED.segments))).toBe(
    NESTED.segments.join("/"),
  );

  const entry = assigned("MINE");
  const own = notePath(NESTED.segments.join("/"), "MINE");

  await write(own, "# what I saw\n\nIn `src/`.\n");
  const span = commitAll("build: a note under a nested state root");
  // Non-vacuity: git named the note the gate is about to be asked to match,
  // in git's own alphabet — so a skip below is the gate's reading of the
  // offset and not an empty span.
  expect(span.touchedPaths).toContain(own);

  const judged = await records(span, {
    phaseName: "build",
    entry,
    stateRoot: NESTED,
  });

  // Judged, not skipped past: the record directories the gate composes from
  // the reported offset are the ones git just named.
  expect(judged).toMatchObject({ ok: true });
  expect(judged.skipped).toBeUndefined();
  expect(judged.message).toContain("1 record(s) touched, 1 written");

  // And the note path it keys the tick's own record by is in the same
  // alphabet, so another tag's note under that root is still refused.
  await write(notePath(NESTED.segments.join("/"), "OTHER"), "# not mine\n\nT.\n");
  const refused = await records(
    commitAll("build: another tag's note under the nested root"),
    { phaseName: "build", entry, stateRoot: NESTED },
  );
  expect(refused.ok).toBe(false);
  expect(refused.details).toContain(own);
});

it("the records gate's park refusal names every note home notePaths renders for the tick's own tag", async () => {
  const entry = assigned("MINE");
  const own = parkedNotePath(STATE_ROOT, "MINE");

  // The tick's own park is a record this gate admits like any other: which of
  // the note homes `notePaths` renders a tick wrote is the park verdict, and
  // that is the chain's to read (`harness/chain.ts`), never this gate's to
  // judge.
  await write(own, "# why it could not ship\n\nThe premise is gone.\n");
  const span = commitAll("build: park into my own note");
  // Non-vacuity: git named the parked note, so the verdict below is the gate
  // reading a record and not an empty span skipping past.
  expect(span.touchedPaths).toContain(own);
  const admitted = await records(span, { phaseName: "build", entry });
  expect(admitted).toMatchObject({ ok: true });
  expect(admitted.skipped).toBeUndefined();
  expect(admitted.message).toContain("1 record(s) touched, 1 written");

  // Another tick's park, in the same directory and differing only in the tag:
  // two ticks writing one file is what this gate stands between, and the
  // parked directory is no exception to it.
  await write(
    parkedNotePath(STATE_ROOT, "OTHER"),
    "# not mine\n\nAnother tag's park.\n",
  );
  const refused = await records(
    commitAll("build: write another tag's park"),
    { phaseName: "build", entry },
  );

  expect(refused.ok).toBe(false);
  expect(refused.details).toContain(parkedNotePath(STATE_ROOT, "OTHER"));
  // And the refusal names the note paths this tick may write — `notePaths`'
  // whole answer for the tag, every home of it — so a tick that wrote the
  // wrong tag is told where all of its own are, and trimming a home out of
  // that advice reds here rather than passing over the two spot-checked.
  const homes = notePaths(STATE_ROOT, "MINE");
  // Non-vacuity, and the reason the assertion walks the layout's answer
  // instead of a list spelled here: the roster it walks holds every home this
  // case can name, so a fourth home added to `notePaths` is asserted too.
  expect(homes).toEqual(
    expect.arrayContaining([
      notePath(STATE_ROOT, "MINE"),
      own,
      continuingNotePath(STATE_ROOT, "MINE"),
    ]),
  );
  for (const home of homes) expect(refused.details).toContain(home);
});

it("the records gate admits a build commit writing its entry's continuing note", async () => {
  const entry = assigned("MINE");
  const own = continuingNotePath(STATE_ROOT, "MINE");

  // The third note home, and no drain's: the gate judges it because what it
  // stands between is two ticks writing one file, which is a property of the
  // path and not of who reads it afterwards.
  await write(own, "# what landed\n\nThe layout; the gate is next.\n");
  const span = commitAll("build: put the rest of the entry down");
  // Non-vacuity: git named the continuing note, so the verdict below is the
  // gate reading a real touched path and not an empty span skipping past.
  expect(span.touchedPaths).toContain(own);

  const admitted = await records(span, { phaseName: "build", entry });
  expect(admitted).toMatchObject({ ok: true });
  expect(admitted.skipped).toBeUndefined();
  expect(admitted.message).toContain("1 record(s) touched, 1 written");

  // Another tick's continuation, in the same directory and differing only in
  // the tag — the collision the gate exists to refuse, in the home the drain
  // never walks.
  await write(
    continuingNotePath(STATE_ROOT, "OTHER"),
    "# not mine\n\nAnother tag's continuation.\n",
  );
  const refused = await records(
    commitAll("build: write another tag's continuation"),
    { phaseName: "build", entry },
  );

  expect(refused.ok).toBe(false);
  expect(refused.details).toContain(continuingNotePath(STATE_ROOT, "OTHER"));
  // And the refusal names every note this tick may write, its own
  // continuation among them.
  expect(refused.details).toContain(own);
  expect(refused.details).toContain(notePath(STATE_ROOT, "MINE"));
});

it("the records gate refuses a note naming a step tag the entry does not carry", async () => {
  const work = queueEntry("MINE");
  const step = queueEntry("MINE-STEP", { kind: "step", parent: "MINE" });
  await writeQueue([work, step]);

  // Non-vacuity: a note naming the step the queue really holds beneath this
  // entry is admitted, and the gate says so — so the refusal below is the tag's
  // doing and not a gate that reds on any `Finished:` line at all.
  await write(notePath(STATE_ROOT, "MINE"), "# done\n\nFinished: MINE-STEP\n");
  const admitted = await records(commitAll("build: finish the step"), {
    phaseName: "build",
    entry: work,
  });
  expect(admitted).toMatchObject({ ok: true });
  expect(admitted.message).toContain("MINE-STEP");

  // The misspelling: one character off the step the entry carries, which the
  // ship predicate would answer by shipping nothing at all.
  await write(notePath(STATE_ROOT, "MINE"), "# done\n\nFinished: MINE-STEPS\n");
  const refused = await records(commitAll("build: name a step that is not one"), {
    phaseName: "build",
    entry: work,
  });

  expect(refused.ok).toBe(false);
  // Naming the record, the tag it named, and the steps the entry has — the
  // three facts a tick needs to fix the line.
  expect(refused.details).toContain(notePath(STATE_ROOT, "MINE"));
  expect(refused.details).toContain("MINE-STEPS");
  expect(refused.details).toContain("MINE-STEP");
});

it("the records gate refuses a continuing note naming a step of another entry", async () => {
  const work = queueEntry("MINE");
  const step = queueEntry("MINE-STEP", { kind: "step", parent: "MINE" });
  const sibling = queueEntry("YOURS");
  const theirs = queueEntry("YOURS-STEP", { kind: "step", parent: "YOURS" });
  await writeQueue([work, step, sibling, theirs]);

  // Non-vacuity: the queue genuinely holds the sibling's step, so the refusal
  // below is "not this entry's" and not "no such entry anywhere".
  await write(
    continuingNotePath(STATE_ROOT, "MINE"),
    "# a segment\n\nFinished: MINE-STEP\n",
  );
  const admitted = await records(commitAll("build: put the rest down"), {
    phaseName: "build",
    entry: work,
  });
  expect(admitted).toMatchObject({ ok: true });

  await write(
    continuingNotePath(STATE_ROOT, "MINE"),
    "# a segment\n\nFinished: YOURS-STEP\n",
  );
  const refused = await records(commitAll("build: claim a sibling's step"), {
    phaseName: "build",
    entry: work,
  });

  expect(refused.ok).toBe(false);
  expect(refused.details).toContain("YOURS-STEP");
  expect(refused.details).toContain("no step of MINE");
});

it("the records gate refuses a record whose first line is not a title", async () => {
  await write(notePath(STATE_ROOT, "MINE"), "what I saw, untitled\n");
  const refused = await records(commitAll("build: an untitled note"), {
    phaseName: "build",
    entry: assigned("MINE"),
  });

  expect(refused.ok).toBe(false);
  expect(refused.details).toContain('first line is not a "# title"');
});

it("the records gate refuses a record a plan slice wrote", async () => {
  // Draining is what a plan slice does: every record directory, one record
  // each, all removed in the slice's own commit.
  const dirs = recordDirs(STATE_ROOT);
  expect(dirs.length).toBeGreaterThan(0);
  for (const dir of dirs) await write(`${dir}/2026-09-14-a-record.md`, "# a record\n");
  commitAll("seed: a record in every directory");
  for (const dir of dirs) await rm(join(repo, dir, "2026-09-14-a-record.md"));
  const drained = await records(commitAll("plan: drain the records"), {
    phaseName: "plan-derive",
  });
  expect(drained).toMatchObject({ ok: true });
  expect(drained.message).toContain(`${dirs.length} record(s) touched, 0 written`);

  for (const dir of dirs) {
    await write(`${dir}/2026-09-14-plan-wrote-this.md`, "# plan wrote this\n");
    const refused = await records(commitAll(`plan: write a record in ${dir}`), {
      phaseName: "plan-derive",
    });
    expect({ dir, ok: refused.ok }).toEqual({ dir, ok: false });
    expect(refused.details).toContain("a plan slice drains records, never writes one");
  }
});

it("the records gate passes a commit whose record is over the byte cap", async () => {
  const text = `# too much\n\n${"x".repeat(RECORD_MAX_BYTES)}\n`;
  await write(notePath(STATE_ROOT, "MINE"), text);
  await write("src/widget.ts", `export const widget = "shipped";\n`);
  const span = commitAll("build: a note past the cap, and the work it rode in with");

  // Non-vacuity: the note this gate admitted really is over the cap, and the
  // commit really does carry code beside it — so the green below is the
  // dropped arm, not an under-cap note sliding by.
  expect(Buffer.byteLength(text)).toBeGreaterThan(RECORD_MAX_BYTES);
  expect(span.touchedPaths).toContain("src/widget.ts");

  const admitted = await records(span, {
    phaseName: "build",
    entry: assigned("MINE"),
  });

  // The cap is a shape rule on a prose channel: the drain reports the
  // overrun, and no gate reverts the code beside it.
  expect(admitted).toMatchObject({ ok: true });
  expect(admitted.message).toContain("1 record(s) touched, 1 written");
});

it("the records gate reports a commit that touches no record as skipped", async () => {
  await write("src/widget.ts", `export const widget = "shipped";\n`);
  const span = commitAll("build: work, and no record beside it");

  // Non-vacuity: git named paths, and none of them is under a record
  // directory — so the skip below is the gate's filter emptying, not an
  // empty commit.
  const dirs = recordDirs(STATE_ROOT);
  expect(dirs.length).toBeGreaterThan(0);
  expect(span.touchedPaths.length).toBeGreaterThan(0);
  expect(
    span.touchedPaths.filter((path) => dirs.some((dir) => path.startsWith(dir))),
  ).toEqual([]);

  // A plan slice, so the span carries no entry and the gate has no
  // continuation to hold the commit to beside its filter — which is the one
  // claim a span with nothing in a record directory leaves it.
  const skipped = await records(span, { phaseName: "plan-derive" });

  // Vacuous by design, and spelled: a tick that wrote no record has nothing
  // to be held to, and the verdict says so rather than reading as judged.
  expect(skipped.ok).toBe(true);
  expect(skipped.skipped).toBe("no record in the gated span");
  expect(skipped.message).toBe("the commit touches no record");
});

/**
 * The continuation leaves with the tick that completes the entry
 * (`spec/harness.md`, *A tick puts work down*): no drain lists that note, so
 * a commit that finishes its entry over a standing one leaves a file behind
 * that outlives the entry it described.
 *
 * Every arm drives the package's own put-down predicate over a real commit,
 * so what counts as "finishes its entry" here is exactly what the chain's
 * `shipped` reads.
 */
it("a build commit shipping its entry over a standing continuing note is refused", async () => {
  const entry = assigned("MINE");
  const continuing = continuingNotePath(STATE_ROOT, entry.tag);

  // A prior tick's continuation, landed on the base this span branches from:
  // the note stands at the commit below without that commit touching it.
  await write(continuing, "# the first segment\n\nWhat is next.\n");
  const put = commitAll("build: land a segment and put the rest down");
  expect(put.touchedPaths).toContain(continuing);
  // Non-vacuity on the arm that is not this case: the tick that *wrote* the
  // note is a continuation, not a ship, and is not held to removing it.
  const continued = await records(put, { phaseName: "build", entry });
  expect(continued).toMatchObject({ ok: true });

  await write("src/widget.ts", `export const widget = "finished";\n`);
  const ships = commitAll("build: finish the entry, and leave the note");
  expect(ships.touchedPaths).not.toContain(continuing);

  const refused = await records(ships, { phaseName: "build", entry });

  expect(refused.ok).toBe(false);
  // Named: the path left behind is the one an agent has to go remove.
  expect(refused.details).toContain(continuing);
});

it("a build commit that removed its entry's continuing note passes the records gate", async () => {
  const entry = assigned("MINE");
  const continuing = continuingNotePath(STATE_ROOT, entry.tag);

  await write(continuing, "# the first segment\n\nWhat is next.\n");
  commitAll("build: land a segment and put the rest down");

  await rm(join(repo, continuing));
  await write("src/widget.ts", `export const widget = "finished";\n`);
  const ships = commitAll("build: finish the entry, and take the note with it");
  // The span really is the removal: git named the path, and the commit does
  // not carry the file.
  expect(ships.touchedPaths).toContain(continuing);
  expect(
    await readFileAtRef(repo, ships.commitSha, continuing),
  ).toBeNull();

  const passed = await records(ships, { phaseName: "build", entry });

  expect(passed.ok).toBe(true);
  // Judged, not skipped: the commit touched a record, and the gate says the
  // note it was handed is gone.
  expect(passed.skipped).toBeUndefined();
  expect(passed.message).toContain("1 record(s) touched, 0 written");
  expect(passed.message).toContain("no continuing note standing");
});

it("the records gate leaves a park standing over a continuation alone", async () => {
  const entry = assigned("MINE");
  const continuing = continuingNotePath(STATE_ROOT, entry.tag);
  const park = parkedNotePath(STATE_ROOT, entry.tag);

  await write(continuing, "# the first segment\n\nWhat is next.\n");
  commitAll("build: land a segment and put the rest down");

  // The next tick on the entry cannot ship it and says so. The entry stays in
  // the queue either way, so the continuation is still addressed to the tick
  // that comes after — and a refusal reverted for leaving it standing would
  // throw away the one channel that tick had.
  await write(park, "# why this cannot ship\n\nThe premise.\n");
  const parked = commitAll("build: park the entry over its own continuation");
  expect(parked.touchedPaths).not.toContain(continuing);
  expect(
    await readFileAtRef(repo, parked.commitSha, continuing),
  ).not.toBeNull();

  const passed = await records(parked, { phaseName: "build", entry });

  expect(passed.ok).toBe(true);
  expect(passed.message).toContain("1 record(s) touched, 1 written");
});

it("the records gate skips a state root resolved outside the repository", async () => {
  const entry = assigned("MINE");
  const own = notePath(STATE_ROOT, "MINE");

  // A commit that genuinely carries a record: read against the repo's own
  // state root, the same span is judged.
  await write(own, "# what I saw\n\nIn `src/`.\n");
  const span = commitAll("build: a note beside a relocated state root");
  expect(span.touchedPaths).toContain(own);
  const judged = await records(span, { phaseName: "build", entry });
  expect(judged).toMatchObject({ ok: true });
  expect(judged.skipped).toBeUndefined();
  expect(judged.message).toContain("1 record(s) touched, 1 written");

  // The offset the engine reports for a state root outside the repo: absent,
  // because no path in a commit's tree can address it.
  const relocated = { segments: ["..", "elsewhere", ".flume"] };
  expect(computeStateRootRel(repo, join(repo, ...relocated.segments))).toBeUndefined();

  const skipped = await records(span, {
    phaseName: "build",
    entry,
    stateRoot: relocated,
  });

  // Same span, same record-shaped path in it, and still no judgement — the
  // skip is the reported offset's, spelled on the verdict.
  expect(skipped.ok).toBe(true);
  expect(skipped.skipped).toBe(
    "no path in a commit can be a record under a relocated state root",
  );
  expect(skipped.message).toBe("the state root is outside the repository");
});

it("the records gate ignores a sibling directory that only prefixes a record directory", async () => {
  const dirs = recordDirs(STATE_ROOT);
  expect(dirs.length).toBeGreaterThan(0);

  // One sibling per record directory, each named so that a prefix match
  // without the separator would claim it — `inbox-archive` under `inbox`.
  const siblings = dirs.map((dir) => `${dir}-archive/2026-09-14-a-record.md`);
  for (const [i, path] of siblings.entries()) {
    expect(path.startsWith(dirs[i] ?? "")).toBe(true);
    await write(path, "# archived, not a record\n");
  }
  const span = commitAll("build: files beside the record directories");
  for (const path of siblings) expect(span.touchedPaths).toContain(path);

  // Build's own tag, so a path read as a record would be refused as another
  // tick's — the guard is what stands between these files and that refusal.
  const passed = await records(span, {
    phaseName: "build",
    entry: assigned("MINE"),
  });

  expect(passed.ok).toBe(true);
  expect(passed.message).toContain("0 record(s) touched");

  // And the directories themselves still match: the guard narrows the globs
  // to the separator, it does not stop them matching.
  await write(notePath(STATE_ROOT, "MINE"), "# what I saw\n\nIn `src/`.\n");
  const judged = await records(commitAll("build: the tick's own note"), {
    phaseName: "build",
    entry: assigned("MINE"),
  });
  expect(judged).toMatchObject({ ok: true });
  expect(judged.skipped).toBeUndefined();
  expect(judged.message).toContain("1 record(s) touched, 1 written");
});

it("the clean-tree gate refuses a leftover path the phase may not write", async () => {
  const gate = named("clean-tree");
  await write("src/widget.ts", `export const widget = "shipped";\n`);
  const span = commitAll("build: the tick's whole output");
  const ctx = ctxFor(span, { phaseName: "build", entry: assigned("MINE") });

  // Nothing left behind — the verdict the other two arms are measured against.
  expect(await gate.run(ctx)).toMatchObject({ ok: true });

  // An untracked file outside the fence is not the tick's to have written,
  // and is left alone.
  await write("scratch/stray.txt", "someone else's\n");
  expect(await gate.run(ctx)).toMatchObject({ ok: true });

  // A tracked file the phase's fence does not cover, modified and left
  // uncommitted: residue the worktree's teardown would discard silently.
  expect(phase.writablePaths.some((p) => p.startsWith("spec/"))).toBe(false);
  await write("spec/harness.md", "# rewritten under the tick\n");
  const refused: GateResult = await gate.run(ctx);

  expect(refused.ok).toBe(false);
  expect(refused.message).toContain("left uncommitted in the worktree");
  expect(refused.details).toContain("spec/harness.md");
});

it("the clean-tree gate refuses an untracked file inside the fence whose name git quotes", async () => {
  const gate = named("clean-tree");
  await write("src/widget.ts", `export const widget = "shipped";\n`);
  const span = commitAll("build: the tick's whole output");
  const ctx = ctxFor(span, { phaseName: "build", entry: assigned("MINE") });
  expect(await gate.run(ctx)).toMatchObject({ ok: true });

  // A name porcelain v1 would quote, inside the phase's fence: work the tick
  // wrote and never added, which the worktree's teardown discards.
  const quoted = "src/a widget.ts";
  expect(matchesAny(quoted, phase.writablePaths)).toBe(true);
  await write(quoted, `export const widget = "unstaged";\n`);
  expect(git(repo, ["status", "--porcelain", "--untracked-files=all"])).toContain(
    `"${quoted}"`,
  );

  const refused: GateResult = await gate.run(ctx);

  expect(refused.ok).toBe(false);
  expect(refused.details).toContain(`${quoted} (??)`);
});

it("the clean-tree gate names a quoted tracked path without its quotes", async () => {
  const gate = named("clean-tree");
  const tracked = "spec/a page.md";
  await write(tracked, "# tracked under a quoted name\n");
  const span = commitAll("build: the tick's whole output");
  const ctx = ctxFor(span, { phaseName: "build", entry: assigned("MINE") });
  expect(await gate.run(ctx)).toMatchObject({ ok: true });

  // Tracked, so residue wherever it sits — the fence never reads it.
  expect(matchesAny(tracked, phase.writablePaths)).toBe(false);
  await write(tracked, "# rewritten under the tick\n");
  const refused: GateResult = await gate.run(ctx);

  expect(refused.ok).toBe(false);
  // Named as git spells the path, not as porcelain v1 escapes it for display.
  // The negative reads that one status line, cut out of the verdict: the
  // details carry a line per residue path, and any other line's own spelling
  // is not what this case is about (`.claude/rules/posture-sweep.md`, *A
  // negative assertion over a whole rendered artifact*).
  const status = (refused.details ?? "")
    .split("\n")
    .filter((line) => line.includes(tracked));
  expect(status).toHaveLength(1);
  expect(status[0]).toContain(`${tracked} (M)`);
  expect(status[0]).not.toContain(`"`);
});

it("the clean-tree gate reads a rename's origin field as its origin, not as a second status line", async () => {
  const gate = named("clean-tree");
  const from = "src/old name.ts";
  await write(from, `export const widget = "renamed";\n`);
  const span = commitAll("build: the tick's whole output");
  const ctx = ctxFor(span, { phaseName: "build", entry: assigned("MINE") });
  expect(await gate.run(ctx)).toMatchObject({ ok: true });

  // `-z` spends a second record on where a rename came from, and that record
  // carries no status code — read as one it becomes a line of its own.
  const to = "src/new name.ts";
  git(repo, ["mv", from, to]);
  const refused: GateResult = await gate.run(ctx);

  expect(refused.ok).toBe(false);
  expect(refused.message).toContain("1 path(s) left uncommitted");
  expect(refused.details).toBe(`${to} (R)`);
});

it("the clean-tree gate takes its status records from the engine rather than spawning git", async () => {
  // The engine's decode, wrapped to count calls and to answer with a listing
  // no `git status` on this tree could produce. A gate running its own
  // `git status` would see the clean tree beneath and pass.
  const calls: string[] = [];
  const planted = [
    { code: " M", path: "spec/a page.md" },
    { code: "??", path: "src/a widget.ts" },
    { code: "??", path: "scratch/stray.txt" },
  ];
  const wired: GateEngine = {
    pendingGate,
    readGatedQueue,
    parsePendingQueue,
    git: {
      readFileAtRef,
      isAncestor,
      statusRecords: async (cwd: string) => {
        calls.push(cwd);
        // Vacuity pin on the seam: the real decode runs and agrees the tree
        // is clean, so every path named below came off the injected value.
        expect(await statusRecords(cwd)).toEqual([]);
        return planted;
      },
    },
  };
  const gate = harnessGates({
    phase,
    declaration,
    engine: wired,
    putDown,
    declared: [],
  }).find(
    (g) => g.name === "clean-tree",
  );
  if (!gate) throw new Error(`the package's set has no gate named "clean-tree"`);

  await write("src/widget.ts", `export const widget = "shipped";\n`);
  const span = commitAll("build: the tick's whole output");
  const ctx = ctxFor(span, { phaseName: "build", entry: assigned("MINE") });

  const refused: GateResult = await gate.run(ctx);

  // Asked once, for the worktree the engine reported on the context.
  expect(calls).toEqual([repo]);
  expect(refused.ok).toBe(false);
  // The verdict stays the gate's: a tracked edit is residue wherever it
  // sits, an untracked file inside the fence is the tick's, and one outside
  // it is not.
  expect(refused.details).toBe("spec/a page.md (M)\nsrc/a widget.ts (??)");
});

/** A sha as every message this gate writes names one. */
const short = (sha: string): string => sha.slice(0, 7);

/**
 * The derive slice's state through the package's **own writer** — the one a
 * slice's tick writes this artifact with. A hand-authored JSON fixture here
 * would re-author, by the tester's hand, the vocabulary the gate's reader
 * decodes, which is the half of this seam worth holding
 * (`.claude/rules/engineering.md`, *A seam gate reads what the real writer
 * wrote*).
 */
const writeState = (derivedThrough: string): void =>
  writePlanState(join(repo, STATE_ROOT), "plan-derive", { derivedThrough });

/**
 * The sweep slice's state, same writer — the second cursor the package
 * declares, in the second slice's own file. One file per writer, so a commit
 * carrying this one is judged on `sweptThrough` alone (`spec/harness.md`,
 * *Plan state as declared state*).
 *
 * The rotation rides the same write because it is the same file and the same
 * writer: a case about a cursor stamped under an open rotation cannot hand
 * the gate a rotation the slice's own writer never accepted.
 */
const writeSweepState = (
  sweptThrough: string,
  rotation: PlanStateWriteOf<"plan-sweep">["rotation"] = { kind: "closed" },
): void =>
  writePlanState(join(repo, STATE_ROOT), "plan-sweep", {
    sweptThrough,
    rotation,
  });

/** Every lane's drained-run stamp as the inbox slice's own writer takes them. */
type LaneStamps = NonNullable<PlanStateWriteOf<"plan-inbox">["drainedRuns"]>;

/**
 * The inbox slice's state, same writer — plan state that holds **no cursor**,
 * so a commit carrying it alone is judged on the slice's own rule and on
 * nothing the ancestry probe reads.
 */
const writeInboxState = (
  drainedRuns: LaneStamps = { lint: { run: "17", titles: [] } },
): void =>
  writePlanState(join(repo, STATE_ROOT), "plan-inbox", { drainedRuns });

/**
 * A real commit the gated branch cannot reach — what a cursor stepped
 * sideways names. Called on a clean tree, so nothing of the case's own rides
 * across with the checkout.
 */
async function offHistory(): Promise<string> {
  const branch = git(repo, ["rev-parse", "--abbrev-ref", "HEAD"]);
  git(repo, ["checkout", "-q", "-b", "off-history"]);
  await write("src/side.ts", `export const side = true;\n`);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "side: a commit this branch never sees"]);
  const sha = git(repo, ["rev-parse", "HEAD"]);
  git(repo, ["checkout", "-q", branch]);
  return sha;
}

/**
 * The slice-state gate, and the two state paths it keys the package's two
 * cursor-holding slices on — derive's file for `derivedThrough`, sweep's for
 * `sweptThrough` (`harness/planState.ts`, `JUDGED_SLICES`).
 */
const sliceState = (): Gate => named("slice-state");
const STATE_PATH = planStatePath(STATE_ROOT, "plan-derive");
const SWEEP_STATE_PATH = planStatePath(STATE_ROOT, "plan-sweep");
const INBOX_STATE_PATH = planStatePath(STATE_ROOT, "plan-inbox");

it("the slice-state gate refuses a plan commit whose derive cursor is not an ancestor of the tip", async () => {
  const stray = await offHistory();
  const reachable = git(repo, ["rev-parse", "HEAD"]);

  // A cursor the commit does reach, first: the same gate on the same repo
  // rules green, so the refusal below is the ancestry probe and not a gate
  // that refuses every plan state it is handed.
  writeState(reachable);
  const within = commitAll("plan: a cursor inside the commit's own history");
  expect(within.touchedPaths).toContain(STATE_PATH);
  const passed = await sliceState().run(ctxFor(within, { phaseName: "plan-derive" }));
  expect(passed).toMatchObject({ ok: true });
  expect(passed.skipped).toBeUndefined();

  writeState(stray);
  const span = commitAll("plan: a cursor stepped onto a sha this history has not got");
  const refused = await sliceState().run(ctxFor(span, { phaseName: "plan-derive" }));

  expect(refused.ok).toBe(false);
  // Both shas, because the fix is a cursor value and the tip is what bounds it.
  expect(refused.details).toContain(
    `derivedThrough ${short(stray)} is not an ancestor of the gated commit ${short(span.commitSha)}`,
  );
});

it("the slice-state gate refuses a plan commit whose derive cursor is not a descendant of its pre-commit value", async () => {
  const first = git(repo, ["rev-parse", "HEAD"]);
  await write("src/widget.ts", `export const widget = "second";\n`);
  const second = commitAll("build: a second commit to step the cursor over").commitSha;

  writeState(second);
  const ahead = commitAll("plan: derive through the tip");
  const passed = await sliceState().run(ctxFor(ahead, { phaseName: "plan-derive" }));
  expect(passed).toMatchObject({ ok: true });
  expect(passed.skipped).toBeUndefined();

  // Backwards onto a commit the tick had already derived through. Still an
  // ancestor of the tip, so only the pre-commit half can catch it.
  writeState(first);
  const span = commitAll("plan: step the cursor back over derived history");
  const refused = await sliceState().run(ctxFor(span, { phaseName: "plan-derive" }));

  expect(refused.ok).toBe(false);
  expect(refused.details).toContain(
    `derivedThrough ${short(second)} -> ${short(first)} is not a step forward`,
  );
  // The one half that could fire did; the tip half agrees the cursor is reachable.
  expect((refused.details ?? "").split("\n")).toHaveLength(1);
  expect(refused.details).not.toContain("is not an ancestor of the gated commit");
});

it("the slice-state gate passes a plan commit that steps its derive cursor forward within its own history", async () => {
  const first = git(repo, ["rev-parse", "HEAD"]);
  writeState(first);
  const stamped = commitAll("plan: stamp the first cursor");
  expect(await sliceState().run(ctxFor(stamped, { phaseName: "plan-derive" }))).toMatchObject({
    ok: true,
  });

  await write("src/widget.ts", `export const widget = "second";\n`);
  const second = commitAll("build: a commit for the cursor to step over").commitSha;
  writeState(second);
  const span = commitAll("plan: step the derive cursor over the commit it derived");
  // Vacuity pin: the gate only judges a cursor the span actually carries.
  expect(span.touchedPaths).toContain(STATE_PATH);

  const passed = await sliceState().run(ctxFor(span, { phaseName: "plan-derive" }));

  expect(passed.ok).toBe(true);
  // Judged, not skipped, and naming both ends of the step it read — which is
  // the arm a commit with no pre-commit value never reaches.
  expect(passed.skipped).toBeUndefined();
  expect(passed.message).toContain(`${short(first)} -> ${short(second)}`);
});

it("a plan commit touching no judged slice's state file is skipped by the slice-state gate", async () => {
  // A judged run first, so the skip below is the untouched artifact's verdict
  // and not a gate that never rules on anything.
  writeState(git(repo, ["rev-parse", "HEAD"]));
  const judged = await sliceState().run(
    ctxFor(commitAll("plan: stamp the cursor"), { phaseName: "plan-derive" }),
  );
  expect(judged).toMatchObject({ ok: true });
  expect(judged.skipped).toBeUndefined();

  await write("src/widget.ts", `export const widget = "shipped";\n`);
  const span = commitAll("build: ship the work, write no plan state");
  expect(span.touchedPaths).not.toContain(STATE_PATH);
  expect(span.touchedPaths).not.toContain(SWEEP_STATE_PATH);
  expect(span.touchedPaths).not.toContain(INBOX_STATE_PATH);

  const skipped = await sliceState().run(
    ctxFor(span, { phaseName: "build", entry: assigned("MINE") }),
  );

  // Vacuous by design, and spelled: the plan state the commit did not touch
  // still holds whatever the commit that wrote it was held to.
  expect(skipped.ok).toBe(true);
  expect(skipped.skipped).toBe(
    "no judged slice's state file is in the gated span",
  );
  expect(skipped.message).toContain("moves nothing this gate holds");

  // And the skip is the path's verdict rather than a slice's: the inbox's
  // file holds no cursor, and a commit carrying it alone is still judged —
  // on the one rule that slice states about itself.
  writeInboxState();
  const sibling = commitAll("plan: stamp the inbox's drained run alone");
  expect(sibling.touchedPaths).toContain(INBOX_STATE_PATH);
  expect(sibling.touchedPaths).not.toContain(STATE_PATH);
  expect(sibling.touchedPaths).not.toContain(SWEEP_STATE_PATH);

  const elsewhere = await sliceState().run(
    ctxFor(sibling, { phaseName: "plan-inbox" }),
  );
  expect(elsewhere.ok).toBe(true);
  expect(elsewhere.skipped).toBeUndefined();
});

it("the slice-state gate skips a state root resolved outside the repository", async () => {
  // A commit that genuinely carries a judged slice's state: read against the
  // repo's own state root, the same span is judged.
  writeState(git(repo, ["rev-parse", "HEAD"]));
  const span = commitAll("plan: stamp the cursor beside a relocated state root");
  expect(span.touchedPaths).toContain(STATE_PATH);
  const judged = await sliceState().run(
    ctxFor(span, { phaseName: "plan-derive" }),
  );
  expect(judged).toMatchObject({ ok: true });
  expect(judged.skipped).toBeUndefined();
  expect(judged.message).toContain("derivedThrough");

  // The offset the engine reports for a state root outside the repo: absent,
  // because no path in a commit's tree can address it.
  const relocated = { segments: ["..", "elsewhere", ".flume"] };
  expect(
    computeStateRootRel(repo, join(repo, ...relocated.segments)),
  ).toBeUndefined();

  const skipped = await sliceState().run(
    ctxFor(span, { phaseName: "plan-derive", stateRoot: relocated }),
  );

  // Same span, same cursor file in it, and still no judgement — the skip is
  // the reported offset's, spelled on the verdict. No path this commit
  // carries can address the state the gate holds, so there is no cursor here
  // to rule on.
  expect(skipped.ok).toBe(true);
  expect(skipped.skipped).toBe(
    "no commit can carry the plan state under a relocated state root",
  );
  expect(skipped.message).toBe("the state root is outside the repository");
});

/**
 * The inbox's lane stamps, held to the one thing its own file says about a
 * move: a lane the slice has drained stays drained. No cursor rides this
 * file, so the ancestry halves are not reached and the rule is the whole
 * verdict (`harness/planState.ts`, `JUDGED_SLICES`).
 */
it("a plan commit that stamps a new lane beside a standing one is not refused", async () => {
  writeInboxState({ lint: { run: "17", titles: ["a lint title"] } });
  const standing = commitAll("plan: stamp the lane this slice drained");
  // Vacuity pin: the base really carries the lane the commit below stands a
  // second one beside, so the pair is a real move and not a first write.
  expect(standing.touchedPaths).toContain(INBOX_STATE_PATH);
  expect(
    await sliceState().run(ctxFor(standing, { phaseName: "plan-inbox" })),
  ).toMatchObject({ ok: true });

  // A second lane drained this tick, the first copied forward, and the first
  // advanced to a later run: each keeps every lane the base stamped.
  writeInboxState({
    lint: { run: "17", titles: ["a lint title"] },
    e2e: { run: "5", titles: [] },
  });
  const beside = commitAll("plan: drain a second lane, copy the first forward");
  expect(
    await sliceState().run(ctxFor(beside, { phaseName: "plan-inbox" })),
  ).toMatchObject({ ok: true });

  writeInboxState({
    lint: { run: "23", titles: [] },
    e2e: { run: "5", titles: [] },
  });
  const advanced = commitAll("plan: drain the first lane's later run");
  expect(
    await sliceState().run(ctxFor(advanced, { phaseName: "plan-inbox" })),
  ).toMatchObject({ ok: true });
});

it("the slice-state gate refuses a plan commit that drops a lane's drained-run stamp", async () => {
  writeInboxState({
    lint: { run: "17", titles: ["a lint title"] },
    e2e: { run: "5", titles: [] },
  });
  const standing = commitAll("plan: stamp the two lanes this slice drained");
  expect(standing.touchedPaths).toContain(INBOX_STATE_PATH);
  const passed = await sliceState().run(
    ctxFor(standing, { phaseName: "plan-inbox" }),
  );
  // Judged, not skipped — so the refusal below is the slice's own rule and
  // not a gate that refuses every inbox state it is handed.
  expect(passed).toMatchObject({ ok: true });
  expect(passed.skipped).toBeUndefined();

  // The lane the tick did not drain, not copied forward. Nothing about the
  // file says it was ever drained after this, so the slice wakes back into
  // the run it already filed.
  writeInboxState({ e2e: { run: "5", titles: [] } });
  const span = commitAll("plan: rewrite the stamp file without the lane it drained");

  const refused = await sliceState().run(ctxFor(span, { phaseName: "plan-inbox" }));

  expect(refused.ok).toBe(false);
  expect((refused.details ?? "").split("\n")).toHaveLength(1);
  expect(refused.details).toContain("plan-inbox state at");
  expect(refused.details).toContain("1 lane(s) (lint)");
});

/**
 * The refusal's **headline**, read over the one case whose every clause comes
 * off a slice's own rule: it says what this gate checks itself and how many
 * clauses ride under it, and each rule's wording reaches the tick through the
 * detail lines alone. A headline rostering the rules is the second copy the
 * next rule forgets to join (`.claude/rules/engineering.md`, *Derived state
 * is computed, never restated beside its source*).
 *
 * The negative reads the headline and nothing around it — one line this gate
 * composed, which is the arm the case is about — never the verdict, whose
 * details quote a slice's rule on purpose. The roster is read off
 * `JUDGED_SLICES` rather than spelled here, so a fourth slice widens this
 * case by joining that list.
 */
it("the slice-state gate's refusal over a dropped lane stamp names no slice's own rule in its headline", async () => {
  writeInboxState({
    lint: { run: "17", titles: ["a lint title"] },
    e2e: { run: "5", titles: [] },
  });
  commitAll("plan: stamp the two lanes this slice drained");

  writeInboxState({ e2e: { run: "5", titles: [] } });
  const span = commitAll("plan: rewrite the stamp file without the lane it drained");
  const refused = await sliceState().run(
    ctxFor(span, { phaseName: "plan-inbox" }),
  );

  // Vacuity pin: the clause under the headline really is the inbox slice's
  // own rule firing, so the headline below is read over a refusal that has a
  // rule to have rostered.
  expect(refused.ok).toBe(false);
  expect(refused.details).toContain("1 lane(s) (lint)");

  const headline = refused.message;
  expect(headline).toContain("1 plan-state problem(s)");
  expect(headline).toContain("cursor");
  for (const slice of JUDGED_SLICES) {
    expect(headline).not.toContain(slice);
    expect(headline).not.toContain(slice.replace(/^plan-/, ""));
  }
});

/**
 * The sweep cursor, held to the same two halves as derive's — the bound the
 * gate's name now states over every cursor the package declares, rather than
 * over the one field it used to read (`spec/harness.md`, *The gates the
 * discipline needs*).
 *
 * Both cases key on sweep's own file, written through the package's own
 * writer, so nothing here re-authors what "sweep stamped its cursor" looks
 * like on disk.
 */
it("a plan commit whose sweptThrough is not an ancestor of the commit is refused", async () => {
  const stray = await offHistory();
  const reachable = git(repo, ["rev-parse", "HEAD"]);

  // A cursor the commit does reach, first: the same gate on the same repo
  // rules green over sweep's file, so the refusal below is the ancestry probe
  // and not a gate that refuses every sweep state it is handed.
  writeSweepState(reachable);
  const within = commitAll("plan: a sweep cursor inside the commit's own history");
  expect(within.touchedPaths).toContain(SWEEP_STATE_PATH);
  const passed = await sliceState().run(ctxFor(within, { phaseName: "plan-sweep" }));
  expect(passed).toMatchObject({ ok: true });
  expect(passed.skipped).toBeUndefined();

  writeSweepState(stray);
  const span = commitAll("plan: a sweep cursor stepped onto a sha this history has not got");
  const refused = await sliceState().run(ctxFor(span, { phaseName: "plan-sweep" }));

  expect(refused.ok).toBe(false);
  // Named by its own field, because the fix is that cursor's value and the
  // message is what says which slice's file to repair.
  expect(refused.details).toContain(
    `sweptThrough ${short(stray)} is not an ancestor of the gated commit ${short(span.commitSha)}`,
  );
});

it("a plan commit whose sweptThrough is not a descendant of its pre-commit value is refused", async () => {
  const first = git(repo, ["rev-parse", "HEAD"]);
  await write("src/widget.ts", `export const widget = "second";\n`);
  const second = commitAll("build: a second commit for the sweep to stamp past").commitSha;

  writeSweepState(second);
  const ahead = commitAll("plan: sweep through the tip");
  const passed = await sliceState().run(ctxFor(ahead, { phaseName: "plan-sweep" }));
  expect(passed).toMatchObject({ ok: true });
  expect(passed.skipped).toBeUndefined();

  // Backwards onto a commit the rotation had already been drawn past. Still
  // an ancestor of the tip, so only the pre-commit half can catch it.
  writeSweepState(first);
  const span = commitAll("plan: step the sweep cursor back over swept history");
  const refused = await sliceState().run(ctxFor(span, { phaseName: "plan-sweep" }));

  expect(refused.ok).toBe(false);
  expect(refused.details).toContain(
    `sweptThrough ${short(second)} -> ${short(first)} is not a step forward`,
  );
  // The one half that could fire did; the tip half agrees the cursor is reachable.
  expect((refused.details ?? "").split("\n")).toHaveLength(1);
  expect(refused.details).not.toContain("is not an ancestor of the gated commit");
});

/**
 * The sweep's third half: its own state at the commit has to allow the step.
 * A rotation stands open over the frontier the *old* stamp drew, and its
 * covered set is settled for that window — so a tick that moves the stamp
 * while the rotation is still open throws away the coverage nobody re-derives
 * (`spec/harness.md`, *The gates the discipline needs*).
 */
it("a plan commit moving sweptThrough while its rotation is open is refused", async () => {
  const first = git(repo, ["rev-parse", "HEAD"]);
  await write("src/widget.ts", `export const widget = "second";\n`);
  const second = commitAll("build: a commit for the sweep to stamp past").commitSha;

  // A rotation armed over the first stamp, cursor unchanged: a real sweep
  // tick, and green — the rule is about moving the stamp, not about holding
  // an open rotation, so this arm proves the gate is not refusing the latter.
  writeSweepState(first, { kind: "open", covered: ["src/widget.ts"] });
  const armed = commitAll("plan: arm a rotation over the frontier at the stamp");
  expect(armed.touchedPaths).toContain(SWEEP_STATE_PATH);
  const opened = await sliceState().run(ctxFor(armed, { phaseName: "plan-sweep" }));
  expect(opened).toMatchObject({ ok: true });
  expect(opened.skipped).toBeUndefined();

  // Same open rotation, stamp stepped forward over history the commit does
  // carry: both ancestry halves agree, and only the slice's own rule can
  // catch it.
  writeSweepState(second, { kind: "open", covered: ["src/widget.ts"] });
  const span = commitAll("plan: stamp the sweep cursor with the rotation still open");
  const refused = await sliceState().run(ctxFor(span, { phaseName: "plan-sweep" }));

  expect(refused.ok).toBe(false);
  expect((refused.details ?? "").split("\n")).toHaveLength(1);
  expect(refused.details).toContain(
    `plan-sweep state at ${short(span.commitSha)} is not a move its own invariants allow`,
  );
  expect(refused.details).toContain(
    "sweptThrough moved while the rotation it stamps under is still open",
  );
  // The two ancestry halves are not what fired: the step itself was sound.
  expect(refused.details).not.toContain("is not an ancestor of the gated commit");
  expect(refused.details).not.toContain("is not a step forward");
});

/**
 * The same move on the tick that closes the rotation — the one tick the sweep
 * stamps on. Derive's cursor beside it, declaring no such rule and held to
 * the ancestry bound alone, so the rule is read off the cursor rather than
 * applied to whichever field the gate happens to be judging.
 */
it("a plan commit moving sweptThrough on the tick that closes its rotation is allowed", async () => {
  const first = git(repo, ["rev-parse", "HEAD"]);
  writeSweepState(first, { kind: "open", covered: ["src/widget.ts"] });
  writeState(first);
  const stamped = commitAll("plan: stamp both cursors, sweep mid-rotation");
  // Vacuity pin: both files ride the span, so both cursors have a pre-commit
  // value for the move below to be judged against.
  expect(stamped.touchedPaths).toContain(SWEEP_STATE_PATH);
  expect(stamped.touchedPaths).toContain(STATE_PATH);
  expect(await sliceState().run(ctxFor(stamped, { phaseName: "plan-sweep" }))).toMatchObject({
    ok: true,
  });

  await write("src/widget.ts", `export const widget = "second";\n`);
  const second = commitAll("build: a commit for both cursors to step over").commitSha;
  writeSweepState(second, { kind: "closed" });
  writeState(second);
  const span = commitAll("plan: close the rotation and stamp both cursors at the tip");

  const passed = await sliceState().run(ctxFor(span, { phaseName: "plan-sweep" }));

  expect(passed.ok).toBe(true);
  // Judged, not skipped, and naming both steps it read.
  expect(passed.skipped).toBeUndefined();
  expect(passed.message).toContain(
    `sweptThrough ${short(first)} -> ${short(second)}`,
  );
  expect(passed.message).toContain(
    `derivedThrough ${short(first)} -> ${short(second)}`,
  );
});

/**
 * The rotation's own arming tick, and the arm a rule keyed on a **changed
 * cursor value** could never have reached: the stamp stands still while the
 * slice rewrites its own state to open a rotation over the frontier that
 * stamp already drew (`spec/harness.md`, *The frontier is read off git*).
 *
 * Read as a rule over the pair rather than over the step, so the tick that
 * opens a rotation is green and the tick that drops what one covered is not.
 */
it("a plan commit that arms a rotation over an unchanged stamp is not refused", async () => {
  const stamp = git(repo, ["rev-parse", "HEAD"]);

  writeSweepState(stamp, { kind: "closed" });
  const quiet = commitAll("plan: a closed rotation, stamped at the tip");
  // Vacuity pin: the span carries sweep's file, so the commit below has a
  // pre-commit rotation to be judged against.
  expect(quiet.touchedPaths).toContain(SWEEP_STATE_PATH);
  expect(
    await sliceState().run(ctxFor(quiet, { phaseName: "plan-sweep" })),
  ).toMatchObject({ ok: true });

  writeSweepState(stamp, { kind: "open", covered: [] });
  const armed = commitAll("plan: arm a rotation over the frontier at the stamp");

  const passed = await sliceState().run(ctxFor(armed, { phaseName: "plan-sweep" }));

  expect(passed.ok).toBe(true);
  // Judged, not skipped: the file was read at both refs and the rules ruled.
  expect(passed.skipped).toBeUndefined();
  expect(passed.message).toContain("plan-sweep within its own rules");
});

/**
 * Coverage is settled for the window, and the cursor holds none of it: a tick
 * that re-draws an open rotation without a neighborhood it already swept
 * moves nothing either ancestry half can see, and the next tick re-sweeps
 * what was paid for while reading as a smaller frontier (`spec/harness.md`,
 * *A neighborhood is a frontier module read with its immediate imports*).
 */
it("a plan commit that drops a module from an open rotation's covered set is refused", async () => {
  const stamp = git(repo, ["rev-parse", "HEAD"]);

  writeSweepState(stamp, {
    kind: "open",
    covered: ["src/widget.ts", "src/other.ts"],
  });
  const opened = commitAll("plan: arm a rotation with two neighborhoods covered");
  expect(opened.touchedPaths).toContain(SWEEP_STATE_PATH);
  expect(
    await sliceState().run(ctxFor(opened, { phaseName: "plan-sweep" })),
  ).toMatchObject({ ok: true });

  // Coverage growing under the same stamp is the sweep's ordinary tick, and
  // green — so the refusal below is the shrink, not a gate refusing every
  // rewritten covered set.
  writeSweepState(stamp, {
    kind: "open",
    covered: ["src/widget.ts", "src/other.ts", "src/third.ts"],
  });
  const grew = commitAll("plan: sweep a third neighborhood into the same rotation");
  const green = await sliceState().run(ctxFor(grew, { phaseName: "plan-sweep" }));
  expect(green).toMatchObject({ ok: true });
  expect(green.skipped).toBeUndefined();

  writeSweepState(stamp, { kind: "open", covered: ["src/widget.ts", "src/third.ts"] });
  const span = commitAll("plan: re-draw the rotation without a module it had swept");

  const refused = await sliceState().run(ctxFor(span, { phaseName: "plan-sweep" }));

  expect(refused.ok).toBe(false);
  expect((refused.details ?? "").split("\n")).toHaveLength(1);
  expect(refused.details).toContain(
    `plan-sweep state at ${short(span.commitSha)} is not a move its own invariants allow`,
  );
  // Named, because the repair is putting that module back in the set.
  expect(refused.details).toContain("dropped 1 module(s) it had already swept");
  expect(refused.details).toContain("src/other.ts");
  // The cursor never moved, so neither ancestry half is what fired.
  expect(refused.details).not.toContain("is not an ancestor of the gated commit");
  expect(refused.details).not.toContain("is not a step forward");
});

/**
 * The same loss at its widest: an open rotation re-armed with nothing covered
 * reads, on every tick after, exactly like a rotation that has swept nothing
 * yet — which is the state the schema calls real.
 */
it("a plan commit that empties an open rotation's covered set is refused", async () => {
  const stamp = git(repo, ["rev-parse", "HEAD"]);

  writeSweepState(stamp, {
    kind: "open",
    covered: ["src/widget.ts", "src/other.ts"],
  });
  const opened = commitAll("plan: arm a rotation with two neighborhoods covered");
  expect(opened.touchedPaths).toContain(SWEEP_STATE_PATH);
  expect(
    await sliceState().run(ctxFor(opened, { phaseName: "plan-sweep" })),
  ).toMatchObject({ ok: true });

  writeSweepState(stamp, { kind: "open", covered: [] });
  const span = commitAll("plan: re-draw the open rotation with nothing covered");

  const refused = await sliceState().run(ctxFor(span, { phaseName: "plan-sweep" }));

  expect(refused.ok).toBe(false);
  expect((refused.details ?? "").split("\n")).toHaveLength(1);
  expect(refused.details).toContain("dropped 2 module(s) it had already swept");
  expect(refused.details).toContain("src/widget.ts, src/other.ts");
});

it("the slice-state gate judges both declared cursors in one commit that moves them", async () => {
  const first = git(repo, ["rev-parse", "HEAD"]);
  writeState(first);
  writeSweepState(first);
  const stamped = commitAll("plan: stamp both cursors");
  // Vacuity pin: the span carries both files, so both arms below are reached.
  expect(stamped.touchedPaths).toContain(STATE_PATH);
  expect(stamped.touchedPaths).toContain(SWEEP_STATE_PATH);
  expect(await sliceState().run(ctxFor(stamped, { phaseName: "plan-derive" }))).toMatchObject({
    ok: true,
  });

  // One cursor stepped forward, the other sideways in the same commit: the
  // gate reports the one problem it found and names the field it is about.
  await write("src/widget.ts", `export const widget = "second";\n`);
  const second = commitAll("build: a commit for a cursor to step over").commitSha;
  const stray = await offHistory();
  writeState(second);
  writeSweepState(stray);
  const span = commitAll("plan: step one cursor forward and one sideways");

  const refused = await sliceState().run(ctxFor(span, { phaseName: "plan-sweep" }));

  expect(refused.ok).toBe(false);
  expect((refused.details ?? "").split("\n")).toHaveLength(1);
  expect(refused.details).toContain(`sweptThrough ${short(stray)}`);
  expect(refused.details).not.toContain("derivedThrough");
});

it("the package's gates precede a consumer's declared gates for the same phase", async () => {
  const declared: Gate[] = [
    { name: "consumer:lint", when: "afterCommit", run: async () => ({ ok: true, message: "lint" }) },
    { name: "consumer:smoke", when: "afterMerge", run: async () => ({ ok: true, message: "smoke" }) },
  ];
  // Vacuity pin: an empty declaration would satisfy every ordering claim below.
  expect(declared.length).toBeGreaterThan(0);

  const set = gates(declared);
  const DISCIPLINE = [
    "records",
    "clean-tree",
    "pending-gate",
    "per cites resolve",
    "slice-state",
  ];
  expect(set.map((g) => g.name)).toEqual([
    ...DISCIPLINE,
    ...declared.map((g) => g.name),
  ]);
  // The consumer's own values, in order, after the package's own — not
  // copies, and not interleaved.
  expect(set.slice(DISCIPLINE.length)).toEqual(declared);

  // And the package's pending gate is wired to the consumer's declared
  // fence: an entry declaring a file build could never write is refused
  // here, at plan's own commit, rather than burning a build tick.
  const gate = named("pending-gate", declared);
  await writeQueue([queueEntry("IN-FENCE", { edit: "src/widget.ts" })]);
  const inFence = await gate.run(
    ctxFor(commitAll("plan: an entry inside build's fence"), {
      phaseName: "plan-derive",
    }),
  );
  expect(inFence).toMatchObject({ ok: true });

  await writeQueue([queueEntry("OUT-OF-FENCE", { edit: "docs/design.md" })]);
  const refused = await gate.run(
    ctxFor(commitAll("plan: an entry outside build's fence"), {
      phaseName: "plan-derive",
    }),
  );
  expect(refused.ok).toBe(false);
  expect(refused.details).toContain("OUT-OF-FENCE");
  expect(refused.details).toContain("docs/design.md");
});

/** One queued entry owed to the lane a case names. */
const laneEntry = (tag: string, lane: string): PendingEntry => ({
  ...queueEntry(tag),
  laneTests: [{ lane, title: "walls a path only that host refuses" }],
});

/** The lane names a declaration carries, as the gate's composition reads them. */
const laneNames = (decl: Declaration): string[] =>
  (decl.ci ?? []).map((lane) => lane.name);

/**
 * `laneTests[]` against the declared CI lanes (`spec/harness.md`, *The
 * judges*). The line is **owed** to its lane and closed by nothing else — the
 * judge reports the lane verbatim and the inbox slice reads findings per
 * declared lane — so a lane the declaration never carried is a line owed
 * forever: never green, never filed.
 *
 * The three cases are driven at the gate rather than at the schema, because
 * the claim is that two declared values meet: a declaration a consumer could
 * have written goes through the package's own schema, the factory composes the
 * extension from it, and the real pending gate parses a real queue file at a
 * real commit (`.claude/rules/engineering.md`, *A seam gate reads what the
 * real writer wrote*).
 */
it("a laneTests[] line naming a lane the declaration's ci does not carry is refused", async () => {
  // Vacuity pin: the declaration carries a lane, so the refusal below is about
  // this name and not about an empty set — that case is the next one.
  expect(laneNames(withCiLane)).toEqual([CI_LANE.name]);

  await writeQueue([laneEntry("OWED-TO-NOBODY", "macos")]);
  const refused = await named("pending-gate", [], withCiLane).run(
    ctxFor(commitAll("plan: file a line owed to a lane nobody declared"), {
      phaseName: "plan-derive",
    }),
  );

  expect(refused.ok).toBe(false);
  expect(refused.details).toContain("laneTests");
  expect(refused.details).toContain("macos");
  // And the operator is told which lanes there are, so the next tick does not
  // guess at the same refusal.
  expect(refused.details).toContain(CI_LANE.name);
});

it("a laneTests[] line is refused when the declaration carries no ci at all", async () => {
  // The lane named below is one another declaration does carry, so what this
  // case judges is the declaration rather than the spelling.
  expect(laneNames(declaration)).toEqual([]);
  expect(laneNames(withCiLane)).toContain(CI_LANE.name);

  await writeQueue([laneEntry("NO-LANE-AT-ALL", CI_LANE.name)]);
  const refused = await named("pending-gate").run(
    ctxFor(commitAll("plan: file a line under a declaration with no ci"), {
      phaseName: "plan-derive",
    }),
  );

  expect(refused.ok).toBe(false);
  expect(refused.details).toContain("laneTests");
  expect(refused.details).toContain("no `ci`");
});

it("a laneTests[] line naming a declared CI lane parses", async () => {
  expect(laneNames(withCiLane)).toContain(CI_LANE.name);

  // Vacuity pin: the entry really carries a line, so the green below is a
  // verdict over a parsed `laneTests[]` rather than over an entry without one.
  const entry = laneEntry("OWED-TO-A-LANE", CI_LANE.name);
  expect(entry.laneTests).toHaveLength(1);

  await writeQueue([entry]);
  const passed = await named("pending-gate", [], withCiLane).run(
    ctxFor(commitAll("plan: file a line owed to a declared lane"), {
      phaseName: "plan-derive",
    }),
  );

  expect(passed).toMatchObject({ ok: true });
});

/**
 * The merged-tree placement of the pending gate — the one member of the set
 * that is not uniform across phases (`harness/gates.ts`). It carries the
 * claim check, whose subject is the queue a commit rewrote, so it is wired to
 * the phases that produce the queue and to no other.
 *
 * Read off the real factory for each declared phase, never a list restated
 * here: a slice added to `PLAN_SLICES` joins this case with it.
 */
it("the merged-tree pending gate is wired to every plan slice, and to build never", () => {
  const placements = (name: string): string[] =>
    harnessGates({
      phase: { name, writablePaths: [...BUILD_FENCE] },
      declaration,
      engine,
      putDown,
    })
      .filter((g) => g.name === "pending-gate")
      .map((g) => g.when);

  // Vacuity pin: there are slices to judge, and each carries the gate at
  // both points — the producer's own commit and the merged tree.
  expect(PLAN_SLICES.length).toBeGreaterThan(0);
  for (const slice of PLAN_SLICES) {
    expect(placements(slice)).toEqual(["afterCommit", "afterMerge"]);
  }
  expect(placements(BUILD_PHASE)).toEqual(["afterCommit"]);
});

/**
 * The other half of that claim check's subject: the entry's **records**
 * (`spec/pending.md`, *A claim covers the entry's records*). The engine
 * carries the mechanism and the package declares the paths, so this is where
 * "the paths are this package's note homes" is pinned — over the real
 * factory, a real claim on disk, and a real commit that folds the note away.
 *
 * Both sides of the wiring are asserted: a producer's set refuses, and
 * build's passes the identical span, because a build tick *holds* the claim
 * on the entry whose note it writes.
 */
it("the package's claim check covers a claimed entry's note, and build's own set leaves it alone", async () => {
  await writeQueue([queueEntry("HELD")]);
  await write(`${STATE_ROOT}/plan/notes/HELD.md`, "# Held\n\nmid-flight\n");
  commitAll("plan: queue an entry and its note");

  // A drain folding the note away while a build tick carries the entry.
  await rm(join(repo, STATE_ROOT, "plan", "notes", "HELD.md"));
  const span = commitAll("plan: fold the note");
  // Non-vacuity: the span is the note alone, so the verdict below is the
  // records half of the check and not the ledger half riding along.
  expect(span.touchedPaths).toEqual([`${STATE_ROOT}/plan/notes/HELD.md`]);

  const { commonDir, segment } = await checkoutAddress(repo);
  const claim = entryClaimPath(commonDir, segment, entryClaimSlug("HELD"));
  await mkdir(dirname(claim), { recursive: true });
  await writeFile(claim, renderPidClaim(process.pid, new Date()));

  const setFor = (name: string): Gate[] =>
    harnessGates({
      phase: { name, writablePaths: [...BUILD_FENCE] },
      declaration,
      engine,
      putDown,
    }).filter((g) => g.name === "pending-gate");

  const producer = setFor("plan-derive");
  // Every placement the producer carries refuses it — the check is the
  // gate's, not one placement's.
  for (const gate of producer) {
    const result = await gate.run(ctxFor(span, { phaseName: "plan-derive" }));
    expect(result.ok).toBe(false);
    expect(result.details).toContain(
      `  [HELD] ${STATE_ROOT}/plan/notes/HELD.md is claimed by pid ${process.pid}`,
    );
  }
  // Vacuity pin: there were placements to judge.
  expect(producer.length).toBeGreaterThan(0);

  // And build, whose tick is the claim's own holder, passes the same span.
  const build = setFor(BUILD_PHASE);
  expect(build.length).toBeGreaterThan(0);
  for (const gate of build) {
    expect((await gate.run(ctxFor(span, { phaseName: BUILD_PHASE }))).ok).toBe(
      true,
    );
  }
});

/**
 * The inventory a consumer reads before the hover text, read against the set
 * the factory builds (`.claude/rules/engineering.md`, *Narration is the
 * ladder's bottom rung*, the `docs/` carve-out): the page states which gates
 * the package brings to a commit, so it is pinned for what it says against
 * the interface it describes.
 *
 * The names come from the real factory over the real declaration, the same
 * calls every other case here runs — so a gate added to the set reds this
 * until the page names it, and a rename carries the page with it. **Every
 * phase's set, not build's:** a member wired to the queue's producers alone
 * is absent from build's, and a demand read off build would let the page drop
 * it with nothing red.
 *
 * The span is cut to the adoption section rather than the page read whole:
 * `docs/CHAIN-AUTHORING.md` documents `pending-gate` and the records gates at
 * length further down, so a whole-page read would report every name found
 * wherever it fell and pass over an inventory naming none of them.
 */
it("docs/CHAIN-AUTHORING.md names every gate the package's discipline set holds", async () => {
  const names = new Set([
    ...gates().map((g) => g.name),
    ...PLAN_SLICES.flatMap((slice) => sliceGates(slice).map((g) => g.name)),
  ]);
  // Vacuity pin: an empty set is named in full by every page there is, and a
  // demand drawn off build alone would miss every producer-only member.
  expect(names.size).toBeGreaterThan(0);
  expect(names).toContain("goal rank");

  const page = await readFile(
    new URL("../docs/CHAIN-AUTHORING.md", import.meta.url),
    "utf8",
  );
  const inventory = sectionOf(page, "## First: do you need to write one?");

  // The cut landed on the inventory: without this a renamed heading reports
  // no missing gate over no text at all.
  expect(inventory).toContain("**The harness package**");

  expect(
    [...names].filter((name) => !inventory.includes(`\`${name}\``)),
  ).toEqual([]);
});
