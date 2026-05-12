#!/usr/bin/env -S node --experimental-strip-types --no-warnings

/**
 * `flume` — single tick, or loop until hibernation.
 *
 * Usage:
 *   flume tick                  Run one tick of whichever phase is awake.
 *   flume loop [--max N]        Run ticks until hibernation (default cap 50).
 *   flume status                Print baton state + pending count.
 *   flume wake <phase>          Touch .flume/awake/<phase>.
 *   flume sleep <phase>         Remove .flume/awake/<phase>.
 *   flume render <phase> [opts] Render the prompt that would be sent for one
 *                               tick of <phase>, without invoking the agent.
 *                               --entry <tag>   for fanout phases: pick the
 *                                               entry with this tag from
 *                                               .flume/plan/pending.json.
 *
 * The chain config is loaded from `./.flume/chain.ts` (resolved with tsx).
 * That file must default-export a `Chain` and may export `agent` to override
 * the default `claudeCode()`.
 */

import { resolve, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { Baton } from "./Baton.ts";
import { Dispatcher } from "./Dispatcher.ts";
import { claudeCode } from "./Agent.ts";
import type { Agent } from "./Agent.ts";
import type { Chain, TickContext } from "./Phase.ts";
import { renderPrompt } from "./Prompt.ts";
import { parsePending } from "./PendingSchema.ts";

interface ChainModule {
  default: Chain;
  agent?: Agent;
}

async function loadChain(repoRoot: string): Promise<ChainModule> {
  const path = resolve(repoRoot, ".flume", "chain.ts");
  if (!existsSync(path)) {
    throw new Error(
      `chain config not found at ${path}; create .flume/chain.ts that default-exports a Chain.`,
    );
  }
  const mod = (await import(pathToFileURL(path).href)) as Partial<ChainModule>;
  if (!mod.default) {
    throw new Error(`${path} must default-export a Chain`);
  }
  return mod.agent
    ? { default: mod.default, agent: mod.agent }
    : { default: mod.default };
}

async function main(): Promise<number> {
  const [, , cmd = "tick", ...rest] = process.argv;
  const repoRoot = process.cwd();

  if (cmd === "status") {
    const baton = new Baton(repoRoot);
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
    new Baton(repoRoot).wake(phase);
    console.log(`woke ${phase}`);
    return 0;
  }

  if (cmd === "sleep") {
    const phase = rest[0];
    if (!phase) {
      console.error("usage: flume sleep <phase>");
      return 2;
    }
    new Baton(repoRoot).sleep(phase);
    console.log(`slept ${phase}`);
    return 0;
  }

  const { default: chain, agent: chainAgent } = await loadChain(repoRoot);
  const agent = chainAgent ?? claudeCode();
  const dispatcher = new Dispatcher({
    chain,
    repoRoot,
    configDir: resolve(repoRoot, ".flume"),
    agent,
  });

  if (cmd === "tick") {
    const outcome = await dispatcher.tick();
    console.log(outcome.summary);
    return outcome.hibernated ? 0 : 0;
  }

  if (cmd === "loop") {
    const maxIdx = rest.indexOf("--max");
    const max = maxIdx >= 0 ? Number(rest[maxIdx + 1]) : 50;
    await dispatcher.loop(max);
    return 0;
  }

  if (cmd === "render") {
    const phaseName = rest[0];
    if (!phaseName) {
      console.error("usage: flume render <phase> [--entry <tag>]");
      return 2;
    }
    const phase = chain.phases.find((p) => p.name === phaseName);
    if (!phase) {
      console.error(`unknown phase: ${phaseName}`);
      return 2;
    }

    const entryIdx = rest.indexOf("--entry");
    const entryTag = entryIdx >= 0 ? rest[entryIdx + 1] : undefined;

    const pendingPath = join(repoRoot, ".flume", "plan", "pending.json");
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

    const ctx: TickContext = { cwd: repoRoot, pending };
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
      promptFile: join(repoRoot, ".flume", phase.promptPath),
      cwd: repoRoot,
      args,
    });
    process.stdout.write(prompt);
    return 0;
  }

  console.error(`unknown command: ${cmd}`);
  console.error("usage: flume [tick|loop|status|wake|sleep] ...");
  return 2;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
