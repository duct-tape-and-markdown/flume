# The smoke installs the shipped example, not a new checked copy

Shipped against the entry's architecture, not its predicted file. The entry
named a new `examples/smoke-consumer-chain.ts`; the step now copies
`examples/backlog-groomer-chain.ts` and `examples/prompts/backlog-groomer.md`
in verbatim instead. A new condensed file would have been a second checked
spelling of a chain that already exists, shipped to consumers inside the
tarball (`package.json` "files" carries `examples`) as a fourth reference
chain that is really a CI fixture. No new file is the same fix one rung
deeper.

Rehearsed before editing CI: the real example loaded and ticked green as a
consumer's `.flume/chain.ts` in a scratch repo (`wake groom` + `tick`), and
all four of the step's assertions held — SHIPPED line, parked
`rotate-secrets`, one backlog item left, `groom: ship trim-notes-intro`. The
`../src/index.ts` type import erases exactly as the entry predicted; the
consumer has no `src/` and resolves nothing.

Two things for a later rotation, neither filed:

- The CI step and `tests/examples.integration.test.ts` now assert the same
  four facts over the same chain and the same seed backlog. That is
  deliberate — the lane's subject is the *published* tarball and the real
  `npx flume` verbs, where the test's is an in-process `Dispatcher` — but the
  seed backlog is a second spelling living in two files, and a third copy
  would be worth a shared fixture.
- `tests/bin.test.ts`'s `stepBody` is now module-scope, shared by the two
  ci.yml readers. A third reader of that workflow should take it, not
  re-spell the `- name:` delimiter.
