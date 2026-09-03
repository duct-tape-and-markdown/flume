# Open Questions

Decisions parked for human input. Each question is a `##` subsection with status, context, options, and recommended disposition.

Status markers:
- **PARKED** — no movement until human resolves
- **PARTIALLY ADDRESSED** — some progress; remaining ambiguity blocks closure
- **NEEDS AMENDMENT** — answer is clear; requires a spec edit to close

<!-- questions below this line -->

## `flume check`'s fence collapses to universal rejection when a chain declares zero fanout phases (PARKED)

`src/cli.ts:1184-1188` derives `check`'s fence from `chain.phases.filter(p => p.concurrency === "fanout")`. Nothing in `src/Phase.ts`'s `Concurrency` type or chain-load validation requires at least one fanout phase — per `spec/pending.md` ("Selection is the sole site; a singleton phase does not pick from pending"), a chain with only singleton phases is structurally legal, it just never consumes `pending.json`. For such a chain, `consumerPhases` is `[]`, `entryWriteScopeUnion([], [])` is the empty fence, and `matchesAny(p, fence)` is `false` for every declared path — so `flume check` would report *every* pending entry as a fence violation, misdiagnosed as "declares files outside the consumer phase's fence" when the real story is "no consumer phase exists." `spec/cli.md`'s `check` description doesn't address this case.

Options:
- **A — vacuous pass.** Zero fanout phases means nothing will ever pick from the queue, so `check`'s fence step has nothing to check; skip it (mirroring how `check` already treats an absent `pending.json`).
- **B — keep rejection, fix the message.** Universal rejection may be the intended defensive posture (a misconfigured chain should be loud), but the message should name "no fanout phase declared" distinctly from "paths outside the fence" so an operator isn't sent chasing the wrong cause.
- **C — enforce the invariant earlier.** If a chain with zero fanout phases and a non-empty `pending.json` is always a misconfiguration, chain-load validation could refuse it outright, making `check`'s current behavior moot.

This repo's own `.flume/chain.ts` always declares one fanout phase (`build`), so the case doesn't manifest here — this is a second-implementation question (`engine-boundary.md`), not a bug against current usage.

## `spec/loop.md` "The tick verdict" field enumeration omits `bystanderCheckpointSha` (NEEDS AMENDMENT)

`1f98caf` added `TickVerdict.bystanderCheckpointSha` to satisfy "Crash equals stop" ("its sha recorded on the tick verdict"), and the field is real and reported (JSDoc on `TickVerdict.bystanderCheckpointSha` in `src/Dispatcher.ts`, populated in both `runSingleton` and `runFanout`). But `spec/loop.md`'s "The tick verdict — one facts artifact" section — the canonical enumeration of what the artifact carries — doesn't list it alongside `headSha`/`at`/`invocations[]`, each of which got its own bullet when added. The fix is mechanical: a bullet naming the field and its recovery purpose, mirroring "Every verdict is anchored" / "Every agent invocation leaves a usage row" already there. Not filed as a pending entry — the edit is to `spec/loop.md` itself, a human-authored surface plan doesn't touch.
