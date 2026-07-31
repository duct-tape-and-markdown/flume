# Flume — v0.9 Release Target (minor: the doctrine line)

## 1. Purpose & scope

One ruling (operator, 2026-07-30): **exec-local doctrine**. A bay
declares `@dtmd/flume` as its own dependency and invokes it through the
package manager (`pnpm exec flume`, an npm script, `npx`). The binary
that runs is the bay's pinned copy *and* the chain's
`import "@dtmd/flume"` resolves to that same copy, natively — one
engine per bay, coherent by construction, owned by the package manager.
Flume ships **no version-coordination machinery of its own**.

Why: the engine accumulated two generations of coherence machinery with
opposite authority models — v0.5 §5a step 4's job-dir link (chain
follows the invoked binary, deliberately overriding the bay's pin) and
v0.7 §10's launcher handshake (binary follows the bay's pin) — and
their composition produced three high-severity field wedges in the
0.8.0 migration week (temper, carto: no pinned layout could run at all;
platform: the handshake structurally cannot reach the pre-0.7 engines
that are its entire audience). Both mechanisms compensate for one
unexamined premise: a global CLI on PATH as a first-class invocation
path. Remove the premise and both mechanisms delete. Under
`.claude/rules/engine-boundary.md` and the complexity-is-a-signal rule
(`.claude/rules/collaboration.md`): distribution is not the harness's
mechanism, and a subsystem that wedges its own users three times in a
week is the signal, heeded.

Version mismatch under the doctrine: **let it break.** An out-of-doctrine
invocation (a stray global against a newer bay) fails however it fails;
the engine owes it nothing beyond documentation. The chain-side
minimum-engine marker discussed in the drained old-engine-blind-spot
park is explicitly **deferred, evidence-gated**: it ships only if
silent-mismatch reports continue *after* the doctrine lands. This
section supersedes and closes that parked question, and supersedes
v0.7 §10 and v0.5 §5a step 4 (frozen files stay frozen; this file is
the ruling of record).

Blast radius: `src/cli.ts`, `src/job.ts`, `tests/`, `README.md`,
`docs/CLI.md`, `docs/MIGRATING-0.8.md`, `docs/CHAIN-AUTHORING.md`,
CHANGELOG. Net-negative line count is the expectation, not a hope.

Explicitly not in this line: any replacement launcher, wrapper script,
or version check; multi-engine-per-job capability (never requested).

## 2. The engine↔pin handshake is removed

`engineHandshake` and its whole apparatus leave `src/cli.ts`:
`readLocalInstall` (including the `"self"` outcome just added),
`readPin`, `OWN_PACKAGE_ROOT`, the three arms, the re-exec, the
job-run-form and `--max` validation legs that existed only to feed the
re-exec, and every test that exercises them. CLI startup runs the
invoked engine, unconditionally — pre-v0.7 behavior, minus the era's
missing truth-telling (which v0.7's *other* sections already fixed and
which stay).

- The removal is subtractive only: no warning, no version probe, no
  replacement check. An unpinned invocation and a pinned one behave
  identically — the engine does not read the bay's manifest at startup.
- `tests/cli.test.ts`'s handshake suite is deleted, not rewritten; the
  consumer-install smoke keeps `--no-save` (it tests "works when
  installed", which is now the *only* supported shape).

Acceptance: `grep -n 'engineHandshake\|readLocalInstall\|readPin\|OWN_PACKAGE_ROOT' src/` is
empty; a bay with any `@dtmd/flume` pin and no provisioned link runs
every subcommand normally via its package-manager-resolved binary; the
full suite passes with the handshake tests gone.

## 3. Job-dir engine link provisioning is removed

`ensureFlumeLink` leaves `src/job.ts`; `flume job new` no longer plants
`<jobdir>/node_modules/@dtmd/flume`. A job chain's
`import "@dtmd/flume"` resolves by Node's normal walk-up to the bay's
own `node_modules` — the same copy that is executing, per §1.

- Existing job dirs with a stale link: `job run`/ticks do not read or
  repair it; it is inert (Node resolution finds it first if present —
  acceptable, it points at an engine that once ran there; `job rm`
  removes the dir wholesale as today). No sweeper, no migration
  machinery — a one-line note in the CHANGELOG suffices, pre-1.0.
- The `node_modules/` runtime-ignore entry `job new` writes stays (it
  is harmless and keeps any stray artifacts out of the baseline
  commit).

Acceptance: `grep -n 'ensureFlumeLink' src/` is empty; `flume job new`
on a fresh repo creates no `node_modules` under the job dir; a job tick
in a bay that declares `@dtmd/flume` resolves the chain's import to the
bay's install (fixture: assert the resolved module path).

## 4. Docs teach the doctrine

- `README.md` and `docs/CLI.md`: installation/invocation sections state
  the doctrine plainly — add `@dtmd/flume` as a dev dependency, invoke
  via the package manager; global installs are unsupported and the
  engine makes no attempt to detect or accommodate them.
- `docs/MIGRATING-0.8.md` §4 (the handshake section): rewritten to the
  doctrine — the "provision the pinned install" instruction dies with
  the handshake; the section becomes "invoke via your bay's install,
  full stop", and the pin-placement ambiguity (root vs bay manifest)
  dissolves — the pin lives wherever the bay's package manager reads,
  like every other dependency.
- `docs/CHAIN-AUTHORING.md`: any handshake/link references retired.

Acceptance: `grep -rin 'global' README.md docs/CLI.md` hits only the
"unsupported" statement; MIGRATING-0.8 contains no provisioning
instruction; no doc references `ensureFlumeLink` or the handshake.

## 5. CHANGELOG

- 0.9.0 section: Breaking — the engine↔pin handshake (0.8.0) and job-dir
  engine link provisioning (0.5.0) are removed; invocation doctrine is
  exec-local (bay-declared dependency, package-manager-resolved binary);
  a stray global engine is unsupported and undetected. Removed — the
  job-run/`--max` handshake validation legs. Existing job dirs' links
  are inert; delete them at leisure.
- Version bump + `npm publish` stay human-performed at cut time.
