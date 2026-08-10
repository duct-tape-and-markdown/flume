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

## 2026-08-10 — pinLongPaths unconditional config write fails on externally-held `.git/config` (human, via downstream report)

Downstream incident: @dtmd/flume 0.11.0, Windows 11, consumer centercode-platform, job dal-migration. A build wave provisioning 2 fanout worktrees quarantined one entry: `worktree provisioning failed for <entry> (Command failed: git config core.longpaths true — error: could not write config file .../.git/config: Permission denied)`. Intermittent, wave ≥ 2 only; the failure is infra charged to a work entry (same misaccounting class the exit-3 split exists to prevent).

**Verified this session (HEAD and v0.11.0 tag):**

- `pinLongPaths` (`src/git.ts:167`) writes `git config core.longpaths true` unconditionally per call; called per-provision (`src/Dispatcher.ts:2817`) and at job provisioning (`src/job.ts:203`). All writes target the shared common `.git/config`.
- **The report's proposed mechanism — two concurrent provisions racing — is wrong for 0.11.0 as shipped.** Provisioning is serialized (`src/Dispatcher.ts:1691–1711`, identical at v0.11.0); setup hooks and agent fanout start only after the loop completes. No two engine pins overlap within a process.
- Consistent-with-evidence mechanism: the redundant repeat write races an **external holder** of `.git/config` — AV/indexer/sync client opening the file right after the prior provision's write (explains wave ≥ 2 only, intermittent, config mtime = surviving provision), or a second flume process on the same repoRoot. On Windows an open read handle fails the `config.lock` → `config` rename with `EACCES` ("Permission denied"), not git's "could not lock" message.

**Fix direction (consumer's rank #1, endorsed):** check-then-skip — `git config --get core.longpaths` already `true` → return without writing. Kills every steady-state write (after the first-ever pin the local key exists forever) and the whole race window; pure mechanism, passes second-implementation test. Contract points to preserve: no-op off win32; still self-heals a repo where longpaths is unset at every scope. Note `run()` throws on nonzero exit — `--get` on an unset key exits 1, so the probe needs that case handled as "unset", not error.

**Test (fails on pre-fix tree, win32 lane):** key already `true` locally + `.git/config` made read-only → pre-fix throws on the redundant write, post-fix succeeds by skipping.

**Consumer's rank #2 (bounded retry / first-pin serialization): rejected as a complexity tail.** The concurrent-writer case it defends is already excluded upstream by the engine's own structure: in-wave provisioning is serialized (`src/Dispatcher.ts:1691`), one supervisor per state root (`src/cli.ts:1272`), and v0.11's advisory tip claim admits one flume writer per ref (`src/cli.ts:1287`) — the resource multiple jobs under one checkout contend on. Retry inside `pinLongPaths` would re-derive, at the leaf, exclusion the engine owns at the top (per engineering.md "the fix lands at the mechanism"). The residual — a lone external holder defeating the first-ever pin — already self-heals loudly: the failed entry stays pending, the next wave probes and writes again; the loop is the retry. A *persistent* external lock then surfaces via repeated-identical-failure quarantine, which is the correct loud outcome.

**Upstream alternative considered and rejected:** hoisting the pin out of per-provision to a per-run boundary (dispatcher init, beside `job.ts:203`). It fixes the callers rather than the mechanism — future callsites regress — and still restates durable once-per-repo state as a write every run. Check-then-skip encodes the actual invariant (write only when absent) at the mechanism, so every caller present and future inherits it.

**Also:** platform-facts candidate — "a config write shortly after a prior write to the same file can EACCES on win32 under AV/sync watchers" is an external fact this repo has now paid for once (downstream). And the doc comment's idempotence claim (`src/git.ts:164–165`) is true for the engine's serialized use but reads as licence for the redundant write — shrink it alongside the fix.
