# Flume — v0.6.2 Release Target (patch: friction lifecycle + teardown integrity)

## 1. Purpose & scope

One theme: **the engine guarantees the friction channel's lifecycle without
ever reading its content.** Friction — loop-to-owner notes, gitignored by
design, hand-routed by the operator, never in a commit diff — is today a
per-chain convention the machinery half-knows: `job extract` harvests a
hardcoded `friction.md` (v0.5 template shape), centercode-platform uses a
gitignored `friction/` directory, flume's own chain has no channel at all.
The drift has a real cost, observed twice on 2026-07-27:

- Job `dev-9175-cim-usage` (centercode-platform): agents wrote friction
  inside fanout worktrees — correctly, per the stray-write isolation that
  keeps worktree agents inside `$PWD` (`src/Dispatcher.ts:1110`) — and
  teardown deleted every note before the operator could route it. The
  agents' own explanations of two entry-scope reverts survived nowhere.
- The v0.6.1 dogfood run (this repo): all three build waves ended with
  `git worktree remove --force` failing (`Directory not empty`, win32,
  pnpm-installed node_modules), leaving debris swept by hand.

Design laws this line must not bend:

- **Friction stays gitignored and out of the commit stream** (operator
  ruling 2026-07-27: intentional, not a defect).
- **Agents write only under `$PWD`**; crossing the worktree boundary is
  harness-code privilege (the sessions precedent: `withSessionCapture`
  writes to absolute `FLUME_DIR` from the dispatcher process, never from
  the agent).
- **Declaration, not identity** (the v0.6 species: `Chain.seedDir`,
  `Chain.harvest`; v0.6 deleted the `HARVEST_PATHS` hardcode — this line
  must not re-ship an engine hardcode in its place). Undeclared → the
  engine does nothing new.
- **Content-opaque**: the engine moves, counts, and names friction files.
  It never parses, renders, or routes their contents.

Blast radius: `src/` (Phase/Chain type, Dispatcher teardown + revert path,
cli status/loop/extract surfaces), `tests/`, CHANGELOG. No prompt or chain
content ships from this line (downstream chains adopt by declaration).

## 2. `Chain.friction?: string` — the declaration

- New optional field on `Chain` beside `seedDir` / `harvest`
  (`src/Phase.ts`): a **state-root-relative directory path** naming the
  friction channel (e.g. `"friction"`). Resolved against the resolved
  `flumeDir` at load, same idiom as the other two fields.
- Validation at chain load: must be relative and must resolve inside the
  state root — anything else is a usage-shaped error (exit 2), consistent
  with `seedDir`'s absent-on-disk handling. The directory itself is
  created lazily by whichever engine write needs it first; its absence is
  never an error.
- Undeclared: every behavior in §§3–6 is off; §7 applies regardless.

## 3. Runtime ignore entry

Wherever the engine today "ensures the runtime ignore entries" (`job new`,
and any other site that maintains the runtime ignore set), a declared
friction dir is added to that set — gitignored uniformly by machinery, not
by per-repo habit. Idempotent; template-authored ignore lines preserved
verbatim per the existing contract (`src/job.ts:98`).

## 4. Teardown harvest — the delivery guarantee

Only the engine is present when a fanout worktree dies; therefore only the
engine can guarantee a worktree-local friction note survives.

- At wave end, for each fanout worktree, BEFORE removal: resolve the
  worktree-local mirror of the declared channel — the declared dir joined
  to the worktree's copy of the state root's repo-relative path — and
  **move** every file in it into the primary `<flumeDir>/<friction>/`,
  prefixing each filename with `<tag>--` (provenance + collision-free
  against other waves and the primary's own files).
- Harvest is a move by harness code across the worktree boundary — the
  sessions precedent, not an agent write. Agent-facing rules do not
  change: worktree agents keep writing under `$PWD`.
- Scope: applies when the state root lives inside the repo tree (so a
  worktree contains a mirror). A relocated state root (`FLUME_DIR`
  outside the repo) has no mirror; behavior there is unchanged.
- Harvest failure (locked file, unreadable dir) must not abort the wave:
  log per-file, continue, leave what could not move for §7's sweep to
  surface.

## 5. Revert note — the operator's copy of the verdict

When an afterCommit gate reverts a build tick's commit and `Chain.friction`
is declared, the engine writes `<friction>/<ISO-timestamp>--<tag>--reverted.md`
containing, verbatim from data the engine already holds: the gate name,
its message and details (for the write gate: the offending path list), and
the reverted commit's subject + body. Today that evidence dies with the
worktree and lives only in supervisor stdout; the operator half of the
2026-07-27 revert-evidence finding closes here. (The *plan*-addressed
half — surfacing the verdict where the next plan tick reads it, e.g. a
`gate.reason` append — is deliberately NOT in this line; it entangles
pending.json semantics and awaits the v0.7 scoping call.)

## 6. Surfacing — the routing trigger

Hand-routing stays human; the engine only announces that mail exists.

- `flume status` and `flume job status`: when declared and non-empty,
  append one line — count of files in the friction dir (e.g.
  `friction: 3 note(s) await routing`).
- Loop end (`loop` / `job run` completion summary): same single line.
- `job extract`: when declared, the friction harvest prints the declared
  dir's files (path + contents, the existing harvest style) instead of
  the legacy hardcoded `friction.md` guess; undeclared keeps today's
  behavior exactly.

## 7. Worktree removal fallback (win32) — unconditional

Independent of any friction declaration. When `git worktree remove
--force` fails at wave cleanup:

1. `git worktree prune`, then recursive directory removal with a bounded
   retry (the EBUSY/locked-handle class; pnpm-installed `node_modules` is
   the common payload).
2. If the directory still survives, the failure is reported once with the
   surviving path — not once per wave tick — and the loop continues (as
   today).

Acceptance: a worktree whose tree contains a populated `node_modules` is
fully removed on win32 at wave end; the v0.6.1 symptom (three waves,
three `Directory not empty` errors, hand sweep) does not reproduce.

## 8. CHANGELOG

- 0.6.2 section: Added — `Chain.friction` declaration; teardown harvest
  of worktree-local friction; revert notes to the friction channel;
  friction counts in status/loop/extract surfaces. Fixed — worktree
  removal on win32 falls back past `Directory not empty`.
- Version bump + `npm publish` stay human-performed at cut time; no phase
  writes the version field. (0.6.1 is cut-pending ahead of this line —
  the human cut may batch or sequence them; not this spec's concern.)
