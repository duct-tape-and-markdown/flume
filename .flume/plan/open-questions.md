# Open Questions

Decisions parked for human input. Each question is a `##` subsection with status, context, options, and recommended disposition.

Status markers:
- **PARKED** — no movement until human resolves
- **PARTIALLY ADDRESSED** — some progress; remaining ambiguity blocks closure
- **NEEDS AMENDMENT** — answer is clear; requires a spec edit to close

<!-- questions below this line -->

## Type-level tests are not gate-enforced — tsconfig excludes `tests/`

**Status: PARKED**

Observed during TRUNK-PURGE: v0.5 §7 asks for a type-level assertion
(`trunkBranch` absent from `DispatcherOptions`). It's written
(`tests/Dispatcher.test.ts`, `TrunkBranchPurged`), but `tsconfig.json`
includes only `src/**`, `examples/**`, `.flume/chain.ts` — so the tscGate
never typechecks `tests/`, and vitest transpiles without checking. The
assertion binds under LSP while editing, but no gate would catch a
regression. This affects every type-level test §7 plans, not just §2.

Options: (a) add `tests/**/*` to tsconfig include — strict flags may
surface existing errors in ~3k lines of tests; (b) a separate
`tsconfig.tests.json` + second tscGate invocation; (c) accept LSP-only
enforcement. Leaning (a) or (b); either is a small standalone entry.

## v0.5 is code-complete but uncut — no versioning section in RELEASE-v0.5.md (or v0.4)

**Status: NEEDS AMENDMENT**

Observed at the v0.5 queue-drain: every §2–§8 obligation has shipped, but
`CHANGELOG.md` `[Unreleased]` is empty and `package.json` sits at 0.3.1.
v0.5 §2 deleted `DispatcherOptions.trunkBranch` — a public-API breaking
change, which frozen v0.1 §9 obligates to land as a minor bump with a
`### Breaking` CHANGELOG entry. The v0.4 line's surface (entry-scoped
fanout guard, `entryChannelPaths`, `observedFiles`-adjacent work after the
0.3.1 cut) is likewise unrecorded.

The gap is a spec gap, not a build miss: RELEASE-v0.2 (§9) and RELEASE-v0.3
(§6) each ended with a versioning section naming the version and the
CHANGELOG block, and plan derived the cut from it (0.2.0 was build-executed;
0.3.0/0.3.1 were `chore(release)` cuts). RELEASE-v0.4 and RELEASE-v0.5
carry no such section, so the cut has no spec anchor and plan can't derive
it. `spec/` is the human's surface — hence parked.

Options:

- **(a) Amend RELEASE-v0.5.md with a Versioning section; plan derives a
  CUT entry for build.** Recommended shape: one **0.5.0** cut consolidating
  the uncut v0.4 surface (0.4.0 was never cut or published — mirrors
  v0.3 §6's "the still-unpublished version is the right home" reasoning).
  Block sketch: `### Breaking` — `DispatcherOptions.trunkBranch` removed
  (HEAD-is-truth, v0.5 §2). `### Added` — `flume job` verb family
  (new/run/rm/status/extract), `--job`/`FLUME_JOB` resolution,
  `flume/<job>/<slug>` fanout namespacing, plus the v0.4 additions.
- **(b) Cut interactively as `chore(release)`** like 0.3.0/0.3.1 — no
  amendment; accepts that cuts are a human act outside the spec corpus.
- **(c) Two blocks, 0.4.0 + 0.5.0**, if the v0.4 line should be
  version-visible despite never publishing.

Leaning (a) — it restores the v0.2/v0.3 pattern and the block content is
already sketched. Whether the cut lands before or after pushing the ~32
unpushed main commits is also the human's call.
