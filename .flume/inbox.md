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

## 2026-08-04 — track FLUME_DIR provenance instead of inferring it from path shape (operator ruling)

Closes CLI-FLUMEDIR-CROSS-REPO-ROOT-REFUSAL's parked question at **option 2**.

`impliedRepoRoot` (`src/cli.ts`) decides an absolute `FLUME_DIR` was inherited from
another repo's process by walking the path for a segment literally named `.flume` and
comparing its parent to `repoRoot`. That is provenance reconstructed from a string.

`.claude/rules/engine-boundary.md` *Told, not inferred* rules it directly: the
counterparty here is flume's own earlier process, which **can** say so outright, so
the engine reads that statement rather than rebuilding it. This is not a reopening of
the 2026-08-03 ruling — that ruling said an inherited `FLUME_DIR` must not cross a
repo root, and it stands. Only the evidence changes.

The misfire is real, not theoretical: `FLUME_DIR=/mnt/state/.flume` is a natural
thing for an operator to type, `spec/cli.md` explicitly sanctions out-of-tree
relocation with no constraint on the directory's name, and today that invocation is
refused as cross-repo contamination. Shipped tests only cover a relocation with no
`.flume` ancestor (`/var/dock/state`), so the misclassifying case is unpinned.

Shape: `resolveStateDirs`'s canonicalization write-back stamps the repo root it
resolved for, alongside the vars it already writes back. Refuse only when that stamp
is present and disagrees with the freshly-resolved `repoRoot`. A value typed for this
invocation carries no stamp and can never misfire; only a genuine crossing of the
loop→tick or nested-process boundary sets one. Delete the path-shape walk.

Per: `spec/cli.md` *State-root and config-dir resolution* — the write-back section
gains the stamp. Tests: an operator-typed `FLUME_DIR` whose path contains a `.flume`
segment belonging to no repo resolves cleanly; a stamped value from another repo's
root is still refused.

## 2026-08-04 — `docs/MIGRATING-0.11.md` is live; repoint its cites (operator ruling)

Closes the parked live-or-historical question. **Live.**

Plan couldn't settle it from the repo alone and said so. The answer is outside this
repo but inside the operator's: of the four downstream consumers on `@dtmd/flume`,
**three are pre-0.11** — `runner` at `^0.2.0`, `temper` at `^0.6.0`, `cartograph`
pinned at `0.9.0`. A caret range on `0.x` pins the minor, so none of them has taken
the factory-shape migration yet and all three will need this guide when they do.

So it is live directive prose, not a record, and its three dead
`../spec/RELEASE-v0.11.md` links (§1 twice, §6 once) get the same repair
`FLATTEN-ORPHANED-RELEASE-CITES-REPOINT` applied elsewhere: repoint to the topic file
and section that now owns each ruling — the branch-topology retraction and the
factory-shape requirement.

`docs/PRD-dock-collapse.md` is the opposite case and stays as-is: it declares itself
a design record in its own third line. That contrast is the whole reason this pair
was routed as a question rather than swept together.

Per: `.claude/rules/engineering.md` *Narration is the ladder's bottom rung* — a cite
that cannot resolve is the weakest rung failing. Test: no live guidance under `docs/`
links to a `spec/RELEASE-v0*` path.
