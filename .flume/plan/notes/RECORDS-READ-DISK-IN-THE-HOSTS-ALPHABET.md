# The record listing was also un-namespaced, and the same shape may sit elsewhere

Fixing the alphabet meant introducing a bare `join` for an fs call, which
`platform-facts.md`, *Windows MAX_PATH*, refuses: a record sits under a
chain-declared state root and a note's name is an entry's tag, both of which
the `spec/cli.md` depth bar names. So `recordFiles` namespaces its
`readdirSync` and `inboxWindow` namespaces its `readFileSync`, while the paths
handed back stay plain — that is what the pin claims and what a tick opens.

Two things for the next rotation:

- No posix-decidable regression exists for the alphabet itself. The pin holds
  on both hosts and only bites on win32; the lane's record-cap case is the real
  repro. Named in the commit body as the exception `engineering.md`, *A fix
  ships the test that would have caught it*, allows.
- The same un-namespaced-fs-call shape may sit on other `harness/` disk reads I
  did not open. A sweep lens over `harness/` for `readFileSync`/`readdirSync`
  on a `join`-built path would settle it cheaply.
