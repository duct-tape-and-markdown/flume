/**
 * The harness package's gate set (`spec/harness.md`, *The gates the
 * discipline needs*): what each of the four refuses, and that all four sit
 * ahead of whatever a consumer declared.
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

import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  RECORD_MAX_BYTES,
  harnessGates,
  notePath,
  notesDir,
  parseDeclaration,
  recordDirs,
  type Declaration,
  type GateEngine,
} from "../harness/index.ts";
import { pendingGate } from "../src/builtinGates.ts";
import { computeStateRootRel } from "../src/Dispatcher.ts";
import type { Gate, GateContext, GateResult } from "../src/Gate.ts";
import { readFileAtRef, statusRecords } from "../src/git.ts";
import { matchesAny } from "../src/paths.ts";
import type { PendingEntry } from "../src/PendingSchema.ts";
import type { RunnerFactory } from "../harness/runner.ts";
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
  git: { readFileAtRef, statusRecords },
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
const BUILD_FENCE = ["src/**", "tests/**", `${notesDir(STATE_ROOT)}/*.md`];

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

/** The phase the set is built for — build's fence, as declared. */
const phase = { writablePaths: [...BUILD_FENCE] };

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

const writeQueue = (entries: readonly unknown[]): Promise<void> =>
  write(`${STATE_ROOT}/plan/pending.json`, `${JSON.stringify(entries, null, 2)}\n`);

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
    pendingPath: join(flumeDir, "plan", "pending.json"),
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

/** The package's set for this phase, plus whatever the case declares. */
const gates = (declared: readonly Gate[] = []): Gate[] =>
  harnessGates({ phase, declaration, engine, declared });

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
  const raw = await readFileAtRef(
    repo,
    span.commitSha,
    `${STATE_ROOT}/plan/pending.json`,
  );
  expect(raw).not.toBeNull();
  expect(JSON.parse(raw ?? "null")).toEqual([]);

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

  const skipped = await records(span, {
    phaseName: "build",
    entry: assigned("MINE"),
  });

  // Vacuous by design, and spelled: a tick that wrote no record has nothing
  // to be held to, and the verdict says so rather than reading as judged.
  expect(skipped.ok).toBe(true);
  expect(skipped.skipped).toBe("no record in the gated span");
  expect(skipped.message).toBe("the commit touches no record");
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
  const skipped = await records(span, {
    phaseName: "build",
    entry: assigned("MINE"),
  });

  expect(skipped.ok).toBe(true);
  expect(skipped.skipped).toBe("no record in the gated span");

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
      statusRecords: async (cwd: string) => {
        calls.push(cwd);
        // Vacuity pin on the seam: the real decode runs and agrees the tree
        // is clean, so every path named below came off the injected value.
        expect(await statusRecords(cwd)).toEqual([]);
        return planted;
      },
    },
  };
  const gate = harnessGates({ phase, declaration, engine: wired, declared: [] }).find(
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

it("the package's gates precede a consumer's declared gates for the same phase", async () => {
  const declared: Gate[] = [
    { name: "consumer:lint", when: "afterCommit", run: async () => ({ ok: true, message: "lint" }) },
    { name: "consumer:smoke", when: "afterMerge", run: async () => ({ ok: true, message: "smoke" }) },
  ];
  // Vacuity pin: an empty declaration would satisfy every ordering claim below.
  expect(declared.length).toBeGreaterThan(0);

  const set = gates(declared);
  expect(set.map((g) => g.name)).toEqual([
    "records",
    "clean-tree",
    "pending-gate",
    "per cites resolve",
    ...declared.map((g) => g.name),
  ]);
  // The consumer's own values, in order, after the package's four — not
  // copies, and not interleaved.
  expect(set.slice(4)).toEqual(declared);

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
