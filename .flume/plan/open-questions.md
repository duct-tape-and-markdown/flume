# Open Questions

Decisions parked for human input. Each question is a `##` subsection with status, context, options, and recommended disposition.

Status markers:
- **PARKED** — no movement until human resolves
- **PARTIALLY ADDRESSED** — some progress; remaining ambiguity blocks closure
- **NEEDS AMENDMENT** — answer is clear; requires a spec edit to close

<!-- questions below this line -->

## `.flume/chain.ts:54`'s `anyVoluntaryBailRecord` needs `priorAttemptsDir` wired in by hand (PARKED)

`PRIOR-ATTEMPTS-DIR-EXPORT` (pending.json) exports `priorAttemptsDir(flumeDir)` from
`src/Dispatcher.ts`/`index.ts`/`flumeApi.ts` so `anyVoluntaryBailRecord` can stop hardcoding the
`"prior-attempts"` literal. But `.flume/chain.ts` is outside every phase's lane
(`.claude/rules/spec-plan-build.md`) — no build tick can write it. The prior plan tick declared
`.flume/chain.ts` in that entry's `files.edit` anyway; build picked it up, and the resulting
merge failure is exactly the recorded footprint (`chore(flume): record merge-failure footprints
for PRIOR-ATTEMPTS-DIR-EXPORT`). This tick scoped the entry back down to the exportable src+test
surface and parks the consuming edit here.

Once `priorAttemptsDir` ships, an interactive session should replace `.flume/chain.ts:54`'s
`resolve(process.env.FLUME_DIR ?? CHAIN_DIR, "prior-attempts")` with a call through the exported
helper (mirroring however the file already imports `priorAttemptPath`/`slugify` from `../src/`),
in its own `chore(flume):` commit — no design fork, just an edit no phase can make.

## `src/Dispatcher.ts` (4836 lines) bundles several jobs that read as separate homes (PARKED)

Posture sweep (`.claude/rules/posture-sweep.md` standing lens: "a module carrying jobs that want separate homes") over the `src/Dispatcher.ts` neighborhood found the file's own `// ---------- X ----------` markers delineating distinct concerns: chain load+validate (`:735-1028`), tick-verdict I/O (`:440-600`), singleton tick (`:1601-1943`), fanout tick + per-entry fanout (`:1983-2892`), worktree/friction/prior-attempt helpers (`:2894-4153`), loop supervisor (`:4156-4628`). Sibling engine files stay well under 1000 lines (`git.ts` 651, `Agent.ts` 606, `PendingSchema.ts` 598).

Not filed as a mechanical fix: `Dispatcher.ts:42-44` already documents a constraint that shaped the current structure — `buildFlumeApi` is a function rather than a constant "precisely so" a chain can't resolve a second physical engine, which implies at least the chain-load/`FlumeApi` surface is deliberately colocated with the dispatcher rather than free to split. Whether the tick-execution (singleton/fanout), worktree/friction/prior-attempt, and loop-supervisor concerns share that same constraint, or could split cleanly, needs a design call rather than a sweep-driven guess.

Options:
- **A — split along the marked seams**, keeping only what the `buildFlumeApi` cycle constraint actually requires colocated.
- **B — leave it whole**, treating the file's size as the cost of the single-cycle-avoidance design and citing that constraint as the deliberate divergence (`engineering.md` "The fix lands at the mechanism" allows a declared exception).
- **C — narrower split**: extract only the clearly acyclic concerns (worktree/friction/prior-attempt helpers, loop supervisor) and leave chain-load + tick execution together.

## `flume check`'s fence collapses to universal rejection when a chain declares zero fanout phases (PARKED)

`src/cli.ts:1184-1188` derives `check`'s fence from `chain.phases.filter(p => p.concurrency === "fanout")`. Nothing in `src/Phase.ts`'s `Concurrency` type or chain-load validation requires at least one fanout phase — per `spec/pending.md` ("Selection is the sole site; a singleton phase does not pick from pending"), a chain with only singleton phases is structurally legal, it just never consumes `pending.json`. For such a chain, `consumerPhases` is `[]`, `entryWriteScopeUnion([], [])` is the empty fence, and `matchesAny(p, fence)` is `false` for every declared path — so `flume check` would report *every* pending entry as a fence violation, misdiagnosed as "declares files outside the consumer phase's fence" when the real story is "no consumer phase exists." `spec/cli.md`'s `check` description doesn't address this case.

Options:
- **A — vacuous pass.** Zero fanout phases means nothing will ever pick from the queue, so `check`'s fence step has nothing to check; skip it (mirroring how `check` already treats an absent `pending.json`).
- **B — keep rejection, fix the message.** Universal rejection may be the intended defensive posture (a misconfigured chain should be loud), but the message should name "no fanout phase declared" distinctly from "paths outside the fence" so an operator isn't sent chasing the wrong cause.
- **C — enforce the invariant earlier.** If a chain with zero fanout phases and a non-empty `pending.json` is always a misconfiguration, chain-load validation could refuse it outright, making `check`'s current behavior moot.

This repo's own `.flume/chain.ts` always declares one fanout phase (`build`), so the case doesn't manifest here — this is a second-implementation question (`engine-boundary.md`), not a bug against current usage.

## `spec/loop.md` "The tick verdict" field enumeration omits `bystanderCheckpointSha` (NEEDS AMENDMENT)

`1f98caf` added `TickVerdict.bystanderCheckpointSha` to satisfy "Crash equals stop" ("its sha recorded on the tick verdict"), and the field is real and reported (JSDoc on `TickVerdict.bystanderCheckpointSha` in `src/Dispatcher.ts`, populated in both `runSingleton` and `runFanout`). But `spec/loop.md`'s "The tick verdict — one facts artifact" section — the canonical enumeration of what the artifact carries — doesn't list it alongside `headSha`/`at`/`invocations[]`, each of which got its own bullet when added. The fix is mechanical: a bullet naming the field and its recovery purpose, mirroring "Every verdict is anchored" / "Every agent invocation leaves a usage row" already there. Not filed as a pending entry — the edit is to `spec/loop.md` itself, a human-authored surface plan doesn't touch.
