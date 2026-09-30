/**
 * `flume check` — the pending queue validated without spending a tick: the
 * schema parse, then the consumer phase's fence (spec/cli.md, *Subcommand
 * surface*).
 *
 * Both readings are the engine's own — the queue listing, the schema, the
 * fence derivation — so this verb and the gate that pre-checks a plan commit
 * (`pendingGate`, `src/builtinGates.ts`) can never name different offending
 * paths for one queue. What is this verb's alone is reporting them to an
 * operator instead of failing a tick.
 */

import { loadChainOrRefuse } from "./cliChainLoad.js";
import { operatorLog } from "./cliLog.js";
import { EX_DATAERR, EX_IOERR } from "./exitCodes.js";
import type { FlumePaths } from "./flumeApi.js";
import {
  DEFAULT_PENDING_REL,
  queueFenceViolations,
  resolvePendingDir,
} from "./paths.js";
import { parsePendingQueue, type QueueFile } from "./PendingSchema.js";
import { readQueueOnDisk } from "./pendingLedger.js";
import { thrownMessage } from "./thrown.js";

export async function checkVerb(
  paths: FlumePaths,
  rest: string[],
): Promise<number> {
  const { flumeDir } = paths;
  // `check` consumes no positionals (spec/cli.md "Subcommand surface") —
  // refuse before the chain load below, not just before the fence checks.
  if (rest.length > 0) {
    operatorLog.error("usage: flume check");
    return 2;
  }
  // The shared refusing load (`loadChainOrRefuse`, src/cliChainLoad.ts):
  // the CJS refusal, the failure line and the mount-dead code have one
  // home, and this verb supplies only the name it reports under.
  const loaded = await loadChainOrRefuse(paths, "check");
  if (!loaded.chain) return loaded.exitCode;
  const chain = loaded.chain;

  // spec/pending.md "The pending queue": the queue directory is
  // Chain.pendingDir (default plan/pending) — the same resolved value the
  // dispatcher, `flume status`, and `pendingGate` read, never a hardcoded
  // copy. The listing under it is read through the engine's own
  // (`readQueueOnDisk`, `src/pendingLedger.ts`), so this verb and the gate
  // cannot disagree about which files are entries.
  const pendingRel = chain.pendingDir ?? DEFAULT_PENDING_REL;
  const pendingDir = resolvePendingDir(flumeDir, chain.pendingDir);
  let files: QueueFile[] | null;
  try {
    files = readQueueOnDisk(flumeDir, pendingDir);
  } catch (err) {
    operatorLog.error(
      `[flume] check: ${pendingRel} failed to read: ${thrownMessage(err)}`,
    );
    return EX_IOERR;
  }
  if (files === null) {
    console.log(`${pendingRel} absent — nothing to check`);
    return 0;
  }

  const parsed = parsePendingQueue(files, chain.entryExtension);
  if (!parsed.ok) {
    operatorLog.error(
      `[flume] check: ${pendingRel} has ${parsed.errors.length} schema violation(s)`,
    );
    for (const e of parsed.errors) {
      operatorLog.error(`  [${e.file}] ${e.path}: ${e.message}`);
    }
    return EX_DATAERR;
  }

  // The consumer of the queue is whichever phase(s) pick from pending —
  // fanout concurrency is the sole site that does (Phase.ts, "Concurrency";
  // spec/pending.md, "The fork-resolution seam"). Mirrors how
  // .flume/chain.ts wires build's own writablePaths/entryChannelPaths as
  // plan's pendingGate targetFence — for a chain with one fanout phase this
  // is byte-identical to that fence, derived from the phase declaration
  // instead of a chain-side constant.
  const consumerPhases = chain.phases.filter((p) => p.concurrency === "fanout");

  // No fanout phase means no consumer, and no consumer means no fence to
  // measure against — not an empty fence every declared path falls outside
  // of. The parse above still stands; the fence step is skipped and says so
  // (spec/cli.md "Subcommand surface"), the vacuous case spelled rather
  // than inherited (`.claude/rules/engineering.md`, "A green verdict is
  // proven non-vacuous").
  if (consumerPhases.length === 0) {
    console.log(
      `${pendingRel} valid (${parsed.entries.length} entries), no fanout phase declared; fence not checked`,
    );
    return 0;
  }

  // The same derivation `pendingGate` (`src/builtinGates.ts`) pre-checks a
  // plan commit with, so this verb and that gate can never name different
  // offending paths for one queue — the verb differs only in which
  // consumers it reads the fence from, and in reporting to an operator
  // rather than failing a tick.
  const violations = queueFenceViolations(parsed.entries, consumerPhases);
  if (violations.length > 0) {
    operatorLog.error(
      `[flume] check: ${violations.length} pending entr${
        violations.length === 1 ? "y" : "ies"
      } declare files outside the consumer phase's fence`,
    );
    for (const v of violations) {
      operatorLog.error(`  [${v.tag}] ${v.offending.join(", ")}`);
    }
    return EX_DATAERR;
  }

  console.log(
    `${pendingRel} valid (${parsed.entries.length} entries), fence check passed`,
  );
  return 0;
}
