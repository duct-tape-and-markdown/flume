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

## 2026-08-02 — `.flume/chain.ts` has zero behavioral coverage (human)

`vitest.config.ts` includes `tests/**` only; no test imports `../.flume/chain.ts`.
492 lines of load-bearing loop control go unexercised: `plan.shouldRun`,
`plan.handoff`'s `Plan continues:` regex, `changelogGate`, `setupBuildWorktree`'s
sentinel assertion. `tsc` covers the file (`tsconfig.json` include), so this is a
behavioral gap, not a type gap.

Sharp instance: `934e880` (`chore(flume): declare plan.shouldRun`) is one file,
+48 lines, **no test**. Its body enumerates eight verified cases ("declines on
pickable+empty inbox, runs on a non-empty inbox, a missing inbox.md, an empty
queue, a parked-only queue, a live-blocked queue, a promotable-only queue, and
undefined pending"). None exist on disk. That verification is unreproducible
now — the commit message is the only witness, which is the substrate
`.flume/PROTOCOL.md` *Disk vs git log* says cannot testify.

Not blocked: `tests/**` rides `entryChannelPaths`, so build can write this without
a fence widening. The chain is loadable in-process via `loadChainModule` +
`buildFlumeApi` (the pattern `tests/examples.integration.test.ts` already uses on
`examples/`), so the real factory can be driven rather than a copy of its logic —
`engineering.md` *A seam gate reads what the real writer wrote*.

Per candidates: `.claude/rules/engineering.md` *A fix ships the test that would
have caught it* (the `shouldRun` regression specifically);
`spec/RELEASE-v0.11.md` §8 (the seam being declared).

Note the asymmetry worth weighing at file time: chain.ts is outside every phase
lane, but a test *of* chain.ts is inside build's. Nothing structural blocks the
coverage — only that no entry has ever asked for it.

## 2026-08-02 — win32 CI lane says "full suite", runs the fast lane (human)

`.github/workflows/ci.yml:7-8` — "win32 support lane (spec/RELEASE-v0.4.md §6):
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
