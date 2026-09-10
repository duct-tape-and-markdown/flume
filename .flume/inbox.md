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

## 2026-09-10 — the tick's read set is prose; the write set is a fence (human via claude-desktop)

1. **The posture is enforced on one side only.** "Harness enforces, prompts
   state" holds for writes: `writablePaths` is typed, rendered into the
   `<harness>` block, gated, reverted. What a tick *reads* is assembled by
   the prompt template through placeholders and inline exec, and the engine
   holds no declaration and no record of it. Writes are a contract; reads
   are a gesture. The chain-side proof that the move is possible is already
   in temper: `temper/.flume/chain.ts:118` (`scopedDelta`) says the build
   prompt "used to instruct the agent to derive this itself; the render owns
   it now" — rendered "as data instead of an errand". That was done once.
   The prompts are still mostly errands.

2. **The sharpest case is plan's dispatch.** `temper/.flume/prompts/plan.md`
   says "take the FIRST live input in the order below" — four jobs whose
   liveness is static (inbox non-empty; `specs/` commits past the cursor;
   `src/` commits past the audit cursors; posture window non-empty). The
   chain already computes two of them (`chain.ts:194-208`, `inboxNotes`,
   `specsPastCursor`) — inside the marker-honesty gate, to grade the model's
   `Plan continues` claim after the tick. The harness knows which job is
   live, asks the model to derive it from a digest, then checks the answer.
   Every tick then receives every job's material (`<spec-map>`,
   `<cargo-check>`, `<sizing>`, `<ripple>`, `<gate-reverts>`, `<src-tree>`)
   plus a paragraph on what to ignore, and the prompt's own words concede the
   context is a pointer: "the state above is an orientation digest, not the
   material — the prompt points, you read."

3. **Remaining errands, both prompts** (each is judgment standing in for a
   lookup the chain can make from `TickContext` + git):
   - build: "Find the section named `{{PER_SECTION}}` (or the nearest
     equivalent heading)" over the whole `cat` of the spec → extract the
     section; "nearest equivalent" is a plan-side lie a pending gate should
     refuse (`per.section` must resolve to a heading in `per.path`).
   - build: `<src-tree>` (whole tree, model picks relevance) → deliver
     `files[]` and `tests[]` contents plus the ripple set `ripple.mjs`
     already computes for plan.
   - build: "if green needs a file `files[]` didn't list — almost always an
     existing test — file a capture" → ripple over `tests/` delivered as
     likely collateral; the fence revert already records the actual miss.
   - plan: "a note stamped `observed at <sha>` narrows the re-verify to
     `git log <sha>..HEAD`" → `scopedDelta` keyed on the stamp.
   - plan: "read each delta commit's diff (`git show <sha> -- specs/`)" →
     render the diffs; the prompt names the exact command.
   - both: incident dates as enforcement ("eleven of nineteen build attempts
     on 2026-09-06", "three times on 2026-09-06") — rules the harness can
     deliver as data; temper's own CLAUDE.md says a surface states the rule,
     never the incident.

4. **Engine ask, minimal.** A typed read-set declaration on `Phase` —
   static paths plus a `(ctx: TickContext) => ReadSet` for entry-derived
   sets — that the engine (a) materializes and renders as data the way it
   renders the `<harness>` block, so the template states the task and the
   harness states the input; (b) records on the tick verdict as the file
   list with blob shas, beside `commitSha`. (b) is the general form of the
   2026-09-07 entry above: a gate that cannot tell an ignored input from an
   unseen one is a gate with no read set; with one recorded, it is a lookup.
   Widens spec/chain.md (*What a gate receives*, `Phase` fields),
   spec/prompt.md (what the renderer injects), spec/loop.md (*The tick
   verdict*) — the human's spec edit first. **Declined alternative: a hard
   read fence.** Blocking reads outside the set kills the arena's one real
   advantage (the caller nobody listed). Soft: reads outside the declared
   set are allowed and counted on the verdict as unplanned; that count is the
   signal the declaration is wrong, and how it improves.

5. **Chain-side, no engine change, temper's to file:** split plan into four
   phases (`plan:inbox`, `plan:spec`, `plan:reconcile`, `plan:posture`),
   each with `shouldRun` = its liveness predicate and handoff ordering them
   by priority; each receives only its material, whole, not digest-plus-
   pointer. Build receives the section, the files, the tests, the ripple —
   not the spec and the tree. Dispatch then decides what the model works on;
   the gates that decide whether its claims are believed stay exactly where
   they are.

6. **Why now.** A tick with a materialized read set is function-shaped:
   auditable from the verdict alone, cheaper (only the live job's material
   is paid for), and the only shape a 32k local model can take — the
   claude-desktop calibration of 2026-09-10 (comment-taxonomy audit, 50
   blocks, coder-agent vs qwen3.5:4b) failed on exactly the loose-context
   axis: both models classified a neighbouring artifact that leaked into a
   fixed-slice context window. Observed at flume `e1beccf`, temper
   `d9a34e39`.

## 2026-09-08 — ruling: no `regate` verb; re-gating a reverted span is chain process (human via cascade-integrations)

1. **Declined, do not derive.** Proposed in the 0.14 cycle after six vitest
   reverts re-ran good code at full agent price: a verb that re-cherry-picks a
   reverted span from the verdict's sha and re-runs afterMerge without the
   agent. John's reason, verbatim: "seems like we're proposing engine
   functionality where this is a process / chain config correction." A
   reverted span is the loop's record that it failed a gate; re-gating the
   same bytes by operator hand, without the agent seeing the prior attempt,
   routes around that record. The remedy for a gate that fired on a
   foreign-commit window or a contended box is in the chain — gate placement,
   `failingFiles` so the suspect-flake marker can fire, re-pick with the
   prior attempt visible — not a new verb. Record as declined in the plan
   commit body so it does not re-surface as an entry.

## 2026-09-08 — the release publish is a local, hand-run step with a credential nothing checks (human via flume-main)

1. **0.14.0's publish stalled a day on a dead token.** The recipe in CLAUDE.md
   named a key `.env` did not hold, the key it did hold had expired in May, and
   `pnpm publish` ignored the env-var auth form and read `~/.npmrc` instead,
   reporting the whole thing as a 404. Tag and commit were already pushed, so
   the registry lagged the tag by a day. Temper's `.github/workflows/release.yml`
   is the shape to adopt: `on: push: tags: ["v*"]`, publish with
   `secrets.NPM_TOKEN` through `setup-node`'s `registry-url`, **idempotent** —
   skip when `npm view <pkg>@<version>` already resolves — and a post-publish
   smoke that installs the published tarball from the registry and runs the
   shim (`scripts/smoke-install.mjs` already does this against a local pack;
   the job points it at the registry). `.github/**` is build's lane; the repo
   secret is John's to set. Until it lands, the CLAUDE.md recipe is corrected
   to `npm publish` and the token lives in `.env` as `NPM_TOKEN`.

## 2026-09-07 — the tick's base sha is on no surface a gate or handoff reads (temper via flume-main)

1. **An afterMerge gate cannot tell an input the tick ignored from one it never
   saw.** Field-traced twice at temper this morning (~$11, 25 min): a trunk
   commit landed minutes after a plan tick branched; the afterMerge honesty gate
   reads trunk claims by design, saw an unreconciled input, and reverted a tick
   that could not have seen it. Chain-side fix at temper 0377962d reads the
   tick's own tree at `<FLUME_WORKTREES_DIR>/plan` HEAD — a path convention
   plus a cleanup-ordering promise the engine never made. Verified on disk: the
   dispatcher holds the span's base at both merge sites (`preWtHead` at
   `src/Dispatcher.ts:1896` for singleton, `r.spanBase` at `:2505` for fanout)
   and hands it out on neither `GateContext` (`src/Gate.ts`) nor `TickResult`
   (`src/Phase.ts`). With the base, a gate says `git show <base>:path` and
   `git log <base>..HEAD -- specs/` and never touches the worktree. Fact, not
   verdict: the engine reports where the span started; whether an input that
   post-dates it counts stays the chain's (`engineering.md`, *A fact the
   engine holds is reported, never rediscovered*). Candidate shape: `baseSha`
   beside `commitSha` on `GateContext` (both stages) and `TickResult`;
   `ShipContext` already carries the merged sha and would take the same field.
   Widens the enumerations in spec/chain.md (*What a gate receives*, *What a
   hook receives*) and spec/loop.md (*The tick verdict*), so the human's edit
   first. Temper also asked for the worktree path on the afterMerge
   `GateContext`; the base sha makes that read unnecessary, so file it only
   if plan finds a second consumer.
