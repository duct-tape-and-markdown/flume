# The smoke's refusal is win32-only, and `scripts/` is outside the program

Shipped: `run` (`scripts/smoke-install.mjs`) refuses, per step, an argv
`wordShimRetryWouldRewrite` (`src/spawnShim.ts`) says cmd.exe would re-parse.
Three invocation sites take `--import tsx`; a new case pins that agreement
(script imports `src/*.ts` -> every site carries the loader).

Two things for the next plan tick.

1. **Nothing in-tree exercises the refusal.** The arm is gated on `IS_WIN`,
which reads `process.platform` at module load in a script the suite cannot
import in pieces — `run` is not exported and the module runs the whole smoke
on load. I proved the arm out of tree: a copy with `IS_WIN = true`, driven at
`--scratch "/tmp/probe dir"`, refuses at `npm pack` naming the word, exit 1.
That is a measurement, not a pin. If plan wants one, the shape is the split
`engineering.md`, *A module is one job* already implies: `run` (and the
`IS_WIN` it reads) in a module of its own, the script as its caller, the
predicate call reading a platform passed in. That is a real entry, not this
one's scope.

2. **`scripts/` is in no tsconfig `include`.** The new import of
`src/spawnShim.ts` from a `.mjs` under `scripts/` is checked by no typecheck
and resolved only at run time — the smoke itself is the only thing that would
catch a rename, and only on a lane that runs it. Same for
`scripts/build-changelog.mjs` and `scripts/pack-harness-assets.mjs`, which
import nothing from `src/` today. The citation pin does read backticked
`src/` paths in comments there, so the *doc* cite is held while the *import*
is not. Worth a decision: widen `include` (they are `.mjs`, so
`allowJs`/`checkJs` questions come with it), or leave it and say so.

Also found: the release lane's flag-agreement case scanned every `--flag` in
the step, node's own included, so `--import` read as a script flag. Scoped to
the words after the script path.
