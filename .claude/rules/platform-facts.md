---
paths:
  - "src/**"
  - "harness/**"
  - "tests/**"
  - "bin/**"
  - "scripts/**"
  - "examples/**"
  - ".flume/chain.ts"
---

# Platform facts

Facts about the toolchain and the host OS that this repo has already paid to
learn. Each one is external — it lives in git, node, pnpm, or Windows, not in
this code — so no test can pin it and no type can hold it. Rediscovering one
costs a broken run and a debugging session.

Scoped by frontmatter to anything that spawns a process, builds a path, or
provisions a worktree.

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

## A CommonJS-scoped `chain.ts` stops loading the ESM-only package at node 22.23

`tsx` loads `.flume/chain.ts` in the module mode the nearest `package.json`
declares. With no `"type": "module"` in scope that is CommonJS, and the
package is ESM-only. Measured against the published 0.16.0 on linux:

- a chain with a runtime import from `@dtmd/flume` loads on node 22.20,
  fails on 22.23 (`Cannot find module …/dist/…/index.js?namespace=…` — the
  query `tsx` appends stops resolving through a CommonJS load), and loads on
  node 24 through `require(esm)`;
- the chain `flume-harness init` writes fails on every node 22 without the
  manifest (`Cannot find module './declaration.js'` on 22.20, the harness
  subpath on 22.23) and loads on 24;
- a chain importing only types never loads the package at runtime and is
  green everywhere, which is why a type-only fixture proves nothing here.

`"type": "module"` in a `package.json` beside `chain.ts` fixes every row on
every node and touches none of the consumer's own files; a `tsconfig.json`
does not. A node patch upgrade is enough to cross the boundary, so an
existing consumer is one upgrade from a dead chain until the manifest is in
place.

## `npm install` resolves every manifest range from the registry, whatever the install supplies

`npm install <tarball>` still resolves each range the manifest names against
the registry before it reconciles `node_modules`. A manifest naming
`@dtmd/flume@^X.Y.Z` on a release-cut commit — that version tagged, not yet
published — makes any later `npm install` in that directory exit `ETARGET`
on a lookup unrelated to what it was asked to install. Measured against the
packed 0.16.0 while shipping the adoption smoke.

So a step that installs a pack into a consumer whose manifest names the
package's own unpublished version cannot install anything else afterward.
Give the pack a consumer directory of its own, with the tarball as the only
handoff between steps; the install order within one step is that step's to
declare at its site.

## Node caps a captured child stream at 1 MiB, and reports the overrun as a spawn failure

`execFile`, `exec`, and their sync forms keep at most `maxBuffer` bytes of a
child's stdout and of its stderr — 1 MiB each unless the call says otherwise.
On overrun node kills the child with `SIGTERM` and reports it where an exit
status would be, never as a truncation anything downstream can see:

- the async forms reject with `code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"`, a
  string where a numeric exit code would sit, and the captured output is cut
  at the cap;
- the sync forms throw `ENOBUFS` with `status: null` and `signal: "SIGTERM"`,
  the shape of a child that never exited.

Either way a large-but-correct run reads as a child that failed to run or
was signalled. Every spawn site declares its cap; a site that inherits the
default has chosen 1 MiB silently, and `git log` over an unreleased range has
exceeded it. The cap's size is the site's decision and stays there.

## `realpathSync` keeps the `\\?\` prefix only where nothing resolved

Node's JS `realpathSync` builds its answer from the argument it was handed.
Where it answers, a namespaced path comes back namespaced when no component
was a link, and as `readlink`'s un-prefixed target when one was — two answers
over one file differing by the prefix alone, decided only by how that file was
installed (pnpm's linked store against a plain copy). `realpathSync.native`
(libuv) strips the prefix unconditionally.

Through node 22 it does not answer at all on win32: it lstats the root it
splits off its argument before walking, reads `\\?\C:\…`'s leading `\\` as a
UNC root, hands that root to the binding unstripped, and throws on every
namespaced drive path. Node 24 strips the prefix for that one probe; it is not
backported, and `engines` admits 22. The callback `fs.realpath` is the same
JS walk with the same root probe, handing the error to its callback instead of
throwing it. `realpathSync.native`, `realpath.native`, and
`fs.promises.realpath` are the native binding, no root split, prefix stripped.
So a namespaced path goes to a native form, never a JS one.

A namespaced answer that is **compared** rather than handed back to an fs call
is folded out of the namespaced alphabet first — `plainPath` (`src/paths.ts`)
is the idiom, `namespacedJoin`'s inverse — on every leg of the comparison. With
the native call the answer's fold is a no-op, and `plainPath` is load-bearing
on the throwing leg alone. The fold is unconditional: no posix path or posix
`realpathSync` answer can begin with the prefix, so nothing is gated on the
platform.

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

## `tsx` decorates `import.meta.url` with a namespace query

A chain module loads under `tsx`, and `import.meta.url` can then arrive as
`file:///…/chain.ts?tsx-namespace=…`. Handing that URL to `createRequire`
fails on every call, because the specifier is no longer a plain file URL —
measured as a worktree hook failing on every tick in a consumer chain.

Strip the query first: `createRequire(import.meta.url.split("?")[0])`.

## A package-manager shim carries the manager's state into a gate

`pnpm exec tsc` runs under pnpm's own configuration — build-approval state,
workspace resolution — which is not the gate's subject and can differ between
a fresh worktree and the primary checkout. Two consumer chains independently
moved their gates to the binary itself for this reason.

Invoke the tool, not the manager, where the verdict must not depend on manager
state: `node node_modules/typescript/bin/tsc --noEmit`.

## A headless `claude -p` inherits the user's MCP servers

The agent binary boots every MCP server the user's own configuration names
unless told otherwise, so an autonomous tick inherits by-user runtime state
through the binary. A wedged MCP child has held a finished agent's process
open and stalled a whole fanout wave.

The engine passes `--strict-mcp-config` by default, so a tick loads only the
MCP configuration the chain hands it; `ClaudeCodeOptions.inheritUserMcp` is
the declared opt-out.

## Git quotes porcelain output per subcommand and per config; `-z` is the one spelling right everywhere

Measured on git 2.43. `status --porcelain` C-quotes and octal-escapes a path
with a trailing space or a non-ASCII byte; `worktree list --porcelain` prints
both raw (git 2.36's release note calls that a defect worked around by `-z`);
`show --name-only` leaves a space raw, quotes a non-ASCII byte unless
`core.quotePath=false`, and quotes a control character either way. A reader
assuming v1 quoting is wrong at one subcommand and a reader assuming raw bytes
is wrong at another.

Read every porcelain-shaped output NUL-separated (`-z`) and never parse quoting
by hand. `worktree list -z` is git 2.36+, which is the engine's git floor
(`spec/chain.md`, *The package a chain loads through*).

## Git pathspecs over-match, and the literal spelling depends on position

A pathspec is matched literally first and then as a glob, so a name carrying a
metacharacter matches itself *and* every glob sibling: `git add --
'.flume/jobs/a*'` stages `.flume/jobs/ab/` beside it. A test asserting only
that the named path was staged reads green on both sides. Three spellings make
a pathspec literal, and they are not interchangeable: `--literal-pathspecs`
is accepted by the main command only (`ls-tree` exits 129 on it),
`GIT_LITERAL_PATHSPECS=1` applies to the whole invocation from anywhere, and
`:(top,literal)<path>` applies to that one argument, anchored at the repo
root. Compose git's pathspecs at one spelling and pin the over-match case,
not the matched one.

## nvm scopes global packages to one node version

`npm install -g` writes into the active node version's own tree
(`~/.nvm/versions/node/<version>/bin`), and `nvm install <new>` puts a fresh,
empty tree on PATH. Every global package — the language server the sweep's
absence verdicts need among them — stays under the old version and vanishes
from PATH without an error. The signature is `which typescript-language-server`
empty while the previous version's `bin/` still holds it; the fix is
`npm install -g` under the active version, or `nvm install <new>
--reinstall-packages-from=<old>` at upgrade time. Nothing in the repo holds
this: no gate reads PATH, and an agent that lacks the tool parks the finding
rather than rebuilding the verdict from grep.

## TypeScript abandons a module lookup whose directory the host denies

`ts.createProgram` over a custom `CompilerHost` resolves an import by asking
the host `directoryExists` for each containing directory before it asks
`fileExists` for the candidate file, and a directory the host reports absent
ends the lookup there. A host that serves a virtual tree — an in-memory
`outDir`, a declaration emit never written to disk — and implements only
`fileExists` and `readFile` therefore resolves every cross-module import to
`unknown`, with no diagnostic: the program builds, the types are `unknown`,
and a scan over it reports an empty reach graph as a clean surface. Answer
`directoryExists` (and `getDirectories`) for every virtual path, and pin the
scan's judged count above zero so a silent resolution failure reds rather
than passes.

## `chmod` denies nothing on win32

A POSIX permission bit is the suite's denial primitive — `chmod(dir, 0o000)`
to make a directory unreadable, `0o444` to make a file unwritable — and on
win32 it toggles the read-only attribute and denies nothing: every read
succeeds, every "unreadable" refusal case resolves instead of rejecting, and
a lane reads the loud-or-nothing posture as verified when it was never
exercised. Deny structurally wherever the code path allows it — a plain file
where a directory is expected, a directory where a file is expected — which
denies on every host and survives a root-run test; where no structural
substitute exists, the case declares its host and skips on win32 with the
reason stated, never silently.

## `tmpdir()` can return an 8.3 short path git never spells

On win32 `os.tmpdir()` may hand back the DOS short form
(`C:\Users\RUNNER~1\AppData\Local\Temp`) while git reports every path it
holds in the resolved long form (`C:\Users\runneradmin\...`). A fixture that
composes a path from `mkdtemp(tmpdir())` and asserts it against git's
worktree registry, name-only output, or a pathspec reads two spellings of
one directory and fails on the comparison, not on the behavior. Canonicalize
with `realpath` on both sides before comparing; a separator fold alone does
not close it.

## win32 reports a path through a non-directory as not found

POSIX answers a lookup that passes through a plain file with `ENOTDIR`; win32
answers the same lookup with `ENOENT`, indistinguishable from a path whose
last segment is simply absent. And `statSync(path, { throwIfNoEntry: false })`
suppresses `ENOTDIR` as well as `ENOENT` on every host, so a probe built on it
takes its absent arm over an obstructed ancestor. An absent-or-present verdict
keyed on an errno is therefore wrong on one host or the other; prove absence
by descending the path and asserting each ancestor is a directory before the
next segment is probed, and never deny a fixture's *parent* to stand in for
denying the read — that un-arms the case on both hosts. The one exception is
its converse: a reader that carries the descent is exercised *only* by an
obstructed ancestor, so a case pinning that reader denies the parent on
purpose and says so at the site.

## win32 refuses to spawn a process whose working directory exceeds MAX_PATH

Beside the ~260-character limit `toNamespacedPath` clears and the `git
worktree add` ceiling it cannot, a third: `CreateProcess` refuses a `cwd`
longer than MAX_PATH, and Node reports it as `spawn <bin> ENOENT` — the
binary looks missing when the directory is what was refused. No flume-built
path is involved, so the `\\?\` prefix cannot reach it; the OS resolves the
working directory itself. A fixture proving a long-path behavior therefore
puts its depth on the *subject* path — a long job name, a deep config dir, a
deep queue path — and never on a directory git or any process is spawned in,
or asked to create a worktree under.
