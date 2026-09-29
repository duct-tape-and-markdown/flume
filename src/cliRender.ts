/**
 * `flume render` — the prompt a tick would hand its agent, resolved and
 * printed one call short of the invocation (spec/cli.md, *Subcommand
 * surface*).
 *
 * The resolution is the dispatcher's own, never an approximation of it: the
 * fence, the prior-attempt state and pickability all come back off
 * `Dispatcher.render`, and this verb owns the argv, the exit codes and the
 * two stderr notices that say what the printed prompt is and is not.
 */

import { takeFlagValue } from "./cliArgs.js";
import { refuseCjsContextHost } from "./cliChainLoad.js";
import type { CliVerbRun } from "./cliRunContext.js";
import {
  RenderUnresolvedError,
  RenderUsageError,
  type RenderResolution,
} from "./Dispatcher.js";
import { EX_DATAERR, EX_MOUNT_DEAD } from "./exitCodes.js";
import { RenderRefusal } from "./Prompt.js";

export async function renderVerb(run: CliVerbRun): Promise<number> {
  const { rest, dispatcher, log: operatorLog } = run;
  const words = [...rest];
  const taken = takeFlagValue(words, "--entry");
  if (taken === null) {
    operatorLog.error("usage: flume render <phase> [--entry <tag>]");
    return 2;
  }
  const entryTag: string | undefined = taken;
  const phaseName = words[0];
  // One positional, `<phase>` — same class as `tick`'s stray-arg refusal
  // (spec/cli.md "Subcommand surface", gh#1): rendering a phase other than
  // the one typed is the harm, and it is refused before the chain loads.
  if (!phaseName || words.length > 1) {
    operatorLog.error("usage: flume render <phase> [--entry <tag>]");
    return 2;
  }

  let resolution: RenderResolution;
  try {
    resolution = await dispatcher.render({
      phase: phaseName,
      ...(entryTag !== undefined ? { entryTag } : {}),
    });
  } catch (err) {
    const cjs = refuseCjsContextHost(err);
    if (cjs !== undefined) return cjs;
    if (err instanceof RenderUsageError) {
      operatorLog.error(`[flume] render refuses: ${err.message}`);
      return 2;
    }
    // The shapes of "the prompt never resolved" — every stage refusal the
    // render itself raises (`RenderRefusal`, src/Prompt.ts: an unresolved
    // inline-exec span, a `{{KEY}}` no arg filled), and a `promptArgs` throw.
    // One exit code because the engine gives them one name: `render-refused`
    // (`NO_COMMIT_MODES`, src/Prompt.ts). This is the refusal a tick would
    // have bought with an invocation, so it is the same EX_DATAERR `check`
    // spends nothing to reach.
    if (err instanceof RenderRefusal || err instanceof RenderUnresolvedError) {
      operatorLog.error(`[flume] render refuses: ${err.message}`);
      return EX_DATAERR;
    }
    // Declared bound (`.claude/rules/engineering.md`, "Loud or nothing"):
    // everything left is the chain failing to come up — it would not load,
    // its queue would not parse, its declared prompt file is not on disk.
    // Classified mount-dead, the same code `tick` and `check` return when
    // the chain cannot be run, rather than left to `main().catch`'s raw
    // stack and exit 1.
    operatorLog.error(
      `[flume] render: nothing resolved: ${err instanceof Error ? err.message : String(err)}`,
    );
    return EX_MOUNT_DEAD;
  }

  // Which entry the resolution picked, and what the tick's own pickability
  // verdict says about it — on stderr, so stdout stays the prompt and its
  // one notice line. A hand-named entry a tick would decline to carry is
  // rendered and said so, never silently previewed as if it were next.
  if (resolution.entry) {
    const tag = resolution.entry.tag;
    const carried = resolution.pickable.some((e) => e.tag === tag);
    operatorLog.error(
      carried
        ? `[flume] render: ${resolution.phaseName} scoped to entry ${tag}`
        : `[flume] render: ${resolution.phaseName} scoped to entry ${tag} — ` +
            `not pickable at HEAD; a tick would not carry it`,
    );
  }
  // spec/cli.md "Subcommand surface": the block is omitted, and the first
  // line of the output says so — a render outside a tick has no attempt to
  // carry, and one is never reconstructed for it.
  console.log(
    "[flume] render: <prior-attempt> omitted — a render outside a tick " +
      "carries no attempt, and it is never reconstructed.",
  );
  process.stdout.write(resolution.prompt);
  return 0;
}
