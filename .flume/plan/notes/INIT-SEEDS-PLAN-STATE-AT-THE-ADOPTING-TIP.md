# A repository adopted before its first commit can never be seeded

The seed landed: `harness/planState.ts` now carries `PLAN_STATE_SEEDS`, a
table whose key type is read off `CursorFieldsOf`, so a slice that carries a
cursor must state a starting state and the inbox must not. `harness/init.ts`
resolves the tip in its preflight and reports `planState` as a fact.

What I could not close, and did not build around: **the no-commit arm has no
second chance.** `scripts/smoke-install.mjs` is exactly this shape — it runs
`git init` in the consumer and adopts without committing — so the package's
own smoke adopts into a repository that gets no cursors. init refuses a
second run over an existing state root (upgrade is a version bump, not a
re-run), and no other verb writes a cursor, so that consumer's first derive
tick opens over its whole spec corpus and its sweep goes live over its whole
domain. Exactly the failure this entry exists to close, reachable by the one
adoption order the smoke demonstrates.

`spec/harness.md`, *Adoption and upgrade* says nothing about it. Three forks
I can see, none of which a build tick should pick:

1. Leave it — the report says the state is unseeded, and a consumer who
   wants cursors hand-writes two small JSON files.
2. A seed that is idempotent over plan state alone: init's refusal stays for
   the declaration and the chain, and a re-run over an existing state root
   that carries no plan state writes only that. Narrow, but it is a re-run,
   which the section currently forbids outright.
3. A cursor-carrying slice treats "no state file, state root younger than
   the first commit" as seeded-at-nothing — an inference off evidence, which
   `engine-boundary.md`, *Told, not inferred* fences.

Also worth knowing: the smoke asserts nothing about plan state, so it will
stay green either way.
