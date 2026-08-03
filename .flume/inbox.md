# Inbox — findings queue

Transient queue of findings awaiting triage by the plan phase. Append-only by external reviewers; drained-only by plan.

## Who writes here

- Humans dropping observations to be routed.
- Future review skills (e.g. multidim-review, security-review) when added.

**Plan does not write here.** Plan-tick self-audit findings go directly to `.flume/plan/pending.json` (file as entry), to `.flume/plan/open-questions.md` (parked for human input), or live only in the `plan:` commit message body (narrative + dispositions).

## Who reads here

The plan phase reads inbox.md every tick and drains each entry into one of three outcomes:

1. **File as a pending entry** in `.flume/plan/pending.json` (with a `per` cite to the relevant spec section).
2. **Park** in `.flume/plan/open-questions.md` if it needs human input before any code can land.
3. **Accept as debt** — note the disposition + one-line reason in the `plan:` commit message body.

After routing, the inbox entry is **removed**. The queue is meant to drain; it is not a log. Narrative history lives in git.

## Format

Each entry is a markdown subsection:

```
## YYYY-MM-DD — <short label> (<source>)

<finding body — observations, file:line cites, severity if known>
```

`<source>` is the writer (e.g. `human`, `multidim-review`). One subsection per finding cluster; group related items under one `##` to keep routing atomic.

---

<!-- entries below this line; newest first -->

## 2026-08-03 — ship classification stops inferring intent from paths (operator ruling)

Ship detection diffs the merged commit against `declaredPaths(entry)` and calls
zero overlap "not shipped" (`Dispatcher.runFanout`, the `touchesDeclaredFile`
branch). That makes `entry.files` load-bearing — the last place an entry
declaration is a contract rather than a prediction, and the coupling the
writablePaths ruling removed everywhere else.

**Ruling: delete the path predicate.** An entry ships when its commit landed and
its gates passed, unless the agent's own termination says it parked.

The engine already captures the agent's final message on every invocation
(`AgentTermination.stdout`, `Dispatcher.invokeAgent` call sites) and already
reads it to classify a bail — but only inside the no-commit branch
(`classifyNoCommit`). When a commit lands, the termination is discarded. That
discard is the defect: the one party that knows whether work happened is the
agent, and the engine throws away its account, then guesses from paths.

So the fix is **subtraction plus reuse**, not new machinery: stop discarding the
termination, drop the diff. No new config, no new schema, no new agent channel —
the build prompt already asks for a stated bail.

Do not preserve the predicate against `phase.entryChannelPaths` instead. The
comment above the branch describes that intent, but the code never implemented
it; the comment is stale narration, and reading a phase's scratch paths is the
same inference one layer over.

**Reconcile with `PENDING-ZERO-FILES-SCHEMA-FLOOR`** (queued, may ship first).
Its stated justification is "an entry declaring empty files can never be
classified shipped" — this ruling removes that failure entirely. The floor may
still be wanted, because `files` feeds `partitionByFileOverlap` and an entry
declaring nothing partitions against nothing. But the *rationale* and any test
pinning it must be re-derived, not carried forward: a test whose reason has
evaporated is a green verdict over a subject that no longer exists.

Per candidate: `spec/pending.md` *Ship detection requires a declared-files diff*
— the section title itself is what changes. Test: an entry whose commit touches
no declared file, with a clean termination and green gates, is classified
shipped; an entry whose agent stated a park is not.

## 2026-08-03 — `claudeCode()` keeps `--dangerously-skip-permissions`; the rationale is rewritten (operator ruling)

**Ruling: keep the default.** An autonomous tick cannot answer a permission
prompt, so a prompt is a hang, not a safety net. Closes
CLAUDECODE-SKIP-PERMISSIONS-DEFAULT at option 1.

The rationale is what changes. It currently claims every Flume tick runs in a
worktree the harness controls — false for singleton phases, which run in the
main checkout, and this repo's own plan phase is that case.

Do not replace it with "the fence and the gates are the containment" either.
That is also overstated: the fence and the gates contain **what lands in a
commit**. They contain nothing about what the agent does to the host during a
tick — files outside the repo, network, anything. Swapping one reassuring claim
for another is not a fix.

The claim to write is bounded: the flag is required for autonomy; containment of
what lands is the fence and the gates; what an agent does to the host mid-tick
is not contained, and running flume means accepting that.

Per candidate: `spec/chain.md` *The agent seam*, which carries this same gap as a
`> **Drift:**` note to close in the same commit. Test: the assertion is prose, so
the pin is the spec section agreeing with the source comment — no behavior
changes.

## 2026-08-03 — state-root resolution: run before dispatch, and stop crossing repo roots (operator ruling)

Two findings, one root: `FLUME_DIR` resolution is neither uniform across
subcommands nor bounded to the repo it belongs to.

### Part 1 — resolve before verb dispatch

**Ruling: option 1**, closing FLUME_DIR-canonicalization-skips-`job new`-and-`job
status`. But not as that question framed it.

The question proposes routing two verbs through `resolveStateDirs`, and flags
that `job new` takes its name positionally so the call needs a `--job`-shaped
input synthesized from the positional arg. That synthesis is the signal: the
defect is not that two verbs skip resolution, it is that resolution happens
**after** dispatch instead of before it. Special-casing two verbs back into the
existing call is a branch on specific instances inside otherwise-generic code —
`.claude/rules/engineering.md` *The fix lands at the mechanism*.

Resolve uniformly ahead of the verb switch, so every subcommand inherits the same
guarantee and no verb has to remember to opt in.

**Sequencing note:** `CLI-JOB-FLAG-REFUSES-NONEXISTENT-STATE-ROOT` is already
queued and edits the same resolution path in `src/cli.ts`. They share a declared
path, so `partitionByFileOverlap` serializes them into different waves — expected,
not a conflict. Whichever lands second inherits the other's shape.

Per candidates: `spec/cli.md` *State-root and config-dir resolution*,
`spec/chain.md` *Per-run artifacts belong under `FLUME_DIR`*. Test: a chain
factory reading `process.env.FLUME_DIR` during `job new` sees the resolved job
state root, not the caller's raw environment.

### Part 2 — an inherited `FLUME_DIR` must not cross a repo root

Observed on disk 2026-08-03, not hypothesized. `.flume/awake/groom` appeared in
this repo's live baton at 13:01 while the loop was running. `groom` is not a
phase this chain declares — it belongs to `examples/backlog-groomer-chain.ts`.

Path, verified end to end:

- The CI smoke lane (`.github/workflows/`, ~line 321) seeds a **scratch repo**
  and runs `flume wake groom` && `flume tick` inside it. Correct under CI.
- The `CI-CHAIN-FIXTURES-FACTORY-MIGRATION` build agent ran that lane locally to
  verify its own change (session `…19-57-21…-ci-chain-fixtures-factory-migration`,
  12:57). The agent did nothing wrong — it exercised the repo's documented lane.
- A tick exports `FLUME_DIR` and children inherit it (`Dispatcher.ts`,
  `SuperviseLoopOptions.flumeDir` doc — the supervisor *depends* on this). It is
  an absolute path, so **it overrides cwd**: the nested invocation ran in the
  scratch repo and wrote to the outer repo's state root.
- `flume wake <phase>` (`src/cli.ts`, the `cmd === "wake"` branch) accepts any
  string with no chain validation — prints `woke groom`, exits 0.
- `.flume/awake/` is gitignored. It never becomes a commit, so
  `writablePathsGate` — and every other gate, all of which are commit-shaped —
  is structurally unable to see it.

**The class:** the loop's control plane is writable by the process the loop is
controlling, and every containment mechanism the harness has is commit-shaped.
Same family as `CLI-JOB-FLAG-REFUSES-NONEXISTENT-STATE-ROOT` (control state
materialized by a read-shaped action), one layer deeper — inside a tick rather
than at the operator's keyboard.

This is not agent-specific. **Any** nested flume invocation in a different repo
corrupts its parent's baton today; a downstream chain writing a smoke test hits
it on day one.

**Ruling: fix at the mechanism, keep the cheap check as defence in depth.**

- *Mechanism:* an inherited `FLUME_DIR` does not survive a change of repo root. A
  flume invocation resolving a different `repoRoot` than the one `FLUME_DIR`
  belongs to refuses — *loud or nothing* argues refuse over silently ignoring.
  An explicit `--job` / `--flume-dir` on that invocation is the stated override.
- *Defence in depth:* `wake`/`sleep` refuse a phase the chain does not declare,
  exit 2. The CLI already loads the chain for `status`, so it is free, and it
  converts a silent impossible state into an error at the moment of the mistake.

Do not close this by editing the CI lane. The lane is correct; the inheritance is
the defect, and patching the one caller leaves the mechanism intact.

Per candidates: `spec/cli.md` *State-root and config-dir resolution*,
`spec/jobs.md` *A job is a state root*. Tests: a flume invocation with
`FLUME_DIR` inherited from another repo's tick refuses instead of writing to it;
`flume wake <undeclared-phase>` exits 2 and creates no flag.

**Live consequence, for context:** `groom` is awake right now. It is inert while
plan or build is also awake, but at hibernation the only awake flag will name an
undeclared phase — Axis-C terminal misconfiguration, `EX_TERMINAL_MISCONFIG`
instead of a clean stop. Left deliberately in place: the flags are kept on disk
precisely so this cannot become a silent clean stop, and that mechanism firing is
correct behavior from a bogus cause. Clear the flag when landing this.
