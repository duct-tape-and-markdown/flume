# Flume — v0.7 Release Target (minor: the truth line)

## 1. Purpose & scope

One theme: **the engine never misstates what it will do or what it did** —
to an agent, to an operator, or to CI. Four field findings from 2026-07-27/28
share that failure shape, and this line closes the class, not the sightings:

- Agents on entry-scoped fanout ticks are shown the *unnarrowed* phase fence
  in the `<harness>` block while the write guard enforces a strict subset —
  every dev-9175-cim-usage fence casualty traces here, and both
  centercode-platform (PR #672) and temper had to hand-write fence clarity
  into chain prompts that the engine should self-transmit.
- `dist/cli.js` reached through a Windows directory junction silently exits
  0 having run nothing (observed live, DEV-9191 delivery).
- A chain that cannot load burns every tick in a `--max` run and still
  exits 0 — silent CI green on a dead chain.
- A CJS-context host repo fails chain load with a raw tsx stack instead of
  a usage-shaped refusal (verified against published 0.6.0 — longstanding).

Plus two freebies riding the line: `GateContext.repoRoot` (kills a helper
every gate reinvents) and `prepack` building (a local `npm pack` can today
ship stale `dist/` silently).

Explicitly **not** in this line (operator ruling 2026-07-28): the
structured-verdicts family — engine-side pending.json validation at the
plan gate, plan-time path pre-checks against the next phase's fence, and
persisting revert verdicts where plan reads them. Those entangle
pending.json semantics together and hold for a v0.8 line of their own.
Also declined: *supporting* CJS-context hosts (§5 refuses honestly instead).

Blast radius: `src/` (Prompt, cli entry, Dispatcher/loop exit paths,
GateContext), `tests/`, `docs/CHAIN-AUTHORING.md` (§5 worked example),
`package.json` scripts, CHANGELOG. No chain or prompt content ships from
this line.

## 2. Harness block states the effective fence

On a tick carrying an `assignedEntry`, `prependHarnessBlock`
(`src/Prompt.ts:218`) today renders `phase.writablePaths` under "anything
else you modify will revert the commit" — but the write guard
(`src/Dispatcher.ts:1056-1068`, per `spec/RELEASE-v0.4.md` §5) narrows the
revert boundary to `entry.files ∪ phase.entryChannelPaths`, a strict
subset. The engine's one authoritative prompt surface misstates its own
enforcement exactly where it is narrowest.

- Scoped ticks: the harness block states the **effective** fence — the
  union of `entry.files` and `phase.entryChannelPaths` as "your commit may
  touch exactly these; anything else reverts the commit whole" — and names
  `phase.writablePaths` separately as the outer ceiling (both checks are
  real and independent; a path must clear both).
- Unscoped ticks: rendering unchanged, byte-identical to today.
- The `<prior-attempt>` retry feedback mandated by v0.4 §5 (name the
  offending path after a revert) is unchanged — the reactive detail stays;
  this section only makes the *pre-commit* statement truthful.
- `docs/CHAIN-AUTHORING.md` §5's worked example currently teaches the
  collapsed rendering as correct; it is rewritten in the same entry to
  show the narrowed block.

Acceptance: a scoped tick's rendered prompt names exactly the fence the
guard will enforce; an unscoped tick's prompt is byte-identical to 0.6.2.

## 3. CLI entry survives junctions

`src/cli.ts:806-808` decides "invoked directly" by comparing
`import.meta.url` (which resolves through a junction to the file's
realpath) against `pathToFileURL(process.argv[1])` (which keeps the
junction path verbatim). Through any junction- or symlink-based install
(pnpm's linked store, the v0.5 §4 provisioning shape) the two never match,
`main()` never runs, and the process exits 0 having done nothing.

- Compare realpaths: resolve `process.argv[1]` via `fs.realpathSync`
  before the comparison. Guards: `argv[1]` undefined → not direct
  (unchanged); `realpathSync` throws → fall back to today's raw
  comparison, never crash the import.
- Importing the module without executing it (tests, embedding) must still
  not run `main()`.

Acceptance: `dist/cli.js` reached through a directory junction executes
the requested command (the DEV-9191 silent no-op does not reproduce); a
plain module import runs nothing.

## 4. Exit-code contract — the run never lies to CI

Ruled contract (operator, 2026-07-28):

- **Mount-dead aborts immediately.** A failure in the load/mount class —
  chain module cannot load, state root missing, declaration invalid —
  aborts the run on first occurrence with a usage-shaped error and a
  non-zero exit. It does not burn the remaining `--max` ticks re-hitting
  the same wall.
- **`loop` / `job run` exit non-zero iff at least one tick errored AND
  zero entries shipped.** "Settled with nothing to do" (empty queue, plan
  declines to continue) stays 0. Partial success — ships landed despite
  some tick errors — stays 0, with the errors surfaced in the completion
  summary (they must not vanish into a green exit silently).
- Tick-level agent failures keep today's semantics (fail the tick, the
  run continues); only the mount-dead class halts the run.

Acceptance: a run against an unloadable chain exits non-zero after one
tick's worth of work; an empty-queue run exits 0; a run with one errored
tick and one shipped entry exits 0 and its summary names the error.

## 5. CJS-context host: detect and refuse

A host repo whose own `package.json` lacks `"type": "module"` fails
`.flume/chain.ts` load with a raw loader stack (tsx 4.21:
`Cannot use import statement outside a module`; tsx 4.23: an
`ERR_MODULE_NOT_FOUND` with the `tsImport` `?namespace` query
percent-encoded into the path). Supporting that context is declined;
lying about it with a stack trace is the defect.

- When chain load fails with the module-context signature family, the
  engine refuses with a usage-shaped message: the host must carry
  `"type": "module"` (in the repo's `package.json` or a `package.json`
  beside the chain), stated as the fix. Exit 2, consistent with other
  usage errors. The underlying loader error remains available (debug/
  verbose detail), not the headline.
- Build determines the reliable detection signature empirically (the two
  fixtures above are the known family); false positives on genuine
  module-resolution failures must not occur — when unsure, show the raw
  error as today.

Acceptance: chain load in a CJS-context fixture (the `npm init -y` smoke
shape, pre-fix) prints the usage-shaped refusal naming `"type": "module"`
and exits 2; a genuinely missing dependency still surfaces as itself.

## 6. `GateContext.repoRoot`

New field on `GateContext`: the absolute path of the working-tree root
the gate is running in — in a fanout tick, the worktree root; in a bare
tick, the primary checkout. The value the `git rev-parse --show-toplevel`
+ fallback helper every gate currently reinvents. No other behavior
changes.

Acceptance: a gate running in a fanout worktree receives that worktree's
root; existing gates keep passing untouched.

## 7. `prepack` builds

`npm pack` runs no build today (only `prepublishOnly` exists), so a local
pack — including `pnpm smoke:install` — packs whatever `dist/` is on
disk; a stale-dist run tests the wrong code silently. Add
`"prepack": "pnpm build"`. CI is unaffected (it builds explicitly).

Acceptance: `pnpm smoke:install` from a dirty `dist/` state exercises the
current source.

## 8. CHANGELOG

- 0.7.0 section: Fixed — harness block states the effective (narrowed)
  fence on entry-scoped ticks; CLI entry runs through directory
  junctions/symlinks; module-context chain-load failure is a usage error,
  not a stack; `pack` can no longer ship stale `dist/`. Added — run
  exit-code contract (mount-dead aborts non-zero; error-and-nothing-
  shipped is non-zero); `GateContext.repoRoot`.
- Version bump + `npm publish` stay human-performed at cut time; no phase
  writes the version field.
