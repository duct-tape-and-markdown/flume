/**
 * Backlog groomer — the second reference chain (v0.8 §7): single-phase, no
 * plan/build split, no spec corpus. One phase reads `BACKLOG.json`, picks
 * the highest-priority pickable item, ships it, and commits — all in one
 * tick.
 *
 * Where `cascade-chain.ts` is the flagship spec→plan→build derivation
 * pipeline, this is the peer that proves the engine isn't shaped around
 * that pipeline. It has no fanout, no `pending.json`, no multi-phase
 * handoff — just one `Phase` — but it wires into the same PendingSchema
 * mechanics cascade uses (§§2-4), declared as its own small extension and
 * its own tag convention, applied to a completely different queue.
 *
 * The `groom` phase runs on a deterministic (non-LLM) agent: reading a
 * backlog, filtering by gate/capability, and picking the top pickable item
 * is exactly the kind of task that doesn't need a model in the loop. That
 * also keeps this example runnable end-to-end with zero external
 * dependencies — `pnpm exec flume tick` works with no API key, which is
 * what lets `tests/examples.integration.test.ts` drive it in CI on the
 * unpatched engine. The `Agent` interface doesn't care either way: point
 * `groom.agent` at `claudeCode()` to hand grooming judgment to an LLM
 * instead — everything else on this phase stays the same.
 *
 * Imports come from `../src/index.ts` — the same public surface a consumer
 * sees as `import { ... } from "flume"`. See cascade-chain.ts's trailing
 * block for the host-repo swap; it applies here unchanged.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";
import type {
  Agent,
  Chain,
  ChainFactory,
  EntryExtension,
  Gate,
  Phase,
} from "../src/index.ts";


const BACKLOG_PATH = "BACKLOG.json";
const SHIPPED_PATH = "SHIPPED.md";

// ---------- entry extension (v0.8 §2) + tag refinement (v0.8 §3) ----------

/**
 * This chain's pending-entry fields beyond the engine core
 * (tag/gate/dependsOnForks/files): one field, `reason` — a one-line "why
 * this ships next". Small on purpose, to contrast with cascade's five-field
 * extension: the engine composes either shape identically.
 *
 * `tag` is refined to a lowercase-kebab convention — the opposite of
 * cascade's ALL-CAPS grammar — proving the refinement is this chain's
 * choice, not the engine's: both compose against the same mechanical floor
 * (`TAG_PATTERN`, src/PendingSchema.ts) and neither can widen past it.
 */
const entryExtension = {
  reason: {
    schema: z.string().min(1).max(280),
    hint: `"why this item ships next (≤280 chars)"`,
  },
  tag: {
    schema: z
      .string()
      .regex(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/, "backlog tags are lowercase-kebab"),
    hint: `"lowercase-kebab, e.g. \\"trim-readme-intro\\""`,
  },
} satisfies EntryExtension;


// ---------- chain factory (RELEASE-v0.11 §6) ----------

/**
 * The default export is a factory the engine calls with its own API. The
 * schema helpers this chain uses arrive as parameters rather than through an
 * engine import, so the chain resolves no engine copy of its own — see §6.
 */
const factory: ChainFactory = (api) => {
  const { isPickableNow, parsePending, renderSchemaForPrompt } = api;
  // ---------- the groom agent ----------

  /** Tags already shipped, read back from `SHIPPED.md` so a `blockedBy` item unblocks across ticks. */
  function readShippedTags(cwd: string): Set<string> {
    const path = join(cwd, SHIPPED_PATH);
    if (!existsSync(path)) return new Set();
    const tags = new Set<string>();
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const m = /^- ([a-z0-9-]+):/.exec(line);
      if (m) tags.add(m[1]!);
    }
    return tags;
  }

  /**
   * Deterministic groomer: parse `BACKLOG.json` against core + this chain's
   * extension, pick the first pickable entry (array order — "top is next",
   * same convention `pending.json` uses), remove it from the backlog, log it
   * to `SHIPPED.md`, and commit both files itself — one tick, one commit, the
   * same contract an LLM-backed agent honors.
   *
   * `capabilities` is hardcoded empty here to mirror `Chain.capabilities`
   * below (this chain asserts none); a chain that probes real capabilities at
   * load time would thread the same set through instead of the literal.
   */
  const groomAgent: Agent = {
    name: "backlog-groomer",
    async invoke({ cwd }) {
      const backlogPath = join(cwd, BACKLOG_PATH);
      let raw: string;
      try {
        raw = readFileSync(backlogPath, "utf8");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
        return { exitCode: 0, stdout: "no BACKLOG.json; nothing to groom", stderr: "" };
      }

      const parsed = parsePending(raw, entryExtension);
      if (!parsed.ok) {
        const detail = parsed.errors
          .map((e) => `  [${e.index}] ${e.path}: ${e.message}`)
          .join("\n");
        return { exitCode: 1, stdout: "", stderr: `BACKLOG.json invalid:\n${detail}` };
      }

      const shippedTags = readShippedTags(cwd);
      const pick = parsed.entries.find((entry) =>
        isPickableNow(entry, shippedTags, undefined, new Set()),
      );
      if (!pick) {
        return { exitCode: 0, stdout: "no pickable backlog item", stderr: "" };
      }

      const remaining = parsed.entries.filter((entry) => entry !== pick);
      writeFileSync(backlogPath, `${JSON.stringify(remaining, null, 2)}\n`);

      const reason = entryExtension.reason.schema.parse(pick.reason);
      const shippedPath = join(cwd, SHIPPED_PATH);
      const prior = existsSync(shippedPath) ? readFileSync(shippedPath, "utf8") : "";
      writeFileSync(shippedPath, `${prior}- ${pick.tag}: ${reason}\n`);

      execFileSync("git", ["add", BACKLOG_PATH, SHIPPED_PATH], { cwd });
      execFileSync("git", ["commit", "-q", "-m", `groom: ship ${pick.tag}`], { cwd });

      return { exitCode: 0, stdout: `shipped ${pick.tag}`, stderr: "" };
    },
  };

  // ---------- gate ----------

  /**
   * Re-validates `BACKLOG.json` post-commit against core + `entryExtension` —
   * the same `parsePending` call cascade's `pendingParseGate` makes, reused
   * here for a single-phase chain with no plan/build split. Absence is fine
   * (a tick with nothing pickable makes no changes at all).
   */
  const backlogParseGate: Gate = {
    name: "BACKLOG.json parses",
    when: "afterCommit",
    async run(ctx) {
      let raw: string;
      try {
        raw = readFileSync(join(ctx.cwd, BACKLOG_PATH), "utf8");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
        return { ok: true, message: "BACKLOG.json absent (nothing groomed this tick)" };
      }
      const result = parsePending(raw, entryExtension);
      if (result.ok) {
        return {
          ok: true,
          message: `BACKLOG.json parses (${result.entries.length} item(s) remaining)`,
        };
      }
      return {
        ok: false,
        message: `BACKLOG.json has ${result.errors.length} schema violations`,
        details: result.errors
          .map((e) => `  [${e.index}] ${e.path}: ${e.message}`)
          .join("\n"),
      };
    },
  };

  // ---------- phase ----------

  /**
   * Singleton: one groom tick at a time, same reasoning as cascade's plan
   * phase — `BACKLOG.json` is a single shared artifact. No fanout, no
   * `assignedEntry`, no `pending.json` — the queue this phase reads and
   * writes is `BACKLOG.json`, entirely of this chain's own naming.
   */
  const groom: Phase = {
    name: "groom",
    description: "Read BACKLOG.json, ship the top pickable item, commit.",
    promptPath: "prompts/backlog-groomer.md",
    concurrency: "singleton",
    agent: groomAgent,
    writablePaths: [BACKLOG_PATH, SHIPPED_PATH],
    gates: [backlogParseGate],
    promptArgs() {
      return { BACKLOG_SCHEMA: renderSchemaForPrompt(entryExtension) };
    },
    // One phase, no sibling to hand off to — the chain hibernates after every
    // tick, same as minimal-chain's `notes`.
    handoff: () => [],
  };

  // ---------- chain ----------

  const backlogGroomerChain: Chain = {
    phases: [groom],
    entryExtension,
    humanOnly: [],
    // No environment facts asserted (v0.8 §4): a backlog item gated
    // `requiresCapability` stays parked until a deployment of this chain
    // names the capability here.
    capabilities: [],
  };

  return { chain: backlogGroomerChain };
};

export default factory;

/* --------------------------------------------------------------------------
 * Plugging this into a host repo's `.flume/chain.ts`
 *
 *   1. Copy this file to `<your-repo>/.flume/chain.ts` and
 *      `examples/prompts/backlog-groomer.md` to
 *      `<your-repo>/.flume/prompts/backlog-groomer.md`.
 *
 *   2. Replace the `../src/index.ts` import paths with the bare specifier:
 *
 *          import type { Agent, Chain, EntryExtension, Gate, Phase } from "flume";
 *          import { isPickableNow, parsePending, renderSchemaForPrompt } from "flume";
 *
 *   3. Seed `<your-repo>/BACKLOG.json` with a JSON array conforming to
 *      `entryExtension` above (core `tag`/`gate`/`dependsOnForks`/`files`
 *      plus this chain's `reason`) — this is the "TODO file" a human or an
 *      upstream process maintains; the groom phase never invents entries.
 *
 *   4. Run `pnpm exec flume tick` (or `npx flume tick`). No agent CLI or API
 *      key needed — `groom.agent` is the deterministic groomer above. Swap
 *      in `claudeCode()` there to let an LLM pick instead.
 *
 * See `docs/CHAIN-AUTHORING.md` for the full walkthrough, and
 * `examples/cascade-chain.ts` for the multi-phase, fanout, pending.json
 * shape this chain deliberately does without.
 * -------------------------------------------------------------------------- */