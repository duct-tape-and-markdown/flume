# The answer reader follows an expression, not a binding graph

The scan now reads where a namespaced answer goes, but only outward through
the call expression the fs call sits in (`tests/helpers/namespacedFsScan.ts`,
*Where the answer goes*). An answer written into a `const` and then handed to
a non-fs reader two statements later still ships green. Following bindings
forward needs the use-direction of the resolver `isComposed` already walks
backward, and a callback or a cross-module return (the `namespacedJoin`
arrows in `harness/planState.ts`) ends that walk anyway — so the bound is
declared at the site rather than half-caught. If a second escape lands
through a binding, that is the entry to file, not a wider regex.

Also: `src/cli.ts` held the only `realpath`-family call in either tree, so
the new verdict's vacuity count rides on it plus the `mkdir` family. A commit
that drops the entry-direct check reds the vacuity pin rather than the
verdict — right per *A green verdict is proven non-vacuous*, but it will read
as an unrelated failure to whoever hits it.
