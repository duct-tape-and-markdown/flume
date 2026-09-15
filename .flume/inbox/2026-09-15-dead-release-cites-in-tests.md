# The retired release corpus is cited 329 times across tests/, and every sweep re-notes it

Filed from the interactive session after five consecutive sweep ticks
(Gate.test.ts, loopSupervisor.test.ts, git.test.ts, then job.test.ts and
examples.test.ts — five) each accepted the same
debt: cites into `spec/RELEASE-v*.md`, a corpus no tree carries. Each
sweep counted only the sites in its own neighborhood and priced the re-note
as cheaper than an entry. Sized across the whole domain, the price is
different.

**Size, measured this tick** (`grep -rnE 'RELEASE-v0\.[0-9.]+|§[0-9]+' tests/`):

- 329 sites in 18 files — 145 name a release line (`RELEASE-v0.N`,
  `v0.N §M`), 184 are a bare `§M` that resolves only through the same
  retired corpus. A sweep counting the first form alone sees ~130. Per file:
- tests/Dispatcher.test.ts — 135
- tests/cli.test.ts — 32
- tests/job.test.ts — 24
- tests/cliJobResolution.test.ts — 23
- tests/loopSupervisor.test.ts — 20
- tests/job.integration.test.ts — 16
- tests/git.test.ts — 14
- tests/loop-process-boundary.integration.test.ts — 13
- tests/cliVerdict.test.ts — 10
- tests/cliJobVerbs.test.ts — 10
- tests/PendingSchema.test.ts — 8
- tests/tip-claim.integration.test.ts — 7
- tests/Prompt.test.ts — 5
- tests/examples.integration.test.ts — 4
- tests/examples.test.ts — 3
- tests/builtinGates.test.ts — 2
- tests/Gate.test.ts — 2
- tests/helpers/subprocess.ts — 1
- 101 of them sit inside a `describe`/`it`/`test` title, so the
  dead cite is part of the name a `pins[]` line buys and the hover text
  a `.d.ts` reader follows.
- Four `src/` doc comments (`PendingSchema.ts:87`, `paths.ts:253`,
  `Prompt.ts:478`, `:731`) cite a test case *by its §-bearing title*.
  A title rewrite moves those pointers in the same commit, as
  LOOPSUPERVISOR-DEFAULTS-CASE-COVERS-BOTH-KNOBS just did for its two.
- One more in `scripts/smoke-install.mjs:191` (`v0.7 §10`), the sweep
  domain's newest member.
- `src/`, `harness/`, `examples/`, `README.md` are otherwise clean;
  `docs/` carries 89 hits, all inside the historical material
  `CLAUDE.md` names as history, out of scope here.

**Why a debt line no longer prices it right.** posture-sweep *Routing* takes
the debt line when "a later rotation re-noting the same debt is cheaper
than a queue that grows faster than build drains it." The queue is not
growing faster than build drains it — this loop has shipped every entry
within the tick it was picked, zero reverts. The re-note, meanwhile, is not
one line: 35 frontier modules remain in the open rotation, 18 of them are
these files, and each sweep tick spends its body re-deriving the same
finding and re-explaining why it is not filed. That is the token tax
*Derived state is computed, never restated* names, paid by plan instead of
by a file.

**What it is not.** Not a correctness finding: no behavior sits behind any
of these cites. The ask is one mechanical cut so the sweep stops re-reading
it, nothing more.

**Options, so plan need not re-derive them:**

1. **One bulk entry, scripted, in a solo wave** (recommended). A single
   entry whose `files` names all 18 test files plus the four `src/` doc
   comments; the rewrite drops the cite and keeps the surrounding sentence
   (`"ensureRuntimeIgnores — §5a-3 create-or-merge"` →
   `"ensureRuntimeIgnores — create-or-merge"`). No `tests[]` and no
   `pins[]`: the entry claims no property, and every title it touches is
   already exercised by the case it names. Plan schedules it into a wave
   with nothing else touching `tests/`, which the partitioner already
   handles by `files`. tsc and the suite gate it like any ship.
2. **One entry per file as the rotation reaches it.** Same routing as now
   but an entry instead of a debt line. Eighteen small ships, each
   colliding with whatever else that sweep filed against the same file.
3. **Keep accepting the debt.** Costs a re-note on every remaining test
   neighborhood this rotation and every rotation after until a phrase
   delta stops redrawing the whole domain.

The cite form to cut is the numbered one — `RELEASE-v0.N`, `v0.N §M`,
`§M` — never a cite by heading text into `spec/*.md` or a rule page,
which is the live form the corpus uses.
