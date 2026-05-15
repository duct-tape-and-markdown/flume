# Open Questions

Decisions parked for human input. Each question is a `##` subsection with status, context, options, and recommended disposition.

Status markers:
- **PARKED** — no movement until human resolves
- **PARTIALLY ADDRESSED** — some progress; remaining ambiguity blocks closure
- **NEEDS AMENDMENT** — answer is clear; requires a spec edit to close

<!-- questions below this line -->

## §8 ci.yml enumeration no longer describes shipped CI — NEEDS AMENDMENT (source: plan audit of ea8b4e7)

**Context.** §8 L153 enumerates `ci.yml` as `pnpm install`, `pnpm typecheck`, `pnpm test`, `pnpm build`. As of `ea8b4e7` the shipped workflow also runs an `attw` step and a consumer-install smoke step. Separately, §4 L106 says the smoke is "smoke-tested in CI per §8" — §4 delegates the smoke's home to §8, but §8's own enumeration doesn't list it. The inconsistency is now internal to the spec, not just spec-behind-reality. A prior tick flagged this as commit-body debt while the work was unshipped; it has now shipped and stabilized, so it is no longer transient.

**Why this matters now.** §8's acceptance ("green on `main` for at least one PR before tagging v0.1") is the tagging gate. The spec should accurately describe the CI it is gating on before the release is cut.

**Recommended disposition (answer is clear; needs a spec edit).** Fold the two steps into §8 L153's enumeration (e.g. "...`pnpm build`, plus publish-acceptance: `attw --pack .` and a consumer-install smoke"), and optionally tighten §4 L106's "per §8" reference so the cross-reference resolves. Pure spec hygiene — no code lands from this. Plan cannot edit `spec/`; this is a human edit.

## §4 L107 (`npm pack --dry-run` allowlist) has no enforcement — PARKED (source: plan audit of ea8b4e7)

**Context.** §4 L107 acceptance: "`npm pack --dry-run` shows only the files listed in `"files"`." §8 L154 reinforces this — the `"files"` allowlist is "the single source of truth," `.npmignore` forbidden. Nothing enforces it: no CI step, no pending entry. The shipped consumer-smoke covers only the *negative* direction (a missing required file → tarball install fails); a tarball that *over-includes* `src/`, `.flume/`, `spec/`, etc. still passes both the smoke and attw. The "only the files listed" clause is genuinely unguarded.

**The ambiguity.** §4 L106 explicitly says "smoke-tested in CI per §8"; L107 and L108 carry no "in CI" qualifier. attw (L108) was nonetheless put in CI by `CI-PUBLISH-ACCEPTANCE` because §2 L64 makes it an acceptance and CI is the natural enforcement. L107 sits in the same position — an acceptance the spec doesn't explicitly route to CI — but was not picked up. Plan will not silently derive it (deriving against a spec-silent point is what `spec-plan-build.md` forbids until the human resolves the ambiguity) and will not silently drop it (it is currently unaccounted for in the queue, in CI, and in the tracked out-of-band human work).

**Options.**
- **A — add a CI guard (recommended).** A `npm pack --dry-run` (or `--json`) step asserting the packed file set equals the `"files"` allowlist. ~one-liner, regression-proof, aligned with §8 L154's "single source of truth" emphasis. If chosen, the human folds it into §8 (or amends §4 L107 to say "in CI") and the next plan tick derives the entry.
- **B — publish-time human check.** Treat L107 as a manual pre-publish verification, alongside the scope-name and tag steps already tracked as out-of-band human work. Cheaper now, no regression guard later.

**Recommendation: A** — the spec's own emphasis on the allowlist as the single source of truth argues for a regression guard, and the cost is trivial. Needs a human spec decision before plan can derive.
