# The consumer-facing docs still tell the hand-written-chain story

Filed from the interactive session ahead of the next cut, which is the first
to ship `@dtmd/flume/harness` and `flume-harness init`. `spec/harness.md`
*Adoption and upgrade* states how a consumer adopts: one verb writes the
declaration skeleton, `chain.ts`, the state root, the ignores and
`PROTOCOL.md`; a consumer never copies a prompt, a slice, or a judge; an
upgrade is one version bump plus the release's migration note. None of the
surfaces a consumer reads first say so — measured on this tree:

- `README.md` *Quickstart* (lines 34–84) installs the package and then tells
  the reader to drop a hand-written `.flume/chain.ts` with an inline `Phase`,
  author a prompt, and copy `examples/cascade-chain.ts` for multi-phase. The
  harness verb, the `./harness` subpath, and the declaration appear nowhere
  in the README; its only "harness package" mention is in *Where state lives*.
- `docs/CHAIN-AUTHORING.md` has no section on the package; every hit for
  "declaration" is the engine-level `Chain` field.
- `docs/INTENT.md` line 53 heads *Decided, not yet executed — the consumable
  chain*, and it is executed: `harness/` shipped, this repo's `.flume/chain.ts`
  is the factory applied to `.flume/declaration.ts`, and the survey's
  consumers are the audience.
- The three prior breaking cuts each shipped `docs/MIGRATING-0.N.md`
  (0.10, 0.11, 0.12), and `spec/harness.md` says an upgrade is "one version
  bump plus the release's migration note". The unreleased range carries
  breaking changes with no note: `WorktreeSetupContext.worktreeKey`,
  `entryTag` on both verdict rows, `priorAttemptPath(flumeDir, ref)` with
  keyspace-scoped map keys, and `--strict-mcp-config` by default with
  `inheritUserMcp` as the opt-out — the last of which carries no `BREAKING:`
  line in its commit body (66781ef), so the mined draft omits it.

Why it matters now: the operator's stated goal for the package is that the
survey's consumers "have a simple interface to adopt". A consumer who reads
the README at the cut is handed the interface the package exists to retire.

What this asks for, each in build's lane and citable against
`spec/harness.md` *Adoption and upgrade*: a README quickstart that leads with
`npx flume-harness init` and keeps the hand-written chain as the
engine-level path below it; a CHAIN-AUTHORING section on the declaration; the
INTENT heading moved from decided to shipped; and a `docs/MIGRATING-0.16.md`
carrying the four breaking changes above plus the adoption path for a chain
that wants to move onto the package. The CHANGELOG curation itself stays the
cut's, per `spec/cli.md` *Versioning policy*.
