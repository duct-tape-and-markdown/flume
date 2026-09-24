/**
 * The repo-resident chain fixture: the `.flume/` layout a real `flume` verb
 * loads a chain from, and the minimal chain sources the CLI suites load or
 * tick over. One home rather than a copy per suite — four suites spelled the
 * same materialization and three spelled the same chain source, which is one
 * function with callers (`.claude/rules/engineering.md`, *A module is one
 * job*).
 *
 * Not *.test.ts, so neither vitest lane collects it as a suite of its own.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * The state-root-relative chain fields {@link minimalChainSrc} can declare.
 * Each is spliced in as that field's value (JSON-encoded here, so callers
 * pass the value itself); a field left absent is absent from the chain.
 */
export interface MinimalChainDeclarations {
  /** `Chain.friction`, verbatim — undeclared turns every friction behavior off. */
  friction?: string;
  /** `Chain.pendingDir`, verbatim — undeclared leaves the engine's default. */
  pendingDir?: string;
}

/** The phase shape {@link minimalChainSrc} renders, plus what it declares beside it. */
export interface MinimalChainShape extends MinimalChainDeclarations {
  /** The single phase's name — defaults to `"probe"`. */
  name?: string;
  /**
   * The phase's `promptPath`, configDir-relative — defaults to the
   * `prompts/` join {@link writeRepoConfig} materializes.
   */
  promptPath?: string;
}

/**
 * Materialize the repo-resident config: `chain.ts` at
 * `<root>/.flume/` with its sibling `prompts/` dir — the shape every chain
 * fixture loading through a real verb starts from. `promptPath` stays a plain
 * configDir-relative join (the shared-prompts case).
 */
export async function writeRepoConfig(
  root: string,
  chainSrc: string,
  promptContent = "probe prompt\n",
): Promise<string> {
  const cfg = join(root, ".flume");
  await mkdir(join(cfg, "prompts"), { recursive: true });
  await writeFile(join(cfg, "chain.ts"), chainSrc, "utf8");
  await writeFile(join(cfg, "prompts", "prompt.md"), promptContent, "utf8");
  return cfg;
}

/** The chain body both sources below share, `agent` spliced in when one is wanted. */
function chainSrc(shape: MinimalChainShape, agentSrc = ""): string {
  const { name = "probe", promptPath = "prompts/prompt.md" } = shape;
  const declared = (["friction", "pendingDir"] as const)
    .filter((field) => shape[field] !== undefined)
    .map((field) => `  ${field}: ${JSON.stringify(shape[field])},\n`)
    .join("");
  return (
    `export default () => ({ chain: {\n` +
    `  phases: [{\n` +
    `    name: ${JSON.stringify(name)},\n` +
    `    description: "",\n` +
    `    promptPath: ${JSON.stringify(promptPath)},\n` +
    `    concurrency: "singleton",\n` +
    `    writablePaths: ["**"],\n` +
    `    gates: [],\n` +
    `    handoff: () => [],\n` +
    `  }],\n` +
    `  humanOnly: [],\n` +
    declared +
    `}${agentSrc} });\n`
  );
}

/**
 * A minimal, otherwise-valid chain — one singleton phase, no gates, empty
 * handoff. Loaded for its declared fields by the suites that never tick it,
 * and ticked by the suites that only need a phase to dispatch.
 */
export function minimalChainSrc(shape: MinimalChainShape = {}): string {
  return chainSrc(shape);
}

/**
 * {@link minimalChainSrc} with an agent that leaves `marker` on disk when the
 * dispatcher invokes it, and otherwise behaves as
 * {@link stubbedAgentChainSrc}'s does. For a suite whose property is *which*
 * phase a tick chose, or whether it reached an agent at all: a file either
 * present or absent is decidable evidence, where a negative read over a
 * process's whole output turns on whatever else that output quotes
 * (`.claude/rules/posture-sweep.md`, *Standing lenses*).
 *
 * `marker` is written verbatim, so callers pass an absolute path and the
 * evidence does not depend on which cwd the invocation ran under.
 */
export function markerAgentChainSrc(
  marker: string,
  shape: MinimalChainShape = {},
): string {
  return chainSrc(
    shape,
    `,\n` +
      `agent: {\n` +
      `  name: "marker-agent",\n` +
      `  async invoke() {\n` +
      `    const { writeFileSync } = await import("node:fs");\n` +
      `    writeFileSync(${JSON.stringify(marker)}, "invoked\\n");\n` +
      `    return { exitCode: 0, stdout: "", stderr: "" };\n` +
      `  },\n` +
      `}`,
  );
}

/**
 * {@link minimalChainSrc}, but with an agent declared so the dispatcher never
 * falls through to the real `claudeCode()` agent (`src/Dispatcher.ts`) —
 * for tests that only need a tick to complete cleanly, not to observe what
 * an agent does. spec/worktrees.md "The default test lane must stay fast":
 * a real agent invocation in the fast lane is flaky under parallel load.
 */
export function stubbedAgentChainSrc(shape: MinimalChainShape = {}): string {
  return chainSrc(
    shape,
    `,\n` +
      `agent: {\n` +
      `  name: "stub-agent",\n` +
      `  async invoke() {\n` +
      `    return { exitCode: 0, stdout: "", stderr: "" };\n` +
      `  },\n` +
      `}`,
  );
}
