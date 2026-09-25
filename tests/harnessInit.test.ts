/**
 * `flume-harness init` (`spec/harness.md`, *Adoption and upgrade*) — the
 * artifacts adoption writes, and the refusal that keeps it from running twice.
 *
 * The cases here are agreement gates (`.claude/rules/engineering.md`, *A seam
 * gate reads what the real writer wrote*): the real writer is `harnessInit`
 * over a real temporary repository, and the readers are the real ones — the
 * package's own `DeclarationSchema` over the skeleton it wrote, `tsx`'s
 * module loader over that skeleton as a consumer's chain would load it, the
 * engine's own `loadChainModule` over the `chain.ts` it wrote, `tsc` over
 * both against the package's exported types, and `consumerIgnores` over the
 * `.gitignore` lines it merged. A hand-authored expectation of any of them
 * would re-author the writer's output by the tester's hand and let a
 * one-sided change ship green.
 *
 * The one thing simulated is the install: a temporary repository has no
 * `node_modules`, so the package specifier the skeleton imports is satisfied
 * by a shim that re-exports this checkout's `harness/index.ts` at runtime,
 * and by a `paths` entry pointing at the same file at typecheck. The bytes
 * being judged are still the writer's, and the schema and the type judging
 * them are still the package's.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  consumerIgnores,
  harnessInit,
  parseDeclaration,
  planSliceWindows,
  readPlanState,
  DEFAULT_STATE_ROOT,
  planStatePath,
  protocolTemplatePath,
  type HarnessInitResult,
  type PlanSlice,
  type PlanSliceWindow,
} from "../harness/index.ts";
import { INBOX_PHASE, PLAN_SLICES } from "../harness/declaration.ts";
import { entryExtension } from "../harness/entryExtension.ts";
import { HELP_TOP, isSubcommand } from "../src/cliHelp.ts";
import { parsePendingQueue } from "../src/PendingSchema.ts";
import { readQueueOnDisk } from "../src/pendingLedger.ts";
import { queueDir } from "../harness/layout.ts";
import { resolvePendingDir } from "../src/paths.ts";
import { mkTempDir } from "./helpers/fixtureRoot.ts";
import {
  SPAWN_BUDGET_MS,
  TSX_CLI,
  exec,
  gitOut,
  runNodeStreams,
} from "./helpers/subprocess.ts";

// This file starts processes, so it declares the lane's one budget — cases
// and hooks alike — once here rather than inheriting the runner's default
// (`SPAWN_BUDGET_MS`, `tests/helpers/subprocess.ts`).
vi.setConfig({ testTimeout: SPAWN_BUDGET_MS, hookTimeout: SPAWN_BUDGET_MS });

/** This checkout's harness entry point — what the install shim re-exports. */
const HARNESS_INDEX = fileURLToPath(new URL("../harness/index.ts", import.meta.url));

/**
 * This checkout's engine entry point — the package root, which the written
 * `chain.ts` imports `ChainFactory` from. Type-only there, so it is the
 * typecheck that needs it and never the loader.
 */
const ENGINE_INDEX = fileURLToPath(new URL("../src/index.ts", import.meta.url));

/** The engine's real chain loader, for the probe that drives it in-process. */
const CHAIN_LOAD = new URL("../src/chainLoad.ts", import.meta.url).href;

/**
 * The harness package's own command line — the module `bin/flume-harness.js`
 * executes, run here the way that shim runs it: as an entry point, with an
 * argv of its own. The argv half is only reachable as a process, so the
 * cases that judge it start one.
 */
const HARNESS_CLI = fileURLToPath(new URL("../harness/cli.ts", import.meta.url));

let repoRoot: string;

beforeEach(async () => {
  // A bare root, not `mkFixtureRoot`: the fixture's bay is the subject here,
  // and init refuses a state root that is already present.
  repoRoot = await mkTempDir("flume-harness-init-");
});

afterEach(async () => {
  await rm(repoRoot, { recursive: true, force: true });
});

/**
 * Satisfy the package specifier the skeleton imports, without an install:
 * `<root>/node_modules/<name>` re-exporting this checkout's harness entry
 * point through the same `./harness` subpath the published `exports` map
 * declares. The name comes off the init result rather than being spelled
 * here, so the shim answers whatever specifier the writer actually wrote.
 */
async function installShim(root: string, packageName: string): Promise<void> {
  const dir = join(root, "node_modules", ...packageName.split("/"));
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({
      name: packageName,
      type: "module",
      exports: { "./harness": "./harness.mjs" },
    }),
  );
  await writeFile(
    join(dir, "harness.mjs"),
    `export * from ${JSON.stringify(pathToFileURL(HARNESS_INDEX).href)};\n`,
  );
}

it("flume-harness init writes a declaration.ts skeleton the package's schema parses", async () => {
  const result = await harnessInit({ repoRoot });
  await installShim(repoRoot, result.packageName);

  // Non-vacuity: the file the loader is about to read is the one init wrote,
  // and it imports the package by the specifier init recorded.
  expect(result.written).toContain(`${result.stateRoot}/declaration.ts`);
  const source = await readFile(
    join(repoRoot, result.stateRoot, "declaration.ts"),
    "utf8",
  );
  expect(source).toContain(`from "${result.packageName}/harness"`);

  // Loaded the way a consumer's chain loads it — `tsx` over the `.ts` on
  // disk, in a process rooted at the consumer's repository, resolving the
  // bare specifier through its own `node_modules` — and parsed by the
  // package's real schema, which throws naming every field at fault. A
  // skeleton that does not compile, imports a name the package does not
  // export, or misses a required field reds here rather than at a
  // consumer's first tick.
  const probe = join(repoRoot, "parse-declaration.mjs");
  await writeFile(
    probe,
    `import { parseDeclaration } from ${JSON.stringify(`${result.packageName}/harness`)};\n` +
      `const module = await import("./${result.stateRoot}/declaration.ts");\n` +
      `const declaration = parseDeclaration(module.default);\n` +
      `process.stdout.write(JSON.stringify({\n` +
      `  specLocus: declaration.specLocus,\n` +
      `  fenceBuild: declaration.fence.build,\n` +
      `  slices: declaration.slices.enabled,\n` +
      `  runner: typeof declaration.runner,\n` +
      `}));\n`,
  );

  const parsed = await runNodeStreams(repoRoot, [TSX_CLI, probe]);
  expect({ code: parsed.code, stderr: parsed.stderr }).toEqual({ code: 0, stderr: "" });

  // The fields a tick cannot run without arrived as values, not as absences
  // a default filled in behind the parse.
  const declaration = JSON.parse(parsed.stdout) as {
    specLocus: string[];
    fenceBuild: string[];
    slices: string[];
    runner: string;
  };
  expect(declaration.specLocus.length).toBeGreaterThan(0);
  expect(declaration.fenceBuild.length).toBeGreaterThan(0);
  expect(declaration.slices.length).toBeGreaterThan(0);
  // The runner arrived as the factory the chain calls at load, not as a
  // built value the skeleton resolved without an API.
  expect(declaration.runner).toBe("function");
}, SPAWN_BUDGET_MS);

it("flume-harness init writes the state root and its derived ignore lines", async () => {
  // A `.gitignore` the consumer already maintains: the merge preserves it,
  // and its presence proves the lines below were appended rather than the
  // file being written from scratch.
  await writeFile(join(repoRoot, ".gitignore"), "node_modules/\ndist/\n", "utf8");

  const result = await harnessInit({ repoRoot });

  expect(statSync(join(repoRoot, result.stateRoot)).isDirectory()).toBe(true);

  // The real derivation, not a list by the tester's hand — and non-empty
  // first, since an empty set would satisfy every containment below.
  const derived = consumerIgnores(result.stateRoot);
  expect(derived.length).toBeGreaterThan(0);

  expect(result.ignoreLines).toEqual(derived);
  const written = await readFile(join(repoRoot, ".gitignore"), "utf8");
  expect(written.split(/\r?\n/).filter((line) => line !== "")).toEqual([
    "node_modules/",
    "dist/",
    ...derived,
  ]);

  // Idempotent in the only direction a consumer can reach it: a second
  // adoption into a fresh root beside the same `.gitignore` appends nothing
  // it already carries.
  await rm(join(repoRoot, result.stateRoot), { recursive: true });
  const again = await harnessInit({ repoRoot });
  expect(again.ignoreLines).toEqual([]);
});

/**
 * The queue is the one artifact an adopted repository needs before its first
 * tick that no tick writes (`spec/harness.md`, *Adoption and upgrade*): every
 * plan slice opens it with a bare reader, so absence walls each of them
 * (`tests/harnessPrompts.test.ts`, *each plan slice prompt's verdict on an
 * absent queue follows whether its spans read that artifact*), and only a
 * plan tick that got to run would write one. Seeded here, or the first wave
 * never starts.
 *
 * A directory now, and a placeholder file inside it (`spec/pending.md`, *The
 * ledger is a directory — one entry per file*): git holds no empty directory,
 * so the seed has to carry a file of its own or the queue vanishes from the
 * tree and the pending gate fails the first plan commit over a queue that was
 * simply drained.
 *
 * Addressed through the engine's own `resolvePendingDir` rather than a
 * layout spelled by the tester: a queue seeded at a path the dispatcher does
 * not resolve reds here instead of at a consumer's first tick, and the
 * reported line through the package's own `queueDir` (`harness/layout.ts`),
 * which is the one home the fence reads it from too.
 */
it("flume-harness init seeds an empty queue directory in the state root", async () => {
  const result = await harnessInit({ repoRoot });

  const pending = resolvePendingDir(join(repoRoot, result.stateRoot));
  expect(existsSync(pending)).toBe(true);
  expect(statSync(pending).isDirectory()).toBe(true);

  // Exactly one file, and it is not an entry: the engine reads only
  // `*.json` directly under the directory, so the seed leaves a queue that
  // is present and empty rather than present and carrying a phantom.
  expect(readdirSync(pending)).toEqual([".gitkeep"]);

  // And reported: `written` is the list a consumer commits the adoption from,
  // so a file on disk that no line names is one their first commit drops.
  // The expectation is the same derivation the writer reports through, in
  // git's alphabet, since that is what the rest of the list is in.
  expect(result.written).toContain(`${queueDir(result.stateRoot)}/.gitkeep`);
});

/**
 * The agreement gate behind the case above (`.claude/rules/engineering.md`,
 * *A seam gate reads what the real writer wrote*): the writer is
 * `harnessInit` and the reader is the engine's real listing plus
 * `parsePendingQueue`, composed with the package's own entry extension — the
 * pair a consumer's first plan tick and its `pending-gate` meet this
 * directory through. A seed that read as something other than zero entries
 * would hand that tick a phantom.
 */
it("the queue directory flume-harness init writes reads as an empty pending queue", async () => {
  const result = await harnessInit({ repoRoot });
  const stateRoot = join(repoRoot, result.stateRoot);
  const files = readQueueOnDisk(stateRoot, resolvePendingDir(stateRoot));

  // Non-vacuity: the directory is there to be listed, so the empty entry
  // list below is the reader's verdict on a real directory rather than on an
  // absent one.
  expect(files).not.toBeNull();

  const parsed = parsePendingQueue(files ?? [], entryExtension());
  expect({ ok: parsed.ok, errors: parsed.errors }).toEqual({
    ok: true,
    errors: [],
  });
  expect(parsed.entries).toEqual([]);
});

/**
 * A repository with one commit in it, for the cases below that need an
 * adopting tip. Not `makeScratchRepo`: that fixture roots at a bay, and init
 * refuses a state root that is already there — the whole subject here is what
 * the adoption puts in one.
 *
 * Returns the tip it committed, so a case compares the cursors init stamped
 * against the sha git reports rather than against one the writer reported
 * about itself.
 */
async function commitInto(
  dir: string,
  files: Record<string, string>,
): Promise<string> {
  const opts = { cwd: dir };
  await exec("git", ["init", "-q", "-b", "main"], opts);
  await exec("git", ["config", "user.email", "test@example.com"], opts);
  await exec("git", ["config", "user.name", "Test User"], opts);
  await exec("git", ["config", "commit.gpgsign", "false"], opts);
  for (const [rel, body] of Object.entries(files)) {
    const path = join(dir, ...rel.split("/"));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body, "utf8");
  }
  await exec("git", ["add", "-A"], opts);
  await exec("git", ["commit", "-q", "-m", "seed"], opts);
  return (await gitOut(dir, ["rev-parse", "HEAD"])).trim();
}

/**
 * The plan state is the other artifact an adopted repository needs before its
 * first tick that no tick writes (`spec/harness.md`, *Adoption and upgrade*).
 * Absent, a cursor reads as "nothing derived yet" — which is honest for a
 * state root that has been ticking and true of nothing in a repository that
 * adopted the package this minute: the first derive tick opens over the whole
 * declared spec corpus and the sweep goes live over the whole declared domain,
 * all of it written before the package was ever part of this repository.
 *
 * Seeded at the tip the adopter ran init on, so the first plan wave is about
 * what lands next.
 */
it("flume-harness init seeds each cursor-carrying slice's state at the tip it adopted", async () => {
  const tip = await commitInto(repoRoot, { "spec/loop.md": "# Loop\n" });

  const result = await harnessInit({ repoRoot });
  const stateRootAbs = join(repoRoot, result.stateRoot);

  // The clause as a fact on the result, not inferred from the files: the tip
  // stamped is the one the repository was standing at when init read it.
  expect(result.planState).toEqual({ kind: "seeded", tip });

  // Read back through the package's own reader — the one every window opens
  // a cursor through — so a seed this package would refuse reds here rather
  // than at a consumer's first tick.
  const states = PLAN_SLICES.map(
    (slice) => [slice, readPlanState(stateRootAbs, slice)] as const,
  ).filter(([, state]) => state !== undefined);

  // Non-vacuity, and the general claim in the direction the title makes it:
  // the seed wrote something, and every sha-valued field across whatever it
  // wrote stands at the adopting tip — read off the artifacts rather than
  // from a list of cursor names by the tester's hand.
  expect(states.length).toBeGreaterThan(0);
  const stamped = states.flatMap(([, state]) =>
    Object.values(state as Record<string, unknown>).filter(
      (value): value is string => typeof value === "string",
    ),
  );
  expect(stamped.length).toBeGreaterThan(0);
  expect([...new Set(stamped)]).toEqual([tip]);

  // And what each slice starts as, spelled: derive has derived through the
  // tip; the sweep has swept through it with no rotation open, since a
  // rotation over a domain whose whole history predates the adoption is a
  // frontier nobody drew; and the inbox, which carries no cursor, has no file
  // at all — absence is its declared state.
  expect(readPlanState(stateRootAbs, "plan-derive")).toEqual({
    derivedThrough: tip,
  });
  expect(readPlanState(stateRootAbs, "plan-sweep")).toEqual({
    sweptThrough: tip,
    rotation: { kind: "closed" },
  });
  expect(readPlanState(stateRootAbs, INBOX_PHASE)).toBeUndefined();

  // Reported among what was written, like every other file: `written` is the
  // list a consumer commits their adoption from, so a cursor on disk that no
  // line names is one that first commit drops — and the paths come off the
  // package's own layout, which is where the fence and the accessor read them
  // from too.
  for (const [slice] of states) {
    expect(result.written).toContain(planStatePath(result.stateRoot, slice));
  }
}, SPAWN_BUDGET_MS);

/**
 * The agreement gate behind the case above (`.claude/rules/engineering.md`,
 * *A seam gate reads what the real writer wrote*): the writer is `harnessInit`
 * over a real repository with real history, and the reader is the real derive
 * window — the one the wake set and the prompt both come off — over the state
 * the adoption left. A seed at a sha the window cannot resolve, or in a field
 * it does not read, renders as the bootstrap corpus and would pass every
 * assertion about the bytes on disk.
 */
it("a derive window over the state init seeded opens on no commits rather than the bootstrap corpus", async () => {
  const tip = await commitInto(repoRoot, { "spec/loop.md": "# Loop\n" });
  const result = await harnessInit({ repoRoot });
  const stateRootAbs = join(repoRoot, result.stateRoot);

  const built = planSliceWindows({
    declaration: parseDeclaration({
      specLocus: ["spec/**"],
      fence: { build: ["src/**"] },
      runner: () => ({ run: async () => [], runAtBase: async () => [], lanes: [] }),
      slices: { enabled: ["plan-derive"] },
    }),
    repoRoot,
    stateRootRel: result.stateRoot,
  });
  const windows = Object.fromEntries(
    built.map((window) => [window.name, window]),
  ) as Record<PlanSlice, PlanSliceWindow>;
  const derive = windows["plan-derive"];

  // Non-vacuity: the corpus a bootstrap window would have listed in full is
  // really in this tree, committed before the adoption ran — so the empty
  // window below is the seed's doing rather than an empty repository's.
  expect(existsSync(join(repoRoot, "spec", "loop.md"))).toBe(true);

  // Not live: the slice the adopter's first tick would otherwise have spent
  // re-deriving a whole spec history.
  expect(derive.live({ flumeDir: stateRootAbs, pickable: false })).toBe(false);

  // And what its prompt would have been rendered with, read at the line that
  // tells the two windows apart: a range window opens on its own count and
  // names the cursor it counted from; a bootstrap one opens on a bare
  // announcement and the listing of every file in the locus.
  const rendered = derive.args({ cwd: repoRoot, flumeDir: stateRootAbs });
  const specWindow = rendered["SPEC_WINDOW"] ?? "";
  expect(specWindow.length).toBeGreaterThan(0);
  expect(specWindow.split("\n")[0]).toBe(
    `=== 0 commit(s) in the spec locus since ${tip}, among 0 landed alongside ===`,
  );
  expect(specWindow).toContain("(no spec changes since the cursor)");
}, SPAWN_BUDGET_MS);

/**
 * Adopting before the first commit is a real thing to do — the install smoke
 * `git init`s a repository and adopts into it without committing — and a
 * directory that is no checkout at all gives the same answer: no sha for a
 * cursor to stand at. Not a refusal, so the report has to say it: an adopter
 * who reads nothing else learns here why their first plan tick opens over
 * everything they declared.
 */
it("flume-harness init over a repository with no commit reports the plan state it left unseeded", async () => {
  await exec("git", ["init", "-q", "-b", "main"], { cwd: repoRoot });

  const adopted = await runNodeStreams(repoRoot, [TSX_CLI, HARNESS_CLI, "init"]);
  expect({ code: adopted.code, stderr: adopted.stderr }).toEqual({
    code: 0,
    stderr: "",
  });

  // Non-vacuity: the adoption ran and wrote its files, so the absence below
  // is this arm's doing rather than a verb that never got in.
  expect(adopted.stdout).toContain(`wrote     ${DEFAULT_STATE_ROOT}/declaration.ts`);

  // One line about the cursors, and it names the fact rather than a sha it
  // could not have had.
  const cursors = adopted.stdout
    .split(/\r?\n/)
    .filter((line) => line.startsWith("  cursors "));
  expect(cursors.length).toBe(1);
  expect(cursors[0] ?? "").toContain("plan state left unseeded");

  // And nothing on disk for it — no slice's state file, and no line in the
  // written list claiming one.
  const stateRootAbs = join(repoRoot, DEFAULT_STATE_ROOT);
  for (const slice of PLAN_SLICES) {
    expect(readPlanState(stateRootAbs, slice)).toBeUndefined();
  }

  // The same adoption as a library call, where the fact is typed rather than
  // printed: a second bare directory inside the same commitless repository.
  const adopter = join(repoRoot, "adopter");
  await mkdir(adopter, { recursive: true });
  const result = await harnessInit({ repoRoot: adopter });
  expect(result.planState).toEqual({ kind: "no-commit" });
  for (const slice of PLAN_SLICES) {
    expect(result.written).not.toContain(planStatePath(result.stateRoot, slice));
  }
}, SPAWN_BUDGET_MS);

/**
 * The module scope the two `.ts` files beside it load in (`spec/harness.md`,
 * *Adoption and upgrade*). The loader reads `chain.ts` in the mode the
 * *nearest* manifest declares and the package is ESM-only, so a consumer
 * whose own manifest says nothing loads the chain as CommonJS — and the
 * chain init wrote then fails to resolve the package it imports on every
 * node 22 (`.claude/rules/platform-facts.md`, *A CommonJS-scoped `chain.ts`
 * stops loading the ESM-only package at node 22.23*).
 *
 * Both halves are pinned, because nearest-manifest is a directory walk: what
 * the file declares, and that it sits in the directory the chain does. A
 * manifest one directory off is one the loader never reads, and node 24
 * resolves the chain either way — which is how this reached a consumer.
 */
it("flume-harness init writes a state-root package.json declaring type module", async () => {
  const result = await harnessInit({ repoRoot });

  // Reported like every other file init writes: `written` is the list a
  // consumer commits their adoption from, so a manifest no line names is a
  // file that first commit drops — and every later clone loads the chain as
  // CommonJS again.
  const manifestRel = `${result.stateRoot}/package.json`;
  expect(result.written).toContain(manifestRel);

  const raw = await readFile(join(repoRoot, result.stateRoot, "package.json"), "utf8");
  // Non-vacuity: there are bytes on disk, so the parse below is a verdict on
  // a real file rather than on an empty read.
  expect(raw.length).toBeGreaterThan(0);
  // And that is all of it: the file exists to scope the chain, and any other
  // field would be the package declaring something about a repository it
  // adopted into.
  expect(JSON.parse(raw)).toEqual({ type: "module" });

  // Beside the chain, read off the writer's own report rather than a layout
  // spelled here — a directory identity, which is what the walk turns on.
  const chainRel = result.written.find((path) => path.endsWith("/chain.ts"));
  expect(chainRel).toBeTypeOf("string");
  const dirOf = (path: string): string => path.slice(0, path.lastIndexOf("/"));
  expect(dirOf(manifestRel)).toBe(dirOf(chainRel!));
});

it("flume-harness init writes the state root's protocol page from harness/templates/PROTOCOL.md", async () => {
  const template = await readFile(protocolTemplatePath(), "utf8");

  // Non-vacuity, and the premise of the identity below: the shipped template
  // exists, has content, and carries the one placeholder init substitutes.
  expect(template.length).toBeGreaterThan(0);
  expect(template).toContain("{{STATE_ROOT}}");

  const defaulted = await harnessInit({ repoRoot });
  const other = await mkTempDir("flume-harness-init-alt-");
  try {
    const relocated = await harnessInit({ repoRoot: other, stateRoot: ".harness" });

    const read = async (result: HarnessInitResult, root: string): Promise<string> =>
      readFile(join(root, result.stateRoot, "PROTOCOL.md"), "utf8");
    const written = {
      defaulted: await read(defaulted, repoRoot),
      relocated: await read(relocated, other),
    };

    // Both renders are the template with one token replaced by value: mask
    // each one's own state root back out and all three texts coincide. A
    // protocol page composed in `init.ts` instead of read from the template,
    // or a state root baked into the template, breaks the identity.
    const mask = (text: string, token: string): string => text.split(token).join("\0");
    expect(mask(written.defaulted, defaulted.stateRoot)).toBe(
      mask(template, "{{STATE_ROOT}}"),
    );
    expect(mask(written.relocated, relocated.stateRoot)).toBe(
      mask(template, "{{STATE_ROOT}}"),
    );

    // And the substitution ran: the rendered file names the consumer's root
    // and carries no placeholder left for a reader to trip over.
    expect(written.relocated).toContain(".harness/plan/notes");
    expect(written.defaulted).not.toMatch(/\{\{[^}]*\}\}/);
  } finally {
    await rm(other, { recursive: true, force: true });
  }
});

it("flume-harness init refuses a state root that already exists rather than overwriting it", async () => {
  // A repository mid-life: a state root with a declaration its owner has
  // edited, and the two files init would otherwise merge into.
  const stateRoot = join(repoRoot, ".flume");
  await mkdir(stateRoot, { recursive: true });
  const edited = "export default { mine: true };\n";
  await writeFile(join(stateRoot, "declaration.ts"), edited, "utf8");
  const gitignore = "node_modules/\n";
  await writeFile(join(repoRoot, ".gitignore"), gitignore, "utf8");
  const manifest = `${JSON.stringify({ name: "consumer", version: "1.0.0" }, null, 2)}\n`;
  await writeFile(join(repoRoot, "package.json"), manifest, "utf8");

  await expect(harnessInit({ repoRoot })).rejects.toThrow(/already exists/);

  // The refusal is taken before the first byte: the consumer's declaration,
  // its `.gitignore` and its manifest are all exactly as they were, so a
  // second init cannot leave a half-adopted tree behind.
  expect(await readFile(join(stateRoot, "declaration.ts"), "utf8")).toBe(edited);
  expect(await readFile(join(repoRoot, ".gitignore"), "utf8")).toBe(gitignore);
  expect(await readFile(join(repoRoot, "package.json"), "utf8")).toBe(manifest);
  expect(existsSync(join(stateRoot, "PROTOCOL.md"))).toBe(false);
});

/**
 * The consumer's manifest is an input the whole adoption is downstream of, so
 * it is resolved in init's pre-write phase (`.claude/rules/engineering.md`,
 * *Loud or nothing*). Read at the dependency write instead, its `JSON.parse`
 * escapes as a bare `SyntaxError` only after the state root, the three
 * skeleton files and the `.gitignore` merge have landed — and the re-run that
 * would report it refuses on the state root it just created.
 *
 * The input here is hand-authored, which is the sanctioned shape for a
 * refusal case (*A seam gate reads what the real writer wrote*, last bullet):
 * no real writer produces a malformed manifest.
 */
const MALFORMED_MANIFEST = '{\n  "name": "consumer",\n';

it("flume-harness init refuses an unparseable consumer package.json naming the manifest", async () => {
  // Non-vacuity, both ways: the fixture really is unparseable by the parser
  // init reads it with, and the manifest really is the only thing wrong with
  // this repository — a fresh root, so nothing else could refuse first.
  expect(() => JSON.parse(MALFORMED_MANIFEST)).toThrow();
  const manifestPath = join(repoRoot, "package.json");
  await writeFile(manifestPath, MALFORMED_MANIFEST, "utf8");

  const thrown = await harnessInit({ repoRoot }).then(
    () => undefined,
    (reason: unknown) => reason,
  );

  // Flume's own voice, naming the file an operator has to go fix — not the
  // parser's bare "Unexpected end of JSON input", which names nothing.
  expect(thrown).toBeInstanceOf(Error);
  const message = (thrown as Error).message;
  expect(message).toContain("flume-harness init");
  expect(message).toContain(manifestPath);
});

it("flume-harness init leaves the repository untouched when the consumer manifest cannot be parsed", async () => {
  // A repository as an adopter's is: a `.gitignore` init would merge into,
  // and the manifest its dependency line would land in.
  const gitignore = "node_modules/\ndist/\n";
  await writeFile(join(repoRoot, ".gitignore"), gitignore, "utf8");
  await writeFile(join(repoRoot, "package.json"), MALFORMED_MANIFEST, "utf8");

  await expect(harnessInit({ repoRoot })).rejects.toThrow(/flume-harness init/);

  // The refusal came before the first byte. The state root init would have
  // made — named by the package's own default, not spelled here — is absent,
  // so every skeleton file beneath it is too, and the consumer's two files
  // are byte-identical to what they were.
  expect(existsSync(join(repoRoot, DEFAULT_STATE_ROOT))).toBe(false);
  expect(await readFile(join(repoRoot, ".gitignore"), "utf8")).toBe(gitignore);
  expect(await readFile(join(repoRoot, "package.json"), "utf8")).toBe(
    MALFORMED_MANIFEST,
  );
});

/**
 * The refusal's second shape. A manifest that parses fine but is not a JSON
 * object — `null`, an array, a bare scalar — cannot have `dependencies` read
 * off it either, so it is the same unresolved input wearing a `TypeError`
 * instead of a `SyntaxError`, and it refuses in the same pre-write phase.
 *
 * Every arm of that branch gets a fixture: `null` is the one that reached
 * `pkg["dependencies"]` and threw bare before the refusal moved forward, and
 * an array is the arm that would not throw at all — `dependencies` is simply
 * absent on it, so a dropped `Array.isArray` check writes the whole adoption
 * and then silently hangs a dependency field off a JSON list.
 *
 * Hand-authored, for the reason the unparseable pair above is (*A seam gate
 * reads what the real writer wrote*, last bullet).
 */
const NON_OBJECT_MANIFESTS = ["null", "[]", '"consumer"', "42"] as const;

it("flume-harness init refuses a consumer package.json that parses to a non-object before writing anything", async () => {
  // Non-vacuity, and the line between this case and the unparseable pair:
  // each fixture really does parse, and really is not an object once it has.
  expect(NON_OBJECT_MANIFESTS.length).toBeGreaterThan(0);
  for (const source of NON_OBJECT_MANIFESTS) {
    const parsed: unknown = JSON.parse(source);
    expect(typeof parsed !== "object" || parsed === null || Array.isArray(parsed)).toBe(
      true,
    );
  }

  const gitignore = "node_modules/\ndist/\n";
  for (const [index, source] of NON_OBJECT_MANIFESTS.entries()) {
    // A bay of its own per fixture: init writing anything for one shape must
    // not be mistaken for the next shape's tree being dirty.
    const adopter = join(repoRoot, `non-object-${index}`);
    await mkdir(adopter, { recursive: true });
    const manifestPath = join(adopter, "package.json");
    await writeFile(join(adopter, ".gitignore"), gitignore, "utf8");
    await writeFile(manifestPath, source, "utf8");

    const thrown = await harnessInit({ repoRoot: adopter }).then(
      () => undefined,
      (reason: unknown) => reason,
    );

    // Flume's own voice naming the file, not a `TypeError` from the write
    // that would have read `dependencies` off it.
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain("flume-harness init");
    expect((thrown as Error).message).toContain(manifestPath);

    // And the refusal came before the first byte, exactly as the unparseable
    // case's does: no state root, and the consumer's two files untouched.
    expect(existsSync(join(adopter, DEFAULT_STATE_ROOT))).toBe(false);
    expect(await readFile(join(adopter, ".gitignore"), "utf8")).toBe(gitignore);
    expect(await readFile(manifestPath, "utf8")).toBe(source);
  }
});

/**
 * The refusal's third shape, and the only one that never threw at all: a
 * manifest that is a JSON object but hangs a non-object off a dependency
 * field. Spreading a string into the rewrite yields a map of its characters
 * and spreading a scalar or a list yields an empty one, so init wrote the
 * consumer a `dependencies` field they never declared and reported it as a
 * dependency added, with nothing downstream refusing over it
 * (`.claude/rules/engineering.md`, *Loud or nothing*).
 *
 * Hand-authored, for the reason the fixtures above are (*A seam gate reads
 * what the real writer wrote*, last bullet).
 */
const NON_OBJECT_FIELD_VALUES = ['"oops"', "42", "null", "[]"] as const;

/**
 * Drive init over a manifest whose `field` carries each shape above, and
 * assert the refusal names the file and the field with the repository
 * byte-identical to what it was.
 */
async function expectFieldRefusal(field: string): Promise<void> {
  // Non-vacuity: every fixture parses — so none of them is caught by the
  // unparseable case — and none of them is an object once it has.
  expect(NON_OBJECT_FIELD_VALUES.length).toBeGreaterThan(0);
  for (const value of NON_OBJECT_FIELD_VALUES) {
    const parsed: unknown = JSON.parse(value);
    expect(typeof parsed !== "object" || parsed === null || Array.isArray(parsed)).toBe(
      true,
    );
  }

  const gitignore = "node_modules/\ndist/\n";
  for (const [index, value] of NON_OBJECT_FIELD_VALUES.entries()) {
    // A bay of its own per fixture, as the non-object manifests get: a write
    // taken for one shape must not read as the next shape's tree being dirty.
    const adopter = join(repoRoot, `${field}-${index}`);
    await mkdir(adopter, { recursive: true });
    const manifestPath = join(adopter, "package.json");
    const source = `${JSON.stringify(
      { name: "consumer", version: "1.0.0", [field]: JSON.parse(value) },
      null,
      2,
    )}\n`;
    await writeFile(join(adopter, ".gitignore"), gitignore, "utf8");
    await writeFile(manifestPath, source, "utf8");

    const thrown = await harnessInit({ repoRoot: adopter }).then(
      () => undefined,
      (reason: unknown) => reason,
    );

    // Flume's own voice, naming both the file and the field an operator has
    // to go fix — `devDependencies` is not the substring `dependencies`, so
    // each case's assertion discriminates the field it was given.
    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).toContain("flume-harness init");
    expect(message).toContain(manifestPath);
    expect(message).toContain(field);

    // And before the first byte: no state root, and the consumer's two files
    // exactly as they were — in particular the manifest, which is what the
    // adoption used to rewrite into something nobody declared.
    expect(existsSync(join(adopter, DEFAULT_STATE_ROOT))).toBe(false);
    expect(await readFile(join(adopter, ".gitignore"), "utf8")).toBe(gitignore);
    expect(await readFile(manifestPath, "utf8")).toBe(source);
  }
}

it("flume-harness init refuses a consumer package.json whose dependencies field is not an object before writing anything", async () => {
  await expectFieldRefusal("dependencies");
});

it("flume-harness init refuses a consumer package.json whose devDependencies field is not an object before writing anything", async () => {
  await expectFieldRefusal("devDependencies");
});

it("flume-harness init reports the dependency line it added to the consumer's manifest", async () => {
  // A manifest as an adopter's is: a package with a dependency of its own
  // that the rewrite has to carry through untouched.
  const manifestPath = join(repoRoot, "package.json");
  await writeFile(
    manifestPath,
    `${JSON.stringify(
      { name: "consumer", version: "1.0.0", dependencies: { zod: "^3.0.0" } },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const result = await harnessInit({ repoRoot });

  const outcome = result.dependency;
  if (outcome.kind !== "added") {
    throw new Error(`expected an added dependency, got ${outcome.kind}`);
  }
  expect(outcome.manifest).toBe(manifestPath);

  // Agreement, not a hand-authored expectation: the real writer's manifest
  // read back by a real parser, against the line the result reported. What
  // init says it added and what the consumer's file now declares are one
  // fact, at one range.
  const written: unknown = JSON.parse(await readFile(manifestPath, "utf8"));
  expect(written).toMatchObject({
    name: "consumer",
    version: "1.0.0",
    dependencies: { zod: "^3.0.0", [result.packageName]: outcome.range },
  });
  expect(outcome.range).toMatch(/^\^\d+\.\d+\.\d+/);
});

it("flume-harness init reports a dependency the consumer's manifest already declares without rewriting its range", async () => {
  // The specifier comes off a real adoption rather than being spelled here,
  // so the fixture declares whatever package name init actually writes.
  const probe = join(repoRoot, "probe");
  await mkdir(probe, { recursive: true });
  const { packageName } = await harnessInit({ repoRoot: probe });

  // Declared in `devDependencies`, which is where a harness dependency
  // belongs and the field init has to look in to find it already there.
  const adopter = join(repoRoot, "adopter");
  await mkdir(adopter, { recursive: true });
  const manifestPath = join(adopter, "package.json");
  const pinned = "0.9.0";
  const source = `${JSON.stringify(
    {
      name: "consumer",
      version: "1.0.0",
      devDependencies: { [packageName]: pinned },
    },
    null,
    2,
  )}\n`;
  await writeFile(manifestPath, source, "utf8");

  const result = await harnessInit({ repoRoot: adopter });

  expect(result.packageName).toBe(packageName);
  expect(result.dependency).toEqual({
    kind: "declared",
    manifest: manifestPath,
    range: pinned,
  });

  // Byte-identical: a consumer's pin is a decision, so init neither widens
  // it to its own caret range nor migrates the line into `dependencies`.
  expect(await readFile(manifestPath, "utf8")).toBe(source);
});

/**
 * The reason the verb lives on a bin of its own (`spec/harness.md`,
 * *Adoption and upgrade*): the engine's verb set is closed, so `flume` gains
 * no adoption verb however convenient one would be. The import direction
 * behind it — `src/` never importing `harness/` — is pinned separately
 * (`tests/harnessRunner.test.ts`); this is the surface a caller sees.
 */
/**
 * The first command line a consumer types at a verb they have not run before
 * (`spec/harness.md`, *Adoption and upgrade*): usage, exit 0, and nothing
 * written. `init` takes no arguments and refuses one — so the help flag has
 * to be answered above that refusal, or asking what the verb does is a usage
 * error, and the next thing the consumer tries is the verb itself over a
 * repository they have not decided to adopt yet.
 */
it("flume-harness init --help prints usage and exits 0 without writing a state root", async () => {
  const help = await runNodeStreams(repoRoot, [TSX_CLI, HARNESS_CLI, "init", "--help"]);

  expect({ code: help.code, stderr: help.stderr }).toEqual({ code: 0, stderr: "" });
  expect(help.stdout).toContain("Usage: flume-harness");

  // Nothing written: neither the state root the verb exists to create, nor
  // the `.gitignore` it would have merged into.
  expect(existsSync(join(repoRoot, DEFAULT_STATE_ROOT))).toBe(false);
  expect(existsSync(join(repoRoot, ".gitignore"))).toBe(false);

  // Non-vacuity: the same spawn one flag shorter *does* adopt this
  // repository, so the absence above is the flag's doing rather than a child
  // that never reached the verb — which is the shape a stdout assertion and
  // an absence assertion agree on for free.
  const adopted = await runNodeStreams(repoRoot, [TSX_CLI, HARNESS_CLI, "init"]);
  expect({ code: adopted.code, stderr: adopted.stderr }).toEqual({ code: 0, stderr: "" });
  expect(existsSync(join(repoRoot, DEFAULT_STATE_ROOT))).toBe(true);
}, SPAWN_BUDGET_MS);

it("the engine's flume bin exposes no harness verb", async () => {
  // Vacuity: the table is the engine's real one, and answers `true` for a
  // verb it does ship, before any absence is asserted over it.
  expect(isSubcommand("status")).toBe(true);

  expect(isSubcommand("init")).toBe(false);
  expect(isSubcommand("harness")).toBe(false);

  // Nor in the help text a caller reads to find the verbs: the top table
  // lists no adoption command.
  expect(HELP_TOP.length).toBeGreaterThan(0);
  expect(HELP_TOP).not.toMatch(/^ {2}(init|harness)\b/m);

  // And the engine's bin reaches the engine's entry alone — a shim that
  // routed a verb into the harness emit would name it here. Comment lines
  // drop out first: this shim's prose names its sibling, and what is being
  // read is the entry it executes.
  const shim = await readFile(
    fileURLToPath(new URL("../bin/flume.js", import.meta.url)),
    "utf8",
  );
  const code = shim
    .split(/\r?\n/)
    .filter((line) => line !== "" && !line.startsWith("//") && !line.startsWith("#!"))
    .join("\n");
  expect(code).toContain("cli.js");
  expect(code).not.toMatch(/harness/);
});

/**
 * The declaration's shape one rung up the ladder (`.claude/rules/engineering.md`,
 * *Narration is the ladder's bottom rung*): the schema refuses a bad
 * declaration at chain load, and `DeclarationInput` is that same refusal at
 * typecheck, where a consumer's editor can complete into it.
 *
 * An agreement gate like the parse case above, with the reader swapped: the
 * writer is still `harnessInit` over a real repository, and the reader is
 * the real `tsc` over the real exported type, resolving the package
 * specifier the skeleton imports to this checkout's entry point. A
 * hand-written literal here would re-author the skeleton by the tester's
 * hand, and a skeleton that dropped the annotation would still pass.
 */
const TSC_BIN = fileURLToPath(
  new URL("../node_modules/typescript/bin/tsc", import.meta.url),
);

/** This checkout's compiler options — the consumer's typecheck, not a looser one. */
const BASE_TSCONFIG = fileURLToPath(new URL("../tsconfig.json", import.meta.url));

/**
 * Where the ambient types live. `typeRoots` defaults to a walk up from the
 * *config's* directory, and the config below sits in a temporary repository
 * with no `node_modules` of its own — so without this, `@types/node` is out
 * of the program and every `node:` import under `src/` reds for a reason
 * that has nothing to do with the declaration being judged. A real consumer
 * has its own; the fixture borrows this checkout's.
 */
const TYPE_ROOTS = fileURLToPath(
  new URL("../node_modules/@types", import.meta.url),
);

/**
 * Typecheck the modules `result` wrote and nothing else: `files` names them,
 * `include: []` clears the base config's own roots, and `paths` answers both
 * bare specifiers the written files import — the package root and its
 * `/harness` subpath, the two halves of the published `exports` map —
 * without an install. Everything they reach — the package's entry points,
 * its exported types, the engine beneath both — is this checkout's real
 * source.
 */
async function typecheckWritten(
  root: string,
  result: HarnessInitResult,
  files: readonly string[],
): Promise<{ stdout: string; stderr: string; code: number }> {
  const config = join(root, "tsconfig.written.json");
  await writeFile(
    config,
    JSON.stringify({
      extends: BASE_TSCONFIG,
      compilerOptions: {
        paths: {
          [result.packageName]: [ENGINE_INDEX],
          [`${result.packageName}/harness`]: [HARNESS_INDEX],
        },
        typeRoots: [TYPE_ROOTS],
      },
      files,
      include: [],
    }),
    "utf8",
  );
  return runNodeStreams(root, [TSC_BIN, "-p", config]);
}

it("the declaration skeleton init writes typechecks against the package's exported input type", async () => {
  const result = await harnessInit({ repoRoot });
  const declarationPath = join(repoRoot, result.stateRoot, "declaration.ts");
  const source = await readFile(declarationPath, "utf8");

  // Non-vacuity: the bytes about to be typechecked are annotated ones. A
  // skeleton carrying no `satisfies` would compile below while checking
  // nothing, and a skeleton importing the type as a value would resolve
  // differently under a consumer's `verbatimModuleSyntax`.
  expect(source).toContain(
    `import { vitestRunner, type DeclarationInput } from "${result.packageName}/harness"`,
  );
  expect(source).toContain("} satisfies DeclarationInput;");

  const clean = await typecheckWritten(repoRoot, result, [
    `${result.stateRoot}/declaration.ts`,
  ]);
  expect({ code: clean.code, out: clean.stdout }).toEqual({ code: 0, out: "" });

  // And the annotation bears weight. The typo below is exactly what the
  // schema refuses at chain load today — a slice name the package does not
  // ship — so this is the load refusal arriving a rung earlier, naming the
  // field and the valid set the same way.
  const typo = source.replace(`"plan-inbox"`, `"plan-inbx"`);
  expect(typo).not.toBe(source);
  await writeFile(declarationPath, typo, "utf8");

  const broken = await typecheckWritten(repoRoot, result, [
    `${result.stateRoot}/declaration.ts`,
  ]);
  expect(broken.code).not.toBe(0);
  expect(broken.stdout).toContain("plan-inbx");
  expect(broken.stdout).toContain("plan-inbox");
}, SPAWN_BUDGET_MS);

/**
 * The hop that makes an adopted repository tickable (`spec/harness.md`,
 * *Adoption and upgrade*): the engine refuses a load with no
 * `<configDir>/chain.ts`, so adoption writes the one that applies the
 * package's factory to the declaration beside it.
 *
 * Two readers, both real: `tsc` over the written module against the
 * package's exported `ChainFactory`, and the engine's own `loadChainModule`
 * — the single load+validate path the runtime trusts — over the file on
 * disk, from the roots a consumer's tick resolves.
 */
it("init writes a chain.ts applying the package factory to the declaration beside it", async () => {
  const result = await harnessInit({ repoRoot });

  // Non-vacuity: the bytes typechecked below are the hop — the package's
  // factory, over the declaration init wrote beside this file, exported in
  // the shape the engine's loader demands.
  expect(result.written).toContain(`${result.stateRoot}/chain.ts`);
  const source = await readFile(
    join(repoRoot, result.stateRoot, "chain.ts"),
    "utf8",
  );
  expect(source).toContain(
    `import { harnessChain } from "${result.packageName}/harness"`,
  );
  expect(source).toContain("harnessChain({ api, declaration })");
  expect(source).toContain("export default factory;");

  // And it compiles against the real exported types, resolving both bare
  // specifiers to this checkout: a hop annotated `ChainFactory` whose return
  // is not a `ChainModule`, or one importing a name the package does not
  // export, reds here rather than at a consumer's first tick.
  const clean = await typecheckWritten(repoRoot, result, [
    `${result.stateRoot}/chain.ts`,
  ]);
  expect({ code: clean.code, out: clean.stdout }).toEqual({ code: 0, out: "" });
}, SPAWN_BUDGET_MS);

it("the chain.ts init writes loads through the engine's chain loader as a valid Chain", async () => {
  // A repository as the loader meets one: a manifest for init's dependency
  // clause to land in, and the package resolvable by the specifier the
  // written chain imports.
  //
  // The manifest declares no `type`, which is the shape `npm init` produces
  // and the one a consumer reported the chain dying under: the module scope
  // the chain loads in is then the state root's own manifest's, the one init
  // writes beside `chain.ts`. Declaring it here instead would put the whole
  // repository in ESM scope and this case would pass whether init wrote that
  // manifest or not (`.claude/rules/platform-facts.md`, *A CommonJS-scoped
  // `chain.ts` stops loading the ESM-only package at node 22.23*).
  await writeFile(
    join(repoRoot, "package.json"),
    `${JSON.stringify({ name: "consumer", version: "0.0.0" }, null, 2)}\n`,
    "utf8",
  );
  const result = await harnessInit({ repoRoot });
  await installShim(repoRoot, result.packageName);
  expect(result.written).toContain(`${result.stateRoot}/chain.ts`);

  // `loadChainModule` is what every tick and `chainLoadGate` reach a chain
  // through, so driving it over the adopted roots — repo root, and
  // the state root as both config dir and state dir, exactly as a consumer's
  // `flume tick` resolves them — is the load a first tick performs. It runs
  // in a child under `tsx` because the chain resolves its own bare imports
  // from the consumer's `node_modules`, not from this checkout's.
  const configDir = join(repoRoot, result.stateRoot);
  const probe = join(repoRoot, "load-chain.mjs");
  await writeFile(
    probe,
    `import { loadChainModule } from ${JSON.stringify(CHAIN_LOAD)};\n` +
      `const configDir = ${JSON.stringify(configDir)};\n` +
      `const { chain } = await loadChainModule({\n` +
      `  repoRoot: ${JSON.stringify(repoRoot)},\n` +
      `  configDir,\n` +
      `  flumeDir: configDir,\n` +
      `});\n` +
      `const declaration = (await import("./${result.stateRoot}/declaration.ts")).default;\n` +
      `process.stdout.write(JSON.stringify({\n` +
      `  phases: chain.phases.map((p) => p.name),\n` +
      `  enabled: declaration.slices.enabled,\n` +
      `}));\n`,
    "utf8",
  );

  const loaded = await runNodeStreams(repoRoot, [TSX_CLI, probe]);
  expect({ code: loaded.code, stderr: loaded.stderr }).toEqual({
    code: 0,
    stderr: "",
  });

  // A `Chain` the engine validated — the loader throws on a factory shape it
  // cannot use, a promise, or a `phases[]` that is not an array — carrying
  // the phases this declaration asked for: every slice it enabled, and the
  // build phase the package always ships. The expectation comes off the
  // declaration on disk, so a skeleton that enables a different set moves
  // both sides together.
  const { phases, enabled } = JSON.parse(loaded.stdout) as {
    phases: string[];
    enabled: string[];
  };
  expect(enabled.length).toBeGreaterThan(0);
  expect([...phases].sort()).toEqual([...enabled, "build"].sort());
}, SPAWN_BUDGET_MS);
