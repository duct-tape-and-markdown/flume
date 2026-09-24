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
  parkedNotePath,
  parseDeclaration,
  planStatePath,
  recordDirs,
  writePlanState,
  type Declaration,
  type GateEngine,
} from "../harness/index.ts";
import { pendingGate } from "../src/builtinGates.ts";
import type { Gate, GateContext, GateResult } from "../src/Gate.ts";
import { isAncestor, readFileAtRef, statusRecords } from "../src/git.ts";
import { readQueueAtRef } from "../src/pendingLedger.ts";
import { entryFileName } from "../src/PendingSchema.ts";
import { computeStateRootRel, matchesAny } from "../src/paths.ts";
import type { PendingEntry } from "../src/PendingSchema.ts";
import { BUILD_PHASE, PLAN_SLICES } from "../harness/declaration.ts";
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
 * The engine, as a chain hands it in: the real builtin, the real at-ref
 * reader and the real status decode, never a stand-in. A stubbed reader
 * would decide for itself what "absent from the commit" means, which is half
 * of what the records gate is; a stubbed decode would re-author, by the
 * tester's hand, the porcelain vocabulary the clean-tree gate exists to read
 * (`.claude/rules/engineering.md`, *A seam gate reads what the real writer
 * wrote*).
 */
const engine: GateEngine = {
  pendingGate,
  git: { readFileAtRef, readQueueAtRef, isAncestor, statusRecords },
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
const declaration: Declaration = parseDeclaration({
  specLocus: ["spec/**"],
  fence: { build: BUILD_FENCE, "plan-derive": [`${STATE_ROOT}/plan/**`] },
  runner: runnerFactory,
  slices: { enabled: ["plan-derive"] },
});

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
  over: { per?: { path: string; section: string }; edit?: string } = {},
): PendingEntry => ({
  tag,
  gate: { kind: "open" },
  dependsOnForks: [],
  priority: 0,
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

/** The package's set for this phase, plus whatever the case declares. */
const gates = (declared: readonly Gate[] = []): Gate[] =>
  harnessGates({ phase, declaration, engine, putDown, declared });

/** The gate this set names `name` — by name, never by index. */
function named(name: string, declared: readonly Gate[] = []): Gate {
  const gate = gates(declared).find((g) => g.name === name);
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

it("the records gate refuses a parked note written under another tick's tag", async () => {
  const entry = assigned("MINE");
  const own = parkedNotePath(STATE_ROOT, "MINE");

  // The tick's own park is a record this gate admits like any other: which of
  // its two notes a tick wrote is the park verdict, and that is the chain's to
  // read (`harness/chain.ts`), never this gate's to judge.
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
  // And the refusal names both notes this tick may write, so a tick that
  // wrote the wrong tag is told where its own two are.
  expect(refused.details).toContain(own);
  expect(refused.details).toContain(notePath(STATE_ROOT, "MINE"));
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
  expect(refused.details).toContain(`${tracked} (M)`);
  expect(refused.details).not.toContain(`"`);
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
    git: {
      readFileAtRef,
      readQueueAtRef,
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
 */
const writeSweepState = (sweptThrough: string): void =>
  writePlanState(join(repo, STATE_ROOT), "plan-sweep", {
    sweptThrough,
    rotation: { kind: "closed" },
  });

/**
 * The inbox slice's state, same writer — plan state that holds **no cursor**,
 * so a commit carrying it alone is what the gate's path skip is about now
 * that both cursor files are judged.
 */
const writeInboxState = (): void =>
  writePlanState(join(repo, STATE_ROOT), "plan-inbox", {
    drainedRuns: { lint: { run: "17", titles: [] } },
  });

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
 * The cursor gate, and the two state paths it keys the package's two declared
 * cursors on — derive's file for `derivedThrough`, sweep's for `sweptThrough`
 * (`harness/planState.ts`, `CURSOR_FIELDS`).
 */
const cursor = (): Gate => named("plan cursors");
const STATE_PATH = planStatePath(STATE_ROOT, "plan-derive");
const SWEEP_STATE_PATH = planStatePath(STATE_ROOT, "plan-sweep");

it("the cursor gate refuses a plan commit whose derive cursor is not an ancestor of the tip", async () => {
  const stray = await offHistory();
  const reachable = git(repo, ["rev-parse", "HEAD"]);

  // A cursor the commit does reach, first: the same gate on the same repo
  // rules green, so the refusal below is the ancestry probe and not a gate
  // that refuses every plan state it is handed.
  writeState(reachable);
  const within = commitAll("plan: a cursor inside the commit's own history");
  expect(within.touchedPaths).toContain(STATE_PATH);
  const passed = await cursor().run(ctxFor(within, { phaseName: "plan-derive" }));
  expect(passed).toMatchObject({ ok: true });
  expect(passed.skipped).toBeUndefined();

  writeState(stray);
  const span = commitAll("plan: a cursor stepped onto a sha this history has not got");
  const refused = await cursor().run(ctxFor(span, { phaseName: "plan-derive" }));

  expect(refused.ok).toBe(false);
  // Both shas, because the fix is a cursor value and the tip is what bounds it.
  expect(refused.details).toContain(
    `derivedThrough ${short(stray)} is not an ancestor of the gated commit ${short(span.commitSha)}`,
  );
});

it("the cursor gate refuses a plan commit whose derive cursor is not a descendant of its pre-commit value", async () => {
  const first = git(repo, ["rev-parse", "HEAD"]);
  await write("src/widget.ts", `export const widget = "second";\n`);
  const second = commitAll("build: a second commit to step the cursor over").commitSha;

  writeState(second);
  const ahead = commitAll("plan: derive through the tip");
  const passed = await cursor().run(ctxFor(ahead, { phaseName: "plan-derive" }));
  expect(passed).toMatchObject({ ok: true });
  expect(passed.skipped).toBeUndefined();

  // Backwards onto a commit the tick had already derived through. Still an
  // ancestor of the tip, so only the pre-commit half can catch it.
  writeState(first);
  const span = commitAll("plan: step the cursor back over derived history");
  const refused = await cursor().run(ctxFor(span, { phaseName: "plan-derive" }));

  expect(refused.ok).toBe(false);
  expect(refused.details).toContain(
    `derivedThrough ${short(second)} -> ${short(first)} is not a step forward`,
  );
  // The one half that could fire did; the tip half agrees the cursor is reachable.
  expect((refused.details ?? "").split("\n")).toHaveLength(1);
  expect(refused.details).not.toContain("is not an ancestor of the gated commit");
});

it("the cursor gate passes a plan commit that steps its derive cursor forward within its own history", async () => {
  const first = git(repo, ["rev-parse", "HEAD"]);
  writeState(first);
  const stamped = commitAll("plan: stamp the first cursor");
  expect(await cursor().run(ctxFor(stamped, { phaseName: "plan-derive" }))).toMatchObject({
    ok: true,
  });

  await write("src/widget.ts", `export const widget = "second";\n`);
  const second = commitAll("build: a commit for the cursor to step over").commitSha;
  writeState(second);
  const span = commitAll("plan: step the derive cursor over the commit it derived");
  // Vacuity pin: the gate only judges a cursor the span actually carries.
  expect(span.touchedPaths).toContain(STATE_PATH);

  const passed = await cursor().run(ctxFor(span, { phaseName: "plan-derive" }));

  expect(passed.ok).toBe(true);
  // Judged, not skipped, and naming both ends of the step it read — which is
  // the arm a commit with no pre-commit value never reaches.
  expect(passed.skipped).toBeUndefined();
  expect(passed.message).toContain(`${short(first)} -> ${short(second)}`);
});

it("a plan commit touching no slice's cursor file is skipped by the cursor gate", async () => {
  // A judged run first, so the skip below is the untouched artifact's verdict
  // and not a gate that never rules on anything.
  writeState(git(repo, ["rev-parse", "HEAD"]));
  const judged = await cursor().run(
    ctxFor(commitAll("plan: stamp the cursor"), { phaseName: "plan-derive" }),
  );
  expect(judged).toMatchObject({ ok: true });
  expect(judged.skipped).toBeUndefined();

  await write("src/widget.ts", `export const widget = "shipped";\n`);
  const span = commitAll("build: ship the work, write no cursor");
  expect(span.touchedPaths).not.toContain(STATE_PATH);
  expect(span.touchedPaths).not.toContain(SWEEP_STATE_PATH);

  const skipped = await cursor().run(
    ctxFor(span, { phaseName: "build", entry: assigned("MINE") }),
  );

  // Vacuous by design, and spelled: the plan state the commit did not touch
  // still holds whatever the commit that wrote it was held to.
  expect(skipped.ok).toBe(true);
  expect(skipped.skipped).toBe(
    "no declared cursor's state file is in the gated span",
  );
  expect(skipped.message).toContain("moves no cursor");

  // And plan state holding no cursor at all is the same skip, on the same
  // path test: the inbox slice's file is one file per writer like any other,
  // and no field of it is a cursor, so this gate has nothing to judge
  // (`spec/harness.md`, *Plan state as declared state*).
  writeInboxState();
  const sibling = commitAll("plan: stamp the inbox's drained run alone");
  expect(sibling.touchedPaths).toContain(planStatePath(STATE_ROOT, "plan-inbox"));
  expect(sibling.touchedPaths).not.toContain(STATE_PATH);
  expect(sibling.touchedPaths).not.toContain(SWEEP_STATE_PATH);

  const elsewhere = await cursor().run(
    ctxFor(sibling, { phaseName: "plan-inbox" }),
  );
  expect(elsewhere.ok).toBe(true);
  expect(elsewhere.skipped).toBe(
    "no declared cursor's state file is in the gated span",
  );
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
  const passed = await cursor().run(ctxFor(within, { phaseName: "plan-sweep" }));
  expect(passed).toMatchObject({ ok: true });
  expect(passed.skipped).toBeUndefined();

  writeSweepState(stray);
  const span = commitAll("plan: a sweep cursor stepped onto a sha this history has not got");
  const refused = await cursor().run(ctxFor(span, { phaseName: "plan-sweep" }));

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
  const passed = await cursor().run(ctxFor(ahead, { phaseName: "plan-sweep" }));
  expect(passed).toMatchObject({ ok: true });
  expect(passed.skipped).toBeUndefined();

  // Backwards onto a commit the rotation had already been drawn past. Still
  // an ancestor of the tip, so only the pre-commit half can catch it.
  writeSweepState(first);
  const span = commitAll("plan: step the sweep cursor back over swept history");
  const refused = await cursor().run(ctxFor(span, { phaseName: "plan-sweep" }));

  expect(refused.ok).toBe(false);
  expect(refused.details).toContain(
    `sweptThrough ${short(second)} -> ${short(first)} is not a step forward`,
  );
  // The one half that could fire did; the tip half agrees the cursor is reachable.
  expect((refused.details ?? "").split("\n")).toHaveLength(1);
  expect(refused.details).not.toContain("is not an ancestor of the gated commit");
});

it("the cursor gate judges both declared cursors in one commit that moves them", async () => {
  const first = git(repo, ["rev-parse", "HEAD"]);
  writeState(first);
  writeSweepState(first);
  const stamped = commitAll("plan: stamp both cursors");
  // Vacuity pin: the span carries both files, so both arms below are reached.
  expect(stamped.touchedPaths).toContain(STATE_PATH);
  expect(stamped.touchedPaths).toContain(SWEEP_STATE_PATH);
  expect(await cursor().run(ctxFor(stamped, { phaseName: "plan-derive" }))).toMatchObject({
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

  const refused = await cursor().run(ctxFor(span, { phaseName: "plan-sweep" }));

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
    "plan cursors",
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
 * The inventory a consumer reads before the hover text, read against the set
 * the factory builds (`.claude/rules/engineering.md`, *Narration is the
 * ladder's bottom rung*, the `docs/` carve-out): the page states which gates
 * the package brings to a commit, so it is pinned for what it says against
 * the interface it describes.
 *
 * The names come from `gates()` — the real factory over the real declaration,
 * the same call every other case here runs — so a sixth gate added to the set
 * reds this until the page names it, and a rename carries the page with it.
 *
 * The span is cut to the adoption section rather than the page read whole:
 * `docs/CHAIN-AUTHORING.md` documents `pending-gate` and the records gates at
 * length further down, so a whole-page read would report every name found
 * wherever it fell and pass over an inventory naming none of them.
 */
it("docs/CHAIN-AUTHORING.md names every gate the package's discipline set holds", async () => {
  const names = gates().map((g) => g.name);
  // Vacuity pin: an empty set is named in full by every page there is.
  expect(names.length).toBeGreaterThan(0);

  const page = await readFile(
    new URL("../docs/CHAIN-AUTHORING.md", import.meta.url),
    "utf8",
  );
  const inventory = sectionOf(page, "## First: do you need to write one?");

  // The cut landed on the inventory: without this a renamed heading reports
  // no missing gate over no text at all.
  expect(inventory).toContain("**The harness package**");

  expect(names.filter((name) => !inventory.includes(`\`${name}\``))).toEqual([]);
});
