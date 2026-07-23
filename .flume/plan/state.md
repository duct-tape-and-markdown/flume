# State

Phase: **v0.5 line complete** — 0.5.0 cut shipped (`31ea59d`, ship-marker `c2074c4`). All lines v0.1–v0.5 frozen. No v0.6 spec file exists; nothing to derive. Mode this tick: **audit**.

## This tick — audit the 0.5.0 cut

Delta = 2 commits (`31ea59d` cut, `c2074c4` chore ship); no spec delta; inbox empty; pending empty.

**Audit `31ea59d` vs v0.5 §11**: clean. Version 0.5.0, commit message `chore(release): cut 0.5.0` (exact), `### Breaking` carries the trunkBranch removal, `### Added` covers §11's full enumeration (verb family, `--job`/`FLUME_JOB` + wrong-branch guard, namespaced fanout, Axis-C exit 78, `Phase.agent`, entry write guard + `entryChannelPaths`, win32 + CI lane, all five PR #5 items). Files touched = files declared (`CHANGELOG.md`, `package.json`); lockfile untouched as the entry's notes predicted.

Two build judgments, both ratified:

1. **`### Fixed` block for `74c17cb`** — §11 fixes version + block structure + Breaking's presence, but also directs "reconcile against the commits since the v0.3.1 cut"; `74c17cb` is a real fix in `9be3c0f..HEAD` and omitting it would misreport the log. §11's block list is the required minimum, not a cap (v0.1 §9 mandates `### Breaking` only).
2. **PR #5 items phrased as docs+tests close-out** — items appear under `### Added` per the enumeration; the phrasing is truthful (runtime surface shipped at 0.3.1, its block already records it).

**Derive**: none (no spec delta, no `spec/RELEASE-v0.6.md`). **Drain**: none. **Promote**: none.

## Queue (0)

Empty. Next derivation trigger: a v0.6 spec file (or inbox findings). npm publish of 0.5.0 stays a human act (§11).

## Open questions

None.

## Writable-paths / trunk

- Wrote `.flume/plan/state.md` only; pending.json already `[]`, open-questions.md and inbox.md untouched (both empty).
- Trunk: HEAD `c2074c4` at tick start, tree clean (untracked `.flume/loop.pid` is runtime). **main ahead 39 of origin/main** (40 with this commit) — human push pending.

Plan continues: no
