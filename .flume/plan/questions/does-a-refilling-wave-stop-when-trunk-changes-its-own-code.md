# Does a refilling wave stop pulling once trunk carries a commit changing the code the tick process itself loaded?

From the inbox record *a refilling build wave outlives the code it launched
with*, defect 2.

## The observed instance

564940fd landed mid-wave, adding `{{PROTOCOL_LINE}}` to
`harness/prompts/build.md` and its arg to `harness/prompts.ts`. The next
refilled slot's worktree was cut from the live tip, so it carried the **new
template**; the resident tick process still held the **old args code**. The
render threw on the missing arg and the wave died (see
*what-are-the-placeholder-failure-semantics.md*).

## Why the stated defences did not reach it

`spec/loop.md`, *One tick is one fresh process* already rules the skew that
spans two children — "a wave that refills can outlast many merges, so it runs
the code it started on beside siblings spawned after a merge changed it" — and
names the paths it covers: the entry claims, the locks, the branch grammar. Its
remedy is operational (stop after a contract-touching ship, relaunch), with the
promotion trigger stated: "a second livelock despite the documented rule."

This skew is a **third axis** that paragraph does not name: the prompt template
and the runtime that renders it. The template is read from the refilled
worktree's own tip; the args come from the process's loaded module graph. No
child boundary sits between them, so neither the fresh-process invariant nor
the contract-touching stop reaches it.

## The fork

1. **Widen the paragraph, keep it operational** — name the prompt corpus and
   the loaded runtime as one of the paths a refill shares, so a template edit
   is a `contractTouching` ship and the chain's own stop covers it.
2. **A refill stops pulling when trunk moved past what this process loaded** —
   the wave finishes its in-flight slots and the next tick is a fresh process
   on the new code. Mechanical, and the engine already reads the tip per refill.
3. **A refill renders from the tick's own base tip** — pin the template to the
   code that loaded, and accept that a refilled entry is written against a
   slightly older prompt.

2 is the only one that needs no author to remember anything, and it costs one
wave's tail. But it is a policy about when a wave stops, which is engine
behavior a chain cannot express today — your call before anything is filed.
