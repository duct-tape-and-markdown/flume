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

## 2026-05-15 — node_modules-symlink worktree setup is unsupported by pnpm (runner-review)

**Finding.** `buildSetupWorktree` symlinks `repoRoot/node_modules` into each fanout worktree (`.flume/chain.ts:87`). pnpm officially does not support `node_modules` as a symlink: on `pnpm install` it deletes the symlink rather than treating it as a writable target (pnpm/pnpm#9973). The pattern is outside pnpm's design, not a tunable.

**Distinct from the c8a09ee prune fix.** That addressed stale `.git/worktrees/<slug>` metadata. This is a separate, deeper issue: the *contents* materialization strategy, not git metadata.

**Why flume hasn't manifested it yet (but it's latent + actively mis-taught).** flume's gates (`tscGate` = `pnpm tsc --noEmit`, `vitestGate` = `pnpm test`) only *read* `node_modules`; they never run `pnpm install` inside a worktree, so the symlink survives every wave so far. It breaks the moment a build entry needs `pnpm install` in-worktree (adding a dep, lockfile change). Runner hits it now because runner's entries churn deps. flume will hit it the first dep-adding entry. Worse: `docs/CHAIN-AUTHORING.md:219-231` *documents and recommends* this exact symlink (with a code sample), and `docs/CHAIN-AUTHORING.md:49` describes it in the hook table — flume is teaching consumers a broken pattern, and the forthcoming template would inherit it. Three surfaces: dogfood chain, authoring docs, template.

**pnpm's official answer for this exact use case.** `enableGlobalVirtualStore: true` in `pnpm-workspace.yaml` (https://pnpm.io/git-worktrees): each worktree gets its own `node_modules` of symlinks into a shared content-addressable store. Near-zero setup, cleanup never leaks. **Caveat: marked experimental in pnpm — opt-in only.** That's the real tradeoff and cuts against flume's conservative pre-1.0 posture (`.claude/rules/spec-plan-build.md`). No `pnpm-workspace.yaml` exists yet — greenfield.

**Options:**

- **A — `enableGlobalVirtualStore: true`.** pnpm's blessed answer; experimental surface. Lowest runtime cost.
- **B — symlink each immediate child of `node_modules` individually.** Non-experimental but fragile: new deps installed in-worktree won't appear, `.bin` handling is finicky, nested-symlink edge cases.
- **C — `pnpm install --frozen-lockfile` in `setupWorktree` (no symlink).** Most robust, zero magic, zero experimental surface, zero leak risk. Cost: one `pnpm install` per worktree per wave — but pnpm hardlinks from its global store (no re-download), so for default `maxParallel: 4` this is seconds, not minutes.

**Recommended disposition (needs a human decision — genuine tradeoff, do not silently derive per spec-plan-build.md):**

1. **Open question:** A vs C as flume's *documented default*. My lean: **C is the safe default flume teaches** (robust, no experimental dependency — flume should not teach an experimental-by-default pattern); **A documented as an opt-in optimization** for consumers who accept the flag. flume's own dogfood chain switches to C, which also dogfoods the documented default.
2. Once decided → pending entries: (a) rewrite `.flume/chain.ts` `buildSetupWorktree`; (b) rewrite `docs/CHAIN-AUTHORING.md:219-231` + the :49 table row; (c) add an `afterCommit` defense-in-depth sanity gate that fails loud if a sentinel dependency no longer resolves from the worktree root (catches silent dep-materialization regressions in any strategy); (d) ensure the template inherits the corrected pattern, not the symlink.

**Severity:** High. Latent correctness bug in the runtime-adjacent pattern flume *recommends*; blocks the template; will manifest in flume's own loop on the first dep-adding entry. Sources: https://pnpm.io/git-worktrees, https://github.com/pnpm/pnpm/issues/9973, https://pnpm.io/symlinked-node-modules-structure.
