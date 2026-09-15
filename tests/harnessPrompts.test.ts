/**
 * The prompts the harness package ships (`spec/harness.md`, *The prompts and
 * their discipline*): where each one is addressed, that every address is a
 * file the package actually ships, and that the facts a prompt must not
 * restate reach it from the surface that owns them.
 *
 * The rendering cases here are agreement gates (`.claude/rules/engineering.md`,
 * *A seam gate reads what the real writer wrote*): the real writer is
 * `sharedPromptArgs` over a real parsed declaration and the package's own
 * entry extension, and the real reader is the engine's `renderPrompt` over
 * the shipped markdown. A hand-authored prompt fixture would re-author the
 * placeholder vocabulary by the tester's hand and let a one-sided change — a
 * prompt naming an arg nothing supplies — ship green, which is the failure
 * this file exists to hold.
 */

import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, expect, it } from "vitest";

import { parseDeclaration, type Declaration } from "../harness/declaration.ts";
import { PHASES } from "../harness/declaration.ts";
import { entryExtension } from "../harness/entryExtension.ts";
import {
  PROMPT_NAMES,
  promptPath,
  sharedPromptArgs,
  type PromptName,
} from "../harness/prompts.ts";
import type { Phase } from "../src/Phase.ts";
import { NO_COMMIT_MODES, renderPrompt } from "../src/Prompt.ts";

/** The repo root, and the directory the package's prompts ship in. */
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const PROMPT_DIR = fileURLToPath(new URL("../harness/prompts/", import.meta.url));

/** The engine's own placeholder grammar, as the renderer spells it. */
const PLACEHOLDER = /\{\{([A-Z][A-Z0-9_]*)\}\}/g;

/** A state root with the artifacts the slice prompts' inline-exec spans read. */
let stateRoot: string;
let declaration: Declaration;

beforeAll(async () => {
  stateRoot = await mkdtemp(join(tmpdir(), "flume-prompts-"));
  await mkdir(join(stateRoot, "plan"), { recursive: true });
  await writeFile(join(stateRoot, "plan", "pending.json"), '{ "entries": [] }\n');
  await writeFile(join(stateRoot, "plan", "open-questions.md"), "# Open questions\n");

  // Parsed, not cast: the args under test read `specLocus` and `slots`, and a
  // shape the schema would refuse is not a declaration any consumer could
  // have handed the factory.
  declaration = parseDeclaration({
    specLocus: ["spec/**", "rules/**"],
    fence: { build: ["src/**"] },
    runner: () => ({ run: async () => [], runAtBase: async () => [], lanes: [] }),
    slices: { enabled: [] },
  });
});

afterAll(async () => {
  if (stateRoot) await rm(stateRoot, { recursive: true, force: true });
});

function args(): Record<string, string> {
  return sharedPromptArgs({
    declaration,
    extension: entryExtension(),
    stateRoot,
  });
}

function phase(name: string): Phase {
  return {
    name,
    description: `${name} under test`,
    promptPath: promptPath(name as PromptName),
    concurrency: "singleton",
    writablePaths: ["**"],
    gates: [],
    handoff: () => [],
  };
}

/**
 * One shipped prompt through the engine's real renderer.
 *
 * Whatever the shared args do not cover is a per-tick arg the chain factory
 * supplies, and it is filled here from the file's own placeholders rather
 * than from a list by hand: a list would be this test's copy of a vocabulary
 * the prompts own, and it would go stale the moment a prompt grew an arg.
 */
async function render(name: PromptName): Promise<string> {
  const promptFile = promptPath(name);
  const raw = await readFile(promptFile, "utf8");
  const shared = args();
  const perTick = Object.fromEntries(
    [...raw.matchAll(PLACEHOLDER)]
      .map((match) => match[1]!)
      .filter((key) => !(key in shared) && key !== "FLUME_DIR")
      .map((key) => [key, `<per-tick ${key}>`]),
  );
  return renderPrompt({
    phase: phase(name),
    promptFile,
    // The repo itself, so build's `git log` span resolves against a real
    // history rather than an empty scratch directory.
    cwd: REPO_ROOT,
    flumeDir: stateRoot,
    args: { ...shared, ...perTick },
  });
}

it("the package addresses each phase's prompt absolutely from its own location", () => {
  // Non-vacuity: a phase list that collapsed to zero would pass the loop
  // below over nothing (`.claude/rules/engineering.md`, *A green verdict is
  // proven non-vacuous*).
  expect(PHASES.length).toBeGreaterThan(0);

  for (const name of PHASES) {
    const address = promptPath(name);
    // Both sides resolve from a module URL rather than from a cwd, so the
    // equality holds wherever the suite is started from — which is the
    // property a consumer's state root depends on.
    expect({ name, absolute: isAbsolute(address), address }).toEqual({
      name,
      absolute: true,
      address: join(PROMPT_DIR, `${name}.md`),
    });
  }
});

it("every prompt address the package names is a file it ships", async () => {
  expect(PROMPT_NAMES.length).toBeGreaterThan(0);

  for (const name of PROMPT_NAMES) {
    const address = promptPath(name);
    const body = existsSync(address) ? await readFile(address, "utf8") : "";
    expect({ name, exists: existsSync(address), empty: body.trim() === "" }).toEqual({
      name,
      exists: true,
      empty: false,
    });
  }

  // And the other direction: a prompt file nothing addresses is an orphan
  // that no phase renders and no rename would ever catch.
  const shipped = (await readdir(PROMPT_DIR)).filter((f) => f.endsWith(".md"));
  expect(shipped.sort()).toEqual(PROMPT_NAMES.map((name) => `${name}.md`).sort());
});

it("the package's prompt args name the no-commit modes from the engine's exported value", async () => {
  // Non-vacuity: an empty taxonomy would make every assertion below trivial.
  expect(NO_COMMIT_MODES.length).toBeGreaterThan(0);

  const rendered = await render("plan-inbox");
  for (const mode of NO_COMMIT_MODES) {
    expect({ mode, named: rendered.includes(`\`${mode}\``) }).toEqual({
      mode,
      named: true,
    });
  }

  // The list reached the prompt through the arg, not through the file: no
  // shipped prompt carries the taxonomy entire in its own bytes. Prose
  // naming one mode inline is not a copy — restating the whole set is.
  for (const name of PROMPT_NAMES) {
    const raw = await readFile(promptPath(name), "utf8");
    expect({
      name,
      restatesTaxonomy: NO_COMMIT_MODES.every((mode) => raw.includes(mode)),
    }).toEqual({ name, restatesTaxonomy: false });
  }
});

it("every phase prompt the package ships resolves every placeholder it names", async () => {
  expect(PHASES.length).toBeGreaterThan(0);

  for (const name of PHASES) {
    const rendered = await render(name);
    expect({ name, unresolved: [...rendered.matchAll(PLACEHOLDER)].map((m) => m[0]) }).toEqual({
      name,
      unresolved: [],
    });
  }
});

it("the discipline page names no placeholder, since no tick renders it", async () => {
  const raw = await readFile(promptPath("plan-discipline"), "utf8");
  expect(raw.length).toBeGreaterThan(0);
  expect([...raw.matchAll(PLACEHOLDER)].map((m) => m[0])).toEqual([]);

  // Every plan slice sends its reader here, by the address the package
  // resolves rather than by a path spelled in the markdown.
  const slices = PHASES.filter((name) => name.startsWith("plan-"));
  expect(slices.length).toBeGreaterThan(0);
  for (const name of slices) {
    expect({ name, points: (await render(name)).includes(promptPath("plan-discipline")) }).toEqual({
      name,
      points: true,
    });
  }
});
