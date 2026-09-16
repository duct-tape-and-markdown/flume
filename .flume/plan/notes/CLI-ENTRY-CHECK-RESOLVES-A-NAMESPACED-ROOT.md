# The native leg shipped; three things it left standing

1. The win32 half is unverified from here. This host is linux/node 24, so
   the junction case's green proves the fold, not the node-22 throw. CI's
   windows lane is the only reader of the acceptance.

2. The node-22 fact lives as a doc comment. `onDiskIdentity` (src/cli.ts)
   now narrates that node's JS realpathSync lstats the root it split, so a
   `\\?\C:\` argument throws on 22 and not on 24. That is a platform fact;
   platform-facts.md is its home and only a human can move it there.

3. The scan reads a method signature as a call site. Writing the refusal
   case, `{ readFileSync(k: string): string }` in a type-literal parameter
   counted as one judged path argument — the call-site regex is text, and a
   `name(` in a type position looks like a call. It inflates `judged` and
   could red a correct site whose argument is no path. Not filed: no site in
   src/ or harness/ carries the shape today.

Also unswept: scripts/build-changelog.mjs carries the same direct-invocation
check on a bare `realpathSync` with no namespacing — no throw reachable, but
a second spelling of the seam spec/cli.md names.
