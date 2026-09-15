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
 * written. Record paths are composed from `records.ts` — nothing here spells
 * `plan/notes` — so a layout rename moves these cases with it.
 */

import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, expect, it } from "vitest";

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
import { readFileAtRef } from "../src/git.ts";
import type { PendingEntry } from "../src/PendingSchema.ts";
import type { Runner, RunnerFactory } from "../harness/runner.ts";

/**
 * The engine, as a chain hands it in: the real builtin and the real at-ref
 * reader, never a stand-in. A stubbed reader would decide for itself what
 * "absent from the commit" means, which is half of what the records gate is.
 */
const engine: GateEngine = { pendingGate, git: { readFileAtRef } };

/** The state root every case addresses, repo-relative. */
const STATE_ROOT = ".flume";

/**
 * A nested state root, as a job namespace produces one: its segments under
 * the repo, and the offset the engine reports for it.
 *
 * The reported form is `relative()`'s, which is the **host's** dialect — so
 * on win32 a root more than one segment deep arrives backslash-separated.
 * Spelled here rather than computed because a posix run cannot produce that
 * shape, and it is the shape every record path the gate matches still has to
 * be composed from.
 */
const NESTED = {
  segments: ["jobs", "alpha", ".flume"],
  rel: String.raw`jobs\alpha\.flume`,
};

/** The runner a declared factory returns here; no case runs a test. */
const runner = {
  run: async () => ({ ok: true, passed: [], failures: [], failingFiles: [] }),
  runAtBase: async () => ({ ok: true, passed: [], failures: [], failingFiles: [] }),
  lanes: [],
} as unknown as Runner;

/** The runner as it is declared: a factory over the engine's API. */
const runnerFactory: RunnerFactory = () => runner;

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
  execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();

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

/** One queued entry: the engine core plus every package extension field. */
const queueEntry = (
  tag: string,
  over: { per?: { path: string; section: string }; edit?: string } = {},
): Record<string, unknown> => ({
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
 * repo root by default, or the nested root a case names, whose host path and
 * reported offset travel together.
 */
function ctxFor(
  span: Span,
  over: {
    phaseName: string;
    entry?: PendingEntry;
    stateRoot?: { segments: string[]; rel: string };
  },
): GateContext {
  const flumeDir = over.stateRoot
    ? join(repo, ...over.stateRoot.segments)
    : join(repo, STATE_ROOT);
  return {
    cwd: repo,
    repoRoot: repo,
    flumeDir,
    stateRootRel: over.stateRoot?.rel ?? computeStateRootRel(repo, flumeDir),
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
const assigned = (tag: string): PendingEntry =>
  queueEntry(tag) as unknown as PendingEntry;

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
  repo = await mkdtemp(join(tmpdir(), "flume-harness-gates-"));
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

it("the records gate matches a touched record under a backslash-separated state root", async () => {
  // The two spellings are one root: what the case writes on disk, and what
  // the engine reports as the offset to it.
  expect(NESTED.rel.split("\\").join("/")).toBe(NESTED.segments.join("/"));

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

it("the records gate refuses a record past the byte cap", async () => {
  const body = "x".repeat(RECORD_MAX_BYTES);
  await write(notePath(STATE_ROOT, "MINE"), `# too much\n\n${body}\n`);
  const refused = await records(commitAll("build: a note past the cap"), {
    phaseName: "build",
    entry: assigned("MINE"),
  });

  expect(refused.ok).toBe(false);
  expect(refused.details).toContain(`cap ${RECORD_MAX_BYTES}`);
  // The cap is the package's, and the message reports what was measured.
  expect(refused.details).toContain(`${RECORD_MAX_BYTES + 13} bytes`);
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
