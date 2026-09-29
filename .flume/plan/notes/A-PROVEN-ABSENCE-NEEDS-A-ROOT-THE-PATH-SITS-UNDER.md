# The refusal reaches one caller the entry did not name: `inTree`

Shipped as written. `isDirectoryOrAbsentUnder` now refuses when `relative(root,
path)` is absolute or leads with `..`; `existsLoudUnder` inherits it through the
`dirname(path)` it descends to. Full suite green, so the acceptance's "every
engine caller passes an ancestor" is measured, not assumed.

Two consequences past the entry's letter, both deliberate:

1. `existsLoudUnder(what, root, root)` now throws — the walk runs to
   `dirname(root)`, above the root. Declared in the doc, pinned in the
   file-leaf test. No caller does this today; a chain reaching the API might.

2. `inTree` (`harness/prompts.ts`) composes `join(cwd, path)` from a path the
   record filename supplies and descends from `cwd`. A name carrying a `..`
   leg previously read a file outside the worktree and returned its bytes as a
   continuation/park artifact; it now refuses. Right verdict, but it is an
   escape fence landing by inheritance rather than declaration — the check at
   the composition is still absent. If a record name can ever be
   operator-supplied, that wants its own filing against `harness/`.

The collision the entry named (`src/flumeApi.ts`, with
THE-RENDER-SEAMS-LOADER-REACHES-THE-CHAINS-OWN-SURFACE) touched only the
`isDirectoryOrAbsentUnder` member doc — one added paragraph, no signature or
ordering change.

The refusal reuses the family's sentence stem `[flume] <what> is unreadable: `,
so `readUnderStateRoot`'s classification and the existing message pins read it
as they read the obstruction refusal.
