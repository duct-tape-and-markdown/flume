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

## 2026-08-03 — twenty-one dead `spec/RELEASE-v0*` cites survive the flatten (operator)

The flatten deleted `spec/RELEASE-v0.*.md`; the cites pointing at those files
did not go with it. Counted on disk this tick:

- **`tests/` — 21 cites across 7 files.** Describe-strings and comments naming
  sections in files that no longer exist.
- **`CHANGELOG.md` — 9 cites.** One is load-bearing prose rather than a
  reference: the file's own versioning-policy header states the pre-1.0
  breaking-change rule "see `spec/RELEASE-v0.1.md` §2" and the `### Breaking`
  subheading convention "per `spec/RELEASE-v0.1.md` §9". **The policy that
  governs how this project versions itself cites a deleted file, twice.**
- **`src/` — zero.** Already clean.

The whole premise of the flatten was that a cite either resolves to a named
section or it does not. Twenty-one that cannot resolve is the defect the
restructure existed to end, still in the tree — and the changelog instance is
worse than a stale reference, because a reader following it to understand the
versioning rule finds nothing at all.

Repoint each to the topic file that now owns the claim
(`spec/{loop,chain,prompt,pending,cli,jobs,worktrees}.md`) and its section
name, not a number. Where the cited section has no successor because the claim
was retired, drop the cite rather than inventing a target.

**Needs a judgment call, do not guess:** `docs/MIGRATING-0.11.md` and
`docs/PRD-dock-collapse.md` also cite the deleted files. CLAUDE.md names
`docs/` as the home for historical material, and a dated retro citing the
corpus as it stood is legitimately historical. A *migration guide* may not be —
it reads as live reference. Route that one explicitly rather than sweeping both
in or both out.

Per candidate: `.claude/rules/engineering.md` *Narration is the ladder's bottom
rung* — a cite is narration, and one that cannot resolve is the weakest rung
failing outright. Test: no file under `tests/`, `src/`, or `CHANGELOG.md`
references a path matching `spec/RELEASE-v0`.
