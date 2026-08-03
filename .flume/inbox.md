# Inbox — findings queue

Transient queue of findings awaiting triage by the plan phase. Append-only by external reviewers; drained-only by plan.

## Who writes here

- Humans dropping observations to be routed.
- Future review skills (e.g. multidim-review, security-review) when added.

**Plan does not write here.** Plan-tick self-audit findings go directly to `.flume/plan/pending.json` (file as entry), to `.flume/plan/open-questions.md` (parked for human input), or live only in the `plan:` commit message body (narrative + dispositions).

## Who reads here

The plan phase reads inbox.md every tick and drains each entry into one of three outcomes:

1. **File as a pending entry** in `.flume/plan/pending.json` (with a `per` cite to the relevant spec section).
2. **Park** in `.flume/plan/open-questions.md` if it needs human input before any code can land.
3. **Accept as debt** — note the disposition + one-line reason in the `plan:` commit message body.

After routing, the inbox entry is **removed**. The queue is meant to drain; it is not a log. Narrative history lives in git.

## Format

Each entry is a markdown subsection:

```
## YYYY-MM-DD — <short label> (<source>)

<finding body — observations, file:line cites, severity if known>
```

`<source>` is the writer (e.g. `human`, `multidim-review`). One subsection per finding cluster; group related items under one `##` to keep routing atomic.

---

<!-- entries below this line; newest first -->

## 2026-08-03 — repoint provenance cites off the deleted RELEASE corpus (human)

`spec/RELEASE-v0.*.md` is gone; the corpus is now seven topic files
(`spec/{loop,chain,prompt,pending,cli,jobs,worktrees}.md`). Every non-code
surface was repointed in the same commit — CLAUDE.md, PROTOCOL.md, both
prompts, the chain's `per` hint, the rules, ci.yml, vitest.config.ts. Code was
not, because it is build's lane.

143 `RELEASE-v0.N §M` cites remain in doc comments: `src/` 84 (49 in
Dispatcher.ts alone, then Prompt 12, git 6, cli 4), `tests/` 41, `docs/` 15,
`examples/` 3. They are provenance, not machine-checked — nothing resolves
them at runtime, so this is rot rather than breakage: the cite still answers
"why does this exist" via git history, just not from the working tree.

Mechanical but not blind — a cite names a section, and section identity moved.
The mapping is one-to-many in places (v0.7 §17 split across loop.md and
cli.md; v0.4 §2's items landed in three files). Prefer reading the target
section over pattern-substituting the filename.

Worth splitting by directory if it partitions badly as one entry: `src/`,
`tests/`, and `docs/`+`examples/` are disjoint file sets and would fan out
cleanly.

Per candidate: `.claude/rules/engineering.md` *Narration is the ladder's
bottom rung* — a pointer into a file that no longer exists is prose that has
stopped carrying its property.

## 2026-08-03 — build the release changelog from git history (human)

`changelogGate` is removed (operator ruling): a per-commit presence check is
the wrong layer for a release artifact, and the gate never verified what it
claimed to. Its docstring called it the agreement check for this repo's
"loudest self-description seam", but it only tested
`touched.includes("CHANGELOG.md")` — a commit touching `src/` with an
unrelated changelog line passed. Shape sold as truth
(`.claude/rules/engineering.md`, *A seam gate reads what the real writer
wrote*).

Needed: a release-time step that derives the changelog from git rather than
accumulating it per tick. Input is the commit range since the last release
tag; output is the `[Unreleased]` section, preserving the `### Breaking`
subheading convention (`spec/cli.md`, *Versioning policy*). `scripts/` and
`CHANGELOG.md` are both in build's `writablePaths`.

Design note for whoever files this: `build:` commit subjects carry the entry
tag and the bodies carry the why, so the range is already structured —
prefer reading those over re-deriving intent from diffs. Tags stopped at
`v0.6.2` while CHANGELOG has `[0.8.0]`/`[0.9.0]`, so "since the last release
tag" needs a defined fallback, not an assumption.

Vacuity risk to pin in its tests: a range that resolves to zero commits must
say so and refuse, never emit an empty section that reads as "no changes
this release".

Per candidate: `spec/cli.md` *Versioning policy* (the Breaking
subheading); `.claude/rules/engineering.md` *A green verdict is proven
non-vacuous* for the empty-range refusal.

## 2026-08-03 — chain `setupWorktree` hooks run outside the provisioning isolation (human)

`Dispatcher.runFanout` collects `provisionFailures` around `createWorktree` only:
a failure there parks that entry and the wave continues with the rest. The
chain's `setupWorktree` hooks then run in an **unguarded** `await
Promise.all(provisioned.map(...))`. A throw from one entry's hook rejects the
whole wave, `Dispatcher.tick` rethrows anything that is not a
`PendingParseFailure`, and the tick dies — the batch's worktrees are never torn
down and no entry is parked.

The isolation is narrower than its own contract: pre-tick worktree provisioning
is supposed to quarantine per slug, and a chain's setup hook is pre-tick
provisioning by any reading. Sharpest evidence that the gap is invisible:
`.flume/chain.ts`'s own docstring asserted the parking behavior, and the spec
inherited the claim from it — both corrected in the commit that files this, both
wrong for as long as the hook has existed.

Per candidate: `spec/worktrees.md` *Every `.git/worktrees` mutation is
serialized* (which states the isolation contract), plus its `> **Drift:**` note
naming this gap. A fix ships the test that would have caught it
(`.claude/rules/engineering.md`): a two-entry wave where one hook throws, the
other entry completes.

## 2026-08-03 — the logic in the harness runtime is unpinned (human)

Supersedes the earlier "chain.ts has zero behavioral coverage" framing, which was
too broad. Most of `.flume/chain.ts` is declaration — writable paths, gate lists,
the entry extension — and declaration does not want tests any more than CLAUDE.md
does. What wants tests is the **logic**, and `vitest.config.ts` includes `tests/**`
only, so no test imports `../.flume/chain.ts` at all:

- `plan.shouldRun` — the pickability predicate that decides whether a tick is
  spent. `934e880` shipped it as one file, +48 lines, no test, with a commit body
  enumerating eight verified cases ("declines on pickable+empty inbox, runs on a
  non-empty inbox, a missing inbox.md, an empty queue, a parked-only queue, a
  live-blocked queue, a promotable-only queue, and undefined pending"). None exist
  on disk; that verification is unreproducible, and the commit message is the only
  witness — the substrate `.flume/PROTOCOL.md` *Disk vs git log* says cannot
  testify.
- `plan.handoff` — the `Plan continues:` regex over `state.md`, which decides
  whether plan re-wakes or hands off.
- `build.handoff` — the wake condition, including the `voluntary-bail` leg.
- `setupBuildWorktree` — the sentinel assertion (see the sibling entry above).

`tsc` covers the file (`tsconfig.json` include), so this is a behavioral gap, not
a type gap. Scope the entry to the four predicates; do not ask for coverage of
the declarations.

Not blocked: `tests/**` is inside build's fence, and the chain is loadable
in-process via `loadChainModule` + `buildFlumeApi` (the pattern
`tests/examples.integration.test.ts` already uses on `examples/`), so the real
factory can be driven rather than a copy of its logic — `engineering.md` *A seam
gate reads what the real writer wrote*.

Per candidates: `.claude/rules/engineering.md` *A fix ships the test that would
have caught it* (the `shouldRun` case specifically); `spec/chain.md`
*`Phase.shouldRun` declines before the invocation* for the seam.

Note the asymmetry worth weighing at file time: chain.ts is the harness runtime
and sits outside every phase lane, but a test *of* chain.ts is inside build's.
Nothing structural blocks the coverage — only that no entry has ever asked.

## 2026-08-02 — win32 CI lane says "full suite", runs the fast lane (human)

`.github/workflows/ci.yml` — "win32 support lane (spec/cli.md, win32 portability):
typecheck + full suite on Windows." The lane runs `pnpm test`, which
`vitest.config.ts` defines as the FAST lane with `**/*.integration.test.ts`
excluded. `pnpm test:integration` appears only in the ubuntu `ci` job.

So `loop-process-boundary.integration.test.ts`, `job.integration.test.ts`, and
`examples.integration.test.ts` — 949 lines covering subprocess spawn, worktree
provisioning, and exit-code boundaries — never run on win32. That is the primary
development platform for this repo, and the `.cmd`-shim defect that motivated
`scripts/smoke-install.mjs` was a win32-only spawn bug. `execGate`'s win32 ENOENT
shell-retry shim (`src/builtinGates.ts`) is exactly this class and is fast-lane
covered only.

The two-lane split itself is declared and reasoned (v0.3 §17). The "full suite"
claim on top of it is not.

Fork — needs a call, may be an open question rather than an entry:
1. **Add `pnpm test:integration` to the windows lane.** Closes the real gap;
   costs win32 CI minutes and imports whatever flakiness the integration lane has
   on a slower runner.
2. **Correct the comment to "fast lane"** and state in it that integration is
   POSIX-only, with the reason. Cheap, honest, leaves the coverage gap standing.
3. **Split**: run the integration lane on win32 but non-blocking
   (`continue-on-error`), same pattern the `attw` step already uses with its
   reason named.

Per candidate: `.claude/rules/engineering.md` *Narration is the ladder's bottom
rung* (prose asserting a property nothing pins) for the comment half; the
coverage half needs the fork resolved first.

## 2026-08-02 — `src/Dispatcher.ts` carries jobs that want separate homes (human)

3,371 lines. One class spans 1,019→2,830 with its own section banners naming
distinct concerns — *singleton tick*, *fanout tick*, *per-entry fanout*,
*prior-attempt persistence (§5)*, *reverted-prose durability (§8)* — plus
module-level tick-verdict read/write persistence, chain-module loading, friction
counting, `slugify`/`worktreeDirName`, and `superviseLoop`. `tests/Dispatcher.test.ts`
is 7,755 lines, ~40% of the suite.

This is a standing lens in `.claude/rules/posture-sweep.md` (*a module carrying
jobs that want separate homes*), and nothing in `spec/` or `open-questions.md`
records it as considered-and-rejected — which is the class the manifesto's
"interrogate inherited design adversarially" flags as where the improvements live.

Routing note: this is pure shape by the correctness-adjacency bar, so
accepted-debt in the commit body is the by-the-book disposition. Flagging it
anyway because the bar demotes exactly the findings that compound — if it lands
as debt a third time, that repetition is itself the signal, and the standing
candidates are the ones with clean seams already: tick-verdict persistence
(`writeTickVerdict`/`readTickVerdicts`/`clearTickVerdict` + `isTickVerdict`) and
chain loading (`loadChainModule`/`diskChainLoader`/`CjsContextLoadError`), both
already module-level rather than class members.

## 2026-08-02 — `plan/pending.json` path: one fact, one side negotiable (human)

`src/Dispatcher.ts:1038` hardcodes `join(this.flumeDir, "plan", "pending.json")`
with no override. `src/builtinGates.ts:323` makes the same path chain-overridable
(`opts.pendingPath ?? join("plan", "pending.json")`). Same fact, two homes, and
only one of them can be chosen by a chain — so a chain that overrides
`pendingGate`'s path gets a gate reading one file and a dispatcher writing
another, silently.

Also: `src/cli.ts:721`, `src/cli.ts:959`, and `src/job.ts:439` each re-derive the
literal independently. Five sites, no shared constant.

The `plan/` segment is a layout convention — a single-phase chain
(`examples/backlog-groomer-chain.ts`) still gets a `plan/` directory it has no
plan phase for. The engine does mechanically consume the file, so the *reading*
is engine business; the *path* is arguably not.

Per candidate: `.claude/rules/engine-boundary.md` *Capability vs convention*. May
warrant an open question rather than an entry — the second-implementation test is
the whole decision here, and the divergence between the two sides is the sharper
half regardless of how the convention question lands.
