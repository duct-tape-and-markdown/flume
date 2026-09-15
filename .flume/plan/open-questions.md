# Open Questions

Decisions parked for human input. Each question is a `##` subsection with status, context, options, and recommended disposition.

Status markers:
- **PARKED** — no movement until human resolves
- **PARTIALLY ADDRESSED** — some progress; remaining ambiguity blocks closure
- **NEEDS AMENDMENT** — answer is clear; requires a spec edit to close

<!-- questions below this line -->

## The release publish is hand-run, and `spec/cli.md` ratifies that (PARKED — needs a spec amendment)

Drained from the inbox (2026-09-08, human via flume-main). 0.14.0's publish
stalled a day on a dead token: CLAUDE.md named a key `.env` did not hold, the
key it did hold had expired in May, and `pnpm publish` ignored the env-var auth
form and read `~/.npmrc`, surfacing as a 404 on the PUT. Tag and commit were
already pushed, so the registry lagged the tag by a day.

**Not derivable as filed.** `spec/cli.md` *Versioning policy* currently states
"The version bump and `npm publish` are human-performed at cut time." A tagged
CI publish contradicts that line, so the line moves first.

Shape the finding proposes, carried here so the answering session need not
re-derive it — temper's `.github/workflows/release.yml`: `on: push: tags:
["v*"]`, publish with `secrets.NPM_TOKEN` through `setup-node`'s
`registry-url`, **idempotent** (skip when `npm view <pkg>@<version>` already
resolves), and a post-publish smoke that installs the published tarball from
the registry and runs the shim — `scripts/smoke-install.mjs` already does this
against a local pack; the job points it at the registry.

Two things are the operator's regardless of the ruling: setting the repo
secret, and whether release automation is wanted at all for a package whose
cut is deliberately hand-curated (changelog mining, `smoke:install`).
`.github/**` is already inside build's fence, so the work ships the moment the
spec line moves.

## Two prior-attempt keyspaces share one stem and one map key (PARKED — needs a spec amendment)

Drained from `.flume/plan/notes/HARNESS-INBOX-KEYSPACE-PINNED.md` (build tick,
864b20b). Verified on disk this tick, not taken from the note.

`priorAttemptStem` (`src/priorAttempts.ts:104`) composes
`join(priorAttemptsDir(flumeDir), slugify(key))` for **both** keyspaces, and
`PriorAttemptStore.write` (`:296`) keys the record by `ref.key` alone, which
`readAll` (`:289`) then uses as its map key. `priorAttemptRef` (`:174`) derives
`slugify(entry.tag)` for fanout and `phase.name` verbatim for singleton — two
different keyspaces, one namespace. A singleton phase `build` and a queued entry
tagged `BUILD` (or phase `plan-sweep` and tag `PLAN.SWEEP`, which `slugify`
folds the same way) resolve to one `build.json` and one map entry: the second
writer clobbers the first, the retry reads a predecessor that was never its own,
and `clearStale` — which filters on `rec.key === "entry"` precisely to protect
phase records — deletes the survivor when the tag leaves the queue, because the
clobbered file now reads `entry`.

The suite covers each keyspace alone (`tests/priorAttempts.test.ts:659`, `:691`)
and never both at one stem through the store; 864b20b's window pin had to build
the two records by hand for exactly that reason.

**Not derivable as filed.** Three spec lines ratify the colliding shape:

- `spec/loop.md` *Prior-outcome feedback to the retrying tick* — "Persisted at
  `<flumeDir>/prior-attempts/<key>.json` — `priorAttemptPath(flumeDir, tag)`".
- `spec/chain.md` *What a hook receives* — the map is "keyed by the identity each
  was written under (tag slug for fanout entries, phase name for singletons — the
  file on disk sits at a slugged stem; the map key does not)".
- `spec/pending.md` *What the package exports* — `priorAttemptPath(flumeDir, tag)`
  as the exported rule a chain derives the path from.

Every fix below contradicts at least the first. An entry would have to cite a
section that ratifies the defect, so this parks rather than queues.

**Options.**

- **A — scope the stem and the map key by keyspace.** `prior-attempts/<keyspace>/<slug>.json`;
  `priorAttemptPath` takes the keyspace (or the `PriorAttemptRef` the engine already
  pairs); `readAll` keys by keyspace + identity. Closes it at the one place that
  composes the path (`.claude/rules/engineering.md`, *The fix lands at the
  mechanism*). Costs: the exported signature, the `TickContext.priorAttempts` map
  key, and all three spec lines. This repo's only map consumer iterates `.values()`
  and already discriminates on `rec.key` (`harness/windows.ts:276`), so the blast
  radius here is the spec and the export, not the harness.
- **D — refuse loudly at write, shape unchanged.** `write` throws when the target
  stem already holds a record of the other keyspace. Preserves every spec line and
  the export. But it makes the engine refuse a chain config no spec section calls
  illegal — convention-policing (`.claude/rules/engine-boundary.md`) unless the
  spec first says the two keyspaces share a namespace.
- **C — accept it.** Declare and cite the shared namespace at the stem, and leave
  collision-avoidance to the chain's naming. Cheapest; leaves a silent clobber
  reachable by any downstream chain whose phase name folds onto a tag slug.

**Recommend A**, with the spec lines moving first. The engine already carries the
keyspace as a typed field and already special-cases it in `clearStale` — the disk
layer is the one place the discrimination was never applied, and D asks a chain to
work around a namespace the engine chose. If A lands, the agreement case is both
refs written through the real store and read back distinct
(`.claude/rules/engineering.md`, *A seam gate reads what the real writer wrote*) —
not two records built by hand, which is all the current suite can do.
