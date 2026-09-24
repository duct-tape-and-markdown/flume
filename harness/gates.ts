/**
 * The gates the package's discipline needs (`spec/harness.md`, *The gates the
 * discipline needs*) — the `per` gate, the records gate, the clean-tree gate,
 * the engine's pending gate wired to the consumer's fence, and the cursor
 * gate over a plan commit's derive cursor — as one ordered set per phase,
 * always ahead of whatever gates the consumer declared.
 *
 * **Always first is mechanism here, not a promise.** {@link harnessGates}
 * returns the package's own and then the consumer's, so a declaration
 * cannot displace one by ordering, and there is no per-phase table of which
 * gate applies where to fall out of step with the fence. The `afterCommit`
 * set is the same for every phase the package ships: each of them is a claim
 * about *any* commit the package's chain produces, and the ones whose subject
 * a given phase never writes cost a handful of at-ref reads to say so.
 *
 * The one member that is not uniform is the pending gate's **merged-tree**
 * placement, which carries the claim check (`spec/pending.md`, *Claims — an
 * entry in flight is left alone*) and is wired to the plan slices alone. Not
 * a table of where a gate applies, but the same reasoning read the other way:
 * that gate's cost is a full queue parse rather than a handful of reads, and
 * build's fence admits no entry file, so on build it would buy a re-parse and
 * a verdict that could only ever be green. The claim check has to be there
 * and not at the producer's own commit, because a build tick can stake a
 * claim between that commit and its cherry-pick — a pre-merge read answers
 * about a tree the collision is not in.
 *
 * The order they run in is dependency order, not the spec's listing
 * order: the dispatcher stops at the first refusal, so the pending gate —
 * which is what proves the queue parses at all — runs before the `per` gate
 * that reads cites out of it. The cursor gate trails them, being the one
 * whose probe costs a process rather than a read.
 *
 * **Every fact these gates judge on is one the engine reported.** The touched
 * span, the state root's offset, the gated commit, the span's base, the
 * assigned entry and the phase's name all arrive on the `GateContext`;
 * nothing here re-derives a diff, rebuilds a state-root path, or infers which
 * phase it is running for from the shape of a commit
 * (`.claude/rules/engine-boundary.md`, *Told, not inferred*). Whether a
 * touched record was written or drained is read by asking for its bytes at
 * the commit — absent is deleted — what the worktree still holds uncommitted
 * is read off the engine's own status decode, and whether one sha reaches
 * another comes off the engine's own ancestry probe. **This module spawns no
 * process:** every fact they judge on either rides the context or comes
 * off `GateEngine`.
 *
 * This module is the package's own set alone. Which phases exist and what
 * fence each carries belong to the chain factory that calls this
 * (`chain.ts`); constructing a consumer's declared gates — including the
 * shell line that does spawn — belongs to `declaredGates.ts`, which is why
 * the sentence above holds here.
 */

import { relative } from "node:path";

import type { PendingGateOptions } from "../src/builtinGates.js";
import type { Gate, GateContext, GateResult } from "../src/Gate.js";
import type { GitStatusRecord } from "../src/git.js";
import { matchesAny } from "../src/paths.js";
import { readQueueOnDisk } from "../src/pendingLedger.js";
import type { EntryExtension, QueueFile } from "../src/PendingSchema.js";
import type { Phase } from "../src/Phase.js";

import { resolveCite, type AtRefReader, type CiteLocus } from "./citeResolver.js";
import { BUILD_PHASE, PLAN_SLICES, type Declaration } from "./declaration.js";
import { entryExtension, PerSchema } from "./entryExtension.js";
import {
  notePaths,
  planStatePath,
  recordOrNoteGlobs,
  underStateRoot,
} from "./layout.js";
import { PLAN_STATE_SCHEMAS } from "./planState.js";
import { parseOrThrow } from "./refusal.js";

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
     * The queue directory's entry files as of a commit, each already read;
     * `null` when that commit carries no queue directory. The engine's own
     * (`FlumeApi.git.readQueueAtRef`), so a gate judges exactly the listing
     * the dispatcher would.
     */
    readonly readQueueAtRef: (
      repoRoot: string,
      ref: string,
      dirRel: string,
    ) => Promise<QueueFile[] | null>;
    /**
     * Whether `ancestor` reaches `descendant` — non-strict, so a sha is its
     * own ancestor and a cursor carried forward unchanged answers `true`. A
     * ref neither side can resolve throws rather than answering `false`, so
     * a cursor naming a sha this repository does not hold is loud.
     */
    readonly isAncestor: (
      repoRoot: string,
      ancestor: string,
      descendant: string,
    ) => Promise<boolean>;
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
   * The phase the set is for, read for its own fence and its own name — the
   * clean-tree gate judges an untracked leftover against exactly the paths
   * the phase declares, and the merged-tree claim check is wired to the
   * phases that produce the queue, so the caller hands the phase itself
   * rather than a list and a name that could drift from it.
   */
  readonly phase: Readonly<Pick<Phase, "name" | "writablePaths">>;
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
   * The gates that follow the package's own, already constructed, in the
   * order they run — the consumer's declared gates for this phase, and
   * whatever the calling factory judges after them. Nothing here can be put
   * ahead of one of them.
   */
  readonly declared?: readonly Gate[];
}

/** A commit sha as a message names it. */
const short = (sha: string): string => sha.slice(0, 7);

/**
 * The queue directory's path relative to the state root — read off the two
 * resolved values the engine hands every gate, never a second spelling of
 * `plan/pending`, which a chain is free to relocate. Host-native, being
 * `relative`'s answer: the caller that hands it to git folds it
 * (`underStateRoot`, `layout.ts`).
 */
const queueRel = (ctx: GateContext): string =>
  relative(ctx.flumeDir, ctx.pendingDir);

/**
 * The queue's entry files as the gated commit holds them, or `null` when the
 * commit carries no queue directory at all.
 *
 * Read through the engine's own queue-at-ref read, never a listing composed
 * here: which files under the directory are entries is the engine's fact, and
 * a second spelling of it is a gate judging a queue the dispatcher does not
 * (`.claude/rules/engineering.md`, *A fact the engine holds is reported,
 * never rediscovered*).
 *
 * A relocated state root (`stateRootRel` absent) has no tracked copy in the
 * commit's tree to read, so the disk read stands in — the same branch, for
 * the same reason, the engine's own pending gate takes.
 */
async function queueAtCommit(
  ctx: GateContext,
  engine: GateEngine,
): Promise<QueueFile[] | null> {
  if (ctx.stateRootRel === undefined) {
    try {
      return readQueueOnDisk(ctx.pendingDir);
    } catch {
      return null;
    }
  }
  return engine.git.readQueueAtRef(
    ctx.repoRoot,
    ctx.commitSha,
    underStateRoot(ctx.stateRootRel, queueRel(ctx)),
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
      const files = await queueAtCommit(ctx, engine);
      if (files === null) {
        return {
          ok: false,
          message: `${queueRel(ctx)} missing at ${short(ctx.commitSha)}`,
        };
      }
      // Each file's own bytes, so an unparseable entry names its file here
      // the way the pending gate ahead of this one already named it — that
      // gate is what proves the queue parses at all, and this one runs only
      // behind it.
      const queued = files.map(
        (f) => JSON.parse(f.raw) as { tag: string; per?: unknown },
      );
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
 * touches only a note its own tag names — whichever kind, since the kind is
 * the directory and the chain is what reads it — and a plan slice drains
 * records rather than writing one. A written record opens with a title line.
 *
 * Build's continuing note is held here like the other two even though no
 * drain lists it (`recordOrNoteGlobs`, `layout.ts`): what this gate
 * stands between is two ticks writing one file, and that is a property of the
 * path rather than of who reads it afterwards.
 *
 * **The byte cap is not this gate's** (`spec/harness.md`, *The gates the
 * discipline needs*). What this gate reverts is what protects the tree — two
 * ticks writing one file, a slice writing into a queue it only drains. A
 * record's length is a shape rule on a prose channel, so it refuses the
 * prose and not the code it rode in with: an over-cap record ships with its
 * entry and the drain that reads it names the overrun
 * (`renderRecords`, `harness/inboxWindow.ts`).
 *
 * The layout itself is composed from `layout.ts`, never re-spelled: a
 * directory renamed there moves this gate with it rather than leaving it
 * guarding a path nobody writes.
 *
 * Written and drained are told apart by asking for the record's bytes at the
 * commit — absent is deleted — so the gate reads the same span every sibling
 * gate does, and the text it judges is the text that landed.
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
      // `src/paths.ts`).
      const stateRoot = ctx.stateRootRel;
      // What a record or a build note *is*, off the layout's own globs rather
      // than a prefix rule spelled here: the matcher's `*` stops at the
      // separator, so `inbox` cannot claim `inbox-archive`, and the notes
      // directory cannot claim the parked or the continuing one nested inside
      // it — which is the distinction the park predicate then reads
      // (`recordOrNoteGlobs`, `layout.ts`). Build's note homes are in the set
      // as well as the drained queues: a continuation is no drain's, and a
      // gate reading the queues alone would leave the one home a tick can
      // write another tick's tag into unjudged.
      const globs = recordOrNoteGlobs(stateRoot);
      const touched = ctx.touchedPaths.filter((path) => matchesAny(path, globs));
      if (touched.length === 0) {
        return {
          ok: true,
          message: "the commit touches no record",
          skipped: "no record in the gated span",
        };
      }

      const isBuild = ctx.phaseName === BUILD_PHASE;
      // The tick's own notes, one per kind: which of them it wrote is the
      // tick's own verdict and the chain's to read (`chain.ts`), so what this
      // holds is only that whichever it wrote carries *its* tag.
      const entry = ctx.entry;
      const own =
        isBuild && entry ? notePaths(stateRoot, entry.tag) : undefined;
      const problems: string[] = [];
      let written = 0;
      for (const path of touched) {
        if (isBuild && !own?.includes(path)) {
          problems.push(
            `${path}: a build tick touches only ${own?.join(" or ") ?? "its own note (no entry on this tick)"}`,
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
      }
      if (problems.length > 0) {
        return refuse(`${problems.length} record problem(s)`, problems);
      }
      return {
        ok: true,
        message: `${touched.length} record(s) touched, ${written} written`,
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
 * A plan commit's derive cursor steps **forward, and only over history the
 * commit itself carries** (`spec/harness.md`, *The gates the discipline
 * needs*): `derivedThrough` at the gated commit is an ancestor of that
 * commit, and a descendant of the value the tick read before it.
 *
 * Both halves fail the same silent way and that is why they are gated. A
 * cursor stepped past commits nobody derived does not red anything — the
 * derive slice simply never opens on the span that was skipped, every tick
 * after, and the window it renders looks exactly like a quiet tree. A cursor
 * stepped *backwards*, or sideways onto a sha this commit cannot reach,
 * re-derives history or names a window the next tick cannot draw at all.
 * Neither is recoverable by reading the artifact, because the artifact reads
 * as a cursor either way (`.claude/rules/engineering.md`, *Loud or nothing*).
 *
 * **Both shas the gate judges are ones the commit already carries.** The new
 * value is the plan state at `ctx.commitSha`; the pre-commit value is the
 * plan state at `ctx.baseSha`, the tick's own branch point as the engine
 * reported it — not `HEAD^`, which names a sibling commit of the same span
 * the moment a tick writes two. Absent at the base is a state root with no
 * cursor yet, which every window reads as "run": there is no prior value to
 * step from, so that half is not judged and the ancestor half still is.
 *
 * **Plan phases are selected by the path, never by their name.** A commit
 * that did not touch the derive slice's own state file changed no derive
 * cursor, and build's fence admits the artifact at all, so the skip is read
 * off `touchedPaths` rather than off a phase-name branch that would have to
 * stay in step with the fence (`.claude/rules/engine-boundary.md`, *Told, not
 * inferred*).
 *
 * The path is derive's file alone (`layout.ts`, `planStatePath`), which is
 * what one file per writer buys this gate: a sweep or inbox commit stamping
 * its own state writes a sibling file and is skipped here on the path, rather
 * than being read at a shared page and found to have moved no cursor.
 *
 * The **leading-run** half of the bound — whether the span the cursor
 * stepped over was one this tick actually derived — is judgement, and stays
 * prose in the slice's own prompt. What is decidable is direction and
 * reachability, and that is what this holds.
 *
 * A cursor naming a sha the repository does not hold throws out of the
 * ancestry probe rather than being folded into "not an ancestor": the probe
 * cannot tell a bad revision from a broken repository without reading git's
 * English, and a gate that throws is a gate that failed, with git's own
 * message on the refusal (`.claude/rules/engine-boundary.md`, *Told, not
 * inferred*).
 */
function cursorGate(engine: GateEngine): Gate {
  return {
    name: "derive cursor",
    when: "afterCommit",
    async run(ctx) {
      if (ctx.stateRootRel === undefined) {
        return {
          ok: true,
          message: "the state root is outside the repository",
          skipped: "no commit can carry the plan state under a relocated state root",
        };
      }
      const path = planStatePath(ctx.stateRootRel, "plan-derive");
      if (!ctx.touchedPaths.includes(path)) {
        return {
          ok: true,
          message:
            "the commit writes no derive state, so it moves no derive cursor",
          skipped: "the derive slice's state file is not in the gated span",
        };
      }

      const raw = await engine.git.readFileAtRef(ctx.repoRoot, ctx.commitSha, path);
      if (raw === null) {
        return {
          ok: false,
          message: `${path} touched by ${short(ctx.commitSha)} and absent from it: a plan tick that deletes the derive slice's state leaves its window without a cursor`,
        };
      }
      const at = (sha: string, text: string) =>
        parseOrThrow(PLAN_STATE_SCHEMAS["plan-derive"], JSON.parse(text), `plan state at ${short(sha)}`);

      const after = at(ctx.commitSha, raw).derivedThrough;
      const problems: string[] = [];
      if (!(await engine.git.isAncestor(ctx.repoRoot, after, ctx.commitSha))) {
        problems.push(
          `derivedThrough ${short(after)} is not an ancestor of the gated commit ${short(ctx.commitSha)}`,
        );
      }

      const baseRaw = await engine.git.readFileAtRef(ctx.repoRoot, ctx.baseSha, path);
      const before = baseRaw === null ? undefined : at(ctx.baseSha, baseRaw).derivedThrough;
      if (
        before !== undefined &&
        !(await engine.git.isAncestor(ctx.repoRoot, before, after))
      ) {
        problems.push(
          `derivedThrough ${short(before)} -> ${short(after)} is not a step forward: ${short(after)} is not a descendant of the value the tick read at ${short(ctx.baseSha)}`,
        );
      }

      if (problems.length > 0) {
        return refuse(
          `${problems.length} derive-cursor problem(s); a cursor stepped past commits nobody derived fails silently on every tick after`,
          problems,
        );
      }
      return {
        ok: true,
        message:
          before === undefined
            ? `derivedThrough ${short(after)} is within ${short(ctx.commitSha)}`
            : `derivedThrough ${short(before)} -> ${short(after)}, within ${short(ctx.commitSha)}`,
      };
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
 * Whether this phase is one of the queue's producers — the plan slices, which
 * are every phase the package ships but build (`PLAN_SLICES`,
 * `declaration.ts`).
 *
 * Read off the package's own roster rather than off a fence or a commit: which
 * phases write the queue is a fact the package states when it declares them,
 * so a sixth slice joins this predicate by joining that list.
 */
function producesQueue(name: string): boolean {
  return (PLAN_SLICES as readonly string[]).includes(name);
}

/**
 * The package's gate set for one phase, followed by the consumer's own.
 *
 * These are the discipline's, and they run in dependency order: records
 * and the clean tree are facts about the commit itself; the pending gate
 * proves the queue parses and every entry's declared files survive build's
 * fence; the `per` gate then reads cites out of a queue already known to
 * parse. The cursor gate trails them because its probe spawns git where the
 * others read. The dispatcher stops at the first refusal, so that order is
 * what decides which message a tick is handed back.
 *
 * The merged-tree pending gate behind them is the one member the set does not
 * carry for every phase, and the module doc above says why: its subject is
 * the queue a commit rewrote, and build's fence admits no entry file, so on
 * build it would re-parse the whole queue to say nothing.
 */
export function harnessGates(options: HarnessGatesOptions): Gate[] {
  const { phase, declaration, engine, entryFields, declared = [] } = options;
  const queue = {
    extension: entryExtension(entryFields),
    targetFence: buildFence(declaration),
  };
  return [
    recordsGate(engine),
    cleanTreeGate(phase.writablePaths, engine),
    engine.pendingGate(queue),
    perGate(declaration, engine),
    cursorGate(engine),
    ...(producesQueue(phase.name)
      ? [engine.pendingGate({ ...queue, when: "afterMerge" as const })]
      : []),
    ...declared,
  ];
}
