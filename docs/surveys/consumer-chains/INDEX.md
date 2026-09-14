# Consumer chain survey — index

Five consumers surveyed on 2026-09-14 against flume 0.15.0. One response file
each: `consumer-a.md` … `consumer-e.md`. Every finding in those files is cited
`path:line` and was verified on disk at the read. All reads were read-only; no
consumer repository was modified, and no typecheck was run against 0.15.0 in
any consumer (each file says so under §4).

The label↔repository mapping is held outside this directory.

## Coverage

Nine other flume state roots exist on the machine and are **not** separate
consumers: worktrees and fanout arms of consumer-a (one of them, the live
seven-job harness worktree, carries a `chain.ts` **byte-identical** to
consumer-a's primary, so consumer-a's findings cover it), two 0.6.2-era scratch
roots, a bump-validation clone of consumer-c, an empty `awake/` husk, and a
library-only dependency with no chain. Temper was skipped as already surveyed
maintainer-side.

## The table

| | engine version | phases | gates | re-derivations (covered / uncovered) | 0.15.0 breakages | harness copies (verbatim / adapted / original) |
| --- | --- | --- | --- | --- | --- | --- |
| **consumer-a** | 0.14.0 pinned, lock agrees; **job mode**, 1 job (+7 in a live worktree on an identical chain) | plan (singleton), build (fanout). **Both `shouldRun`** | 4 + per-job declared (3 forms: registry name, inline shell, script gate). 2 chain-authored | **9** (5 / 4) | **2, both silent** — `voluntary-bail` disarms the zombie brake; seeded `rendered-prompts/`+`merging/` pin `jobRootDirty()` true and defeat plan's decline | 0 / 3 / 4. No PROTOCOL, no flume rules |
| **consumer-b** | 0.14.0 pinned, lock agrees; **job mode**, 2 jobs (1 live) | plan (singleton), build (fanout). **No `shouldRun`** | 4 (1 builtin, 3 chain-authored, one of them a differential `afterMerge` gate) | **12** (5 / 7) | **0** — and only because it consumes almost nothing: no prior-attempt record, no `noCommit`, no `nothingPickable` | 0 / 3 / 4. No PROTOCOL, no flume rules |
| **consumer-c** | `^0.12.0` declared, **0.11.0 installed** — manifest and tree disagree; default root | plan (singleton, Opus), build (fanout, Sonnet) | 8 (6 on build, all `afterCommit`; 2 chain-authored incl. a reverting ledger-cap gate) | **9** (3 / 6) | **2** — one **total and loud** (a guarded assert on the engine's rendered schema wording bricks every plan render, by design); one silent (`voluntary-bail` suppresses the wake after a clean bail) | 0 / 5 / 2. PROTOCOL present and cited from `chain.ts`; no flume rules |
| **consumer-d** | `^0.12.0` declared, 0.12.0 installed; default root. **Cold since May** | plan (singleton, Opus), build (fanout, Sonnet). **`scopeWritesToEntry: true`** — the only one | 8 (5 chain-authored; two-tier `afterCommit`/`afterMerge` schedule; full worktree resource lifecycle + reaper) | **10** (4 / 6) | **1, in prose** — both prompts teach a no-commit taxonomy 0.15.0 renamed a member of and added a fourth to; `chain.ts` is clean because build's handoff reads no `TickResult` field | 0 / 5 / 6 + **4 forks of flume's own rule pages**, all drifted |
| **consumer-e** | **`file:../flume`** path link, **0.3.1 resolved** — twelve minors stale, recorded nowhere. Default root. **Archived** | plan (singleton), build (fanout). No agents, no hooks, no `entryExtension` | 2, both chain-authored (incl. a hand-rolled `pendingGate`) | **5** (4 / 1) | **3, all structural** — default-exports a `Chain` not a `ChainFactory`; static value imports; `renderSchemaForPrompt()` arity; `.per` read with no extension declared. Zero string-level breakages | 0 / 2 / 1. Nothing copied — it predates the prose layer |

## Blocks appearing in more than one consumer

These are the chain package's first config fields. Each is a block that more
than one consumer wrote independently, or copied, because the engine offered no
place to declare it.

1. **The `Plan continues:` self-wake marker** — 3 of 5 (b, c, d). `handoff`
   reads `state.md` off disk and regexes a line the agent wrote. In c and d the
   regex, the comment, and the `PROTOCOL.md` cite are character-identical.
2. **Hand-rolled pickability** — `pendingAfter.some(e => e.gate.kind === "open")`
   in 4 of 5 (c, d, e, and e's ancestor form). Only consumer-a uses
   `pickableAfter`. consumer-a and consumer-b **each independently documented
   the plan↔build live-lock** this causes, in near-identical terms; c, d and e
   still carry the pre-fix form.
3. **`total_cost_usd` scraped from raw agent stdout** — 2 of 5 (a, b), both
   with a comment stating it is *the one `result`-event field `AgentUsage` does
   not carry*. The clearest single missing field in the survey.
4. **The "where did the last plan tick leave off" cursor** — every consumer
   invents one and no two agree: a infers it from touched-path shape
   (`planShapedHead`), b and c/d from commit-message text
   (`git log --grep='^plan:'`, character-identical between c and d), b
   additionally from a sha it wrote into `state.md`. None is a fact the engine
   hands out; all four are inferences.
5. **The per-job declaration layer** — `declaration.json` + a strict zod schema
   + lazy `decl()` + phase getters, in a and b, with the `flume job new`
   rationale comment verbatim in both. The largest shared structure in the
   survey and the obvious shape for typed environment config.
6. **The `entryExtension` record** — all five that have one converge on
   `summary` / `per{path,section}` / `acceptance` / `tests[]` / `notes`, and
   a and b share **character-identical `hint` strings**. `tests[]` is declared
   by every consumer that has an extension and **run by none of them** — five
   chains carry a field whose only enforcement is prose.
7. **`per`-path existence as a chain-authored gate** — a and b, same gate, same
   rationale comment; c and d `cat` the path into the build prompt with no
   check at all.
8. **The `scopeWritesToEntry` decision, argued both ways** — a and c decline it
   (an entry's `files` is a partition prediction, not an allowance); d adopts
   it (without narrowing, two entries the partition calls disjoint can write
   the same file). Both arguments are correctness arguments. The engine lets
   both stand with no guidance, and the survey cannot resolve it.
9. **The no-commit taxonomy restated in prompt prose** — d's two prompts
   enumerate and explain each mode; a, b and c encode mode names in `chain.ts`
   string comparisons. Every copy went stale on 0.15.0's rename, none loudly.
10. **A hand-maintained ignore list against engine-owned paths** — all five
    name some subset of `sessions/`, `worktrees/`, `awake/`, `prior-attempts/`,
    `tick-verdict*`; **none** names `rendered-prompts/` or `merging/`, and d
    still ignores `.awake`/`.lock` from an engine version it no longer runs.
    Neither direction of that list is checked by anything.

## One reading worth carrying into the design

The §4 checks measure **how much of the engine a consumer has adopted, not how
healthy it is**. consumer-b and consumer-e both score zero string-level
breakages: consumer-b because it is genuinely fine, consumer-e because it will
not load. Meanwhile the two consumers that adopted the most — a and c — are the
two the rename actually bites, and in both cases **silently**, because the
adopted surface is a `string` comparison against a union member no type
protects. consumer-c's assert is the one mechanism in the survey that turned an
engine change into a loud failure, and it was hand-built by the consumer to
guard a sentence the engine emits.
