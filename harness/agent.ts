/**
 * The package's agent for one phase (`spec/harness.md`, *What a consumer
 * declares*) — the fields a declaration states folded onto the engine's
 * `claudeCode` options, the transcript placement, and the budget the window
 * rides in.
 *
 * **Nothing here decides a value.** Every field is the consumer's or the
 * engine's: what this module owns is the fold between the two vocabularies
 * and the one shape the package does choose — a transcript per tick.
 */

import { resolve } from "node:path";

import type { Agent } from "../src/Agent.js";
import type { FlumeApi } from "../src/flumeApi.js";

import type { Declaration, HarnessPhase } from "./declaration.js";
import { SESSIONS_REL } from "./ignores.js";

/**
 * The package's agent for one phase: `claude -p` streaming structured
 * events, its raw stream teed under the state root and a condensed
 * one-line-per-tool-call summary on the dispatcher's stdout.
 *
 * The model is not one of the package's opinions — undeclared, the flag is
 * omitted and the binary's own default applies, which is the difference
 * between a consumer choosing a tier and inheriting one it has to discover
 * to turn off (`.claude/rules/engine-boundary.md`, *Surface, not
 * prescription*). What the package does choose is the shape: a transcript
 * per tick, because a loop nobody can read back is a loop nobody can cost.
 *
 * Every declared agent field is handed to the engine's own option of the
 * same name and nothing else: the MCP and settings inheritance the
 * declaration spells are the engine's knobs, defaulted by the engine when no
 * consumer states one.
 *
 * The one field that is not spelled the same on both sides is the context
 * window, which the engine takes inside a budget declaration
 * (`BudgetDeclaration`, `src/budgetHook.ts`) beside a cadence and a set of
 * thresholds. The package fills in neither: how often an agent should be
 * told about its room is not an opinion this package holds either, and an
 * empty cadence is the engine's every-call line, which is what a prompt
 * naming its own percentages reads. Undeclared, no budget is passed at all,
 * so no hook is registered and the argv is the one a consumer who never
 * heard of the field gets.
 */
export function agentFactory(
  api: FlumeApi,
  declaration: Declaration,
): (phase: HarnessPhase) => Agent {
  const dir = resolve(api.paths.flumeDir, SESSIONS_REL);
  return (phase) => {
    const declared = declaration.agents?.[phase];
    return api.withTerminalRenderer(
      api.withSessionCapture(
        api.claudeCode({
          outputFormat: "stream-json",
          ...(declared?.model !== undefined ? { model: declared.model } : {}),
          ...(declared?.extraArgs !== undefined
            ? { extraArgs: [...declared.extraArgs] }
            : {}),
          ...(declared?.contextWindow !== undefined
            ? { budget: { contextWindow: declared.contextWindow } }
            : {}),
          ...(declared?.inheritUserMcp !== undefined
            ? { inheritUserMcp: declared.inheritUserMcp }
            : {}),
          ...(declared?.inheritUserSettings !== undefined
            ? { inheritUserSettings: declared.inheritUserSettings }
            : {}),
        }),
        { dir },
      ),
    );
  };
}
