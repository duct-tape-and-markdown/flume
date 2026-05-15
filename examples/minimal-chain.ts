/**
 * Minimal chain — the smallest viable Flume chain: one phase, no gates, no
 * fanout, no pending schema.
 *
 * Each tick wakes `notes`, runs one agent invocation, and produces one commit
 * (or zero on bail). The chain hibernates after one tick because `handoff`
 * returns []; wake it again with `flume wake notes` or `flume tick`.
 *
 * This is the same shape as the README Quickstart inline snippet, expanded
 * across lines so each `Phase` field is visible. For multi-phase pipelines,
 * fanout, gates, structured handoff, and the pending-schema surface, read
 * `cascade-chain.ts` instead.
 *
 * Imports come from `../src/index.ts` — the same public surface a consumer
 * sees as `import { ... } from "flume"`. The path is relative because this
 * file lives inside the flume repo; in a host repo, swap `../src/index.ts`
 * for the bare specifier `"flume"`. See the trailing block.
 */

import type { Chain, Phase } from "../src/index.ts";

/**
 * Notes phase — irreducible Phase shape. Each tick appends a dated entry to
 * `notes/journal.md`; nothing else may change (writablePaths confines the
 * commit). No gates: the agent's commit lands as-is. `handoff` returns []
 * so the dispatcher hibernates after one tick.
 */
const notes: Phase = {
  name: "notes",
  description: "Append a dated entry to notes/journal.md.",
  promptPath: "prompts/notes.md",
  concurrency: "singleton",
  writablePaths: ["notes/**"],
  gates: [],
  handoff: () => [],
};

const minimalChain: Chain = {
  phases: [notes],
  humanOnly: [],
};

export default minimalChain;

/* --------------------------------------------------------------------------
 * Plugging this into a host repo's `.flume/chain.ts`
 *
 *   1. Copy this file to `<your-repo>/.flume/chain.ts`.
 *
 *   2. Replace the `../src/index.ts` import with the bare specifier:
 *
 *          import type { Chain, Phase } from "flume";
 *
 *   3. Author `.flume/prompts/notes.md` — the agent prompt template. `{{KEY}}`
 *      placeholders are substituted from `Phase.promptArgs` at tick time;
 *      this minimal phase declares none, so the prompt is sent verbatim.
 *
 *   4. Run `pnpm exec flume tick` (or `npx flume tick`).
 *
 * Grow from here: add a second phase, declare gates (`tscGate`, `vitestGate`,
 * `shellGate`, ...) to enforce checks post-commit, switch a phase to
 * `concurrency: "fanout"` once pending entries are partitioned by file
 * overlap, or layer in `parsePending` / `renderSchemaForPrompt` for
 * plan↔build coordination. See `examples/cascade-chain.ts` for the loaded
 * shape.
 * -------------------------------------------------------------------------- */
