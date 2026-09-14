# Stranded inbox entries, cross-referenced against the survey

Triage material, not findings. Written 2026-09-14 because the cross-session
channel this was first sent over dropped a message, and the routing decision
below should not depend on a message landing.

## What is stranded

Pulling `main` to v0.15.0 stranded ~380 lines of uncommitted
`.flume/inbox.md` — roughly 24 entries dated 2026-08-06 → 2026-09-03, mostly
"jeff pass" field reports. 0.15.0 replaced that single file with one-file-each
under `.flume/inbox/` (`.flume/PROTOCOL.md`, *Records: one file each*), so
nothing re-files the content automatically and a stash-pop would recreate a
file the repo no longer uses.

The content is preserved verbatim at the flume session's scratchpad as
`preserved-inbox.md`, and in the stash entry `inbox findings pre-pull`.
Nothing has been dropped.

**The decision is not this session's.** Six entries below appear closeable,
but each is a judgment about another bay's work. They are laid out here with
the evidence so whoever owns the triage can rule cheaply.

## Ruling

**2026-09-14 — 1-6 are closed. Ruled by the chef in the flume session,
confirmed by the chef at the pass.**

The ruling was relayed verbatim to `jeff-intake-triage` and held there as a
claim, per the pass's house law that a confirmation an agent attributes to the
chef enters no member until the chef confirms it at that keyboard. That
confirmation has since landed, and the board's carry line
(`jeff/spool/2026-09-04-flume-inbox-carry.md`) is narrowed to the entries below
that are *not* 1-6 — `jeff` `7cf7c31`.

The confirmation is reported by the pass rather than witnessed from this
session; `7cf7c31` is the record of it.

Nothing in the stash was deleted on this ruling. The six close by **not being
carried** — their disposition is this file plus the consumer files it cites.
The stash, `preserved-inbox.md`, and the pass's byte-identical 09-04 copy all
remain intact.

## Closeable — verified on disk 2026-09-14

| # | Entry | Why it looks closed | Evidence |
| --- | --- | --- | --- |
| 1 | `renderSchemaForPrompt` states a fence the engine doesn't enforce (08-06, + the 08-06 cross-bay addendum) | **The entry's own flip trigger fired.** It recorded that the local correction "retires when the engine conditions the sentence." 0.15.0 now emits *"Enforced on fanout: **a scoped tick** may write ONLY these paths…"* — conditioned. Both divergent local mitigations retire: consumer-c's assert and consumer-a's prose. | `src/PendingSchema.ts:513`; `consumer-c.md` §4 |
| 2 | metrics.jsonl loss, root-caused as prefix-matching the result event (08-06 addendum 2) | **Fixed in both bays, independently.** Neither prefix-matches now — one uses `lastIndexOf('"type":"result"')`, the other `.includes(...)`. The transferable CHAIN-AUTHORING line is still worth keeping; the incident is closed. | `consumer-a.md` §3 #6; `consumer-b.md` §3 #3 |
| 3 | Channel-only commits should count as shipped (09-03, a consumer-a job) | **Solved chain-side, better than the ask.** A declared `channelOnly` boolean on the entry plus a `shipped` predicate honouring it — explicitly declared per entry, not inferred from touched paths. The chain's comment records that the inference version was rejected deliberately. | `consumer-a.md` §2, §5 |
| 4 | Plan's continuation marker has no input for a standing multi-tick work order (09-03) | **Solved chain-side**, exactly as the entry proposed: a declared `planBacklogPath` merged into plan's fence, with a live 332-line backlog file. | `consumer-b.md` §2, §5 |
| 5 | Brief cursor is a raw SHA; rebase orphans it (09-03) | **Solved chain-side, and the real failure was worse than filed.** Computing the window in a prompt span made an unresolvable cursor *fatal* — a non-zero span aborts the render, and plan is the only phase that can rewrite `state.md`, so a bad cursor bricked the one phase able to fix it. Moved into `promptArgs`, where it renders as an instruction to re-stamp. A content-hash cursor is still the cleaner fix; the deadlock is the finding. | `consumer-b.md` §3 #9, §7 |
| 6 | `setupDirs` not reaching the plan singleton worktree (09-03, a consumer-a job) | **Answered: yes, plan needs provisioning too.** Two consumers declare `setupWorktree` on the *plan* phase, one citing MIGRATING-0.12 §2 — a singleton now runs in a worktree, and their plan prompts shell out to tooling needing gitignored `node_modules`. | `consumer-c.md` §2; `consumer-d.md` §2 |

## Superseded by a new record

The **zombie pickability** entry (08-07) and its 08-07 correction: the
correction was right that the fix is chain-side. But 0.15.0 now **silently
disarms that chain-side brake**. Filed fresh on `main` as
`.flume/inbox/2026-09-14-clean-exit-rename-disarms-consumer-brakes.md` rather
than reopening the old entry.

Two further stranded entries were re-dated and re-filed the same way, both
re-verified unchanged on 0.15.0:
`2026-09-14-retire-accepts-non-paths.md` and
`2026-09-14-no-render-verb-consumers-hand-build-it.md` — the latter gaining
evidence it did not have in August.

## Standing as filed

The survey bears on these neither way; they are not closeable on its evidence:
the CHAIN-AUTHORING candidates (arena contract, prompt-audit checklist,
gate-config-inside-run), the multi-phase-derivation doctrine, the MIGRATING
doc gaps (0.11.0 tarball text, §5 routing row, merge-inherited pins), no
rate-limit backoff, merge-stage untracked collisions, friction-to-retry
transport, `job new` seed-branch assertion, and the capability-bail `probe`
field.

Two operator rulings gained corroboration without needing closure: tick
sizing (both job-mode bays now size `tickTimeoutMs` from their own measured
corpus) and lean active-only registers (one consumer already runs a reverting
ledger-cap gate, which answers the "a gate needs a number nobody set"
objection with a working precedent).

## Not verified

Whether prior-attempt records still die with the tick worktree (0.12 field
report #2). One consumer reads records through `priorAttemptPath` on 0.14 and
its brake is otherwise live, which is weak evidence the durability issue was
addressed — but it was not tested and is not claimed here.
