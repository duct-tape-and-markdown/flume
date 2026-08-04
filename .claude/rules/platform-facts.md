# Platform facts

Facts about the toolchain and the host OS that this repo has already paid to
learn. Each one is external — it lives in git, node, pnpm, or Windows, not in
this code — so no test can pin it and no type can hold it. Rediscovering one
costs a broken run and a debugging session.

**Scope: `src/`, `bin/`, `scripts/`, `examples/`, `.flume/chain.ts`** — anything
that spawns a process, builds a path, or provisions a worktree.

A fact leaves this page only when it stops being true upstream. Add to it when
a run teaches something the same way: cite the source, state the consequence,
name what to do instead.

## pnpm deletes a symlinked `node_modules` on install

Never symlink or junction `node_modules` into a worktree and then run an
install in it. pnpm removes the link ([pnpm/pnpm#9973]), so the pattern breaks
the first time a fanout entry installs — silently, because the setup step
already reported success.

Materialize instead: `pnpm install --frozen-lockfile` inside the fresh
worktree. pnpm hardlinks from its global store, so the cost is seconds, not a
re-download. `enableGlobalVirtualStore` (`pnpm-workspace.yaml`,
[pnpm git-worktrees]) shares one store across worktrees and skips the install —
an **experimental opt-in**, never a default this repo teaches.

Whichever strategy: verify rather than assume. A sentinel gate that fails loud
when a dependency stops resolving from the worktree root is cheap, and the
sentinel derives from the worktree's own manifest rather than a hardcoded name.

[pnpm/pnpm#9973]: https://github.com/pnpm/pnpm/issues/9973
[pnpm git-worktrees]: https://pnpm.io/git-worktrees

## Node refuses to spawn a `.cmd` shim without a shell

Package-manager binaries are `.cmd` shims on Windows, and Node will not spawn
them without a shell — the [CVE-2024-27980] hardening. A bare
`execFile("pnpm", …)` is therefore a defect on win32.

Spawn direct first, then retry through a shell **only** on a win32 `ENOENT`.
Trying the shell first would pass chain-authored arguments through cmd.exe's
parser, which is a different bug.

This applies to gate binaries. It does **not** apply to `sh -c` — see the MSYS2
entry below, where cmd.exe is the wrong interpreter and the fallback is the
defect rather than the fix.

[CVE-2024-27980]: https://nvd.nist.gov/vuln/detail/CVE-2024-27980

## `git worktree add` refuses long paths on win32, below MAX_PATH

Around 200 characters, git fails with `fatal: '$GIT_DIR' too big`. The limit
sits **below** `MAX_PATH`, is **unaffected by `core.longpaths`**, and cannot be
reached by Node-side `toNamespacedPath` — git builds that path itself.

So a worktree directory name must be length-bounded independently of every
other path defence. Bound the directory, never the identifier it derives from:
truncate and append a hash of the full value so distinct inputs stay distinct,
and keep the full value everywhere it is read.

Separately, still pin `core.longpaths` repo-locally before creating worktrees —
it covers the ordinary `MAX_PATH` cases this limit is not.

## Windows MAX_PATH (~260 chars) breaks fs calls with no long component

Node's `fs` calls fail past Windows' ~260-character **total** path length even
where no single component is long — a worktree nested under a friction dir, a
job dir under a state root, a revert snapshot under `prior-attempts/`.
`toNamespacedPath` (`node:path`) prepends the `\\?\` extended-length prefix on
win32 and is a no-op elsewhere, which lets those calls survive it.

Any path built for an fs call wants `join` and `toNamespacedPath` together:
`namespacedJoin` (`src/paths.ts`) is the shared idiom. Reach for it instead of
a bare `join` — and instead of restating this fact in a new comment.

This is **not** the `git worktree add` limit above. That one is git's own
~200-char refusal, which `toNamespacedPath` cannot reach because git builds the
path itself. This one is the general Node fs limit, which it does fix.

## Filesystem `NAME_MAX` is 255, and scaffolding eats into it

Conservatively shared across ext4, APFS, and NTFS. Any identifier that becomes
a filename must leave room for whatever wraps it — a timestamp prefix, a
suffix, an extension. Size the bound off the **tightest** consumer, compute the
arithmetic at that writer rather than restating the number, and pin it against
the real writer with the longest input the schema accepts.

## Node's ESM registry is keyed by resolved URL and cannot be evicted

A fixed-path module is pinned to its first evaluation for the life of the
process. No content-hash query string, `tsx`/`tsImport` namespace, or loader
re-registration evicts it — verified empirically, and the plain-`import()`
control proves it is a Node constraint rather than a `tsx` bug.

An in-process reload also cannot pick up a change that rode a same-commit edit
to a module already evaluated.

Therefore **a process boundary is the only mechanism that re-reads a module
graph** — not an optimization to remove, the reason the design is shaped this
way.

## MSYS2 corrupts non-ASCII in argv; use stdin

`execFile("sh", ["-c", cmd])` fails for **any non-ASCII byte anywhere in
`cmd`** — bare, single-quoted, and double-quoted alike; `é` fails as readily as
`—`. Quoting is not implicated.

Nor is byte encoding: under `LC_ALL=C.UTF-8` the bytes arrive intact and the
command still fails. The damage happens inside MSYS2's re-parsing of the
Windows command line, which Node cannot influence from the spawn side.

Measured alternatives:

- `windowsVerbatimArguments` and `shell: true` — **exit 0 with empty stdout.**
  The silent-wrong-answer mode, worse than a visible failure.
- **stdin** — correct, non-ASCII intact. Note `sh` then consumes stdin.
- temp script file — also correct; buys stdin passthrough at the cost of
  file lifecycle and cleanup-on-crash.

Pass shell commands through **stdin**. Locale and argv-encoding fixes are
measured non-viable; do not re-propose them.

## Exit codes come from `sysexits.h`

Reuse the conventional numbers rather than inventing a scheme: `EX_CONFIG`
(78) for a declared-world inconsistency, `EX_UNAVAILABLE` (69) for a mount or
resolution failure. A caller must be able to classify a failure from the exit
status without reading logs, which is the whole reason the codes are distinct.
