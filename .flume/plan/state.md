# State

Phase: **v0.5 ACTIVE** (`spec/RELEASE-v0.5.md`; v0.1–v0.4 frozen). Mode this tick: **audit**.

## This tick — audit JOB-NEW-SCOPE ship

Delta = 1 build commit + 1 chore ship (`0e69a67`, `5f10653`); no spec changes; inbox empty.

**Audit `0e69a67` (JOB-NEW-SCOPE vs §5a)**: clean. Scope = the two declared files exactly (src/job.ts, tests/job.test.ts). Both entry asserts present: (1) foreign-staged test proves the pathspec'd step-6 commit carries only `.flume/jobs/<name>/.gitignore` while `foreign.txt` stays staged (tests/job.test.ts:266+); (2) file-as-template exits 2 with the usage message before any branch or dir exists (tests/job.test.ts:298+). Mechanics verified: `commit -- <jobdir>` runs immediately after `add -- <jobdir>` so worktree == index under the pathspec — commit content is exactly the staged harness; the `statSync().isDirectory()` gate sits in the pre-flight usage block ahead of step 1 (src/job.ts:160-167). docs/CLI.md:80 already promised exit 2 for "`--template` pointing at no directory" — new message fits, no doc edit needed, matching the entry's "No docs edit needed" claim.

**Findings**: none filed. existsSync→statSync TOCTOU window is trivial (single-operator CLI, race resolves to exit 1 operational) — not worth a debt note beyond this line.

**Derive**: none (no spec delta). **Drain**: none (inbox empty). **Promote**: none — JOB-NEW-SCOPE blocked nothing; every remaining blockedBy tag (JOB-RUN → RM → STATUS → EXTRACT chain) still in pending.

## Queue (5)

Head: **JOB-RUN** (open). Serial after: RM → STATUS → EXTRACT → DOCS, unblocking mechanically as tags ship.

## Active plan target

`spec/RELEASE-v0.5.md` — decomposition complete; underived surface: none. Next derivation trigger: v0.5 amendments or a v0.6 file.

## Open questions

**1** — type-level tests not gate-enforced (tsconfig excludes `tests/`); PARKED, options captured, human toolchain call.

## Writable-paths / trunk

- Wrote `.flume/plan/state.md` only; pending.json unchanged (queue as shipped-minus-head is already correct); open-questions.md unchanged; inbox.md untouched (empty).
- Trunk: HEAD `5f10653` at tick start, tree clean (untracked `.flume/loop.pid` is runtime). **main ahead 14 of origin/main** — human push pending.

Plan continues: no
