# The note rule had one consumer left, and the win32 lane lost an arm

Shipped: `flume friction <name>` now asks `frictionNotes` (`src/friction.ts`)
whether the name is a note, instead of spelling `isDirectChild && !isDotName`
beside it. The dot arm, the directory-child arm, and the absent arm all fall
out of the listing's own `isFile() && !isDotName`, so the named arm's only
`EX_IOERR` left is a read that failed.

Two things the next plan tick may want:

1. **An export went private in the same commit.** `FRICTION_SUBJECT` was
   exported from `src/friction.ts` for exactly one consumer — the descent the
   named arm used to run itself. With that gone its only reference is inside
   its own module, so `tests/exportConsumers.test.ts` would have redded it;
   it is a module-local `const` now. Worth noting as a shape: a
   "shared-vocabulary" export can be load-bearing only for the duplication
   the sweep is about to delete, and the export pin is what surfaces that.

2. **The named-read `EX_IOERR` arm is now posix-only.** Its old fixture was a
   directory in the note's place (structural, every host) — the very input
   this entry reclassified as absent. Nothing structural reaches the arm any
   more: the listing's `isFile()` filters out a directory, a symlink and a
   device before the read, so the case is `chmod(dir, 0o444)` and declares
   posix (`tests/helpers/host-declarations.json`). The win32 lane keeps
   coverage of the named arm's *absent* dispositions and of the channel-
   obstruction refusal, but no longer of a note that lists and will not open.
   That is a real narrowing, not a fixture choice — filing it is plan's call.

No help-page change was needed: `src/cliHelp.ts` already promised exit 2 for
"a name that names no file directly under the channel dir" and scoped 74 to
something that exists and could not be read. The divergence was one-sided,
in the code.
