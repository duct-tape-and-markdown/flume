/**
 * The gates the package's discipline needs (`spec/harness.md`, *The gates the
 * discipline needs*) — the `per` gate, the records gate, the clean-tree gate,
 * and the engine's pending gate wired to the consumer's fence — as one
 * ordered set per phase, always ahead of whatever gates the consumer
 * declared.
 *
 * **Always first is mechanism here, not a promise.** {@link harnessGates}
 * returns the package's four and then the consumer's, so a declaration
 * cannot displace one by ordering, and there is no per-phase table of which
 * gate applies where to fall out of step with the fence. The set is the same
 * for every phase the package ships: each of the four is a claim about *any*
 * commit the package's chain produces, and the two that read the queue cost
 * a handful of at-ref reads on a phase that never writes it.
 *
 * The order the four run in is dependency order, not the spec's listing
 * order: the dispatcher stops at the first refusal, so the pending gate —
 * which is what proves the queue parses at all — runs before the `per` gate
 * that reads cites out of it.
 *
 * **Every fact these gates judge on is one the engine reported.** The touched
 * span, the state root's offset, the gated commit, the assigned entry and the
 * phase's name all arrive on the `GateContext`; nothing here re-derives a
 * diff, rebuilds a state-root path, or infers which phase it is running for
 * from the shape of a commit (`.claude/rules/engine-boundary.md`, *Told, not
 * inferred*). Whether a touched record was written or drained is read by
 * asking for its bytes at the commit — absent is deleted — and what the
 * worktree still holds uncommitted is read off the engine's own status
 * decode. **This module spawns no process:** every fact the four judge on
 * either rides the context or comes off `GateEngine`.
 *
 * This module is the gates alone. Which phases exist, what fence each
 * carries, and how a consumer's declared gates are constructed belong to the
 * chain factory that calls this.
 */

import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";

import type { PendingGateOptions } from "../src/builtinGates.js";
import type { Gate, GateContext, GateResult } from "../src/Gate.js";
import type { GitStatusRecord } from "../src/git.js";
import { matchesAny } from "../src/paths.js";
import type { EntryExtension } from "../src/PendingSchema.js";
import type { Phase } from "../src/Phase.js";

import { resolveCite, type AtRefReader, type CiteLocus } from "./citeResolver.js";
import { BUILD_PHASE, type Declaration } from "./declaration.js";
import { entryExtension, PerSchema } from "./entryExtension.js";
import { RECORD_MAX_BYTES, notePath, recordDirs } from "./records.js";

/**
 * The engine values the package's gates run through, named by the shape they
 * are used at rather than imported as functions.
 *
 * The chain API satisfies this structurally, so a factory hands `api`
 * straight in; a test hands the engine's own `pendingGate` and
 * `readFileAtRef` and gets the gates a real tick runs. Nothing here imports
 * either, for the same reason a chain does not: the engine arrives as a
 * parameter, and a second physical engine in one process stays unreachable.
 */
export interface GateEngine {
  /** The engine's `pendingGate` builtin — queue schema plus fence pre-check. */
  readonly pendingGate: (options: PendingGateOptions) => Gate;
  /** The read-only git helpers the gates read a commit through. */
  readonly git: {
    /**
     * A path's bytes as of a commit; `null` when the path is absent from it,
     * and a throw for an unresolvable ref — the two never confused.
     */
    readonly readFileAtRef: (
      repoRoot: string,
      ref: string,
      path: string,
    ) => Promise<string | null>;
    /**
     * Every path `git status` reports dirty in a worktree right now, already
     * decoded — NUL-separated, so a quoted spelling never reaches a fence
     * glob, and a rename's origin field consumed rather than read as a
     * record of its own.
     */
    readonly statusRecords: (cwd: string) => Promise<GitStatusRecord[]>;
  };
}

/** What {@link harnessGates} needs to build one phase's set. */
export interface HarnessGatesOptions {
  /**
   * The phase the set is for, read for its own fence — the clean-tree gate
   * judges an untracked leftover against exactly the paths the phase
   * declares, so the caller hands the phase itself rather than a list that
   * could drift from it.
   */
  readonly phase: Readonly<Pick<Phase, "writablePaths">>;
  /** The consumer's validated declaration. */
  readonly declaration: Declaration;
  /** The engine values the gates run through. */
  readonly engine: GateEngine;
  /**
   * The consumer's own entry-extension fields, merged beside the package's
   * through {@link entryExtension}. A queue carrying a consumer's field is
   * validated against it rather than refused as unknown.
   */
  readonly entryFields?: EntryExtension;
  /**
   * The gates that follow the package's four, already constructed, in the
   * order they run — the consumer's declared gates for this phase, and
   * whatever the calling factory judges after them. Nothing here can be put
   * ahead of the four.
   */
  readonly declared?: readonly Gate[];
}

/** A commit sha as a message names it. */
const short = (sha: string): string => sha.slice(0, 7);

/**
 * The queue's path relative to the state root — read off the two resolved
 * values the engine hands every gate, never a second spelling of
 * `plan/pending.json`, which a chain is free to relocate.
 */
const queueRel = (ctx: GateContext): string =>
  relative(ctx.flumeDir, ctx.pendingPath);

/**
 * The queue's bytes as the gated commit holds them, or `null` when the
 * commit does not carry it.
 *
 * A relocated state root (`stateRootRel` absent) has no tracked copy in the
 * commit's tree to read, so the disk read stands in — the same branch, for
 * the same reason, the engine's own pending gate takes.
 */
async function queueAtCommit(
  ctx: GateContext,
  engine: GateEngine,
): Promise<string | null> {
  if (ctx.stateRootRel === undefined) {
    try {
      return await readFile(ctx.pendingPath, "utf8");
    } catch {
      return null;
    }
  }
  return engine.git.readFileAtRef(
    ctx.repoRoot,
    ctx.commitSha,
    join(ctx.stateRootRel, queueRel(ctx)),
  );
}

/**
 * An at-ref reader bound to the gated commit, one read per distinct path.
 *
 * The memo is the caller's job by the cite resolver's contract, and this is
 * where a caller lives: a queue cites a handful of files many times over, and
 * the commit this is bound to does not move under it.
 */
function atCommit(ctx: GateContext, engine: GateEngine): AtRefReader {
  const reads = new Map<string, Promise<string | null>>();
  return (path) => {
    const seen = reads.get(path);
    if (seen !== undefined) return seen;
    const read = Promise.resolve(
      engine.git.readFileAtRef(ctx.repoRoot, ctx.commitSha, path),
    );
    reads.set(path, read);
    return read;
  };
}

/** A refusal carrying one line per problem, in the shape every gate reports. */
const refuse = (message: string, problems: readonly string[]): GateResult => ({
  ok: false,
  message,
  details: problems.join("\n"),
});

/**
 * Every entry's `per` cite resolves at the gated commit: the path is inside
 * the declared spec locus and present in the commit, and the section is in
 * the file — by heading text, or by the consumer's declared resolver.
 *
 * One resolution, two readers (`citeResolver.ts`): what a plan tick is held
 * to here is exactly what the build prompt will render, so a cite this gate
 * passes can never be one the prompt cannot fetch.
 *
 * Every unresolved cite is reported in one message. A queue handed back one
 * fix at a time costs a tick per cite, and the tag leads each line because
 * the tag is the entry whose cite has to change.
 */
function perGate(declaration: Declaration, engine: GateEngine): Gate {
  const locus: CiteLocus = {
    specLocus: declaration.specLocus,
    resolver: declaration.resolver,
  };
  return {
    name: "per cites resolve",
    when: "afterCommit",
    async run(ctx) {
      const raw = await queueAtCommit(ctx, engine);
      if (raw === null) {
        return {
          ok: false,
          message: `${queueRel(ctx)} missing at ${short(ctx.commitSha)}`,
        };
      }
      const queued = JSON.parse(raw) as { tag: string; per?: unknown }[];
      if (queued.length === 0) {
        // Spelled, never inherited: a drained queue cites nothing, and
        // reporting that as a judged green is the false pass that hides
        // longest (`.claude/rules/engineering.md`, *A green verdict is
        // proven non-vacuous*).
        return {
          ok: true,
          message: "the queue names no entry, so it cites nothing",
          skipped: "the queue is empty",
        };
      }
      const read = atCommit(ctx, engine);
      const verdicts = await Promise.all(
        queued.map(async (entry) => ({
          tag: entry.tag,
          verdict: await resolveCite(PerSchema.parse(entry.per), locus, read),
        })),
      );
      const unresolved = verdicts.flatMap(({ tag, verdict }) =>
        verdict.ok ? [] : [`${tag}: ${verdict.message}`],
      );
      if (unresolved.length > 0) {
        return refuse(
          `${unresolved.length} per cite(s) do not resolve`,
          unresolved,
        );
      }
      return { ok: true, message: `${queued.length} per cite(s) resolve` };
    },
  };
}

/**
 * Records are one file each (`spec/harness.md`, *Records as one file each*),
 * and the two rules that are not layout hold at the commit: a build tick
 * touches only the note its own tag names, and a plan slice drains records
 * rather than writing one. A written record opens with a title line and fits
 * the package's byte cap.
 *
 * The layout itself is composed from `records.ts`, never re-spelled: a
 * directory renamed there moves this gate with it rather than leaving it
 * guarding a path nobody writes.
 *
 * Written and drained are told apart by asking for the record's bytes at the
 * commit — absent is deleted — so the gate reads the same span every sibling
 * gate does, and the bytes it judges are the bytes that landed.
 */
function recordsGate(engine: GateEngine): Gate {
  return {
    name: "records",
    when: "afterCommit",
    async run(ctx) {
      if (ctx.stateRootRel === undefined) {
        return {
          ok: true,
          message: "the state root is outside the repository",
          skipped: "no path in a commit can be a record under a relocated state root",
        };
      }
      // The engine reports the offset in git's alphabet, which is the one
      // `ctx.touchedPaths` speaks, so the directory globs and the note path
      // below are built from it straight (`computeStateRootRel`,
      // `src/Dispatcher.ts`).
      const stateRoot = ctx.stateRootRel;
      // Trailing separator per directory, so `inbox` cannot prefix-match
      // `inbox-archive`.
      const dirs = recordDirs(stateRoot).map((dir) => `${dir}/`);
      const touched = ctx.touchedPaths.filter((path) =>
        dirs.some((dir) => path.startsWith(dir)),
      );
      if (touched.length === 0) {
        return {
          ok: true,
          message: "the commit touches no record",
          skipped: "no record in the gated span",
        };
      }

      const isBuild = ctx.phaseName === BUILD_PHASE;
      const own =
        isBuild && ctx.entry ? notePath(stateRoot, ctx.entry.tag) : undefined;
      const problems: string[] = [];
      let written = 0;
      for (const path of touched) {
        if (isBuild && path !== own) {
          problems.push(
            `${path}: a build tick touches only ${own ?? "its own note (no entry on this tick)"}`,
          );
          continue;
        }
        const text = await engine.git.readFileAtRef(
          ctx.repoRoot,
          ctx.commitSha,
          path,
        );
        // Absent at the commit is a record drained, which is what a plan
        // slice is for and what a build tick's own note may also be.
        if (text === null) continue;
        if (!isBuild) {
          problems.push(`${path}: a plan slice drains records, never writes one`);
          continue;
        }
        written += 1;
        if (!/^# \S/.test(text)) {
          problems.push(`${path}: first line is not a "# title"`);
        }
        const bytes = Buffer.byteLength(text);
        if (bytes > RECORD_MAX_BYTES) {
          problems.push(
            `${path}: ${bytes} bytes, cap ${RECORD_MAX_BYTES} — what, where, why it matters; cut the rest`,
          );
        }
      }
      if (problems.length > 0) {
        return refuse(`${problems.length} record problem(s)`, problems);
      }
      return {
        ok: true,
        message: `${touched.length} record(s) touched, ${written} written within ${RECORD_MAX_BYTES} bytes`,
      };
    },
  };
}

/**
 * The commit is the tick's whole output. A tracked path modified or deleted
 * and left uncommitted, or a file created inside the phase's fence and never
 * added, is work the worktree's teardown discards while the verdict reads
 * merged — so it is refused at the commit, naming the paths, rather than
 * vanishing quietly (`.claude/rules/engineering.md`, *Loud or nothing*).
 *
 * An untracked file **outside** the fence is not the tick's to have written
 * and is left alone; a tracked one is residue wherever it sits, because the
 * tick is what dirtied it.
 *
 * **The status walk is the engine's, not this gate's.** What git printed
 * about a path is a fact the engine already decodes to name a tick's
 * uncommitted tracked edits, so it arrives on `engine.git.statusRecords`
 * rather than being re-derived from a second `git status` here
 * (`.claude/rules/engineering.md`, *A fact the engine holds is reported,
 * never rediscovered*) — which is also why this module still shells out for
 * nothing. The decode is the part a copy gets wrong: porcelain v1 wraps any
 * path carrying a space, a control character, or a non-ASCII byte in double
 * quotes with the offending bytes escaped, and a quoted spelling matches no
 * fence glob, so an untracked file the tick was meant to commit would read
 * as out-of-fence and this gate would pass over the very discard it exists
 * to refuse.
 *
 * What stays the gate's is the **verdict**: which codes are residue, and
 * which untracked paths the fence makes this tick's to answer for.
 *
 * `afterCommit` only: `repoRoot` is the tick's own worktree there, and the
 * trunk after a merge holds nothing of the agent's to read.
 */
function cleanTreeGate(
  writablePaths: readonly string[],
  engine: GateEngine,
): Gate {
  const fence = [...writablePaths];
  return {
    name: "clean-tree",
    when: "afterCommit",
    async run(ctx) {
      const left: string[] = [];
      for (const { code, path } of await engine.git.statusRecords(
        ctx.repoRoot,
      )) {
        if (code === "??" && !matchesAny(path, fence)) continue;
        left.push(`${path} (${code.trim()})`);
      }
      if (left.length === 0) {
        return { ok: true, message: "worktree clean after the commit" };
      }
      return refuse(
        `${left.length} path(s) left uncommitted in the worktree; the commit is the tick's whole output`,
        left,
      );
    },
  };
}

/**
 * The fence every queued entry's declared `files` is pre-checked against:
 * build's, as the consumer declared it.
 *
 * Derived from the declaration on every call rather than stored beside it, so
 * the fence a plan slice is held to and the fence build enforces are one
 * value read twice (`.claude/rules/engineering.md`, *Derived state is
 * computed, never restated beside its source*). `entryChannelPaths` is
 * omitted rather than set to `undefined`: absent is the engine's own "no
 * channel", and a present key holding nothing is a declaration the engine
 * would have to tell apart from one.
 */
function buildFence(
  declaration: Declaration,
): Pick<Phase, "writablePaths" | "entryChannelPaths"> {
  return {
    writablePaths: [...declaration.fence.build],
    ...(declaration.channelPaths
      ? { entryChannelPaths: [...declaration.channelPaths] }
      : {}),
  };
}

/**
 * The package's gate set for one phase, followed by the consumer's own.
 *
 * The four are the discipline's, and they run in dependency order: records
 * and the clean tree are facts about the commit itself; the pending gate
 * proves the queue parses and every entry's declared files survive build's
 * fence; the `per` gate then reads cites out of a queue already known to
 * parse. The dispatcher stops at the first refusal, so that order is what
 * decides which message a tick is handed back.
 */
export function harnessGates(options: HarnessGatesOptions): Gate[] {
  const { phase, declaration, engine, entryFields, declared = [] } = options;
  return [
    recordsGate(engine),
    cleanTreeGate(phase.writablePaths, engine),
    engine.pendingGate({
      extension: entryExtension(entryFields),
      targetFence: buildFence(declaration),
    }),
    perGate(declaration, engine),
    ...declared,
  ];
}
