#!/usr/bin/env -S node --experimental-strip-types --no-warnings

/**
 * `flume` — single tick, or loop until hibernation.
 *
 * The runtime usage text printed by `flume --help` / `flume <cmd> --help`
 * is the authoritative reference; see HELP_TEXT below.
 *
 * The chain config is loaded from `./.flume/chain.ts` (resolved with tsx).
 * That file must default-export a `Chain` and may export `agent` to override
 * the default `claudeCode()`.
 */

import { resolve, join, dirname } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

import { Baton } from "./Baton.js";
import { Dispatcher, diskChainLoader, superviseLoop } from "./Dispatcher.js";
import { claudeCode } from "./Agent.js";
import type { TickContext } from "./Phase.js";
import { renderPrompt } from "./Prompt.js";
import { parsePending } from "./PendingSchema.js";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Resolve flume's own package.json (sibling of src/ in checkout, sibling of
 * dist/ in the published tarball — both layouts put it at `../package.json`).
 */
function readPackageVersion(): string {
  const pkgPath = resolve(HERE, "..", "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: unknown };
  if (typeof pkg.version !== "string") {
    throw new Error(`package.json at ${pkgPath} has no string "version"`);
  }
  return pkg.version;
}

/**
 * Resolve the mutable-state root (`flumeDir`) and the chain+prompt dir
 * (`configDir`) from `env`, canonicalizing each to an **absolute** path, and
 * write the resolved values back into `env`.
 *
 * Writing back is the point (§12): a chain loaded later in this same process
 * (via tsx) and any spawned child then read the single resolved value from
 * `FLUME_DIR` / `FLUME_CONFIG_DIR` rather than re-deriving the default or
 * falling back to a coincidentally-equal `configDir`. `FLUME_DIR` becomes a
 * reliable, always-present source of truth for the state root.
 *
 * Both default to `<repoRoot>/.flume` when unset; a set-but-relative value is
 * resolved against the cwd. Independent of one another: a dock sets both to its
 * ephemeral dir to co-locate config and state.
 */
export function resolveStateDirs(
  env: NodeJS.ProcessEnv,
  repoRoot: string,
): { flumeDir: string; configDir: string } {
  const flumeDir = env.FLUME_DIR ? resolve(env.FLUME_DIR) : join(repoRoot, ".flume");
  const configDir = env.FLUME_CONFIG_DIR
    ? resolve(env.FLUME_CONFIG_DIR)
    : join(repoRoot, ".flume");
  env.FLUME_DIR = flumeDir;
  env.FLUME_CONFIG_DIR = configDir;
  return { flumeDir, configDir };
}

const SUBCOMMANDS = ["status", "tick", "loop", "wake", "sleep", "render"] as const;
type Subcommand = (typeof SUBCOMMANDS)[number];

const HELP_TOP = `flume — a disciplined harness for AI-derivation pipelines.

Usage: flume <command> [options]

Commands:
  status              Print baton state (awake phases + pending count).
  tick                Run one tick of whichever phase is awake.
  loop [--max N]      Run ticks until hibernation (default cap 50).
  wake <phase>        Mark <phase> awake (touch .flume/awake/<phase>).
  sleep <phase>       Mark <phase> hibernating (remove .flume/awake/<phase>).
  render <phase>      Print the rendered prompt for <phase> without invoking
                      the agent.

Options:
  -h, --help          Print this message.
  -v, --version       Print the flume version.

Run \`flume <command> --help\` for per-command usage and exit codes.
`;

const HELP_SUB: Record<Subcommand, string> = {
  status: `Usage: flume status

Print baton state: awake phases (or "hibernating" if none). Observational —
no side effects, no agent invocation.

Exit codes:
  0   Always.
`,
  tick: `Usage: flume tick

Run one phase × one tick of whichever phase is awake. Loads .flume/chain.ts,
picks the next pending entry (for fanout phases) or runs the singleton phase,
invokes the agent, and applies validation gates.

Exit codes:
  0   Success, or hibernation (no phase awake).
  1   Harness error (chain load failure, unexpected exception).
`,
  loop: `Usage: flume loop [--max N]

Run ticks until hibernation or --max iterations have elapsed.

Options:
  --max N    Maximum number of ticks before bailing (default 50).

Exit codes:
  0   Hibernation reached, or --max ticks completed.
  1   Harness error.
`,
  wake: `Usage: flume wake <phase>

Mark <phase> awake by touching .flume/awake/<phase>. The next tick will
schedule that phase.

Exit codes:
  0   Success.
  2   Missing <phase> argument.
`,
  sleep: `Usage: flume sleep <phase>

Mark <phase> hibernating by removing .flume/awake/<phase>.

Exit codes:
  0   Success (no-op if already hibernating).
  2   Missing <phase> argument.
`,
  render: `Usage: flume render <phase> [--entry <tag>]

Print the rendered prompt for <phase> to stdout without invoking the agent.
Useful for dry-run inspection of prompt construction.

Options:
  --entry <tag>   For fanout phases, render the prompt for the pending entry
                  with this tag. Defaults to the first entry whose gate is
                  "open".

Exit codes:
  0   Success.
  2   Missing or unknown <phase>; or --entry <tag> with no matching entry.
`,
};

function isSubcommand(value: string): value is Subcommand {
  return (SUBCOMMANDS as readonly string[]).includes(value);
}

function wantsHelp(args: readonly string[]): boolean {
  return args.includes("--help") || args.includes("-h");
}

async function main(): Promise<number> {
  const [, , firstArg, ...restArgs] = process.argv;
  const repoRoot = process.cwd();

  // Resolve both state roots up front and canonicalize them back into the env
  // (§12). `flumeDir` is the mutable-state root (baton, pending, worktrees,
  // prior-attempts); `configDir` is the chain+prompt dir. Both default to
  // `<repoRoot>/.flume`; `FLUME_DIR` / `FLUME_CONFIG_DIR` relocate them for a
  // self-contained, ephemeral harness. Resolving here (not constructing) lets
  // them survive the `loop` → `tick` process boundary — children inherit the
  // (now absolute-canonical) env vars — and lets a chain loaded later in this
  // process read one authoritative state root.
  const { flumeDir, configDir } = resolveStateDirs(process.env, repoRoot);

  // Top-level --help / --version short-circuit before subcommand dispatch
  // (and before any chain load) so they work in any cwd.
  if (firstArg === "--help" || firstArg === "-h") {
    process.stdout.write(HELP_TOP);
    return 0;
  }
  if (firstArg === "--version" || firstArg === "-v") {
    console.log(readPackageVersion());
    return 0;
  }

  const cmd = firstArg ?? "tick";
  const rest = restArgs;

  // Per-subcommand --help short-circuits before any side effects (chain load,
  // baton mutation, agent invocation).
  if (isSubcommand(cmd) && wantsHelp(rest)) {
    process.stdout.write(HELP_SUB[cmd]);
    return 0;
  }

  if (cmd === "status") {
    const baton = new Baton(flumeDir);
    const awake = baton.awake();
    console.log(awake.length ? `awake: ${awake.join(", ")}` : "hibernating");
    return 0;
  }

  if (cmd === "wake") {
    const phase = rest[0];
    if (!phase) {
      console.error("usage: flume wake <phase>");
      return 2;
    }
    new Baton(flumeDir).wake(phase);
    console.log(`woke ${phase}`);
    return 0;
  }

  if (cmd === "sleep") {
    const phase = rest[0];
    if (!phase) {
      console.error("usage: flume sleep <phase>");
      return 2;
    }
    new Baton(flumeDir).sleep(phase);
    console.log(`slept ${phase}`);
    return 0;
  }

  // Dispatcher resolves .flume/chain.ts from configDir once at tick start
  // (one load per process — `flume loop` re-resolves by spawning a fresh
  // `flume tick` per iteration, §2); a chain.ts that exports `agent`
  // overrides the default agent per tick. `render` resolves the chain
  // directly (it inspects phases without invoking the agent).
  const resolveChain = diskChainLoader(configDir);
  const dispatcher = new Dispatcher({
    repoRoot,
    configDir,
    flumeDir,
    agent: claudeCode(),
  });

  if (cmd === "tick") {
    const outcome = await dispatcher.tick();
    console.log(outcome.summary);
    // Fail loudly on an unrecoverable resolution failure (§3) so the
    // supervisor — and any human watching exit codes — sees a no-work tick.
    return outcome.failed ? 1 : 0;
  }

  if (cmd === "loop") {
    const maxIdx = rest.indexOf("--max");
    const max = maxIdx >= 0 ? Number(rest[maxIdx + 1]) : 50;
    // Supervisor: one fresh `flume tick` process per iteration (§2). The
    // dispatcher constructed above is unused on this path — each child
    // builds its own and resolves chain.ts in its own process.
    await superviseLoop({ repoRoot, flumeDir, maxTicks: max });
    return 0;
  }

  if (cmd === "render") {
    const phaseName = rest[0];
    if (!phaseName) {
      console.error("usage: flume render <phase> [--entry <tag>]");
      return 2;
    }
    const { default: chain } = await resolveChain();
    const phase = chain.phases.find((p) => p.name === phaseName);
    if (!phase) {
      console.error(`unknown phase: ${phaseName}`);
      return 2;
    }

    const entryIdx = rest.indexOf("--entry");
    const entryTag = entryIdx >= 0 ? rest[entryIdx + 1] : undefined;

    const pendingPath = join(flumeDir, "plan", "pending.json");
    const pending = existsSync(pendingPath)
      ? (() => {
          const r = parsePending(readFileSync(pendingPath, "utf8"));
          if (!r.ok) {
            console.error(`pending.json invalid (${r.errors.length} errors):`);
            for (const e of r.errors) {
              console.error(`  [${e.index}] ${e.path}: ${e.message}`);
            }
            return [];
          }
          return r.entries;
        })()
      : [];

    const ctx: TickContext = { cwd: repoRoot, flumeDir, pending };
    if (phase.concurrency === "fanout") {
      const target = entryTag
        ? pending.find((e) => e.tag === entryTag)
        : pending.find((e) => e.gate.kind === "open");
      if (!target) {
        console.error(
          entryTag
            ? `no entry with tag ${entryTag} in pending.json`
            : `no open entries in pending.json; pass --entry <tag> to render a gated one`,
        );
        return 2;
      }
      ctx.assignedEntry = target;
    }

    const args = phase.promptArgs?.(ctx) ?? {};
    const prompt = await renderPrompt({
      phase,
      flumeDir,
      promptFile: join(configDir, phase.promptPath),
      cwd: repoRoot,
      args,
    });
    process.stdout.write(prompt);
    return 0;
  }

  console.error(`unknown command: ${cmd}`);
  console.error("Run `flume --help` for usage.");
  return 2;
}

// Run only when invoked as the binary, not when imported (tests reach in for
// `resolveStateDirs` at the resolution seam, §14).
const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
