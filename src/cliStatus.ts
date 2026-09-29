/**
 * `flume status` — the baton, the guards each of them reads, the queue and
 * the live run's spend, as one listing (spec/cli.md, "`flume status` owes
 * exactly this").
 *
 * One job: every row is a fact read off disk and printed, in the order that
 * page states. The verb interprets none of them — a claim's state root, a
 * capability skip, a chain that would not load are each said and left to the
 * reader, the engine reporting facts and its reader owning what they mean
 * (`.claude/rules/engine-boundary.md`).
 */

import { Baton } from "./Baton.js";
import { agentUsageLine } from "./cliVerdict.js";
import { loadChainForObservation } from "./cliChainLoad.js";
import { operatorLog } from "./cliLog.js";
import { EX_IOERR } from "./exitCodes.js";
import type { FlumePaths } from "./flumeApi.js";
import { frictionCountLine } from "./friction.js";
import { existsLoudUnder } from "./fsProbe.js";
import { currentRefPath, gitCommonDir, liveTipClaim, tipClaimPath } from "./git.js";
import { loopLockPath, resolvePendingDir, stopFlagPath } from "./paths.js";
import { readPendingLoose } from "./pendingLedger.js";
import { liveLoopClaim, statedStateRoot, type PidClaim } from "./pidClaim.js";
import { readRunSpend, type RunSpend } from "./runSpend.js";

export async function statusVerb(paths: FlumePaths): Promise<number> {
  const { repoRoot, flumeDir } = paths;
  // Reading the baton creates nothing (spec/loop.md, *Baton — presence wakes,
  // absence hibernates*): an absent `<flumeDir>/awake/` is the empty baton
  // and prints `hibernating` over a state root this verb leaves untouched. A
  // directory that is there and will not read is refused by the read itself
  // and reported at `main`'s arm, so this needs no guard of its own for it;
  // the loop-lock and tip-claim reads below guard their own files, which that
  // refusal says nothing about.
  const awake = new Baton(flumeDir).awake();
  console.log(awake.length ? `awake: ${awake.join(", ")}` : "hibernating");
  // Surface supervisor liveness beside the awake markers — the 2026-07-29
  // incident's "hibernating" reading left the operator to infer
  // relaunch-safety instead of being told it. No pidfile: silent, leaving
  // the output as it read before this line existed.
  // Absent is the only silent reading, and it is **proven**: `existsLoudUnder`
  // (src/fsProbe.ts) descends from the state root this verb resolved before
  // it stats `loop.pid`, so a `loop.pid` that is present but unstattable (a
  // symlink loop) and a state root a plain file stands at both refuse — the
  // second of those answers the leaf's stat `ENOENT` on win32
  // (`.claude/rules/platform-facts.md`, *win32 reports a path through a
  // non-directory as not found*), and one stat would read it as no
  // supervisor. The claim read below refuses a file that stats but will not
  // open (a directory at the path) for the same reason: none of these may
  // print as no supervisor line over a possibly-live loop
  // (`.claude/rules/engineering.md`, "Loud or nothing").
  //
  // The whole claim, not just the holder's pid: a live holder's `loop.pid`
  // also states *when* this run began, on its second line, and that instant
  // is the window the spend line at the end of this listing is bounded by
  // (spec/loop.md, "The loop lock and the tip claim"). Read from the
  // supervisor's own statement rather than from the file's mtime, which no
  // writer contracts and which a restore, a backup tool, or a stray `touch`
  // moves under a running loop. One read answers both.
  let supervisor: PidClaim | undefined;
  let loopLockPresent: boolean;
  let loopClaim: PidClaim | null = null;
  const statusLockPath = loopLockPath(flumeDir);
  try {
    loopLockPresent = existsLoudUnder("loop lock", flumeDir, statusLockPath);
    // The claim read sits inside this guard, not after it: `liveLoopClaim`
    // answers `null` for absent and throws for every other read failure, so
    // a `loop.pid` that stats but will not open (a directory at the path, a
    // permission-denied file) is this verb's refusal to classify. Outside
    // the guard it escaped to `main()`'s catch as a raw stack and exit 1 —
    // the one exit `status` is specced never to take (spec/cli.md,
    // "Subcommand surface").
    if (loopLockPresent) loopClaim = await liveLoopClaim(flumeDir);
  } catch (err) {
    operatorLog.error(
      `[flume] status: loop lock at ${statusLockPath} failed to read: ${err instanceof Error ? err.message : String(err)}`,
    );
    return EX_IOERR;
  }
  if (loopLockPresent) {
    if (loopClaim !== null) supervisor = loopClaim;
    console.log(
      loopClaim !== null
        ? `supervisor pid ${loopClaim.pid} live`
        : "loop.pid present, process dead — stale",
    );
  }
  // spec/loop.md "Graceful stop — the stop flag" / spec/cli.md "`flume
  // status` owes exactly this" line 3: named right after supervisor
  // liveness, before the tip claim — the ack ritual only works if the
  // operator who forgot the flag finds it where they look first.
  // Absent is the only silent reading and is proven the same way `loop.pid`
  // above proves it, from the same state root: a stop flag that is present
  // but unstattable, or one under a root a plain file stands at, must never
  // print as no stop line, because that is exactly the reading spec/loop.md
  // "Graceful stop — the stop flag" promises can never happen — the operator
  // would relaunch over an unacknowledged stop
  // (`.claude/rules/engineering.md`, "Loud or nothing").
  const statusStopPath = stopFlagPath(flumeDir);
  let stopFlagPresent: boolean;
  try {
    stopFlagPresent = existsLoudUnder("stop flag", flumeDir, statusStopPath);
  } catch (err) {
    operatorLog.error(
      `[flume] status: stop flag at ${statusStopPath} failed to stat: ${err instanceof Error ? err.message : String(err)}`,
    );
    return EX_IOERR;
  }
  if (stopFlagPresent) {
    console.log(
      supervisor
        ? `${statusStopPath} present: the running supervisor will finish ` +
            "its in-flight tick and end the run"
        : `${statusStopPath} present: the next \`loop\` refuses to start ` +
            "until it is removed",
    );
  }
  // Report the current tip's claim alongside supervisor liveness,
  // observational and best-effort — a detached HEAD (no ref to key the claim
  // on), a non-repository cwd, or a git invocation failure all read as
  // silence, the same precedent as the no-pidfile case above. That
  // declaration covers the *git* side and stops there: the claim file's own
  // existence probe splits absent (silent) from unstattable (refuse), and
  // proves that absence by descending from the common dir git resolved —
  // the claim nests four segments under it, and a plain file at any of them
  // answers the leaf `ENOENT` on win32 (`.claude/rules/platform-facts.md`,
  // *win32 reports a path through a non-directory as not found*). So a claim
  // that is present but unreachable never prints as an unclaimed tip
  // (`.claude/rules/engineering.md`, "Loud or nothing").
  const headRefForStatus = await currentRefPath(repoRoot);
  if (headRefForStatus.kind === "ref") {
    const commonDir = await gitCommonDir(repoRoot);
    const claimPath = tipClaimPath(commonDir, headRefForStatus.path);
    let claimPresent: boolean;
    let holder: PidClaim | null = null;
    try {
      claimPresent = existsLoudUnder("tip claim", commonDir, claimPath);
      // Inside the guard for the same reason as the loop lock's claim read
      // above: `liveTipClaim` throws on any read failure past absent, and
      // a claim file that will not open is a tip whose holder is unknown,
      // never an unclaimed one.
      if (claimPresent) holder = await liveTipClaim(claimPath);
    } catch (err) {
      operatorLog.error(
        `[flume] status: tip claim at ${claimPath} failed to read: ${err instanceof Error ? err.message : String(err)}`,
      );
      return EX_IOERR;
    }
    if (claimPresent) {
      // The root the *claim* states, never the one this process resolved:
      // two state roots in one checkout contend for one tip, so a claim
      // held for the other root read as this one's is the whole reason the
      // row names it (spec/cli.md, "`flume status` owes exactly this").
      // A fact and not a verdict: status says whose root the holder took
      // the tip for and leaves the comparison to its reader. A claim that
      // stated no root says so, rather than borrowing this process's
      // (`statedStateRoot`, `src/pidClaim.ts`).
      console.log(
        holder !== null
          ? `tip claimed by pid ${holder.pid} for ` +
              statedStateRoot(holder.stateRoot)
          : "tip claim present, process dead — stale",
      );
    }
  }
  // spec/pending.md "The pending queue": best-effort — a missing or broken
  // chain must never fail `status` — but never silent: the shared load
  // (`loadChainForObservation`, src/cliChainLoad.ts) reports the failure and
  // names what it costs on stderr, because the pending count below then
  // rebases on the default queue path.
  const { chain, loadFailure } = await loadChainForObservation(
    paths,
    "status",
    "proceeding over engine defaults — the pending count reads the default " +
      "queue path, and chain-declared friction and capability lines are " +
      "withheld.",
  );
  // That stderr report is not enough on a *listing* (spec/cli.md, "`flume
  // status` owes exactly this"): a status whose chain died printed stdout
  // byte-identical to a healthy repo's, so an operator reading the listing —
  // or anything piping it — saw a count with no sign it had been rebased.
  // The failure is a row of the listing, on the listing's stream, ahead of
  // the count it explains; nothing above it is withheld, and the exit stays
  // 0.
  if (loadFailure) console.log(`chain: failed to load — ${loadFailure}`);
  // The pending entry count, independent of whether the chain loads:
  // `readPendingLoose` (src/pendingLedger.ts) is the probe, so an absent queue reads
  // 0 and a corrupt one reads "unparsable" rather than failing the verb.
  const pending = readPendingLoose(
    flumeDir,
    resolvePendingDir(flumeDir, chain?.pendingDir),
  );
  console.log(
    pending.ok ? `pending: ${pending.entries.length}` : "pending: unparsable",
  );
  if (chain) {
    const line = await frictionCountLine(flumeDir, chain);
    if (line) console.log(line);
    // Name entries stuck on a capability this chain hasn't asserted — a
    // `requiresCapability` skip must never be silent.
    const capabilities = new Set(chain.capabilities ?? []);
    for (const entry of pending.entries) {
      if (
        entry.gate.kind === "requiresCapability" &&
        !capabilities.has(entry.gate.capability)
      ) {
        console.log(
          `${entry.tag}: skipped — missing capability "${entry.gate.capability}"`,
        );
      }
    }
  }
  // spec/cli.md "`flume status` owes exactly this", line 7: what the live
  // run has spent so far, where the operator already looks. No live
  // supervisor, nothing extra — there is no run for a total to be about.
  //
  // The window is the instant the supervisor stated on the lock's second
  // line (spec/loop.md, "The loop lock and the tip claim"), read from the
  // claim above rather than from the file's mtime, which no writer contracts
  // and which a restore, a backup tool, or a stray `touch` moves under a
  // running loop.
  //
  // A lock stating no instant — written by a flume before 0.17, or rolled
  // by hand — bounds nothing, and this line is withheld rather than
  // totalled over an unbounded log: the run's spend and every earlier run's
  // would read as one number with nothing to say they had been merged.
  // Declared degradation, and it says so on stderr
  // (`.claude/rules/engineering.md`, "Loud or nothing";
  // `docs/MIGRATING-0.17.md`).
  const startedAtMs = supervisor?.atMs;
  if (supervisor !== undefined && startedAtMs === undefined) {
    operatorLog.error(
      `[flume] status: loop lock at ${statusLockPath} states no ` +
        "claim instant (written by flume before 0.17?) — withholding this " +
        "run's agent spend rather than totalling another run's with it",
    );
  }
  if (startedAtMs !== undefined) {
    // Which rows the window holds, and how many agents have not left one, are
    // `readRunSpend`'s (`src/runSpend.ts`) — this verb prints facts and
    // derives none of them. The grouping it folds through and the line
    // `agentUsageLine` (`src/cliVerdict.ts`) renders are the loop-end
    // summary's own, so a run's cost reads alike wherever it is read.
    //
    // spec/cli.md "Subcommand surface", `status`: the one thing this verb
    // exits non-zero on is a file it must read being present and unreadable.
    // Every read behind that call refuses rather than answering "nothing
    // spent", so withholding the line here would print an unread artifact as
    // a run that paid for nothing.
    let spend: RunSpend;
    try {
      spend = await readRunSpend(flumeDir, startedAtMs);
    } catch (err) {
      operatorLog.error(
        `[flume] status: the live run's spend failed to read: ${err instanceof Error ? err.message : String(err)}`,
      );
      return EX_IOERR;
    }
    const totals = agentUsageLine("agent usage this run", spend.byPhase);
    // A run that has started nothing yet prints nothing, the same silence a
    // run with no agents has always printed. Anything else prints the count
    // of agents still out — zero included, because "this total is complete"
    // and "this total is two hours behind" are the whole question an operator
    // reads a live number to answer, and they render identically without it.
    if (totals !== undefined || spend.inFlight > 0) {
      console.log(
        `${totals ?? "agent usage this run: nothing returned yet"} — ` +
          `${spend.inFlight} ${spend.inFlight === 1 ? "agent" : "agents"} ` +
          "still in flight",
      );
    }
  }
  return 0;
}
