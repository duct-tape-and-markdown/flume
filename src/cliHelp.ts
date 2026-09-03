/**
 * Subcommand table + runtime usage text — the authoritative reference for
 * `flume --help` / `flume <cmd> --help`, split out of `src/cli.ts`
 * (`.claude/rules/posture-sweep.md`, "A violation counts only when verified
 * on disk this tick").
 */

const SUBCOMMANDS = [
  "status",
  "tick",
  "loop",
  "wake",
  "sleep",
  "stop",
  "log",
  "check",
  "friction",
] as const;
type Subcommand = (typeof SUBCOMMANDS)[number];

export const HELP_TOP = `flume — a disciplined harness for AI-derivation pipelines.

Usage: flume <command> [options]

Commands:
  status              Print baton state (awake phases + pending count).
  tick                Run one tick of whichever phase is awake.
  loop [--max N]      Run ticks until hibernation (default cap 50).
  wake <phase>        Mark <phase> awake (touch .flume/awake/<phase>).
  sleep <phase>       Mark <phase> hibernating (remove .flume/awake/<phase>).
  stop                Write .flume/stop and print what happens next: a live
                      supervisor finishes its in-flight tick then ends the
                      run; the next loop/job run refuses to start until the
                      flag is removed. Idempotent. No unstop/resume verb —
                      removing the flag is the operator's own acknowledgement.
  log [-n N] [--json] Print the last N tick verdicts (default 10) from
                      tick-verdicts.jsonl, oldest first — a human table by
                      default, or --json for the records verbatim as JSONL.
  check               Validate the working tree's plan/pending.json — parse
                      plus fence arithmetic against the consumer (fanout)
                      phase's declared fence — without spending an agent.
  friction [name]     List (bare) the declared friction channel's notes —
                      filename, size, mtime — or, with <name>, print that
                      note's bytes verbatim. Never interpreted.
  job new <name>      Seed .flume/jobs/<name>/ from the repo chain's declared
                      Chain.seedDir, if any (runtime .gitignore, baseline
                      commit on the current HEAD). No branch created.
  job run <name> [--max N]
                      Wake the chain's entry phase from hibernation, then
                      loop under the job resolution — on whatever branch
                      HEAD is on.
  job rm <name>       Remove the job's state root: git rm + cleanup commit on
                      the current HEAD, untracked runtime swept, worktrees
                      pruned. Refuses on a live loop.
  job status          List jobs under .flume/jobs/ — awake phases + pending
                      count, plus a friction count where declared and
                      non-empty, per job. Observational; no side effects.

Options:
  --job <name>        Resolve state to <repoRoot>/.flume/jobs/<name> and set
                      FLUME_JOB=<name> (equivalent to setting the env var).
                      Config (chain.ts + prompts) stays at <repoRoot>/.flume —
                      chains are repo-resident; an explicit FLUME_CONFIG_DIR
                      composes. Conflicts with explicit FLUME_DIR (exit 2).
                      Refuses (exit 2) if <name> names no existing state
                      root — every command reached this way except
                      \`job run\`, which may create one; use \`job new\`.
  -h, --help          Print this message.
  -v, --version       Print the flume version.

Run \`flume <command> --help\` for per-command usage and exit codes.
`;

export const HELP_SUB: Record<Subcommand, string> = {
  status: `Usage: flume status

Print baton state: awake phases (or "hibernating" if none), then, when
.flume/loop.pid exists, supervisor liveness ("supervisor pid N live" or
"loop.pid present, process dead — stale"; no pidfile prints nothing extra),
then, when HEAD names a ref and a tip claim exists for it, its holder ("tip
claimed by pid N" or "tip claim present, process dead — stale"; a detached
HEAD or no claim file prints nothing extra), then the pending entry count
from plan/pending.json ("pending: N"; "pending: 0" if absent; "pending:
unparsable" if present but malformed), then, when the chain loads, a
friction count (declared Chain.friction dir holding notes) and one line per
pending entry gated on a capability the chain hasn't asserted. Observational
— no side effects, no agent invocation.

Exit codes:
  0   Always.
`,
  tick: `Usage: flume tick

Run one phase × one tick of whichever phase is awake. Loads .flume/chain.ts,
picks the next pending entry (for fanout phases) or runs the singleton phase,
invokes the agent, and applies validation gates.

Exit codes:
  0   Success, or hibernation (no phase awake).
  1   Harness error (unexpected exception), or HEAD is detached (v0.11 §4:
      the tick record's meaning is advancing a named tip; checkout a branch
      first). No claim is taken or checked — that's loop-level only.
  2   Usage: a stray trailing positional (\`tick\` consumes none — running
      something other than whichever phase is awake is refused, not
      honored); or the chain load failed with the CJS-context refusal — the
      host repo's package.json (or the one beside .flume/chain.ts) lacks
      "type": "module". Add it and re-run.
  69  Mount-dead (EX_UNAVAILABLE): the chain module could not load, its
      state root is missing, or its declaration is invalid. No agent ran —
      fix the chain (or its state root) and re-run.
  78  Terminal misconfiguration (EX_CONFIG): every awake flag names a phase
      the chain does not declare. The flags are left on disk — inspect, then
      \`flume sleep <phase>\` or fix the chain.
`,
  loop: `Usage: flume loop [--max N]

Run ticks until hibernation or --max iterations have elapsed.

Options:
  --max N    Maximum number of ticks before bailing (default 50).

Exit codes:
  0   Hibernation reached, or --max ticks completed — including partial
      success (some ticks errored but at least one entry shipped; the
      completion summary names the errors).
  1   Harness error, another live loop holds the lock; also, the stop flag
      (\`.flume/stop\`) is already present (refusal names the path — remove
      it to acknowledge the stop, spec/loop.md "Graceful stop"); also, HEAD
      is detached (v0.11 §4: checkout a branch first — the tip claim below
      keys on the ref); also, another process holds the tip claim (v0.11
      §4: the refusal names the holder pid and claim path); also, at least
      one tick errored and the run shipped nothing (v0.7 §4); also, an
      identical pre-tick worktree provisioning failure repeated 3
      consecutive ticks with no successful tick between them (v0.7 §16) —
      the completion summary names the repeated signature. A single
      entry's provisioning failure alone does not abort: it quarantines
      that entry for the rest of the run while the others keep dispatching.
      A graceful stop mid-run (\`.flume/stop\` written while the loop is
      already going) ends iteration after the in-flight tick finishes, but
      never changes this exit code — it stays decided by the run's totals.
  69  Stopped on a child tick's mount-dead failure (see \`flume tick
      --help\`): the chain never resolved. The run aborts after that one
      tick instead of burning the remaining --max ticks against the same
      wall.
  78  Stopped on a child tick's terminal misconfiguration (see \`flume tick
      --help\`); the orphaned awake flags are left on disk.
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
`,
  stop: `Usage: flume stop

Write <flumeDir>/stop and print what happens next: a live supervisor
finishes its in-flight tick — merge, park, verdict, and handoff run exactly
as they would have — then releases the tip claim and the loop lock and ends
the run; without a live supervisor, the next \`loop\`/\`job run\` refuses to
start until the flag is removed. Idempotent — a repeat call finds the flag
already present and prints the same statement. The verb is discoverability
plus the printed statement, never a privileged channel: \`touch\` on the same
path is equally the interface. There is deliberately no \`unstop\`/\`resume\`
verb — removing the flag is the operator's own acknowledgement that the stop
was seen.

Exit codes:
  0   Always — including when the flag was already present.
  2   Usage: a stray trailing positional (\`stop\` consumes none). No flag is
      written.
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
`,
  check: `Usage: flume check

Validate the working tree's plan/pending.json without spending an agent:
the real parse (the same decode a tick's resolution takes, against the
loaded chain's declared entryExtension) plus fence arithmetic for every
entry — declared paths against the consumer (fanout-concurrency) phase's
writablePaths ∪ entryChannelPaths, the same computation the write guard
enforces. Read-only: no baton flag is touched, no agent runs, and chain
gates never run — only the engine's own parse + fence mechanics.

Exit codes:
  0    Pending queue parses clean and every entry's declared files survive
       the consumer phase's fence (also 0 when plan/pending.json is absent
       — nothing to check).
  2    A stray trailing positional (\`check\` consumes none), checked before
       the chain load below; or the chain failed to load with the
       CJS-context refusal — the host repo's package.json (or the one
       beside .flume/chain.ts) lacks "type": "module". Add it and re-run.
  65   Data error (EX_DATAERR): plan/pending.json fails schema validation,
       or an entry declares a path outside the consumer phase's fence.
       Naming the offending entry (and paths, for a fence violation).
  69   Mount-dead (EX_UNAVAILABLE): the chain module could not load for any
       other reason. Nothing was checked — fix the chain and re-run.
  74   I/O error (EX_IOERR): plan/pending.json exists but could not be read
       (permission denied, a path too long for the platform, …). Naming
       the underlying error.
`,
  friction: `Usage: flume friction [name]

Bare: list the declared friction channel's (Chain.friction) notes — one line
per file directly under the channel dir, as "<filename>  <size>  <mtime>".
With <name>: print that note's bytes verbatim to stdout — the channel's
content is never interpreted, only moved, counted, listed, or printed
(spec/chain.md, "Chain.friction"). Read-only: no baton flag is touched, no
agent runs.

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
`,
};

export const HELP_JOB = `Usage: flume job <verb> [args]

Lifecycle verbs over a job — .flume/jobs/<name>/, tracked files in the
working tree, on whatever branch the operator is on. Machinery only —
harness content arrives via the repo chain's declared Chain.seedDir,
chain-owned.

Verbs:
  new <name>
      Load the repo chain (<configDir>/chain.ts — missing chain exits 2: a
      job that could never \`run\` must not be creatable), copy its declared
      seedDir into .flume/jobs/<name>/ verbatim and skip-existing (absent
      seedDir → bare job, no warning; a declared-but-absent seedDir exits 2),
      merge runtime ignore entries into the job dir's .gitignore (awake/,
      prior-attempts/, worktrees/, node_modules/, loop.pid), pin
      core.longpaths repo-locally (win32), and baseline-commit the seeded
      harness on the current HEAD. No branch is created or checked out.

  run <name> [--max N]
      Wake the chain's entry phase (phases[0]) iff the baton is hibernating
      — a mid-job baton is left untouched; then run the standard loop under
      the job resolution, on whatever branch HEAD is on. Lock, supervisor,
      and exit codes are identical to \`flume --job <name> loop [--max N]\`.

  rm <name>
      Refuse while the job's loop.pid records a live pid. \`git rm -r
      .flume/jobs/<name>\` plus a cleanup commit on the current HEAD, remove
      untracked runtime remnants (awake/, prior-attempts/, the @dtmd/flume
      link, pid files), and \`git worktree prune\`. No branch is touched.

  status
      Enumerate .flume/jobs/* in the working tree: one line per job with its
      awake phases (or "hibernating"), pending count (entries in the
      job's plan/pending.json; 0 when absent, "unparsable" when broken), and,
      when the repo chain declares Chain.friction, a friction count (0 when
      the dir is absent, "unreadable" when it exists but can't be read).
      Observational — nothing on disk changes; prints "no jobs" when the
      jobs dir is empty or missing.

Exit codes:
  0   Success (run: hibernation reached, or --max ticks completed —
      including partial success, some ticks errored but at least one entry
      shipped; rm on a job dir with nothing tracked is a no-op; status:
      always, including no jobs).
  1   Git or filesystem failure (provisioning, commit); for run also:
      harness error, another live loop holds the job's lock, at least one
      tick errored and the run shipped nothing (v0.7 §4), or an identical
      pre-tick worktree provisioning failure repeated 3 consecutive ticks
      (v0.7 §16); for rm also: the job's loop is still live.
  2   Usage error: missing or unknown verb, missing <name>, a <name> that is
      not a single path segment, new with no chain at <configDir>/chain.ts or
      a declared seedDir absent on disk, rm on a <name> whose job dir does
      not exist, or status given any argument.
  78  run: stopped on a child tick's terminal misconfiguration (see
      \`flume tick --help\`).
`;

export function isSubcommand(value: string): value is Subcommand {
  return (SUBCOMMANDS as readonly string[]).includes(value);
}

export function wantsHelp(args: readonly string[]): boolean {
  return args.includes("--help") || args.includes("-h");
}
