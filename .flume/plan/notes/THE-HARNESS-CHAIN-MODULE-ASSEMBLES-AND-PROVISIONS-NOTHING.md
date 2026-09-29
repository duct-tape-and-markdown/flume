# The split landed; the cases stayed with the factory, by choice

`harness/agent.ts` (72 lines) takes `agentFactory`; `harness/provisioning.ts`
(147) takes `provisioning`, `oneAtATime`, `installing`, `worktreeSetup`.
`harness/chain.ts` is 664 -> 481 and its header now names both homes.
`supervisorPolicy`, `repoRelativeStateRoot`, `unique` stayed under "the small",
as the entry said.

**The one judgment call.** The entry predicted the agent-option and
setup/serialize cases would "follow whichever module keeps them". They did not
move, and the file header now says why: every one of them asserts that the
factory hands a declared field to the module and the module's answer to the
phase. Driven against `provisioning()` or `agentFactory()` directly they would
prove the module and stop proving the wiring, which is the seam that actually
broke in this family's history. Moving them would also have meant a second copy
of `tests/harnessChain.test.ts`'s real-git fixture, which is its own instance of
the shape this entry was filed against. If plan disagrees, the target shape is a
`tests/harnessProvisioning.test.ts` sharing the fixture through a helper — that
helper does not exist yet and building it is a bigger move than this entry
named.

**Two cites re-homed** (`engineering.md`, *A module is one job*: a split
re-homes the citations it strands): `harness/ignores.ts` said `SESSIONS_REL`
lives apart from "the agent factory that passes it to the session capture
(`chain.ts`, which imports it)" — now `agent.ts`, which is the importer.
`harness/declaredShell.ts` named `setup.restore`'s home as `chain.ts` — now
`provisioning.ts`. Both were green before the edit and would have stayed green
after it: the citation pin reads the token, and `chain.ts` still resolves. That
is exactly the failure mode the rule describes, and it is worth knowing the pin
cannot see it.

Behavior-free as filed: no `tests[]`, no `pins[]`. Typecheck clean, full suite
74 files / 2094 passed / 22 skipped.
