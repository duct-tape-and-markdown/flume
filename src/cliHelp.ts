/**
 * Subcommand table + runtime usage text — the authoritative reference for
 * `flume --help` / `flume <cmd> --help`, split out of `src/cli.ts`
 * (`.claude/rules/posture-sweep.md`, "A violation counts only when verified
 * on disk this tick").
 */

import {
  DEFAULT_ABORT_THRESHOLD,
  DEFAULT_MAX_TICKS,
  DEFAULT_TICK_BUDGET,
} from "./loopSupervisor.js";
import { STATE_ROOT_DIRNAME } from "./paths.js";

const SUBCOMMANDS = [
  "status",
  "tick",
  "loop",
  "wake",
  "sleep",
  "stop",
  "log",
  "check",
  "render",
  "friction",
] as const;
type Subcommand = (typeof SUBCOMMANDS)[number];

/**
 * The `EX_IOERR` causes every verb shares, worded once. Bay discovery runs
 * before any verb reaches work of its own, and both ways it can fail to hand
 * back a usable root land here, so every page's `74` row carries them and no
 * page states a narrower range than its own process can return
 * (`spec/loop.md`, *Exit codes — the run never lies to CI*).
 */
const BAY_DISCOVERY_LINES = [
  `The state root (\`${STATE_ROOT_DIRNAME}\`) is present but will not stat at the bay`,
  "discovery every verb starts with — a symlink loop, a permission-denied",
  "parent. Refused rather than walked past to an unrelated ancestor's",
  "bay, naming the cwd the walk began at and the underlying error.",
  "Or that walk resolved a bay below the root git names paths from —",
  "every path composed against it would be spelled in an alphabet git",
  "does not use. Refused before the first one is composed, naming",
  "both roots.",
];

/**
 * The clause above, wrapped into a page's own exit-code block. `indent` is
 * that block's continuation column — a block aligns its rows to the widest
 * code it lists, so `check`'s sits one past everyone else's.
 *
 * Rendered rather than spelled once per page: ten hand copies of one
 * sentence is the shape that leaves nine of them stale
 * (`.claude/rules/engineering.md`, *Derived state is computed, never
 * restated beside its source*).
 */
function bayDiscoveryRefusal(indent: number): string {
  return BAY_DISCOVERY_LINES.join(`\n${" ".repeat(indent)}`);
}

/**
 * The whole `74` row for a verb that reads the state root and nothing else
 * before it answers — `wake`, `sleep`, `stop`, `render`. Their every other
 * refusal is usage-shaped or a chain that would not come up, so discovery is
 * the only file read they can take.
 */
function bayDiscoveryRow(indent: number): string {
  const pad = " ".repeat(indent);
  return (
    `  74${" ".repeat(indent - 4)}I/O error (EX_IOERR): the refusals every verb shares,\n` +
    `${pad}and this verb's only ones.\n` +
    `${pad}${bayDiscoveryRefusal(indent)}`
  );
}

export const HELP_TOP = `flume — a disciplined harness for AI-derivation pipelines.

Usage: flume <command> [options]

Commands:
  status              Print baton state (awake phases + pending count).
  tick [--phase <name>]
                      Run one tick of whichever phase is awake, or of the
                      named phase, awake or not.
  loop [--max N]      Run ticks until hibernation (default cap 50).
  wake <phase>        Mark <phase> awake (touch .flume/awake/<phase>).
  sleep <phase>       Mark <phase> hibernating (remove .flume/awake/<phase>).
  stop                Write .flume/stop and print what happens next: a live
                      supervisor finishes its in-flight tick then ends the
                      run; the next loop refuses to start until the flag is
                      removed. Idempotent. No unstop/resume verb —
                      removing the flag is the operator's own acknowledgement.
  log [-n N] [--json] Print the last N tick verdicts (default 10) from
                      tick-verdicts.jsonl, oldest first — a human table by
                      default, or --json for the records verbatim as JSONL.
  check               Validate the working tree's plan/pending/ — parse
                      plus fence arithmetic against the consumer (fanout)
                      phase's declared fence — without spending an agent.
  render <phase> [--entry <tag>]
                      Print to stdout the prompt <phase> would be handed,
                      invoking nothing — the dispatcher's own resolution run
                      one call short of the agent. The <prior-attempt> block
                      is omitted and the first line says so.
  friction [name]     List (bare) the declared friction channel's notes —
                      filename, size, mtime — or, with <name>, print that
                      note's bytes verbatim. Never interpreted.

Options:
  -h, --help          Print this message (\`flume help\` prints the same).
  -v, --version       Print the flume version.

Run \`flume <command> --help\` — or \`flume help <command>\`, or \`flume --help
<command>\` — for that command's usage and exit codes.
`;

const HELP_SUB: Record<Subcommand, string> = {
  status: `Usage: flume status

Print baton state: awake phases (or "hibernating" if none), then, when
.flume/loop.pid exists, supervisor liveness ("supervisor pid N live" or
"loop.pid present, process dead — stale"; no pidfile prints nothing extra),
then, when HEAD names a ref and a tip claim exists for it, its holder ("tip
claimed by pid N" or "tip claim present, process dead — stale"; a detached
HEAD or no claim file prints nothing extra), then the pending entry count
from plan/pending/ ("pending: N"; "pending: 0" if absent; "pending:
unparsable" if present but malformed), then, when the chain loads, a
friction count (declared Chain.friction dir holding notes) and one line per
pending entry gated on a capability the chain hasn't asserted, then, when a
supervisor is live, what that run has spent on agents so far ("agent usage
this run: <phase> ×N (...)", one entry per phase whose ticks invoked an
agent at or after the instant loop.pid states the run took the lock; no live
supervisor — a live run that has invoked none yet, or one whose lock states
no instant (written by flume before 0.17) — prints nothing extra).
Observational
— no side effects, no agent invocation.

Exit codes:
  0   Every observation above succeeded — including "nothing to report" for
      each optional line.
  74  I/O error (EX_IOERR): loop.pid, the stop flag, or the tip claim file
      exists but could not be read (permission denied, a symlink loop, a
      directory standing at the path, a path too long for the platform, ...)
      — the presence probe and, for the two claim files, the read of the
      pid they state. Refused rather than printed as
      absent — that reading would tell the operator there is no live
      supervisor, no pending stop, or no claim holder when there may be one.
      Naming the file and the underlying error. Also, under a live
      supervisor, tick-verdicts.jsonl exists but could not be read: the
      spend line is refused rather than withheld, since withholding it
      states a run that has spent nothing. And the state root itself,
      present and not a directory: the awake dir this verb creates under
      it — its one filesystem effect — cannot be made, and the refusal
      names the root that was resolved rather than the dir it tried.
      ${bayDiscoveryRefusal(6)}
`,
  tick: `Usage: flume tick [--phase <name>]

Run one phase × one tick of whichever phase is awake. Loads .flume/chain.ts,
picks the next pending entry (for fanout phases) or runs the singleton phase,
invokes the agent, and applies validation gates.

Options:
  --phase <name>  Run this phase, awake or not, instead of whichever phase
                  the baton names — how \`flume loop\`'s supervisor tells a
                  child what it is for. The baton decides nothing here: no
                  flag awake still runs the named phase, and a flag naming
                  another phase does not run it. Handoff is unchanged, so
                  the phase that ran is slept and whatever it hands off to
                  wakes.

Exit codes:
  0   Success, or hibernation (no phase awake).
  1   Harness error (unexpected exception), or HEAD is detached (the tick
      record's meaning is advancing a named tip; checkout a branch first).
      No claim is taken or checked — that's loop-level only. Also a wave
      whose entries merged and gated clean and whose pending-ledger commit
      then refused — a paused merge or cherry-pick in the checkout, a lost
      index.lock: the shipped entries are on trunk, the chain is fine, and
      a fresh process has every reason to get further. Clear the refusal and
      re-run; the queue still names what has not shipped.
  2   Usage: a stray trailing positional (\`tick\` consumes none — running
      something other than whichever phase is awake is refused, not
      honored), or \`--phase\` with no name after it, or \`--phase <name>\`
      naming a phase the chain does not declare — the refusal names the
      phases it does, no agent runs, and no baton flag moves, the same code
      \`wake\`, \`sleep\` and \`render\` answer an undeclared phase name with.
      Also the chain load failing with the CJS-context refusal — the host
      repo's package.json (or the one beside .flume/chain.ts) lacks
      "type": "module". Add it and re-run.
  69  Mount-dead (EX_UNAVAILABLE): the chain module could not load, its
      state root is missing, or its declaration is invalid. No agent ran —
      fix the chain (or its state root) and re-run. Also the queue
      failing to parse, where a fresh process reads the same bytes until the
      queue's declared writer runs over them; a wave that shipped before its
      rewrite read hit them still exits 69, and its work is on trunk.
  74  I/O error (EX_IOERR): the verdict history
      (\`.flume/tick-verdicts.jsonl\`) is present and unreadable — the tick
      reads it before appending its own record, so its work has already
      landed and it has printed its own summary; recording is what failed
      and there is nothing to re-run. Naming the file and the underlying
      error.
      ${bayDiscoveryRefusal(6)}
  78  Terminal misconfiguration (EX_CONFIG): every awake flag names a phase
      the chain does not declare. The flags are left on disk — inspect, then
      \`flume sleep <phase>\` or fix the chain.
`,
  loop: `Usage: flume loop [--max N]

Run ticks until hibernation or --max ticks have been spent. The supervisor
holds one \`flume tick\` child per awake phase that has none of its own in
flight, started in the chain's declared order, up to
supervisorPolicy.maxTicks at once (default ${DEFAULT_MAX_TICKS} — one phase
tick at a time, the serial loop). The run ends once no flag stands and no
child is in flight.

Options:
  --max N    How many child ticks this run may start in total before
             bailing (default ${DEFAULT_TICK_BUDGET}). A budget the run
             spends, not a width: supervisorPolicy.maxTicks above is how
             many of them run at once.

Exit codes:
  0   Hibernation reached, or --max ticks completed — including partial
      success (some ticks errored but at least one entry shipped; the
      completion summary names the errors).
  1   Harness error, another live loop holds the lock; also, the stop flag
      (\`.flume/stop\`) is already present — the refusal names the path, and
      removing it is how the stop is acknowledged (docs/CLI.md, "flume
      stop"); also, HEAD is detached (checkout a branch first — the tip
      claim below keys on the ref); also, another process holds the tip
      claim (the refusal names the holder pid and claim path); also, at
      least one tick errored and the run shipped nothing; also, an
      identical failure signature repeated on as many consecutive ticks as
      the chain's supervisorPolicy.abortThreshold declares (default
      ${DEFAULT_ABORT_THRESHOLD}), with no successful tick between them — a
      provision-stage, merge-stage or gate-stage wall alike, with the
      completion summary naming the aborting stage, the streak it reached
      and the repeated signature. A single entry's failure alone does not
      abort: it quarantines that entry for the rest of the run while the
      others keep dispatching.
      A graceful stop mid-run (\`.flume/stop\` written while the loop is
      already going) ends iteration after the in-flight tick finishes, but
      never changes this exit code — it stays decided by the run's totals.
  74  I/O error (EX_IOERR): at start, the stop flag (\`.flume/stop\`)
      exists but could not be stat'd (permission denied, a symlink
      loop, ...). Refused rather than started — an unreadable flag is
      not an absent one. Naming the path and the underlying error. Also,
      the lock file (\`.flume/loop.pid\`) exists but could not be read
      (a directory at the path, permission denied, ...): a lock whose
      holder is unknown is not a free one, so the run refuses instead of
      claiming it. Also, the merging-marker dir (\`.flume/merging/\`)
      exists but could not be listed: whether a marker stands is
      unknown, so the run refuses rather than reading it as none.
      ${bayDiscoveryRefusal(6)}
  69  Mount-dead: the chain never resolved. The supervisor resolves it in
      its own process before the first child, so a chain that will not load
      refuses the run there, naming the load error and starting no tick; a
      chain that loads for the supervisor and not for a child surfaces as
      that child's own 69 (see \`flume tick --help\`). Either way the run
      aborts instead of burning the remaining --max ticks against the same
      wall.
  78  Stopped on a terminal misconfiguration: a child tick classified one
      (see \`flume tick --help\`), or every flag still standing names a
      phase the chain does not declare and no child is left to run — either
      way the orphaned awake flags are left on disk. Also, at start:
      a merge interrupted before its ship bookkeeping is unreconciled — a
      \`.flume/merging/<slug>.json\` marker survived a crash between the
      cherry-pick and the queue rewrite, so the picked commit may sit on
      trunk ungated with its entry still open (docs/CLI.md, "flume loop
      [--max N]"). The refusal names the file, the branch and the entry;
      nothing is touched and the startup sweep does not run, so the branch
      survives — reconcile, then remove the file to acknowledge.
  2   Bad --max: missing, non-numeric, or negative. No tick runs. Also, a
      stray positional past --max/<value> — loop consumes no positionals,
      and running anything other than what was typed is refused rather
      than silently starting a run.
`,
  wake: `Usage: flume wake <phase>

Mark <phase> awake by touching .flume/awake/<phase>. The next tick will
schedule that phase. Best-effort: loads .flume/chain.ts to check <phase>
against its declared phases; a chain that fails to load never blocks the
wake, only a chain that loads and doesn't declare <phase> does.

Exit codes:
  0   Success.
  2   Missing <phase> argument, an extra positional past <phase>, or <phase>
      names a phase the loaded chain does not declare. No flag is written.
${bayDiscoveryRow(6)}
`,
  sleep: `Usage: flume sleep <phase>

Mark <phase> hibernating by removing .flume/awake/<phase>. Best-effort:
loads .flume/chain.ts to check <phase> against its declared phases; a chain
that fails to load never blocks the sleep, only a chain that loads and
doesn't declare <phase> does.

Exit codes:
  0   Success (no-op if already hibernating).
  2   Missing <phase> argument, an extra positional past <phase>, or <phase>
      names a phase the loaded chain does not declare.
${bayDiscoveryRow(6)}
`,
  stop: `Usage: flume stop

Write <flumeDir>/stop and print what happens next: a live supervisor
finishes its in-flight tick — merge, park, verdict, and handoff run exactly
as they would have — then releases the tip claim and the loop lock and ends
the run; without a live supervisor, the next \`loop\` refuses to start until
the flag is removed. Idempotent — a repeat call finds the flag
already present and prints the same statement. The verb is discoverability
plus the printed statement, never a privileged channel: \`touch\` on the same
path is equally the interface. There is deliberately no \`unstop\`/\`resume\`
verb — removing the flag is the operator's own acknowledgement that the stop
was seen.

Exit codes:
  0   Always — including when the flag was already present.
  2   Usage: a stray trailing positional (\`stop\` consumes none). No flag is
      written.
${bayDiscoveryRow(6)}
`,
  log: `Usage: flume log [-n N] [--json]

Print the last N tick verdicts (default 10) from tick-verdicts.jsonl, oldest
first. The human form is one fixed-format line per verdict, carrying only
fields the record already holds: phase, committed, gate results, shipped
tags, merge outcomes — facts only, never reclassified (park/bail vocabulary
is the chain's, not the engine's). --json emits the TickVerdict records
verbatim as JSONL, one per line, for a supervising agent. Read-only: no
baton flag is touched, no agent runs.

Exit codes:
  0   Success — including no tick-verdicts.jsonl on disk (prints nothing).
  2   Usage: unknown or extra arguments, or -n is missing, non-numeric, or
      negative. No verdicts are read.
  74  I/O error (EX_IOERR): tick-verdicts.jsonl exists but could not be read
      (permission denied, a symlink loop, a directory in its place, ...).
      Refused rather than printed as an empty history — exit 0 over silence
      means the log is not there, never that it could not be opened. Naming
      the file and the underlying error.
      ${bayDiscoveryRefusal(6)}
`,
  check: `Usage: flume check

Validate the working tree's plan/pending/ without spending an agent:
the real parse (the same decode a tick's resolution takes, against the
loaded chain's declared entryExtension) plus fence arithmetic for every
entry — declared paths against the consumer (fanout-concurrency) phase's
writablePaths ∪ entryChannelPaths, the same computation the write guard
enforces. Read-only: no baton flag is touched, no agent runs, and chain
gates never run — only the engine's own parse + fence mechanics.

Exit codes:
  0    Three routes: the queue parses clean and every entry's declared
       files survive the consumer phase's fence; plan/pending/ is
       absent (nothing to check); or the chain declares no fanout phase, so
       there is no consumer and no fence — the parse still runs and the
       output says "no fanout phase declared; fence not checked", never a
       refusal of every declared path.
  2    A stray trailing positional (\`check\` consumes none), checked before
       the chain load below; or the chain failed to load with the
       CJS-context refusal — the host repo's package.json (or the one
       beside .flume/chain.ts) lacks "type": "module". Add it and re-run.
  65   Data error (EX_DATAERR): an entry under plan/pending/ fails schema
       validation, or an entry declares a path outside the consumer
       phase's fence.
       Naming the offending entry (and paths, for a fence violation).
  69   Mount-dead (EX_UNAVAILABLE): the chain module could not load for any
       other reason. Nothing was checked — fix the chain and re-run.
  74   I/O error (EX_IOERR): plan/pending/ exists but could not be read
       (permission denied, a path too long for the platform, …). Naming
       the underlying error.
       ${bayDiscoveryRefusal(7)}
`,
  render: `Usage: flume render <phase> [--entry <tag>]

Print to stdout the prompt a tick would hand <phase>, invoking nothing: the
dispatcher's own resolution path run one call short of the agent — the same
chain load, the same queue read at HEAD, the same pickability verdict, the
same fence in the <harness> block, the same renderer. Nothing is previewed
twice or approximated.

Two things differ from a tick, because no tick is running: the inline-exec
spans evaluate in the primary checkout rather than a provisioned worktree,
and the <prior-attempt> block is omitted — a render outside a tick has no
attempt to carry, it is never reconstructed, and the output's first line
says so. A tick's own record of what it sent stays in rendered-prompts/;
there is no --out, stdout is the surface.

Options:
  --entry <tag>   Fanout phases only: scope the render to that queue entry,
                  pickable or not — a gated, parked or blocked entry renders
                  and stderr says a tick would not carry it. Omitted, the
                  entry the next wave's first batch carries first is chosen
                  by the dispatcher's own batch arithmetic.

Exit codes:
  0   The prompt resolved and was written to stdout.
  2   Usage: missing <phase>, an extra positional past it, --entry with no
      value, an unknown phase, --entry against a phase that picks no entry,
      --entry naming no entry in the queue at HEAD, or a fanout phase with
      nothing pickable and no --entry to scope it. Also: the chain failed to
      load with the CJS-context refusal — the host repo's package.json (or
      the one beside .flume/chain.ts) lacks "type": "module".
  65  Data error (EX_DATAERR): the prompt never resolved — an inline-exec
      span exited non-zero (each failing span named with its stderr), or the
      phase's promptArgs hook threw. The same refusal a tick would have
      bought with an invocation; the engine calls the class render-refused.
  69  Mount-dead (EX_UNAVAILABLE): the chain could not be brought up for any
      other reason — it failed to load, the queue at HEAD failed to parse,
      or the declared prompt file is not on disk. Nothing was rendered.
${bayDiscoveryRow(6)}
`,
  friction: `Usage: flume friction [name]

Bare: list the declared friction channel's (Chain.friction) notes — one line
per file directly under the channel dir, as "<filename>  <size>  <mtime>".
A dot-prefixed name is not a note: the listing omits it, <name> refuses it,
and the status count skips it.
With <name>: print that note's bytes verbatim to stdout — the channel's
content is never interpreted, only moved, counted, listed, or printed
(docs/CLI.md, "flume friction [name]"). Read-only:
no baton flag is touched, no agent runs.

Exit codes:
  0   Success — including a declared channel whose directory doesn't exist
      yet (empty list) and a bare list against an empty channel.
  2   Usage: Chain.friction is undeclared, extra arguments were given, or
      <name> names no file directly under the channel dir (including a name
      that would resolve outside it). Also: the chain failed to load with
      the CJS-context refusal — the host repo's package.json (or the one
      beside .flume/chain.ts) lacks "type": "module".
  69  Mount-dead (EX_UNAVAILABLE): the chain module could not load for any
      other reason. Nothing was read — fix the chain and re-run.
  74  I/O error (EX_IOERR): the channel dir, or a note in it, exists but
      could not be read or stat'd (permission denied, a symlink loop, a
      non-directory in the channel's place, ...). Named <name> and bare list
      alike refuse rather than report the note missing or the channel empty
      — that reading would tell the operator there is no friction to route
      when there may be some. The bare list prints no rows at all on a
      refusal, never a partial listing.
      ${bayDiscoveryRefusal(6)}
`,
};

export function isSubcommand(value: string): value is Subcommand {
  return (SUBCOMMANDS as readonly string[]).includes(value);
}

/**
 * The page that answers one command name — its {@link HELP_SUB} entry.
 * `undefined` is a name this surface carries no page for.
 *
 * One decision, read by every arm that prints a page: `flume <name> --help`,
 * `flume help <name>`, and `flume --help <name>`. A page reachable through
 * one spelling and not another is the shape this function exists to make
 * unspellable.
 */
export function helpPageFor(name: string): string | undefined {
  return isSubcommand(name) ? HELP_SUB[name] : undefined;
}

export function wantsHelp(args: readonly string[]): boolean {
  return args.includes("--help") || args.includes("-h");
}
