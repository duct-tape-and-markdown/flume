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

## 2026-07-31 — engine seams from the chain simplify review (operator)

Three engine-side candidates surfaced by the 4-angle simplify pass on
`.flume/chain.ts`; each is a dedup of a fact the engine already computes,
not new capability. File as entries only where a spec/rules cite holds;
park otherwise.

1. **GateContext lacks touched-paths.** `git show --name-only` on the tick
   commit is run independently by chainLoadGate, writablePathsGate, the
   dispatcher's footprint derivation, and (until today) this chain's
   changelogGate. One computation per commit on GateContext would retire
   three in-engine copies and the shell-out every downstream chain gate
   re-authors. Per engineering.md "The fix lands at the mechanism".
2. **`showNameOnly` is not in the barrel.** This chain now imports it from
   `../src/git.ts` directly; downstream bays (published dep) cannot. "An
   export earns its consumer" — the consumer exists now. Moot for chains
   if (1) ships.
3. **Per-entry afterMerge suite cost — measured, no action.** The fast
   lane is ~21s; per-entry granularity buys surgical revert attribution
   and is the right trade at this suite size. Revisit trigger: fast-lane
   wall time approaching minutes.
