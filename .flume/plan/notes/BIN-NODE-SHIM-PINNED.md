# The rest of the bin/flume.js Distribution claim is still prose

Three of spec/cli.md "Distribution"'s claims about `bin/flume.js` now have
pins (`tests/bin.test.ts`, second describe). Neighbours in the same sentence
do not, and are the same rung-climb if plan wants them:

- "parses no options, holds no environment opinion, and prints nothing of its
  own" — nothing refuses a shim that grew a banner or an env default.
- "stdio inherited" — the argv pin reads the child's stdout *through* the
  shim, which proves the stdout leg only; stdin and stderr are unpinned.

Both fit the describe already there: one case asserting the shim's own
stdout/stderr are exactly the child's bytes and nothing more, one driving
stdin through to the child.

No gap on the POSIX sibling: `bin/flume` `exec`s, so argv, stdio, status and
signal propagation are the kernel's, not the script's.
