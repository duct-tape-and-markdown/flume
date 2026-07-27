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

## 2026-07-27 — the harness block misstates the fence on entry-scoped ticks (human, from the two-exemplars study)

`prependHarnessBlock` (`src/Prompt.ts:218`) renders `phase.writablePaths`
under "anything else you modify will revert the commit" — on EVERY tick,
including fanout ticks with an `assignedEntry`, where the guard actually
narrows to `entry.files ∪ entryChannelPaths`
(`src/Dispatcher.ts:1056-1068`). The engine's one dispatcher-authoritative
prompt surface ("your prompt states the task; the harness states what it
will enforce" — CHAIN-AUTHORING §5) states the wrong fence on exactly the
ticks where the fence is narrowest. Field consequences, all 2026-07-27:
dev-9175-cim-usage agents got phase globs in-band while the entry fence
reverted them; centercode-platform PR #672 had to hand-write fence clarity
into a chain prompt that the engine should self-transmit; temper's build
prompt still PROMISES "staying inside [phase paths] never reverts" —
true on its 0.3.1-era engine, armed as a lie by its 0.6 bump. Fix shape:
the harness block states the EFFECTIVE fence for this tick — on scoped
ticks list `entry.files ∪ channelPaths` as the revert boundary and the
phase globs as the outer ceiling. Chains stop hand-transmitting guard
semantics; version bumps stop silently invalidating prompts — the engine
speaks for itself, per tick, version-correct forever.
