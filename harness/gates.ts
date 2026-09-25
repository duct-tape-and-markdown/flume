/**
 * The gates the package's discipline needs (`spec/harness.md`, *The gates the
 * discipline needs*) — the `per` gate, the records gate, the clean-tree gate,
 * the engine's pending gate wired to the consumer's fence, and the cursor
 * gate over every cursor a plan commit moves — as one ordered set per phase,
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
 * that reads cites out of it. The slice-state gate trails them, being the one
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

import type { PendingGateOptions } from "../src/builtinGates.js";
import type { Gate, GateContext, GateResult } from "../src/Gate.js";
import type { GitStatusRecord } from "../src/git.js";
import { matchesAny } from "../src/paths.js";
import type { GatedQueue } from "../src/pendingLedger.js";
import type { EntryExtension } from "../src/PendingSchema.js";
import type { Phase } from "../src/Phase.js";

import { resolveCite, type AtRefReader, type CiteLocus } from "./citeResolver.js";
import { BUILD_PHASE, PLAN_SLICES, type Declaration } from "./declaration.js";
import { entryExtension, PerSchema } from "./entryExtension.js";
import {
  continuingNotePath,
  notePaths,
  planStatePath,
  recordOrNoteGlobs,
} from "./layout.js";
import { JUDGED_SLICES, judgeSliceState } from "./planState.js";
import type { PutDownPredicate } from "./putDown.js";

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
  /**
   * The queue the gated commit holds — its directory's name, its
   * repo-relative spelling, and every entry file already read out of that
   * commit's tree; `files` is `null` when no queue was readable at all. The
   * engine's own (`FlumeApi.readGatedQueue`), so the gate below judges
   * exactly the listing `pendingGate` ahead of it parsed, over an offset
   * neither of them composed.
   */
  readonly readGatedQueue: (ctx: GateContext) => Promise<GatedQueue>;
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
   * How a build commit put its work down, if it did — the chain factory's
   * own predicate ({@link PutDownPredicate}), which the records gate reads to
   * tell a commit that finished its entry from one that parked or continued.
   * Handed in rather than rebuilt here for the reason the judge's gate is
   * handed it: which note means what is the package's vocabulary over paths
   * the factory composed, and a second spelling beside a gate is the copy
   * that goes stale (`.claude/rules/engineering.md`, *Derived state is
   * computed, never restated beside its source*).
   */
  readonly putDown: PutDownPredicate;
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
      const queue = await engine.readGatedQueue(ctx);
      if (queue.files === null) {
        return {
          ok: false,
          message: `${queue.rel} missing at ${short(ctx.commitSha)}`,
        };
      }
      // Each file's own bytes, so an unparseable entry names its file here
      // the way the pending gate ahead of this one already named it — that
      // gate is what proves the queue parses at all, and this one runs only
      // behind it.
      const queued = queue.files.map(
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
 *
 * **A commit that finishes its entry takes the entry's continuation with
 * it.** A continuing note is addressed to the next tick on that one entry,
 * and no drain lists it, so a completing commit that leaves it standing
 * leaves a file behind that outlives the entry it described and that nothing
 * downstream will ever read (`spec/harness.md`, *A tick puts work down*).
 * That is refused here, naming the path, rather than proceeding over it
 * (`.claude/rules/engineering.md`, *Loud or nothing*). Which commits the
 * refusal reaches is the chain's put-down predicate's to say and not a rule
 * re-spelled here: a tick that wrote a continuation, or parked, said so, and
 * the note it left is addressed to the tick that comes after it.
 */
function recordsGate(engine: GateEngine, putDown: PutDownPredicate): Gate {
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

      const isBuild = ctx.phaseName === BUILD_PHASE;
      // The tick's own notes, one per kind: which of them it wrote is the
      // tick's own verdict and the chain's to read (`chain.ts`), so what this
      // holds is only that whichever it wrote carries *its* tag.
      const entry = ctx.entry;
      // The entry's continuation, on the one commit that has to take it: a
      // build commit this span's own predicate reads as finishing the entry.
      // `repoRoot` is the tick's worktree under `afterCommit`, which is the
      // tree that commit left behind.
      const finishing =
        isBuild &&
        entry !== undefined &&
        putDown(entry, {
          touched: ctx.touchedPaths,
          tree: ctx.repoRoot,
        }) === undefined
          ? continuingNotePath(stateRoot, entry.tag)
          : undefined;
      if (touched.length === 0 && finishing === undefined) {
        return {
          ok: true,
          message: "the commit touches no record",
          skipped: "no record in the gated span",
        };
      }

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
      // Read at the commit like every other record here: standing means the
      // commit carries the note, never that the worktree happens to.
      const standing =
        finishing !== undefined &&
        (await engine.git.readFileAtRef(
          ctx.repoRoot,
          ctx.commitSha,
          finishing,
        )) !== null;
      if (standing) {
        problems.push(
          `${finishing}: the entry's continuing note still stands at a commit that finishes the entry — the note leaves with the tick that completes it`,
        );
      }

      if (problems.length > 0) {
        return refuse(`${problems.length} record problem(s)`, problems);
      }
      const carried =
        finishing === undefined
          ? ""
          : `, no continuing note standing at ${short(ctx.commitSha)}`;
      return {
        ok: true,
        message: `${touched.length} record(s) touched, ${written} written${carried}`,
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
 * Every slice's state file moves **only as that slice's own invariants
 * allow**, read as a rule over the file at the base and at the commit
 * (`spec/harness.md`, *The gates the discipline needs*).
 *
 * **One check is this gate's own**, made over every declared cursor whatever
 * slice holds it: an ancestor of the gated commit, and a descendant of the
 * value the tick read before it.
 *
 * **Every other invariant rides the table, never this gate.** Each slice's
 * rules sit beside its accessors — `SLICE_STATE_RULES` (`planState.ts`) —
 * which is the set, and this comment names none of them: a slice's invariant
 * arrives at a table that exists, and a roster here would be a second copy
 * the next rule forgets to join (`.claude/rules/engineering.md`, *Derived
 * state is computed, never restated beside its source*). A slice that states
 * no rule of its own is left held to the two ancestry halves alone, and
 * judging one named field here would be a branch on a single instance inside
 * machinery already generic over the type (`.claude/rules/engineering.md`,
 * *The fix lands at the mechanism*).
 *
 * A rule reads the **pair**, not the step: a tick that rewrites its own state
 * without moving a cursor is exactly the tick a rule keyed on a changed
 * cursor value passes over, and it is also the tick that can drop state no
 * later tick re-derives. What a rule may not do is refuse that rewrite
 * itself, which is why the table is handed both ends rather than the
 * commit's alone.
 *
 * Both halves fail the same silent way and that is why they are gated. A
 * cursor stepped past commits no tick did that slice's work over does not red
 * anything — the slice simply never opens on the span that was skipped, every
 * tick after, and the window it renders looks exactly like a quiet tree. A
 * cursor stepped *backwards*, or sideways onto a sha this commit cannot
 * reach, re-derives history or names a window the next tick cannot draw at
 * all. Neither is recoverable by reading the artifact, because the artifact
 * reads as plan state either way (`.claude/rules/engineering.md`, *Loud or
 * nothing*) — which is the same reason a slice's own losses are refused at
 * the table rather than left for a reader to spot.
 *
 * **Both refs the gate reads are ones the commit already carries.** The
 * commit's state is at `ctx.commitSha`; the pre-commit state is at
 * `ctx.baseSha`, the tick's own branch point as the engine reported it — not
 * `HEAD^`, which names a sibling commit of the same span the moment a tick
 * writes two. Absent at the base is a state root with no artifact yet, which
 * every window reads as "run": there is no prior state to judge a move
 * against, so the rules and the descendant half are not reached and the
 * ancestor half still is.
 *
 * **Plan phases are selected by the path, never by their name.** A commit
 * that touched no judged slice's state file moved nothing this gate holds,
 * and build's fence admits the artifacts at all, so the skip is read off
 * `touchedPaths` rather than off a phase-name branch that would have to stay
 * in step with the fence (`.claude/rules/engine-boundary.md`, *Told, not
 * inferred*).
 *
 * Each slice is keyed on **its own file** (`layout.ts`, `planStatePath`),
 * which is what one file per writer buys this gate: a commit stamping one
 * slice's state is judged on that slice's invariants alone, and a slice whose
 * file the commit left alone is skipped on the path. A slice stating neither
 * a rule nor a cursor would be skipped on every commit instead, and the
 * package declares none today (`JUDGED_SLICES`, `planState.ts`).
 *
 * The **leading-run** half of the bound — whether the span a cursor stepped
 * over is one this tick actually did its slice's work over — is judgement,
 * and stays prose in the slice's own prompt. What is decidable is direction,
 * reachability, and what the file itself says, and that is what this holds.
 *
 * A cursor naming a sha the repository does not hold throws out of the
 * ancestry probe rather than being folded into "not an ancestor": the probe
 * cannot tell a bad revision from a broken repository without reading git's
 * English, and a gate that throws is a gate that failed, with git's own
 * message on the refusal (`.claude/rules/engine-boundary.md`, *Told, not
 * inferred*).
 */
function sliceStateGate(engine: GateEngine): Gate {
  return {
    name: "slice-state",
    when: "afterCommit",
    async run(ctx) {
      const stateRootRel = ctx.stateRootRel;
      if (stateRootRel === undefined) {
        return {
          ok: true,
          message: "the state root is outside the repository",
          skipped: "no commit can carry the plan state under a relocated state root",
        };
      }
      const touched = JUDGED_SLICES.map((slice) => ({
        slice,
        path: planStatePath(stateRootRel, slice),
      })).filter(({ path }) => ctx.touchedPaths.includes(path));

      if (touched.length === 0) {
        return {
          ok: true,
          message:
            "the commit writes no judged slice's state, so it moves nothing this gate holds",
          skipped: "no judged slice's state file is in the gated span",
        };
      }

      const problems: string[] = [];
      const judged: string[] = [
        `${touched.map(({ slice }) => slice).join(", ")} within its own rules`,
      ];
      for (const { slice, path } of touched) {
        const raw = await engine.git.readFileAtRef(ctx.repoRoot, ctx.commitSha, path);
        if (raw === null) {
          problems.push(
            `${path} touched by ${short(ctx.commitSha)} and absent from it: a plan tick that deletes the ${slice} slice's state leaves the next tick's window without it`,
          );
          continue;
        }
        const baseRaw = await engine.git.readFileAtRef(ctx.repoRoot, ctx.baseSha, path);
        const state = judgeSliceState(
          slice,
          {
            parsed: JSON.parse(raw),
            locus: `plan state at ${short(ctx.commitSha)}`,
          },
          baseRaw === null
            ? undefined
            : {
                parsed: JSON.parse(baseRaw),
                locus: `plan state at ${short(ctx.baseSha)}`,
              },
        );

        for (const clause of state.problems) {
          problems.push(
            `${slice} state at ${short(ctx.commitSha)} is not a move its own invariants allow: ${clause}`,
          );
        }

        for (const { field, value, before } of state.cursors) {
          if (!(await engine.git.isAncestor(ctx.repoRoot, value, ctx.commitSha))) {
            problems.push(
              `${field} ${short(value)} is not an ancestor of the gated commit ${short(ctx.commitSha)}`,
            );
          }

          if (
            before !== undefined &&
            !(await engine.git.isAncestor(ctx.repoRoot, before, value))
          ) {
            problems.push(
              `${field} ${short(before)} -> ${short(value)} is not a step forward: ${short(value)} is not a descendant of the value the tick read at ${short(ctx.baseSha)}`,
            );
          }

          judged.push(
            before === undefined
              ? `${field} ${short(value)}`
              : `${field} ${short(before)} -> ${short(value)}`,
          );
        }
      }

      if (problems.length > 0) {
        return refuse(
          `${problems.length} plan-state problem(s); a cursor stepped past commits nobody derived or swept, or coverage dropped from a rotation still open, fails silently on every tick after`,
          problems,
        );
      }
      return {
        ok: true,
        message: `${judged.join("; ")}, within ${short(ctx.commitSha)}`,
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
 * parse. The slice-state gate trails them because its probe spawns git where
 * the others read. The dispatcher stops at the first refusal, so that order is
 * what decides which message a tick is handed back.
 *
 * The merged-tree pending gate behind them is the one member the set does not
 * carry for every phase, and the module doc above says why: its subject is
 * the queue a commit rewrote, and build's fence admits no entry file, so on
 * build it would re-parse the whole queue to say nothing.
 */
export function harnessGates(options: HarnessGatesOptions): Gate[] {
  const { phase, declaration, engine, putDown, entryFields, declared = [] } =
    options;
  const queue = {
    extension: entryExtension(entryFields),
    targetFence: buildFence(declaration),
    // What the package calls an entry's records: its note homes, off the one
    // roster that already names them (`notePaths`, `layout.ts`), so a fourth
    // home joins the claim check with the fence and the records gate rather
    // than one at a time.
    //
    // **Wired to the producers alone**, for the reason the merged-tree
    // placement below is: a build tick *holds* the claim on the entry whose
    // note it writes, so a claim check armed over build's own note homes
    // would refuse the very commit the claim was staked for. The collision
    // the spec names is a drain's — a plan slice deleting or folding a note
    // whose entry is in flight — and a drain is a producer
    // (`spec/pending.md`, *A claim covers the entry's records*).
    ...(producesQueue(phase.name)
      ? { entryRecords: (tag: string, root: string) => notePaths(root, tag) }
      : {}),
  };
  return [
    recordsGate(engine, putDown),
    cleanTreeGate(phase.writablePaths, engine),
    engine.pendingGate(queue),
    perGate(declaration, engine),
    sliceStateGate(engine),
    ...(producesQueue(phase.name)
      ? [engine.pendingGate({ ...queue, when: "afterMerge" as const })]
      : []),
    ...declared,
  ];
}
