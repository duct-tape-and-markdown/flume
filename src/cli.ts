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
 *
 * The chain config is loaded from `./.flume/chain.ts` (resolved with tsx).
 * That file must default-export a `Chain` and may export `agent` to override
 * the default `claudeCode()`.
 */

import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { Baton } from "../src/Baton.ts";
import { Dispatcher } from "../src/Dispatcher.ts";
import { claudeCode } from "../src/Agent.ts";
import type { Agent } from "../src/Agent.ts";
import type { Chain } from "../src/Phase.ts";

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
