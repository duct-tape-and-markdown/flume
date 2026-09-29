# The same absorption sits at the setupWorktree seam, hand-rolled twice

Shipped: `waitFor` throws a named `BlownWait`, the fake agents run their
bodies through `runAgentBody` (tests/helpers/dispatcherFixture.ts), and the
seven fanout cases that order a wave from inside an agent body assert the
record empty before their verdicts.

Two observations for the next rotation.

**1. setupWorktree bodies are absorbed the same way, and two cases already
pay for it by hand.** The ledger-refusal pair in Dispatcher.test.ts
("names a decline folded after the refusing pick", "names a render refusal
raised after the refusing pick") each spell `let heldWait; try {
await refusingPickSettled(...) } catch (err) { heldWait = ... }` plus
`expect(heldWait).toBeUndefined()` — one sequence copied across two legs
(engineering.md, *A module is one job*). The recorder now covers the agent
seam only; routing a `setupWorktree` body through it would delete both
copies and cover every future hook body. Behavior-free, so it is debt
rather than an entry — but it is the third copy that files it, and this
entry made two of them redundant rather than three.

**2. `expectNoFindings` has a fourth consumer that is not a scan.** The
guard cannot be `expect(record).toEqual([])`: chai truncates the received
side at 40 chars, so the wait's own message — the whole point — is elided
(platform-facts.md, *chai truncates an inspected value in an assertion
message at 40 characters*). The doubling's one home is
`tests/helpers/repoProgram.ts`, a module whose header states its job as the
base the source scanners are visitors over. Three scans read their verdicts
through it; this is a fanout dispatcher suite doing the same. The trio
(`NO_FINDINGS`, `renderFindings`, `expectNoFindings`) may want the file its
name is if a fifth consumer arrives.
