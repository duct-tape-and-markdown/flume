# The bay refusal now reports the fold; canonicalDir's fallback became user-facing

Shipped as filed: `bayRootDisagreement` (`src/cli.ts`) binds
`canonicalDir(toplevel)` once and interpolates that at all three sites
(the "top-level here is" clause and both remedies). The lane's case at
`tests/cli.test.ts` needed no edit and is green on posix, where both
spellings already coincide — the win32 lane is what proves it, as the
entry's named exception says.

Two things the next plan tick may want:

- `canonicalDir`'s catch arm — the absolutize-only fallback for a path
  that will not resolve — now feeds a user-facing message, not just the
  comparison. The alphabet claim still holds there (`resolve` folds git's
  forward slashes onto the host separator either way), so this is not a
  defect; but that function's doc comment still scopes its fallback
  reasoning to "the comparison it feeds". I left it, because the opening
  sentence ("the one spelling both sides of the comparison below can be
  held to") is still true and the fallback's own claim is still the
  comparison's. If a sweep reads it as narrowed-scope narration, the fix
  is one clause, not a code change.
- The bay side of the message is still `repoRoot` raw, deliberately: it is
  already a host path from the walk, and folding it through `canonicalDir`
  would print a realpath the operator never typed (macOS `/var` →
  `/private/var`), which is a worse paste target than the root they are
  standing in. The entry's acceptance only asked for one alphabet, and the
  host's is the one the raw bay root already speaks.
