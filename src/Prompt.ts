/**
 * Prompt — renders a phase's prompt file for one tick.
 *
 * Two transformations are applied to the raw file:
 *
 *   1. `{{KEY}}` placeholders are replaced from the promptArgs map.
 *   2. `` !`shell command` `` inline-exec blocks are evaluated in the tick's
 *      cwd and replaced with their stdout. This lets prompts bake in dynamic
 *      context (current `pending.json`, recent `git log`, `pnpm tsc` output)
 *      without an authoring round-trip.
 *
 * A `<harness>` block is prepended to every rendered prompt with the phase's
 * declared capabilities (writable paths, gate names). This keeps prompts DRY
 * — the human-authored prompt file states the task; the harness injects what
 * it will enforce.
 */

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

import type { Phase } from "./Phase.ts";

const exec = promisify(execFile);

const PLACEHOLDER_RE = /\{\{([A-Z][A-Z0-9_]*)\}\}/g;
const INLINE_EXEC_RE = /!\s*`([^`]+)`/g;

export interface RenderOptions {
  phase: Phase;
  /** Resolved path of the prompt file (already joined with chain config dir). */
  promptFile: string;
  /** Working directory for inline-exec evaluation. */
  cwd: string;
  /** Substitution map. */
  args: Record<string, string>;
}

export async function renderPrompt(opts: RenderOptions): Promise<string> {
  const raw = await readFile(opts.promptFile, "utf8");
  const withArgs = substitutePlaceholders(raw, opts.args);
  const withExec = await evaluateInlineExec(withArgs, opts.cwd);
  return prependHarnessBlock(opts.phase, withExec);
}

// ---------- transformations ----------

function substitutePlaceholders(
  raw: string,
  args: Record<string, string>,
): string {
  const missing = new Set<string>();
  const result = raw.replace(PLACEHOLDER_RE, (_, key: string) => {
    if (key in args) return args[key]!;
    missing.add(key);
    return `{{${key}}}`; // leave as-is so the failure surfaces
  });
  if (missing.size > 0) {
    throw new Error(
      `prompt references missing args: ${[...missing].sort().join(", ")}`,
    );
  }
  return result;
}

async function evaluateInlineExec(raw: string, cwd: string): Promise<string> {
  // Collect all matches first so we can run them in parallel.
  const matches = [...raw.matchAll(INLINE_EXEC_RE)];
  if (matches.length === 0) return raw;

  const results = await Promise.all(
    matches.map(async (m) => {
      const cmd = m[1]!.trim();
      try {
        const { stdout } = await exec("sh", ["-c", cmd], {
          cwd,
          maxBuffer: 4 * 1024 * 1024,
        });
        return { match: m[0], replacement: stdout.trimEnd() };
      } catch (err) {
        const e = err as { stdout?: string; stderr?: string; message: string };
        return {
          match: m[0],
          replacement: `<exec-failed cmd="${cmd}">${
            e.stderr ?? e.message
          }</exec-failed>`,
        };
      }
    }),
  );

  // Replace by walking the original string with computed offsets — multiple
  // matches with the same text would otherwise alias on naive String.replace.
  let out = "";
  let cursor = 0;
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]!;
    const start = m.index!;
    out += raw.slice(cursor, start) + results[i]!.replacement;
    cursor = start + m[0].length;
  }
  out += raw.slice(cursor);
  return out;
}

function prependHarnessBlock(phase: Phase, body: string): string {
  const gateLines = phase.gates
    .map((g) => `  - ${g.name} (${g.when})`)
    .join("\n");
  const pathLines = phase.writablePaths.map((p) => `  - ${p}`).join("\n");

  const harness = [
    `<harness>`,
    `Phase: ${phase.name}`,
    `Concurrency: ${phase.concurrency}`,
    `Writable paths (anything else you modify will revert the commit):`,
    pathLines,
    `Gates (run automatically after your commit):`,
    gateLines || "  (none)",
    `</harness>`,
    "",
  ].join("\n");

  return harness + body;
}
