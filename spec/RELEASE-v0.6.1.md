# Flume — v0.6.1 Release Target (patch: Windows install surface)

## 1. Purpose & scope

Patch line, one theme: **`npm i @dtmd/flume` must yield a working `flume`
command on a stock Windows box** (PowerShell/cmd, no `sh` on PATH). No
runtime behavior changes; the blast radius is `bin/`, `scripts/`,
`package.json` metadata, CI, CHANGELOG.

Field evidence (2026-07-27): a teammate's onboarding died at the CLI entry
point, and the failure was re-verified on a second Windows machine from a
clean registry install of 0.6.0. The package's only bin (`bin/flume`) is
`#!/bin/sh`, so npm's generated Windows shims hunt for `sh.exe` —
`node_modules/.bin/flume.cmd` resolves `%dp0%\/bin/sh.exe`, falls back to
`/bin/sh`, and exits 1 with "The system cannot find the path specified"
under PowerShell. Chain loading itself is healthy on Windows and is NOT in
scope: verified clean on registry 0.6.0 with hoisted tsx 4.23.1 under Node
22.20.0 (`status` and `render` both exercise the tsx chain load). An
earlier field report blamed a tsx ESM-specifier regression; that did not
reproduce and no tsx pin ships in this line.

## 2. Node bin entry

The published bin becomes a Node script so npm generates working shims on
every platform.

- New `bin/flume.js` with a `#!/usr/bin/env node` shebang;
  `package.json` `bin.flume` → `"./bin/flume.js"`. The `scripts.flume`
  alias follows.
- It must reach the same entry `bin/flume` reaches (`dist/cli.js`),
  preserving argv, stdin piping, and exit-code propagation. Mirror how
  `bin/flume` invokes the CLI (read it first); the simplest shape that
  matches `dist/cli.js`'s module format wins — no option parsing, no
  environment opinion, no output of its own.
- `bin/flume` (POSIX sh) stays in the package for direct callers; it is no
  longer what `bin.flume` points at. Its resolve-through-symlinks
  preamble is not needed in the Node entry (Node resolves its own module
  path).
- `files` / pack inclusion: confirm `bin/flume.js` lands in the tarball
  (`npm pack --dry-run`).
- Acceptance: on win32, in a scratch dir with the packed tarball
  installed, `node_modules\.bin\flume.cmd --version` (spawned from
  PowerShell/cmd, not a POSIX shell) prints the version and exits 0.
  Existing POSIX behavior unchanged — full test suite stays green.

## 3. Install smoke test — pack → install → shim → chain load

The gap that let 0.6.0 ship with a dead Windows entry point: nothing ever
exercised the *installed* package through npm's *generated shims*. Close
it with a repeatable script.

- `scripts/smoke-install.mjs`, plain Node (no bash-isms, no external
  deps): `npm pack` the repo → temp dir (`fs.mkdtemp`) → `npm init -y` +
  `npm i <tarball>` → run the **generated shim** (`node_modules/.bin/
  flume.cmd` on win32, `node_modules/.bin/flume` elsewhere) with
  `--version`, expect exit 0 → scaffold a minimal chain-load fixture
  (`git init`; `.flume/chain.ts` importing a value from `@dtmd/flume`; a
  one-line prompt stub) → run the shim's `render <phase>`, expect exit 0.
  Every step prints what it ran; first failure aborts with a non-zero
  exit and the failing step named.
- `package.json` script: `"smoke:install": "node scripts/smoke-install.mjs"`.
- CI: if `.github/workflows/` carries a test workflow, add the smoke run
  to it — a `windows-latest` lane if the workflow has none. Keep the
  wiring minimal; the script is the substance.
- Acceptance: `pnpm run smoke:install` exits 0 on this machine (win32),
  and the run log shows both the `--version` and `render` steps passing
  through the `.cmd` shim.

## 4. CHANGELOG

- `CHANGELOG.md` gains a 0.6.1 section: Fixed — `npm i -g @dtmd/flume`
  now yields a working `flume` on Windows (bin was `#!/bin/sh`; npm's
  generated `.cmd`/`.ps1` shims required `sh.exe`). Added —
  `smoke:install` pack-and-install smoke test exercising the generated
  shims and a chain load.
- The version bump + `npm publish` remain human-performed at cut time
  (precedent: `chore(release): cut 0.6.0`); this spec targets 0.6.1 but
  no phase writes the version field.
