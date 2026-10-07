# Posture sweep

This repo's lenses for the sweep. The procedure — the frontier, the
neighborhood, the rotation, the routing bar, the stamp — is the package's
(`spec/harness.md`, *The sweep procedure*), and the domain and the posture
pages are declared in `.flume/declaration.ts` (`slices.sweep`).

`tests/` is not a frontier of its own: a test is read as part of the
neighborhood of the module it exercises, and a test-only finding files against
that module.

This page is deliberately not a declared posture page: Claude Code loads it
into every tick, so a lens edited here reaches every neighborhood swept after
the edit and reopens none already covered, where declaring it would price
every wording change at a full rotation. Root config and the declaration are
outside the domain; a finding there arrives through the inbox.

## Standing lenses

Beyond the pages' own sections, the sweep reads every neighborhood through
these. Each is a bulleted lead so a cite can name it.

- **A module carrying jobs that want separate homes** — the cohesion read
  `engineering.md`, *A module is one job* administers.
- **Dead plumbing** — unconstructable branches, vacuous result paths.
- **Embedded provider knowledge** — documented external facts (tool names,
  path layouts, payload shapes) as literals outside the surface that owns
  them.
- **Expired narration** — prose whose stated scope has closed or whose
  revisit condition has fired: a comment scoped to a shipped release line,
  an `interim` marker whose retiring change has landed, a "revisit when X"
  whose X is observable now. The sweep domain for this lens includes
  `.flume/chain.ts` and `.flume/PROTOCOL.md`, which carry decisions no
  other lens reads.
- **A negative assertion over a whole rendered artifact** — a `not.toMatch`
  or `not.toContain` whose subject is an entire rendered prompt, log, or
  verdict turns on whatever else that artifact happens to quote — a stack
  trace carrying the worktree path, and so the entry tag — rather than on
  the arm the case is about. Green by accident today, red for any tag
  spelling the forbidden phrase tomorrow. The assertion reads its own block.
- **A repo-relative path composed with `node:path`** — a value the engine
  reports in git's alphabet (`stateRootRel`, a pathspec, a name-only line)
  joined or resolved through the host's separator before it reaches git
  again. Correct on posix by accident, wrong on win32 silently; the fold
  belongs at the one reporter, never at the composer.
- **Consumer restatement** — the engine read from the consumer's side
  (`engineering.md`, *A fact the engine holds is reported*). The consumers
  this repo carries are `examples/` and `.flume/chain.ts`; a decorator
  parsing agent output, a constant mirroring a gate's command, a copied
  path rule, or a predicate inferring engine state from commit shape is
  filed against the engine surface that should have reported the fact.
  Downstream chains outside this repo are the interactive session's to
  read, and their findings enter through the inbox.
- **An absence verdict never rests on a bare text search** — proving a
  symbol is *un*referenced needs a search that resolves symbols — LSP
  references (`code-navigation.md`) — never a plain no-hits. A host without
  the instrument leaves the finding unmade and says so (`engineering.md`,
  *An export earns its consumer*).
