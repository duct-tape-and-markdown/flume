# State

Phase: v0.7 §16 shipped — the release line is now fully shipped end to
end (§§1-17). v0.8 §§2-8 remain queued. Mode: **audit** (commit-delta
only; no spec-delta, empty inbox; promote already reflected via the
harness's own ship-commit auto-flip).

## Queue (7)

1. `PENDING-SCHEMA-CORE-EXTENSION-SPLIT` — open (v0.8 §2)
2. `REQUIRES-CAPABILITY-GENERALIZATION` — open (v0.8 §4)
3. `TICK-VERDICT-ARTIFACT` — open (v0.8 §5)
4. `TAG-GRAMMAR-MECHANICAL-SAFETY` — blockedBy #1 (v0.8 §3)
5. `PENDING-GATE-BUILTIN` — blockedBy #1 (v0.8 §6)
6. `SUPERVISOR-POLICY-KNOBS` — open (v0.8 §8)
7. `SECOND-REFERENCE-CHAIN` — blockedBy #4 (v0.8 §7)

## Open questions

0.

## Trunk

HEAD `8bebc03` at this pass's start; tree otherwise clean besides
untracked `.flume/loop.pid` (live supervisor artifact) and uncommitted
operator edits to `.claude/rules/collaboration.md` /
`.flume/prompts/plan.md` outside plan's writable paths — not this
tick's to commit.

Audited `7ec9433` (worktree-provisioning quarantine + abort backstop)
against v0.7 §16 in full: both ruled legs present — per-entry quarantine
(tagged failure isolated to its slug, entry stays pending untouched,
crosses to the next child tick via `FLUME_QUARANTINED_SLUGS`) and the
consecutive-identical-signature abort backstop (3x, no success between,
non-zero exit naming the signature). All three acceptance clauses have
a dedicated test replaying the exact incident shape; `tsc --noEmit` and
full suite verified green (296 tests). Scope matches declared files
(`src/Dispatcher.ts`, `src/cli.ts`, `tests/Dispatcher.test.ts`,
`CHANGELOG.md`); `tests/cli.test.ts` also touched but rides the
`tests/**` entryChannelPaths allowance, not a declaration gap. `8bebc03`
is the mechanical ship — its auto-flip of `SUPERVISOR-POLICY-KNOBS`
from blockedBy to open is already reflected in pending-now, so this
tick's promote pass found nothing left to do. No findings.

Plan continues: no — commit-delta audited clean, no findings; no
spec-delta, inbox empty, promote already settled by the ship commit.
