# State

Phase: **v0.5 ACTIVE** (`spec/RELEASE-v0.5.md`; v0.1–v0.4 frozen). Mode this tick: **audit**.

## This tick — audit JOB-STATUS ship

Delta = 1 build commit + 1 chore ship (`ae5abb8`, `e21b8a9`); no spec changes; inbox empty.

**Audit `ae5abb8` (JOB-STATUS vs §5d)**: clean. Scope = the four declared edit files exactly (cli.ts comment touch-up §5d→§5e rides the declared cli.ts edit). §5d's core contract — "observational, no side effects" — held by construction: Baton mkdirs `awake/` in its constructor, so the enumerator constructs it only when the dir already exists (mkdir-on-existing is a no-op) and reports hibernating otherwise; unit asserts a hibernating job gains no `awake/` and no file changes. Enumeration units: absent `.flume/jobs` (or absent `.flume`) → `[]` with nothing materialized; sorted by name; plain files under `jobs/` skipped; awake phases read via per-job Baton as specced. Pending count reads `<jobdir>/plan/pending.json` through the real `parsePending`. e2e: `no jobs` on empty repo, per-job line with awake+pending on a real job, any argument → exit 2. Exit-code table (0 always / 2 usage / 1 fs) consistent across code, help, CLI.md.

**Findings**: none filed. Three one-line debt notes: (1) spec is silent on absent/unparsable pending.json — build chose 0 / `null`("unparsable"); small display-level gap-fill, documented in CLI.md + commit body, within the "within reason" carve-out, no park. (2) status reads the working tree only — a job dir living solely on an un-checked-out `job/<name>` branch is invisible; inherent to disk-is-truth, CLI.md documents it. (3) exit-1 fs-failure path untested — not portably triggerable; matches posture of the other job verbs.

**Derive**: none (no spec delta). **Drain**: none (inbox empty). **Promote**: none — ship commit already flipped JOB-EXTRACT to open; DOCS blockedBy EXTRACT intact (tag still in pending).

## Queue (2)

Head: **JOB-EXTRACT** (open). Then DOCS (blockedBy EXTRACT), unblocking mechanically when it ships.

## Active plan target

`spec/RELEASE-v0.5.md` — decomposition complete; underived surface: none. Next derivation trigger: v0.5 amendments or a v0.6 file.

## Open questions

**1** — type-level tests not gate-enforced (tsconfig excludes `tests/`); PARKED, options captured, human toolchain call.

## Writable-paths / trunk

- Wrote `.flume/plan/state.md` only; pending.json unchanged (EXTRACT→DOCS queue already correct); open-questions.md unchanged; inbox.md untouched (empty).
- Trunk: HEAD `e21b8a9` at tick start, tree clean (untracked `.flume/loop.pid` is runtime). **main ahead 24 of origin/main** — human push pending.

Plan continues: no
