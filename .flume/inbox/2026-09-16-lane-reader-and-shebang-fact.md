# Ruled: the Windows lane declares its title reader; the shebang fact has its home

Closes the two questions parked at d0d39286.

- *Do flume's own CI lanes declare a `titles` reader?* — (b). This repo's
  `windows` lane declares the vitest pattern, `FAIL <file> > <title>`, so a
  red that persists unchanged stops re-waking; `posix` declares none, since
  its job also runs steps that fail without a title and an empty set over a
  real red would read as drained. `.flume/declaration.ts`, the human's.
- *Does `platform-facts.md` carry "win32 spawns no shebang script"?* —
  added beside the `chmod` section: no loader reads `#!`, libuv appends
  `.exe` to an extensionless target, a `.cmd` substitute is a different
  subject. What derives: the four ledger rows shrink to a cite.
