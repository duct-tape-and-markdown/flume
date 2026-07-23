# State

Phase: **v0.5 CODE-COMPLETE** (`spec/RELEASE-v0.5.md`; all §2–§8 surface shipped; release cut parked as OQ 2; v0.1–v0.4 frozen). Mode this tick: **audit**.

## This tick — audit EXTRACT-WORKTREE-GUARD + JOB-DOCS ship

Delta = 2 build commits + chore ship (`3e26606`, `91f72b3`, `a9c37f0`); no spec changes; inbox empty.

**Audit `3e26606` (EXTRACT-WORKTREE-GUARD vs §5e)**: faithful. Scope = exactly the 5 declared files. Guard sits beside the dirty-tree/live-loop refusals; the HEAD==job/<name> exemption is sound (git permits one holder, so HEAD holding it proves no foreign holder); porcelain parse is safe (`git()` trimEnd, plumbing emits LF even on win32). Both planned tests present; the integration case runs the §6 recipe verbatim inside a linked worktree — refuse-from-root then extract-from-inside — which also hardens §7's §6 recipe-viability bullet. Debt accepted (commit body): the refusal's first suggested exit (`git worktree remove` the holder) is impossible when the holder is the *main* worktree; the second exit (run extract from inside it) covers that case — cosmetic.

**Audit `91f72b3` (JOB-DOCS vs §8)**: complete. All four README bullets (flow, two endings, concurrency recipe, HEAD-is-truth) + both CHAIN-AUTHORING items (template expectations under `job new`, phases[0]-as-entry) delivered; content cross-checked against §§2–6 shipped behavior — accurate, incl. the ignore-entry list and the @dtmd/flume link semantics. Scope = the 2 declared files. Also closes §2's document bullet and §6's doc obligation. §8's "getting-started" names no standalone doc — CHAIN-AUTHORING is that doc; conforming. Debt: README omits `job new`'s reuse-if-exists nuance (CLI.md carries it) — cosmetic.

**Finding — parked as OQ 2 (NEEDS AMENDMENT)**: v0.5 is uncut. CHANGELOG `[Unreleased]` is empty and package.json sits at 0.3.1, while §2's `trunkBranch` deletion obligates a minor bump + `### Breaking` entry per frozen v0.1 §9. v0.2/v0.3 each ended with a versioning section plan derived the cut from; v0.4 and v0.5 carry none, so the cut has no spec anchor. Research + concrete block proposal captured in the question per Inform-before-parking.

**Derive**: none (no spec delta). **Drain**: none (inbox empty). **Promote**: none (ship commit already emptied pending).

## Queue (0)

Empty — v0.5 decomposition complete and fully shipped. Next derivation trigger: a v0.5 amendment (versioning section per OQ 2) or a v0.6 file.

## Open questions

**1** — type-level tests not gate-enforced (tsconfig excludes `tests/`); PARKED, human toolchain call.
**2** — v0.5 (and v0.4) uncut; no versioning section in the spec; NEEDS AMENDMENT, proposal captured.

## Writable-paths / trunk

- Wrote `.flume/plan/state.md` + `.flume/plan/open-questions.md`; pending.json unchanged (`[]`); inbox.md untouched (empty).
- Trunk: HEAD `a9c37f0` at tick start, tree clean (untracked `.flume/loop.pid` is runtime). **main ahead 31 of origin/main** at tick start (32 with this commit) — human push pending.

Plan continues: no
